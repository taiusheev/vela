ALTER TABLE "members" ADD COLUMN "relationship" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "interests" text[];--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "reply_ways" text[];--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_relationship_check" CHECK ("relationship" in ('mother', 'father', 'grandmother', 'grandfather', 'other'));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_interests_check" CHECK ("interests" <@ ARRAY['cooking', 'garden', 'family', 'old_days', 'music', 'festivals', 'films_books', 'friends', 'travel', 'making', 'work', 'sayings']::text[]);--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_reply_ways_check" CHECK ("reply_ways" <@ ARRAY['text', 'voice', 'photo', 'tap']::text[]);