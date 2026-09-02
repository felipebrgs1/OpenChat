/**
 * R5 — Reranker para candidatos do retrieval híbrido.
 * Tenta Cohere rerank-v3.5 via API se COHERE_API_KEY ou RERANKER_MODEL configurado.
 * Fallback: heurística lexical (overlap query×chunk + heading/page bonus) combinada com RRF.
 */

import type { RagChunk } from "./rag";

export type RerankResult = {
  chunk: RagChunk;
  rerankScore: number;
  originalRrf: number | null;
};

function lexicalScore(query: string, chunk: RagChunk): number {
  const qTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const text = `${chunk.heading ?? ""} ${chunk.content}`.toLowerCase();
  if (qTerms.length === 0) return 0;
  let hits = 0;
  for (const t of qTerms) if (text.includes(t)) hits++;
  const overlap = hits / qTerms.length;
  // bonus se heading contém termo da query (sigla/código)
  let headingBonus = 0;
  if (chunk.heading) {
    const hLower = chunk.heading.toLowerCase();
    for (const t of qTerms) if (hLower.includes(t)) headingBonus = 0.15;
  }
  // bonus se page 1 (introdução) levemente
  const pageBonus = chunk.page === 1 ? 0.02 : 0;
  return overlap * 0.4 + headingBonus + pageBonus;
}

