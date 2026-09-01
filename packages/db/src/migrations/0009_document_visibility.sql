-- R6: domínio por documento (publico vs cargo) + visibilidade por documento
ALTER TABLE "knowledge_document" ADD COLUMN "visibility" "knowledge_visibility" DEFAULT 'by_role' NOT NULL;--> statement-breakpoint
CREATE TABLE "knowledge_document_role" (
	"document_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "knowledge_document_role_document_id_role_id_pk" PRIMARY KEY("document_id","role_id")
);--> statement-breakpoint
ALTER TABLE "knowledge_document_role" ADD CONSTRAINT "knowledge_document_role_document_id_knowledge_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_role" ADD CONSTRAINT "knowledge_document_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_document_role_role_id_idx" ON "knowledge_document_role" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "knowledge_document_visibility_idx" ON "knowledge_document" USING btree ("visibility");--> statement-breakpoint
-- backfill: documentos existentes herdam visibilidade da coleção
UPDATE "knowledge_document" kd SET "visibility" = kc."visibility" FROM "knowledge_collection" kc WHERE kc."id" = kd."collection_id";--> statement-breakpoint
-- para documentos de coleção by_role, migra vínculos de coleção para documento (herda)
INSERT INTO "knowledge_document_role" ("document_id", "role_id")
SELECT kd."id", kr."role_id"
FROM "knowledge_document" kd
JOIN "knowledge_role" kr ON kr."collection_id" = kd."collection_id"
WHERE kd."visibility" = 'by_role'
ON CONFLICT DO NOTHING;--> statement-breakpoint
