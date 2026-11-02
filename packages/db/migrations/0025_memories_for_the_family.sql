CREATE TABLE "keep_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	CONSTRAINT "keep_suggestions_exchange_id_key" UNIQUE("exchange_id"),
	CONSTRAINT "keep_suggestions_offsets_check" CHECK ("keep_suggestions"."start_offset" >= 0 and "keep_suggestions"."end_offset" > "keep_suggestions"."start_offset" and "keep_suggestions"."end_offset" - "keep_suggestions"."start_offset" <= 2000)
);
--> statement-breakpoint
ALTER TABLE "book_entries" ADD COLUMN "kept_by" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "memories_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD CONSTRAINT "keep_suggestions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD CONSTRAINT "keep_suggestions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD CONSTRAINT "keep_suggestions_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD CONSTRAINT "keep_suggestions_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD CONSTRAINT "keep_suggestions_dismissed_by_members_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keep_suggestions_family_idx" ON "keep_suggestions" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE INDEX "keep_suggestions_answer_idx" ON "keep_suggestions" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "keep_suggestions_expiry_idx" ON "keep_suggestions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_kept_by_members_id_fk" FOREIGN KEY ("kept_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;