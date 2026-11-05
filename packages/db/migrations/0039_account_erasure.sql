ALTER TABLE "users" ADD COLUMN "deleted_auth_subject_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_auth_subject_hash_key" UNIQUE("deleted_auth_subject_hash");
--> statement-breakpoint
-- Deleted accounts need only a denial fingerprint, never a second copy of their profile.
UPDATE "users" SET
  "deleted_auth_subject_hash" = CASE WHEN "auth_subject" IS NULL THEN "deleted_auth_subject_hash"
    ELSE encode(sha256(convert_to("auth_subject", 'UTF8')), 'hex') END,
  "auth_subject" = NULL, "display_name" = '', "email" = NULL, "phone" = NULL,
  "language" = 'en', "tz" = 'UTC', "privacy_acceptance" = NULL,
  "one_moment_a_day" = false, "reply_notifications" = false, "turn_reminders" = false
WHERE "deleted_at" IS NOT NULL;
