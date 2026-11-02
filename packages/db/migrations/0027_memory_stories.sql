CREATE TABLE "memory_stories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"title_answer_id" uuid NOT NULL,
	"title_start" integer NOT NULL,
	"title_end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_stories_title_check" CHECK ("memory_stories"."title_start" >= 0 and "memory_stories"."title_end" > "memory_stories"."title_start" and "memory_stories"."title_end" - "memory_stories"."title_start" <= 200)
);
--> statement-breakpoint
CREATE TABLE "memory_story_moments" (
	"story_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	CONSTRAINT "memory_story_moments_pkey" PRIMARY KEY("story_id","exchange_id"),
	CONSTRAINT "memory_story_moments_exchange_id_key" UNIQUE("exchange_id")
);
--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "memory_stories" ADD CONSTRAINT "memory_stories_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_stories" ADD CONSTRAINT "memory_stories_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_stories" ADD CONSTRAINT "memory_stories_title_answer_id_answers_id_fk" FOREIGN KEY ("title_answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_story_moments" ADD CONSTRAINT "memory_story_moments_story_id_memory_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."memory_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_story_moments" ADD CONSTRAINT "memory_story_moments_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_stories_family_idx" ON "memory_stories" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_stories_member_idx" ON "memory_stories" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memory_stories_title_answer_idx" ON "memory_stories" USING btree ("title_answer_id");--> statement-breakpoint
ALTER TABLE "keep_suggestions" ADD CONSTRAINT "keep_suggestions_kind_check" CHECK ("kind" in ('preference', 'story', 'humour', 'person', 'moment', 'follow_up'));