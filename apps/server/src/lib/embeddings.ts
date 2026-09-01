/**
 * R4 — Embeddings multilíngues para português.
 * Default: openai/text-embedding-3-small (1536 dims) — multilíngue, barato e estável para pt-BR.
 * Alternativas via EMBEDDING_MODEL (OpenRouter):
 * - cohere/embed-multilingual-v3.0 (1024 dims, ótimo para pt-BR, requer reindex)
 * - voyageai/voyage-multilingual-2 (1024 dims)
 * - openai/text-embedding-3-large (3072 dims, melhor recall, requer migração)
 * Env: EMBEDDING_MODEL, OPENROUTER_API_KEY, OPENROUTER_HTTP_REFERER, OPENROUTER_APP_TITLE
 */
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export function embeddingModel(): string {
  return process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function embeddingBaseUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  // remove trailing /chat/completions style if present
  return base.replace(/\/$/, "");
}

type EmbedResult = {
  embeddings: number[][];
  model: string;
};

export async function embedTexts(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { embeddings: [], model: embeddingModel() };
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY ausente para embeddings.");
  }
  const model = embeddingModel();
  const baseUrl = embeddingBaseUrl();
  const url = `${baseUrl}/embeddings`;
  const referer = process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173";
  const title = process.env.OPENROUTER_APP_TITLE ?? "Nexo";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": referer,
      "X-Title": title,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding falhou ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    model?: string;
  };
  if (!json.data?.length) throw new Error("Embedding resposta vazia.");
  const embeddings = json.data.map((d) => d.embedding);
  // validate dimensions
  for (const e of embeddings) {
    if (e.length !== EMBEDDING_DIMENSIONS) {
      // alguns modelos podem ter dim diferente; loga mas não quebra se for prox
      console.warn(
        `embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS} got ${e.length}`,
      );
    }
  }
  return { embeddings, model: json.model ?? model };
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embeddings } = await embedTexts([text]);
  if (!embeddings[0]) throw new Error("Embedding query falhou.");
  return embeddings[0] as number[];
}

/** Helper para testes: converte vetor para literal SQL pgvector */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
