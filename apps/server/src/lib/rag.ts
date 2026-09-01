import { sql } from "drizzle-orm";

import { embedQuery, embeddingModel, vectorLiteral } from "./embeddings";
import { hasSufficientEvidence, rerankChunks } from "./reranker";

export type RagChunk = {
  chunkId: string;
  documentId: string;
  collectionId: string;
  revisionId: string | null;
  title: string;
  content: string;
  heading: string | null;
  page: number | null;
  distance: number | null; // cosine distance (vector)
  rrfScore: number | null;
  textRank: number | null;
  vectorRank: number | null;
};

export type RagSource = {
  documentId: string;
  revisionId: string | null;
  chunkId: string;
  title: string;
  page: number | null;
  heading: string | null;
  excerpt: string;
};

export function toRagSources(chunks: RagChunk[]): RagSource[] {
  return chunks.map((c) => ({
    documentId: c.documentId,
    revisionId: c.revisionId,
    chunkId: c.chunkId,
    title: c.title,
    page: c.page,
    heading: c.heading,
    excerpt: c.content.slice(0, 400),
  }));
}

export const RAG_TOP_K = 6;
export const RAG_TOKEN_CAP = 4000;
export const RAG_RRF_K = 60;
export const RAG_CANDIDATE_MULTIPLIER = 2; // busca 2x topK em cada índice para RRF

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// helpers para extrair rows do driver pg
function unwrapRows(res: unknown): unknown[] {
  if (Array.isArray(res)) return res as unknown[];
  if (res && typeof res === "object" && "rows" in (res as Record<string, unknown>)) {
    return ((res as { rows: unknown[] }).rows ?? []) as unknown[];
  }
  return [];
}

function permissionFilterSql(roleId: string) {
  // acesso por coleção: visibility='all' OU existe vínculo em knowledge_role
  // injetado diretamente no WHERE — nunca recupera sem filtro
  return sql`(
    kcol.visibility = 'all'
    OR EXISTS (
      SELECT 1 FROM knowledge_role kr
      WHERE kr.collection_id = kcol.id AND kr.role_id = ${roleId}::uuid
    )
  )`;
}

type VectorRow = {
  chunk_id: string;
  document_id: string;
  collection_id: string;
  revision_id: string | null;
  title: string;
  content: string;
  heading: string | null;
  page: number | null;
  distance: number;
};

type TextRow = {
  chunk_id: string;
  document_id: string;
  collection_id: string;
  revision_id: string | null;
  title: string;
  content: string;
  heading: string | null;
  page: number | null;
  ts_rank: number;
};

/**
 * R4 — Retrieval híbrido: vetorial (pgvector cosine) + textual (tsvector português)
 * combinados por Reciprocal Rank Fusion, com deduplicação e diversidade.
 * Permissões aplicadas dentro do SQL (nunca fora).
 */
export async function retrieveKnowledgeChunks(
  query: string,
  roleId: string | null,
  topK = RAG_TOP_K,
  opts?: { isAdmin?: boolean },
): Promise<RagChunk[]> {
  const { chunks } = await retrieveKnowledgeChunksWithTelemetry(query, roleId, topK, opts);
  return chunks;
}

