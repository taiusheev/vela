CREATE TABLE "pilot_families" (
	"family_id" uuid PRIMARY KEY NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_access_log" DROP CONSTRAINT "admin_access_log_action_check";--> statement-breakpoint
ALTER TABLE "pilot_families" ADD CONSTRAINT "pilot_families_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_access_log" ADD CONSTRAINT "admin_access_log_action_check" CHECK ("action" in ('view', 'record_consent', 'record_contact_consent', 'add_contact', 'remove_contact', 'set_away', 'end_away', 'mark_left', 'mark_deceased', 'delete_family', 'send_weekly_read', 'create_invite', 'roster_add', 'roster_remove', 'family_approve', 'family_unapprove'));