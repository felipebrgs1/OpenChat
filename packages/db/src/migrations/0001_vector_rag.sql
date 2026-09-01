CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "knowledge_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_document_id_knowledge_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_collection_id_knowledge_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_document_idx" ON "knowledge_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_collection_idx" ON "knowledge_chunk" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embedding_hnsw_idx" ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m='16', ef_construction='64');
