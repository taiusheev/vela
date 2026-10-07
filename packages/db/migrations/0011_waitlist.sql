CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"language" text NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_key" UNIQUE("email"),
	CONSTRAINT "waitlist_signups_email_check" CHECK ("waitlist_signups"."email" = lower("waitlist_signups"."email") and length("waitlist_signups"."email") <= 254),
	CONSTRAINT "waitlist_signups_language_check" CHECK ("language" in ('en', 'zh-TW')),
	CONSTRAINT "waitlist_signups_role_check" CHECK ("waitlist_signups"."role" is null or "role" in ('organiser', 'parent', 'other'))
);
