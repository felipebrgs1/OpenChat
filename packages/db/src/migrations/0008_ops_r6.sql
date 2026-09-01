CREATE TYPE "public"."document_status" AS ENUM('draft', 'published', 'obsolete');--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN "status" "document_status" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN "review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_document_owner_idx" ON "knowledge_document" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "knowledge_document_status_idx" ON "knowledge_document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "knowledge_document_review_idx" ON "knowledge_document" USING btree ("review_at");--> statement-breakpoint
-- backfill
UPDATE "knowledge_document" SET "owner_id" = "created_by" WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "knowledge_document" SET "published_at" = "created_at" WHERE "published_at" IS NULL AND "status" = 'published';--> statement-breakpoint
