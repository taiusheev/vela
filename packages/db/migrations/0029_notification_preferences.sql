ALTER TABLE "users" ADD COLUMN "reply_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "turn_reminders" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Preserve each account's existing choice, including accounts that opted out.
UPDATE "users" SET "reply_notifications" = ("one_moment_a_day" AND "deleted_at" IS NULL), "turn_reminders" = ("one_moment_a_day" AND "deleted_at" IS NULL);
