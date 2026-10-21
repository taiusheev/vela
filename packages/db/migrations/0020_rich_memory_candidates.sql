CREATE TABLE "memory_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"source_answer_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"source_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "memory_candidates_source_span_key" UNIQUE("source_answer_id","start_offset","end_offset"),
	CONSTRAINT "memory_candidates_kind_check" CHECK ("kind" in ('preference', 'story', 'humour', 'person', 'moment', 'follow_up')),
	CONSTRAINT "memory_candidates_offsets_check" CHECK ("memory_candidates"."start_offset" >= 0 and "memory_candidates"."end_offset" > "memory_candidates"."start_offset" and "memory_candidates"."end_offset" - "memory_candidates"."start_offset" <= 2000),
	CONSTRAINT "memory_candidates_expiry_check" CHECK ("memory_candidates"."expires_at" > "memory_candidates"."created_at")
);
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_kind_check";--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_source_answer_id_answers_id_fk" FOREIGN KEY ("source_answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_candidates_family_page_idx" ON "memory_candidates" USING btree ("family_id","id");--> statement-breakpoint
CREATE INDEX "memory_candidates_member_idx" ON "memory_candidates" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memory_candidates_consent_idx" ON "memory_candidates" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX "memory_candidates_expiry_idx" ON "memory_candidates" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_kind_check" CHECK ("kind" in ('light', 'nearby', 'privacy_notice', 'pilot', 'health_words', 'rich_memories'));