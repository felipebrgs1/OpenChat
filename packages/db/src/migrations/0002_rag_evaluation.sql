CREATE TYPE "public"."rag_case_category" AS ENUM('factual', 'procedural', 'negative', 'access_denied');--> statement-breakpoint
CREATE TABLE "rag_evaluation_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"category" "rag_case_category" NOT NULL,
	"allowed_role_slug" text,
	"expected_collection_slug" text,
	"expected_document_title" text,
	"expected_keywords" jsonb,
	"expected_answer_criteria" text,
	"tags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "rag_case_category_idx" ON "rag_evaluation_case" USING btree ("category");--> statement-breakpoint
CREATE TABLE "rag_evaluation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_version" text NOT NULL,
	"git_commit" text,
	"params" jsonb,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "rag_evaluation_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"hit" boolean,
	"retrieved_chunk_ids" jsonb,
	"retrieved_titles" jsonb,
	"latency_ms" integer,
	"cost_usd" numeric(12, 6),
	"error" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "rag_evaluation_result" ADD CONSTRAINT "rag_evaluation_result_run_id_rag_evaluation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."rag_evaluation_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_evaluation_result" ADD CONSTRAINT "rag_evaluation_result_case_id_rag_evaluation_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."rag_evaluation_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rag_result_run_idx" ON "rag_evaluation_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "rag_result_case_idx" ON "rag_evaluation_result" USING btree ("case_id");
