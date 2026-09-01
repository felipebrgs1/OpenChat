import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import { db, knowledgeCollections, knowledgeRoles } from "@nexo/db";

import { embedQuery, vectorLiteral } from "./embeddings";

export type RagChunk = {
  chunkId: string;
  documentId: string;
  collectionId: string;
  title: string;
  content: string;
  distance: number;
};

export const RAG_TOP_K = 6;
export const RAG_TOKEN_CAP = 4000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function retrieveKnowledgeChunks(query: string, roleId: string | null, topK = RAG_TOP_K): Promise<RagChunk[]> {
  const q = query.trim();
  if (!q) return [];
  if (!roleId) return [];

  let embedding: number[];
  try {
    embedding = await embedQuery(q);
  } catch (e) {
    console.warn("rag embed falhou, fallback sem embedding", e);
    return [];
  }
  const literal = vectorLiteral(embedding);

  const collectionFilter = and(
    isNull(knowledgeCollections.deletedAt),
    or(
      eq(knowledgeCollections.visibility, "all"),
      exists(
        db
          .select({ one: knowledgeRoles.collectionId })
          .from(knowledgeRoles)
          .where(and(eq(knowledgeRoles.roleId, roleId), eq(knowledgeRoles.collectionId, knowledgeCollections.id))),
      ),
    ),
  );

  const visibleCollections = await db
    .select({ id: knowledgeCollections.id })
    .from(knowledgeCollections)
    .where(collectionFilter);

  const visibleIds = visibleCollections.map((r) => r.id);
  if (visibleIds.length === 0) return [];

  const rows = (await db.execute(sql`
    SELECT
      kc.id as chunk_id,
      kc.document_id,
      kc.collection_id,
      kd.title as title,
      kc.content as content,
      kc.embedding <=> ${literal}::vector as distance
    FROM knowledge_chunk kc
    JOIN knowledge_document kd ON kd.id = kc.document_id AND kd.deleted_at IS NULL
    JOIN knowledge_collection kcol ON kcol.id = kc.collection_id AND kcol.deleted_at IS NULL
    WHERE kc.collection_id IN (${sql.join(
      visibleIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    ORDER BY kc.embedding <=> ${literal}::vector ASC
    LIMIT ${sql.raw(String(topK))}
  `)) as unknown as { rows?: unknown[] } | unknown[];

  let list: unknown[] = [];
  if (Array.isArray(rows)) {
    list = rows;
  } else if (rows && typeof rows === "object" && "rows" in (rows as Record<string, unknown>)) {
    list = ((rows as { rows: unknown[] }).rows ?? []) as unknown[];
  }

  return (list as Array<{
    chunk_id: string;
    document_id: string;
    collection_id: string;
    title: string;
    content: string;
    distance: number;
  }>).map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    collectionId: r.collection_id,
    title: r.title,
    content: r.content,
    distance: Number(r.distance),
  }));
}

export function buildRagKnowledgeBlock(chunks: RagChunk[]): string {
  if (chunks.length === 0) return "";
  const parts: string[] = [];
  let tokens = 0;
  for (const ch of chunks) {
    const part = `### ${ch.title}\n${ch.content}`;
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
