CREATE TYPE "public"."feedback_rating" AS ENUM('util', 'incorreta', 'desatualizada', 'sem_fonte');--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sources" jsonb;--> statement-breakpoint
CREATE TABLE "knowledge_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "knowledge_feedback" ADD CONSTRAINT "knowledge_feedback_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_feedback" ADD CONSTRAINT "knowledge_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_feedback_message_idx" ON "knowledge_feedback" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "knowledge_feedback_user_idx" ON "knowledge_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_feedback_rating_idx" ON "knowledge_feedback" USING btree ("rating");
