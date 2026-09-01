-- R5/R6: troca para perplexity/pplx-embed-v1-4b (2560 dims) + voyage rerank
-- Limpa embeddings antigos (dimensão incompatível) e recria índice HNSW 2560

DROP INDEX IF EXISTS "knowledge_chunk_embedding_hnsw_idx";--> statement-breakpoint
-- zera embeddings antigos para não quebrar casts; reindex via ingestion reprocessará
UPDATE "knowledge_chunk" SET embedding = NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ALTER COLUMN embedding TYPE vector(2560) USING embedding::vector(2560);--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embedding_hnsw_idx" ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m='16', ef_construction='64');--> statement-breakpoint
-- garante que search_vector continue válido (não afetado)
