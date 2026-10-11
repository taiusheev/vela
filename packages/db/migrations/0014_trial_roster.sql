CREATE TABLE "pilot_roster" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_roster_telegram_user_id_check" CHECK ("pilot_roster"."telegram_user_id" ~ '^[1-9][0-9]{0,12}$')
);
--> statement-breakpoint
ALTER TABLE "admin_access_log" DROP CONSTRAINT "admin_access_log_action_check";--> statement-breakpoint
ALTER TABLE "admin_access_log" ADD CONSTRAINT "admin_access_log_action_check" CHECK ("action" in ('view', 'record_consent', 'record_contact_consent', 'add_contact', 'remove_contact', 'set_away', 'end_away', 'mark_left', 'mark_deceased', 'delete_family', 'send_weekly_read', 'create_invite', 'roster_add', 'roster_remove'));