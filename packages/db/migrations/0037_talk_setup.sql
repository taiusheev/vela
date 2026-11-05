ALTER TABLE "members" ADD COLUMN "talk_rhythm" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avoid_topics" text[];--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avoid_words" text[];--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_talk_rhythm_check" CHECK ("talk_rhythm" in ('often', 'sometimes', 'rarely'));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_avoid_topics_check" CHECK ("avoid_topics" <@ ARRAY['money', 'health', 'work', 'partner']::text[]);