CREATE TYPE "public"."ingestion_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_stage" AS ENUM('upload', 'validation', 'extraction', 'chunking', 'embedding', 'indexing');--> statement-breakpoint
CREATE TABLE "knowledge_document_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"extracted_markdown" text,
	"extraction_metadata" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "knowledge_document_revision" ADD CONSTRAINT "knowledge_document_revision_document_id_knowledge_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_revision" ADD CONSTRAINT "knowledge_document_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_revision_document_idx" ON "knowledge_document_revision" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_revision_document_number_unique" ON "knowledge_document_revision" USING btree ("document_id","revision_number");--> statement-breakpoint
CREATE TABLE "knowledge_ingestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"status" "ingestion_status" DEFAULT 'queued' NOT NULL,
	"stage" "ingestion_stage" DEFAULT 'upload' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "knowledge_ingestion" ADD CONSTRAINT "knowledge_ingestion_document_revision_id_knowledge_document_revision_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."knowledge_document_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_ingestion_revision_idx" ON "knowledge_ingestion" USING btree ("document_revision_id");--> statement-breakpoint
CREATE INDEX "knowledge_ingestion_status_idx" ON "knowledge_ingestion" USING btree ("status");--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "revision_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "heading" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "start_offset" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "end_offset" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "token_count" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_revision_id_knowledge_document_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."knowledge_document_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_revision_idx" ON "knowledge_chunk" USING btree ("revision_id");
