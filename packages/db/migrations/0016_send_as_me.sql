ALTER TABLE "exchanges" ADD COLUMN "drafted_by_vela" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "suggestions_signed_by" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_suggestions_signed_by_members_id_fk" FOREIGN KEY ("suggestions_signed_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;