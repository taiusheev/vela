ALTER TABLE "account_link_challenges" ADD COLUMN "approval_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_link_challenges" ADD COLUMN "requester_label" text;--> statement-breakpoint
ALTER TABLE "account_link_challenges" ADD COLUMN "approved_at" timestamp with time zone;