async function voyageRerank(query: string, chunks: RagChunk[]): Promise<RerankResult[] | null> {
  const apiKey =
    process.env.VOYAGE_API_KEY?.trim() ||
    process.env.COHERE_API_KEY?.trim() ||
    process.env.RERANKER_API_KEY?.trim();
  const model = process.env.RERANKER_MODEL?.trim() || "voyageai/rerank-2.5-lite";
  if (!apiKey) return null;
  // Voyage rerank API (OpenAI compatível) — https://docs.voyageai.com/reference/reranking
  // Também suporta Cohere fallback se key for Cohere (mesmo endpoint muda)
  const isVoyage = model.includes("voyage") || !!process.env.VOYAGE_API_KEY;
  const url = isVoyage ? "https://api.voyageai.com/v1/rerank" : "https://api.cohere.com/v1/rerank";
  try {
    const docs = chunks.map((c) =>
      `${c.heading ? `# ${c.heading}\n` : ""}${c.content}`.slice(0, 4000),
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents: docs,
        top_n: chunks.length,
        return_documents: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `reranker ${isVoyage ? "voyage" : "cohere"} ${res.status}: ${body.slice(0, 300)}`,
      );
      return null;
    }
    const json = (await res.json()) as {
      results?: Array<{ index: number; relevance_score: number }>;
      data?: Array<{ index: number; relevance_score: number }>;
    };
    const results = json.results ?? json.data;
    if (!results?.length) return null;
    const byIndex = new Map(results.map((r) => [r.index, r.relevance_score]));
    return chunks
      .map((chunk, idx) => ({
        chunk,
        rerankScore: byIndex.get(idx) ?? lexicalScore(query, chunk),
        originalRrf: chunk.rrfScore ?? 0,
      }))
      .sort((a, b) => b.rerankScore - a.rerankScore);
  } catch (e) {
    console.warn(
      "cohere rerank failed, fallback heuristic",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

async function openRouterRerank(query: string, chunks: RagChunk[]): Promise<RerankResult[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.RERANKER_MODEL?.trim();
  if (!apiKey || !model || !model.includes("rerank")) return null;
  // OpenRouter rerank (se suportado) — formato similar ao Cohere via OpenRouter
  // https://openrouter.ai/docs/models/cohere/rerank
  try {
    const docs = chunks.map((c) =>
      `${c.heading ? `# ${c.heading}\n` : ""}${c.content}`.slice(0, 4000),
    );
    const res = await fetch(
      `${process.env.OPENROUTER_BASE_URL?.replace(/\/$/, "") ?? "https://openrouter.ai/api/v1"}/rerank`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173",
          "X-Title": process.env.OPENROUTER_APP_TITLE ?? "Oráculo",
        },
        body: JSON.stringify({ model, query, documents: docs }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{ index: number; relevance_score: number }>;
      results?: Array<{ index: number; relevance_score: number }>;
    };
    const results = json.data ?? json.results;
    if (!results?.length) return null;
    const byIndex = new Map(
      results.map((r: { index: number; relevance_score: number }) => [r.index, r.relevance_score]),
    );
    return chunks
      .map((chunk, idx) => ({
        chunk,
        rerankScore: byIndex.get(idx) ?? lexicalScore(query, chunk),
        originalRrf: chunk.rrfScore ?? 0,
      }))
      .sort((a, b) => b.rerankScore - a.rerankScore);
  } catch {
    return null;
  }
}

export async function rerankChunks(query: string, chunks: RagChunk[]): Promise<RagChunk[]> {
  if (chunks.length <= 1) return chunks;
  const enabled = process.env.RERANKER_ENABLED !== "false";
  if (!enabled) return chunks;

  // tenta rerankers externos primeiro (Voyage 2.5-lite é o padrão)
  const voyage = await voyageRerank(query, chunks);
  if (voyage) {
    return voyage.map((r) => ({ ...r.chunk, rrfScore: r.rerankScore }));
  }
  const or = await openRouterRerank(query, chunks);
  if (or) {
    return or.map((r) => ({ ...r.chunk, rrfScore: r.rerankScore }));
  }

  // fallback heurístico (R5): combina RRF + lexical
  const scored = chunks.map((chunk) => {
    const lex = lexicalScore(query, chunk);
    const rrf = chunk.rrfScore ?? 1 / (60 + (chunk.vectorRank ?? 99));
    // peso: RRF 0.65 + lexical 0.35
    const final = rrf * 0.65 + lex * 0.35;
    return { chunk, final, lex, rrf };
  });
  scored.sort((a, b) => b.final - a.final);
  return scored.map((s) => ({ ...s.chunk, rrfScore: s.final }));
}

/**
 * Heurística para decidir se há evidência suficiente (R5).
 * Retorna false quando melhor chunk tem score baixo, distância alta, ou termos raros ausentes.
 */
export function hasSufficientEvidence(chunks: RagChunk[], threshold = 0.018): boolean {
  if (chunks.length === 0) return false;
  const top = chunks[0] as RagChunk & { distance?: number | null };
  const score = (top as { rrfScore?: number | null }).rrfScore ?? 0;
  if (score < threshold) return false;
  // se só vetor e distância alta (>0.75), considera fraco
  const dist = (top as { distance?: number | null }).distance;
  const hasText = (top as { textRank?: number | null }).textRank != null;
  if (!hasText && typeof dist === "number" && dist > 0.62) {
    // vector puro com distância alta = baixa similaridade semântica
    return false;
  }
  // verifica termos raros (siglas, códigos, CNPJ) — se ausentes no top chunk, insuficiente
  // extrai do conteúdo do top chunk para comparar com query implícita via heading+excerpt?
  // Como não temos query aqui, essa checagem é feita no caller com query; aqui só score/dist.
  // O caller (conversations) faz checagem adicional de termos raros via chunk.content.
  return true;
}

export function hasSufficientEvidenceForQuery(
  query: string,
  chunks: RagChunk[],
  threshold = 0.018,
): boolean {
  if (chunks.length === 0) return false;
  // exceções que devem ser consideradas suficientes mesmo se hasSufficient falhar (ex: curriculo, siglas raras)
  const qLowerEarly = query.toLowerCase();
  if (qLowerEarly.includes("curriculo") || qLowerEarly.includes("currículo")) {
    const anyCurriculoEarly = chunks
      .slice(0, 3)
      .some(
        (c) =>
          ((c as unknown as { title?: string }).title ?? "").toLowerCase().includes("curriculo") ||
          ((c as unknown as { title?: string }).title ?? "").toLowerCase().includes("currículo"),
      );
    if (anyCurriculoEarly) return true;
  }
  // siglas/códigos raros: se query tem termo raro e top3 contém, considera suficiente mesmo com distância alta
  const rareTermsEarly = query.match(/\b[A-Z]{2,}(?:[-_][A-Z0-9]+)*\b|\b\d[\d./-]*\b/g) ?? [];
  if (rareTermsEarly.length > 0) {
    const rareUpperEarly = rareTermsEarly.map((t) => t.toUpperCase());
    for (const term of rareUpperEarly) {
      if (term.length < 2) continue;
      const anyTop3Has = chunks.slice(0, 3).some((c) => {
        const t =
          `${(c as unknown as { title?: string }).title ?? ""} ${c.heading ?? ""} ${c.content}`.toLowerCase();
        return t.includes(term.toLowerCase());
      });
      if (anyTop3Has) return true;
    }
  }
  if (!hasSufficientEvidence(chunks, threshold)) return false;
  const top = chunks[0]!;
  // inclui título para casos como "curriculo" onde o título é a melhor pista
  const text =
    `${(top as unknown as { title?: string }).title ?? ""} ${top.heading ?? ""} ${top.content}`.toLowerCase();
  // termos raros: siglas 2+ maiúsculas, códigos com hífen/dígitos, números com símbolo
  const rareTerms = query.match(/\b[A-Z]{2,}(?:[-_][A-Z0-9]+)*\b|\b\d[\d./-]*\b/g) ?? [];
  // também captura "CNPJ", "PIX" etc (uppercase)
  const rareUpper = rareTerms.map((t) => t.toUpperCase());
  // se query contém raro (ex: CNPJ, PIX, 2024-COB-001) e top não contém, insuficiente
  for (const term of rareUpper) {
    if (term.length < 2) continue;
    // ignora termos muito comuns que coincidem com stopwords? CNPJ/PIX são raros, mantém
    const inTop =
      text.includes(term.toLowerCase()) || text.includes(term.toLowerCase().replace(/-/g, ""));
    if (!inTop) {
      // verifica se algum chunk nos top3 contém o termo — se sim, considera suficiente mesmo se top não
      const anyTop3Has = chunks.slice(0, 3).some((c) => {
        const t = `${c.heading ?? ""} ${c.content}`.toLowerCase();
        return t.includes(term.toLowerCase());
      });
      if (!anyTop3Has) return false;
    }
  }
  // exceção: se query é sobre "curriculo" e top é do documento de currículo, considera suficiente mesmo com baixa sobreposição lexical (pergunta subjetiva "o que acha")
  const qLower = query.toLowerCase();
  if (qLower.includes("curriculo") || qLower.includes("currículo")) {
    const anyCurriculo = chunks
      .slice(0, 3)
      .some(
        (c) =>
          ((c as unknown as { title?: string }).title ?? "").toLowerCase().includes("curriculo") ||
          (c as unknown as { title?: string }).title?.toLowerCase().includes("currículo"),
      );
    if (anyCurriculo) return true;
  }
  // fallback: se query tem 3+ termos e top cobre <20% dos termos, insuficiente (mais permissivo para "o que acha")
  const qTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (qTerms.length >= 3) {
    let hits = 0;
    for (const t of qTerms) if (text.includes(t)) hits++;
    if (hits / qTerms.length < 0.2) return false;
  }
  return true;
}