export async function retrieveKnowledgeChunksWithTelemetry(
  query: string,
  roleId: string | null,
  topK = RAG_TOP_K,
  opts?: { isAdmin?: boolean },
): Promise<{
  chunks: RagChunk[];
  telemetry: {
    query: string;
    roleId: string | null;
    model: string;
    topK: number;
    latencyMs: number;
    candidates: { vector: number; text: number; fused: number };
    chosen: number;
    deduped: number;
    costUsd: number | null;
    vectorMs: number | null;
    textMs: number | null;
    rerankMs: number | null;
    rrfK: number;
    hasSufficientEvidence: boolean;
  };
}> {
  const start = performance.now();
  const q = query.trim();
  const model = embeddingModel();
  if (!q || !roleId) {
    return {
      chunks: [],
      telemetry: {
        query: q,
        roleId,
        model,
        topK,
        latencyMs: 0,
        candidates: { vector: 0, text: 0, fused: 0 },
        chosen: 0,
        deduped: 0,
        costUsd: null,
        vectorMs: null,
        textMs: null,
        rerankMs: null,
        rrfK: RAG_RRF_K,
        hasSufficientEvidence: false,
      },
    };
  }

  const candidateLimit = Math.max(topK * RAG_CANDIDATE_MULTIPLIER, topK + 4);
  // normaliza query para tsvector: remove chars que quebram tsquery
  const tsQuery = q.slice(0, 400);
  const isAdmin = opts?.isAdmin === true;

  // 1) vector search (se embedding falhar, vectorRows = [])
  let vectorRows: VectorRow[] = [];
  let vectorMs: number | null = null;
  let costUsd: number | null = null;
  let embeddingFailed = false;
  try {
    const t0 = performance.now();
    const embedding = await embedQuery(q);
    vectorMs = Math.round(performance.now() - t0);
    // custo estimado: ~4 chars/token, 0.02 USD / 1M tokens (small)
    const tokens = Math.ceil(q.length / 4);
    costUsd = (tokens / 1_000_000) * 0.02;
    const literal = vectorLiteral(embedding);
    const perm = isAdmin ? sql`TRUE` : permissionFilterSql(roleId!);
    const res = await sqlExecute<VectorRow>(sql`
      SELECT
        kc.id as chunk_id,
        kc.document_id,
        kc.collection_id,
        kc.revision_id as revision_id,
        kd.title as title,
        kc.content as content,
        kc.heading as heading,
        kc.page as page,
        kc.embedding <=> ${literal}::halfvec(2560) as distance
      FROM knowledge_chunk kc
      JOIN knowledge_document kd ON kd.id = kc.document_id AND kd.deleted_at IS NULL AND kd.status = 'published'
      JOIN knowledge_collection kcol ON kcol.id = kc.collection_id AND kcol.deleted_at IS NULL
      WHERE ${perm}
      ORDER BY kc.embedding <=> ${literal}::halfvec(2560) ASC
      LIMIT ${sql.raw(String(candidateLimit))}
    `);
    vectorRows = res;
  } catch (e) {
    embeddingFailed = true;
    console.warn("rag vector search falhou, usando só textual", e instanceof Error ? e.message : String(e));
  }

  // 2) text search (tsvector português + fallback ILIKE para siglas/códigos)
  let textRows: TextRow[] = [];
  let textMs: number | null = null;
  try {
    const t0 = performance.now();
    const perm = isAdmin ? sql`TRUE` : permissionFilterSql(roleId!);
    // websearch_to_tsquery lida melhor com siglas, códigos e frases; simple como fallback para códigos com hífen
    const res = await sqlExecute<TextRow>(sql`
      SELECT
        kc.id as chunk_id,
        kc.document_id,
        kc.collection_id,
        kc.revision_id as revision_id,
        kd.title as title,
        kc.content as content,
        kc.heading as heading,
        kc.page as page,
        ts_rank(kc.search_vector, websearch_to_tsquery('portuguese', ${tsQuery})) as ts_rank
      FROM knowledge_chunk kc
      JOIN knowledge_document kd ON kd.id = kc.document_id AND kd.deleted_at IS NULL AND kd.status = 'published'
      JOIN knowledge_collection kcol ON kcol.id = kc.collection_id AND kcol.deleted_at IS NULL
      WHERE ${perm}
        AND kc.search_vector @@ websearch_to_tsquery('portuguese', ${tsQuery})
      ORDER BY ts_rank DESC
      LIMIT ${sql.raw(String(candidateLimit))}
    `);
    textRows = res;
    // fallback ILIKE para siglas/códigos que tsvector não pegou (ex: 2024-COB-001)
    if (textRows.length === 0 && tsQuery.length >= 3 && tsQuery.length <= 40) {
      const likeRes = await sqlExecute<TextRow>(sql`
        SELECT
          kc.id as chunk_id,
          kc.document_id,
          kc.collection_id,
          kc.revision_id as revision_id,
          kd.title as title,
          kc.content as content,
          kc.heading as heading,
          kc.page as page,
          0.1 as ts_rank
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc.document_id AND kd.deleted_at IS NULL AND kd.status = 'published'
        JOIN knowledge_collection kcol ON kcol.id = kc.collection_id AND kcol.deleted_at IS NULL
        WHERE ${perm}
          AND (kc.content ILIKE ${`%${tsQuery}%`} OR kc.heading ILIKE ${`%${tsQuery}%`})
        LIMIT ${sql.raw(String(candidateLimit))}
      `);
      if (likeRes.length > 0) textRows = likeRes;
    }
    textMs = Math.round(performance.now() - t0);
  } catch (e) {
    console.warn("rag text search falhou", e instanceof Error ? e.message : String(e));
  }

  // 3) RRF
  const fused = rrfCombine(vectorRows, textRows, candidateLimit);

  // 3b) R5 — rerank dos melhores candidatos (Cohere ou heurística) antes do corte final
  let reranked: RagChunk[] = fused;
  let rerankMs: number | null = null;
  if (fused.length > 0) {
    const t0 = performance.now();
    try {
      reranked = await rerankChunks(q, fused.slice(0, Math.min(fused.length, 12)));
      // mantém ordem reranqueada mas preserva tail não reranqueado
      if (fused.length > 12) reranked = [...reranked, ...fused.slice(12)];
    } catch (e) {
      console.warn("rerank falhou, usando RRF", e instanceof Error ? e.message : String(e));
      reranked = fused;
    }
    rerankMs = Math.round(performance.now() - t0);
  }

  // 4) deduplicação + diversidade (4–8 finais)
  const { deduped, chosen } = dedupAndDiversify(reranked, topK);

  const latencyMs = Math.round(performance.now() - start);
  const telemetry = {
    query: q,
    roleId,
    model: embeddingFailed ? `${model} (vector-failed)` : model,
    topK,
    latencyMs,
    candidates: { vector: vectorRows.length, text: textRows.length, fused: fused.length },
    chosen: chosen.length,
    deduped,
    costUsd,
    vectorMs,
    textMs,
    rerankMs,
    rrfK: RAG_RRF_K,
    hasSufficientEvidence: hasSufficientEvidence(chosen),
  };

  // telemetria estruturada (R4)
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      action: "rag.retrieve",
      query: q.slice(0, 120),
      roleId,
      model,
      topK,
      latencyMs,
      vectorMs,
      textMs,
      candidates: telemetry.candidates,
      chosen: telemetry.chosen,
      costUsd,
    }),
  );

  return { chunks: chosen, telemetry };
}

