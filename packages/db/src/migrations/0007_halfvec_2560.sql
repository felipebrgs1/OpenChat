-- Corrige dim 2560 >2000: HNSW não suporta vector(2560), usa halfvec(2560) (pgvector >=0.8 suporta 4000)
DROP INDEX IF EXISTS "knowledge_chunk_embedding_hnsw_idx";--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ALTER COLUMN embedding TYPE halfvec(2560) USING embedding::halfvec(2560);--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embedding_hnsw_idx" ON "knowledge_chunk" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m='16', ef_construction='64');--> statement-breakpoint
