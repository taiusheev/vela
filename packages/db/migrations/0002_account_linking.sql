CREATE TABLE "account_link_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_hash" text NOT NULL,
	"family_id" uuid,
	"member_id" uuid,
	"channel_link_id" uuid,
	"channel_identity_hash" text,
	"code_hash" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "account_link_challenges_hashes_check" CHECK ("session_hash" ~ '^[0-9a-f]{64}$' and ("channel_identity_hash" is null or "channel_identity_hash" ~ '^[0-9a-f]{64}$') and ("code_hash" is null or "code_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "account_link_challenges_attempts_check" CHECK ("attempts" between 0 and 5),
	CONSTRAINT "account_link_challenges_binding_check" CHECK (("family_id" is null and "member_id" is null and "channel_link_id" is null and "channel_identity_hash" is null) or ("family_id" is not null and "member_id" is not null and "channel_link_id" is not null and "channel_identity_hash" is not null)),
	CONSTRAINT "account_link_challenges_state_check" CHECK (("completed_at" is null or ("family_id" is not null and "code_hash" is null and "invalidated_at" is null)) and ("invalidated_at" is null or ("code_hash" is null and "completed_at" is null)) and ("code_hash" is null or ("family_id" is not null and "completed_at" is null and "invalidated_at" is null))),
	CONSTRAINT "account_link_challenges_timing_check" CHECK ("expires_at" > "created_at" and "expires_at" <= "created_at" + interval '15 minutes' and ("completed_at" is null or ("completed_at" >= "created_at" and "completed_at" < "expires_at")) and ("invalidated_at" is null or "invalidated_at" >= "created_at"))
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_name_check";--> statement-breakpoint
ALTER TABLE "account_link_challenges" ADD CONSTRAINT "account_link_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_link_challenges" ADD CONSTRAINT "account_link_challenges_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_link_challenges" ADD CONSTRAINT "account_link_challenges_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_link_challenges" ADD CONSTRAINT "account_link_challenges_channel_link_id_channel_links_id_fk" FOREIGN KEY ("channel_link_id") REFERENCES "public"."channel_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_link_challenges_user_idx" ON "account_link_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_link_challenges_expiry_idx" ON "account_link_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "account_link_challenges_completed_idx" ON "account_link_challenges" USING btree ("completed_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_name_check" CHECK ("name" in ('family_created', 'member_joined', 'account_linked', 'invite_accepted', 'invite_created', 'consent_given', 'consent_declined', 'stop_said', 'start_said', 'member_left', 'member_left_group', 'member_marked_deceased', 'family_deletion_requested', 'ask_composed', 'ask_withdrawn', 'exchange_prepared', 'arrival_delivered', 'arrival_delivery_failed', 'arrival_seen', 'answer_recorded', 'reply_posted', 'readback_delivered', 'readback_played', 'repeat_sent', 'turn_prompt_sent', 'quiet_notice_sent', 'quiet_notice_resolved', 'ask_to_check_sent', 'away_set', 'away_ended', 'flag_raised', 'nearby_contact_added', 'nearby_contact_removed', 'weekly_read_drafted', 'weekly_read_sent', 'weekly_read_opened', 'story_saved', 'trial_started', 'plan_started', 'plan_lapsed', 'scheduler_missed', 'scheduler_tick', 'gateway_dropped', 'retention_deleted', 'admin_page_opened'));