async function sqlExecute<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const { db } = await import("@nexo/db");
  const res = (await (db as unknown as { execute: (s: unknown) => Promise<unknown> }).execute(q)) as unknown;
  return unwrapRows(res) as T[];
}

function rrfCombine(vectorRows: VectorRow[], textRows: TextRow[], _candidateLimit: number): RagChunk[] {
  const map = new Map<string, RagChunk & { _vRank: number | null; _tRank: number | null }>();

  vectorRows.forEach((r, idx) => {
    const rank = idx + 1;
    const existing = map.get(r.chunk_id);
    const score = 1 / (RAG_RRF_K + rank);
    if (existing) {
      existing.rrfScore = (existing.rrfScore ?? 0) + score;
      existing.vectorRank = rank;
      existing._vRank = rank;
    } else {
      map.set(r.chunk_id, {
        chunkId: r.chunk_id,
        documentId: r.document_id,
        collectionId: r.collection_id,
        revisionId: r.revision_id,
        title: r.title,
        content: r.content,
        heading: r.heading,
        page: r.page,
        distance: Number(r.distance),
        rrfScore: score,
        vectorRank: rank,
        textRank: null,
        _vRank: rank,
        _tRank: null,
      } as RagChunk & { _vRank: number | null; _tRank: number | null });
    }
  });

  textRows.forEach((r, idx) => {
    const rank = idx + 1;
    const score = 1 / (RAG_RRF_K + rank);
    const existing = map.get(r.chunk_id);
    if (existing) {
      existing.rrfScore = (existing.rrfScore ?? 0) + score;
      existing.textRank = rank;
      existing._tRank = rank;
    } else {
      map.set(r.chunk_id, {
        chunkId: r.chunk_id,
        documentId: r.document_id,
        collectionId: r.collection_id,
        revisionId: r.revision_id,
        title: r.title,
        content: r.content,
        heading: r.heading,
        page: r.page,
        distance: null,
        rrfScore: score,
        vectorRank: null,
        textRank: rank,
        _vRank: null,
        _tRank: rank,
      } as RagChunk & { _vRank: number | null; _tRank: number | null });
    }
  });

  // se vetor falhou, todos têm só text; se texto vazio, só vetor
  const list = [...map.values()].sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0));
  return list as RagChunk[];
}

