ALTER TABLE "answers" DROP CONSTRAINT "answers_channel_check";--> statement-breakpoint
ALTER TABLE "channel_links" DROP CONSTRAINT "channel_links_channel_check";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_name_check";--> statement-breakpoint
ALTER TABLE "family_channels" DROP CONSTRAINT "family_channels_channel_check";--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_channel_check";--> statement-breakpoint
ALTER TABLE "message_refs" DROP CONSTRAINT "message_refs_channel_check";--> statement-breakpoint
ALTER TABLE "onboarding_sessions" DROP CONSTRAINT "onboarding_sessions_channel_check";--> statement-breakpoint
ALTER TABLE "outbound" DROP CONSTRAINT "outbound_channel_check";--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_channel_check";--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "channel_links" ADD CONSTRAINT "channel_links_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_name_check" CHECK ("name" in ('family_created', 'member_joined', 'account_linked', 'invite_accepted', 'invite_created', 'consent_given', 'consent_declined', 'stop_said', 'start_said', 'member_left', 'member_left_group', 'member_marked_deceased', 'family_deletion_requested', 'device_set_up', 'device_removed', 'ask_composed', 'ask_withdrawn', 'exchange_prepared', 'arrival_delivered', 'arrival_delivery_failed', 'arrival_seen', 'answer_recorded', 'reply_posted', 'readback_delivered', 'readback_played', 'repeat_sent', 'turn_prompt_sent', 'quiet_notice_sent', 'quiet_notice_resolved', 'ask_to_check_sent', 'away_set', 'away_ended', 'flag_raised', 'nearby_contact_added', 'nearby_contact_removed', 'weekly_read_drafted', 'weekly_read_sent', 'weekly_read_opened', 'story_saved', 'trial_started', 'plan_started', 'plan_lapsed', 'scheduler_missed', 'scheduler_tick', 'gateway_dropped', 'retention_deleted', 'admin_page_opened'));--> statement-breakpoint
ALTER TABLE "family_channels" ADD CONSTRAINT "family_channels_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "outbound" ADD CONSTRAINT "outbound_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app', 'device'));