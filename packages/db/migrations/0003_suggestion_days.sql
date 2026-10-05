-- Nothing but the local dev seed (apps/worker/scripts/seed-dev-family.ts) ever wrote this table,
-- and that seed refuses any database that is not local: staging and production hold no rows. A
-- seeded laptop database does, with no day or bank item for the NOT NULL columns below, so they go.
DELETE FROM "suggestions";--> statement-breakpoint
ALTER TABLE "suggestions" ALTER COLUMN "for_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "local_day" date NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "bank_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "lang" text;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestions_one_per_day" ON "suggestions" USING btree ("about_member_id","local_day");--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_type_check" CHECK ("type" in ('question', 'photo_choice', 'voice_note', 'word', 'story', 'recipe', 'memory_photo', 'vote', 'hello'));--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_lang_check" CHECK ("lang" in ('en', 'zh-TW', 'ja', 'de', 'hi', 'ru'));