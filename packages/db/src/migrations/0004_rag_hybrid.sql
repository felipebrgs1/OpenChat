-- R4: busca híbrida (vetor + tsvector português) + índices

ALTER TABLE "knowledge_chunk" ADD COLUMN "search_vector" tsvector;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_search_vector_gin_idx" ON "knowledge_chunk" USING gin ("search_vector");--> statement-breakpoint
-- trigger para manter search_vector atualizado (portuguese + simple para códigos)
CREATE OR REPLACE FUNCTION knowledge_chunk_search_vector_update() RETURNS trigger AS $$
BEGIN
  -- combina heading + content com dicionário português; códigos/números são preservados
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', coalesce(NEW.content, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.heading, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_chunk_search_vector_trigger ON "knowledge_chunk";--> statement-breakpoint
CREATE TRIGGER knowledge_chunk_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content, heading ON "knowledge_chunk"
  FOR EACH ROW EXECUTE FUNCTION knowledge_chunk_search_vector_update();--> statement-breakpoint
-- backfill existentes
UPDATE "knowledge_chunk" SET content = content WHERE search_vector IS NULL;--> statement-breakpoint
-- índice adicional para busca textual com filtro de coleção (útil para hybrid)
CREATE INDEX IF NOT EXISTS "knowledge_chunk_collection_search_idx" ON "knowledge_chunk" USING gin ("search_vector");