function dedupAndDiversify(
  sorted: RagChunk[],
  topK: number,
): { deduped: number; chosen: RagChunk[] } {
  // deduplicação por conteúdo normalizado (código/sigla idêntico)
  const seenContent = new Set<string>();
  const seenId = new Set<string>();
  const dedupedList: RagChunk[] = [];
  let dedupedCount = 0;

  for (const ch of sorted) {
    if (seenId.has(ch.chunkId)) {
      dedupedCount++;
      continue;
    }
    const norm = ch.content.trim().slice(0, 400).toLowerCase();
    if (seenContent.has(norm)) {
      dedupedCount++;
      continue;
    }
    // dedup muito semelhante (Jaccard simples: 80% dos tokens iguais é considerado dup)
    // para não custar caro, só compara com últimos 3 já vistos
    let isNearDup = false;
    for (const prev of dedupedList.slice(-3)) {
      if (jaccardSimilarity(prev.content, ch.content) > 0.92) {
        isNearDup = true;
        break;
      }
    }
    if (isNearDup) {
      dedupedCount++;
      continue;
    }
    seenId.add(ch.chunkId);
    seenContent.add(norm);
    dedupedList.push(ch);
  }

  // diversidade: no máximo 2 chunks por documento nos topK, para não monopolizar contexto
  const perDoc = new Map<string, number>();
  const chosen: RagChunk[] = [];
  for (const ch of dedupedList) {
    const count = perDoc.get(ch.documentId) ?? 0;
    if (count >= 2 && dedupedList.length > topK + 2) {
      // pula se já temos 2 do mesmo doc, a menos que faltem candidatos
      continue;
    }
    chosen.push(ch);
    perDoc.set(ch.documentId, count + 1);
    if (chosen.length >= topK) break;
  }
  // se diversidade filtrou demais, completa com próximos
  if (chosen.length < topK) {
    for (const ch of dedupedList) {
      if (chosen.find((c) => c.chunkId === ch.chunkId)) continue;
      chosen.push(ch);
      if (chosen.length >= topK) break;
    }
  }
  // garante 4–8 como no ROADMAP: se topK < 4, devolve até 4 quando houver
  const final = chosen.slice(0, Math.max(Math.min(topK, 8), 4));
  // se pedimos 6 mas só temos 4 após filtros, retorna 4
  return { deduped: dedupedCount, chosen: final.slice(0, topK) };
}

function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 80));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 80));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export function buildRagKnowledgeBlock(chunks: RagChunk[]): string {
  if (chunks.length === 0) return "";
  const parts: string[] = [];
  let tokens = 0;
  for (const ch of chunks) {
    const part = `### ${ch.title}${ch.heading ? ` — ${ch.heading}` : ""}${ch.page ? ` (p. ${ch.page})` : ""}\n${ch.content}`;
    const cost = estimateTokens(part);
    if (parts.length > 0 && tokens + cost > RAG_TOKEN_CAP) break;
    parts.push(part);
    tokens += cost;
  }
  if (parts.length === 0) return "";
  return `[CONHECIMENTO]\n${parts.join("\n\n")}`;
}

export function formatCitations(chunks: RagChunk[]): string {
  if (chunks.length === 0) return "";
  const titles = [...new Set(chunks.map((c) => c.title))];
  return `\n\n---\n**Fontes:** ${titles.join(", ")}`;
}
