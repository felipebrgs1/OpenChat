/**
 * R1 — Runner de avaliação do RAG.
 * Mede: hit@k, isolamento, latência p50/p95, custo estimado, negative correct.
 * Persiste em rag_evaluation_run + rag_evaluation_result.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db, ragEvaluationCases, ragEvaluationResults, ragEvaluationRuns, roles } from "@nexo/db";

import { embeddingModel } from "./embeddings";
import { retrieveKnowledgeChunks } from "./rag";

export type EvalParams = {
  topK: number;
  embeddingModel: string;
  pipelineVersion: string;
};

export type CaseRow = typeof ragEvaluationCases.$inferSelect;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function estimateEmbeddingCost(texts: string[], model: string): number {
  // estimativa simples: ~4 chars/token, preço text-embedding-3-small ~0.02 USD / 1M tokens
  // ajusta se modelo diferente; v1 só estima
  const totalChars = texts.join("").length;
  const tokens = Math.ceil(totalChars / 4);
  const perMillion = model.includes("3-small") ? 0.02 : 0.05;
  return (tokens / 1_000_000) * perMillion;
}

export async function runRagEvaluation(opts?: {
  pipelineVersion?: string;
  topK?: number;
  limit?: number;
}) {
  const pipelineVersion = opts?.pipelineVersion ?? `rag-v1-${Date.now()}`;
  const topK = opts?.topK ?? 6;
  const cases = await db
    .select()
    .from(ragEvaluationCases)
    .orderBy(asc(ragEvaluationCases.createdAt));
  const filtered = opts?.limit ? cases.slice(0, opts.limit) : cases;

  if (filtered.length === 0) {
    throw new Error(
      "Nenhum caso em rag_evaluation_case. Rode bun run --cwd packages/db src/seed-rag.ts",
    );
  }

  // resolve slug -> roleId para testes de isolamento
  const allRoles = await db.select().from(roles);
  const slugToId = new Map(allRoles.map((r) => [r.slug, r.id]));

  const gitCommit = process.env.GIT_COMMIT?.slice(0, 12) ?? null;
  const model = embeddingModel();

  const [run] = await db
    .insert(ragEvaluationRuns)
    .values({
      pipelineVersion,
      gitCommit,
      params: { topK, embeddingModel: model, totalCases: filtered.length },
    })
    .returning();
  if (!run) throw new Error("failed to create run");

  const latencies: number[] = [];
  let totalCost = 0;
  let hits = 0;
  let hitCandidates = 0; // só factual/procedural com expectedCollection
  let negativeCorrect = 0;
  let negativeTotal = 0;
  let accessDeniedCorrect = 0;
  let accessDeniedTotal = 0;
  let errors = 0;

  // pré-aquece custo de embeddings das perguntas (estimado)
  const questions = filtered.map((c) => c.question);
  const estimatedQuestionCost = estimateEmbeddingCost(questions, model);

  for (const c of filtered) {
    const roleId = c.allowedRoleSlug ? (slugToId.get(c.allowedRoleSlug) ?? null) : null;
    // para negative/access_denied, o comportamento esperado difere
    const start = performance.now();
    let chunks: Awaited<ReturnType<typeof retrieveKnowledgeChunks>> = [];
    let error: string | null = null;
    try {
      // se não tem roleId (null) e categoria não é all, usa admin para testar visibilidade all vs by_role
      // para access_denied queremos justamente testar que role restrito não recupera
      const effectiveRoleId = roleId ?? slugToId.get("admin") ?? null;
      // para casos de isolamento, usamos o role negado mesmo; para negative usamos o role permitido
      chunks = await retrieveKnowledgeChunks(c.question, effectiveRoleId as string | null, topK);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      errors += 1;
    }
    const latencyMs = Math.round(performance.now() - start);
    latencies.push(latencyMs);

    // custo real de embedding só da query (1 embedding); chunks já indexados não custam na query
    let costUsd: number | null = null;
    try {
      // estimativa por query
      costUsd = estimateEmbeddingCost([c.question], model);
      totalCost += costUsd;
    } catch {
      costUsd = null;
    }

    const retrievedTitles = chunks.map((ch) => ch.title);
    const retrievedIds = chunks.map((ch) => ch.chunkId);

    let hit: boolean | null = null;
    let meta: Record<string, unknown> = {
      latencyMs,
      retrievedTitles,
      expectedCollectionSlug: c.expectedCollectionSlug,
      expectedDocumentTitle: c.expectedDocumentTitle,
      category: c.category,
      allowedRoleSlug: c.allowedRoleSlug,
      tags: c.tags,
    };

    if (c.category === "factual" || c.category === "procedural") {
      hitCandidates += 1;
      // hit = algum chunk retornado pertence à coleção/documento esperado
      // como retrieve só retorna title, comparamos por title ou coleção via title
      const expectedTitle = c.expectedDocumentTitle?.toLowerCase() ?? "";
      hit = retrievedTitles.some((t) => t.toLowerCase() === expectedTitle);
      if (hit) hits += 1;
      meta = { ...meta, hit, expectedTitle };
    } else if (c.category === "negative") {
      negativeTotal += 1;
      // negative: esperado que NÃO encontre fonte relevante (retrieval vazio ou sem hit)
      // consideramos correto se hit==false ou lista vazia
      const hasExpected = c.expectedDocumentTitle
        ? retrievedTitles.some((t) => t.toLowerCase() === c.expectedDocumentTitle!.toLowerCase())
        : retrievedTitles.length > 0;
      // para negative sem expected, correto é lista vazia ou irrelevante; como não temos juízo de relevância sem LLM, usamos vazio como correto
      const correct = c.expectedDocumentTitle ? !hasExpected : retrievedTitles.length === 0;
      // se coleta é null, qualquer resultado é considerado falso positivo
      hit = c.expectedDocumentTitle ? hasExpected : retrievedTitles.length > 0;
      if (correct) negativeCorrect += 1;
      meta = { ...meta, negativeCorrect: correct, hit };
    } else if (c.category === "access_denied") {
      accessDeniedTotal += 1;
      // access_denied: usuário com cargo sem permissão NÃO deve recuperar a coleção esperada
      const expectedTitle = c.expectedDocumentTitle?.toLowerCase() ?? "";
      const leaked = retrievedTitles.some((t) => t.toLowerCase() === expectedTitle);
      hit = leaked;
      const correct = !leaked;
      if (correct) accessDeniedCorrect += 1;
      meta = { ...meta, leaked, accessDeniedCorrect: correct, hit };
    }

    await db.insert(ragEvaluationResults).values({
      runId: run.id,
      caseId: c.id,
      hit,
      retrievedChunkIds: retrievedIds,
      retrievedTitles,
      latencyMs,
      costUsd: costUsd !== null ? String(costUsd) : null,
      error,
      meta,
    } as never);
  }

  latencies.sort((a, b) => a - b);
  const summary = {
    total: filtered.length,
    hitCandidates,
    hits,
    hitRate: hitCandidates ? hits / hitCandidates : null,
    negativeTotal,
    negativeCorrect,
    negativeCorrectRate: negativeTotal ? negativeCorrect / negativeTotal : null,
    accessDeniedTotal,
    accessDeniedCorrect,
    accessDeniedCorrectRate: accessDeniedTotal ? accessDeniedCorrect / accessDeniedTotal : null,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    totalCostUsd: Number((totalCost + estimatedQuestionCost).toFixed(6)),
    estimatedQuestionCostUsd: Number(estimatedQuestionCost.toFixed(6)),
    errors,
    model,
    topK,
  };

  const [updated] = await db
    .update(ragEvaluationRuns)
    .set({ summary })
    .where(eq(ragEvaluationRuns.id, run.id))
    .returning();

  return { run: updated ?? run, summary, latencies };
}

export async function listRuns(limit = 20) {
  return db
    .select()
    .from(ragEvaluationRuns)
    .orderBy(sql`${ragEvaluationRuns.createdAt} DESC`)
    .limit(limit);
}

export async function compareRuns(runIdA: string, runIdB: string) {
  const [a, b] = await Promise.all([
    db
      .select()
      .from(ragEvaluationRuns)
      .where(eq(ragEvaluationRuns.id, runIdA))
      .then((r) => r[0]),
    db
      .select()
      .from(ragEvaluationRuns)
      .where(eq(ragEvaluationRuns.id, runIdB))
      .then((r) => r[0]),
  ]);
  if (!a || !b) throw new Error("run não encontrado");
  const aSummary = (a.summary ?? {}) as Record<string, unknown>;
  const bSummary = (b.summary ?? {}) as Record<string, unknown>;
  const diff: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(aSummary), ...Object.keys(bSummary)])) {
    if (typeof aSummary[k] === "number" && typeof bSummary[k] === "number") {
      diff[k] = (bSummary[k] as number) - (aSummary[k] as number);
    }
  }
  return { a, b, diff };
}
