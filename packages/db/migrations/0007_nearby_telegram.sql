ALTER TABLE "nearby_contacts" DROP CONSTRAINT "nearby_contacts_phone_consented_check";--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD CONSTRAINT "nearby_contacts_invited_by_members_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nearby_contacts_member_external_idx" ON "nearby_contacts" USING btree ("member_id","external_id") WHERE "external_id" is not null;--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD CONSTRAINT "nearby_contacts_invite_token_hash_key" UNIQUE("invite_token_hash");--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD CONSTRAINT "nearby_contacts_reach_consented_check" CHECK (("phone" is not null or "external_id" is not null) = ("consented_at" is not null and "declined_at" is null));--> statement-breakpoint
ALTER TABLE "nearby_contacts" ADD CONSTRAINT "nearby_contacts_external_channel_check" CHECK ("external_id" is null or "channel" = 'telegram');