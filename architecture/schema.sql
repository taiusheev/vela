-- Vela · Postgres schema
-- GENERATED FILE: DO NOT EDIT. The source of truth is packages/db/src/schema.ts.
-- Regenerate with: pnpm --filter @vela/db export-sql
-- Applied through the migrations in packages/db/migrations (pnpm --filter @vela/db generate).
-- Column meanings, retention rules, and the invariants behind each index are documented in
-- schema.ts and in architecture/03-code-design.md §3.

CREATE TABLE "admin_access_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin" text NOT NULL,
	"family_id" uuid,
	"what" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid,
	"member_id" uuid,
	"call" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input_ref" jsonb NOT NULL,
	"output" jsonb,
	"ok" boolean NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"tokens_cached" integer,
	"latency_ms" integer,
	"cost_usd" numeric(10, 6),
	"at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"exchange_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"external_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media_id" uuid,
	"transcript" text,
	"transcript_lang" text,
	"summary" text,
	"mood_words" text[] DEFAULT '{}' NOT NULL,
	"mentions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flag" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"away_until" date,
	"understood_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_channel_external_id_key" UNIQUE("channel","external_id"),
	CONSTRAINT "answers_kind_check" CHECK ("kind" in ('voice', 'chip', 'photo_pick', 'vote', 'heart', 'text', 'photo', 'fine', 'sticker', 'other')),
	CONSTRAINT "answers_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app'))
);

CREATE TABLE "away_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"source" text NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "away_periods_source_check" CHECK ("source" in ('organiser', 'member', 'answer', 'pattern'))
);

CREATE TABLE "channel_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "channel_links_channel_external_id_key" UNIQUE("channel","external_id"),
	CONSTRAINT "channel_links_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app'))
);

CREATE TABLE "chips" (
	"exchange_id" uuid PRIMARY KEY NOT NULL,
	"chips" text[] NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"text_version" text NOT NULL,
	"lang" text NOT NULL,
	"channel" text NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "consents_kind_check" CHECK ("kind" in ('light', 'nearby', 'privacy_notice', 'pilot'))
);

CREATE TABLE "deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"reason" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"family_id" uuid,
	"member_id" uuid,
	"exchange_id" uuid,
	"surface" text,
	"local_time" time,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "events_name_check" CHECK ("name" in ('family_created', 'member_joined', 'invite_accepted', 'consent_given', 'consent_declined', 'stop_said', 'start_said', 'member_marked_deceased', 'ask_composed', 'ask_withdrawn', 'exchange_prepared', 'arrival_delivered', 'arrival_delivery_failed', 'arrival_seen', 'answer_recorded', 'reply_posted', 'readback_delivered', 'readback_played', 'repeat_sent', 'turn_prompt_sent', 'quiet_notice_sent', 'quiet_notice_resolved', 'ask_to_check_sent', 'away_set', 'away_ended', 'flag_raised', 'weekly_read_drafted', 'weekly_read_opened', 'story_saved', 'trial_started', 'plan_started', 'plan_lapsed', 'scheduler_missed', 'scheduler_tick', 'gateway_dropped', 'retention_deleted'))
);

CREATE TABLE "exchanges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"asker_id" uuid,
	"on_behalf_of" text,
	"type" text NOT NULL,
	"state" text DEFAULT 'composed' NOT NULL,
	"text" text,
	"text_lang" text DEFAULT 'en' NOT NULL,
	"options" jsonb,
	"media_ids" uuid[] DEFAULT '{}' NOT NULL,
	"voice_hello_id" uuid,
	"when_rule" text DEFAULT 'tomorrow' NOT NULL,
	"scheduled_for" date,
	"delivered_at" timestamp with time zone,
	"delivery_failed_at" timestamp with time zone,
	"delivery_late" boolean DEFAULT false NOT NULL,
	"repeated_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"read_back_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchanges_type_check" CHECK ("type" in ('question', 'photo_choice', 'voice_note', 'word', 'story', 'recipe', 'memory_photo', 'vote', 'hello')),
	CONSTRAINT "exchanges_state_check" CHECK ("state" in ('composed', 'scheduled', 'delivered', 'seen', 'answered', 'replied', 'read_back', 'archived', 'withdrawn')),
	CONSTRAINT "exchanges_when_rule_check" CHECK ("when_rule" in ('tomorrow', 'date', 'whenever'))
);

CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"country" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"story_day" smallint DEFAULT 0 NOT NULL,
	"turns_enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "families_region_check" CHECK ("region" in ('apac', 'eu', 'us')),
	CONSTRAINT "families_language_check" CHECK ("language" in ('en', 'zh-TW', 'ja', 'de', 'hi', 'ru')),
	CONSTRAINT "families_plan_check" CHECK ("plan" in ('free', 'light')),
	CONSTRAINT "families_story_day_check" CHECK ("story_day" between 0 and 6)
);

CREATE TABLE "family_channels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"conversation_id" text NOT NULL,
	"kind" text NOT NULL,
	"linked_by_member_id" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	CONSTRAINT "family_channels_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app')),
	CONSTRAINT "family_channels_kind_check" CHECK ("kind" in ('private', 'group'))
);

CREATE TABLE "flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"for_member_id" uuid,
	"token" text NOT NULL,
	"channel" text DEFAULT 'link' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	CONSTRAINT "invites_token_key" UNIQUE("token"),
	CONSTRAINT "invites_channel_check" CHECK ("channel" in ('link', 'line', 'whatsapp', 'telegram', 'sms', 'email'))
);

CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"kind" text NOT NULL,
	"storage_key" text,
	"channel" text,
	"provider_file_id" text,
	"provider_unique_id" text,
	"mime" text,
	"bytes" integer,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"kept" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "media_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "media_kind_check" CHECK ("kind" in ('audio', 'image')),
	CONSTRAINT "media_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app')),
	CONSTRAINT "media_storage_key_or_provider_file_id_check" CHECK ("storage_key" is not null or "provider_file_id" is not null)
);

CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid,
	"role" text DEFAULT 'member' NOT NULL,
	"billing" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"address_form" text,
	"language" text DEFAULT 'en' NOT NULL,
	"tz" text NOT NULL,
	"country" text NOT NULL,
	"age_band" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"turns_in" boolean DEFAULT true NOT NULL,
	"primary_surface" text DEFAULT 'app' NOT NULL,
	"light_on" boolean DEFAULT false NOT NULL,
	"light_consented_at" timestamp with time zone,
	"light_consent_text" text,
	"light_starts_on" date,
	"wake_time" time,
	"arrival_time" time DEFAULT '08:00' NOT NULL,
	"next_wake_at" timestamp with time zone,
	"quiet_after_min" integer DEFAULT 360 NOT NULL,
	"learning_until" date,
	"answer_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "members_family_id_user_id_key" UNIQUE("family_id","user_id"),
	CONSTRAINT "members_role_check" CHECK ("role" in ('organiser', 'member')),
	CONSTRAINT "members_language_check" CHECK ("language" in ('en', 'zh-TW', 'ja', 'de', 'hi', 'ru')),
	CONSTRAINT "members_age_band_check" CHECK ("age_band" in ('child', 'teen', 'adult', 'elder')),
	CONSTRAINT "members_status_check" CHECK ("status" in ('invited', 'active', 'paused', 'left', 'deceased')),
	CONSTRAINT "members_primary_surface_check" CHECK ("primary_surface" in ('app', 'parent-surface', 'line', 'whatsapp', 'telegram', 'voice'))
);

CREATE TABLE "memory_facts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"on_date" date,
	"source_answer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "memory_facts_kind_check" CHECK ("kind" in ('date', 'person', 'place', 'health', 'plan', 'preference'))
);

CREATE TABLE "message_refs" (
	"channel" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"family_id" uuid NOT NULL,
	"exchange_id" uuid,
	"quiet_event_id" uuid,
	"member_id" uuid,
	"local_date" date,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_refs_channel_conversation_id_message_id_pk" PRIMARY KEY("channel","conversation_id","message_id"),
	CONSTRAINT "message_refs_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app')),
	CONSTRAINT "message_refs_purpose_check" CHECK ("purpose" in ('arrival', 'repeat', 'turn_prompt', 'answer_post', 'quiet_notice', 'consent', 'ask_confirmation'))
);

CREATE TABLE "metrics_daily" (
	"day" date NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"answer_kind" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_min" integer,
	"replies" integer DEFAULT 0 NOT NULL,
	"read_back" boolean,
	"quiet_notice" boolean DEFAULT false NOT NULL,
	"quiet_outcome" text,
	"away" boolean DEFAULT false NOT NULL,
	"quiet_day" boolean DEFAULT false NOT NULL,
	CONSTRAINT "metrics_daily_day_member_id_pk" PRIMARY KEY("day","member_id")
);

CREATE TABLE "nearby_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relation" text,
	"phone" text NOT NULL,
	"channel" text,
	"consent_requested_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nearby_contacts_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'sms'))
);

CREATE TABLE "onboarding_sessions" (
	"channel" text NOT NULL,
	"conversation_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"step" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onboarding_sessions_channel_conversation_id_pk" PRIMARY KEY("channel","conversation_id"),
	CONSTRAINT "onboarding_sessions_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app'))
);

CREATE TABLE "outbound" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"exchange_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"conversation_id" text NOT NULL,
	"local_day" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"external_id" text,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "outbound_kind_check" CHECK ("kind" in ('arrival', 'repeat', 'turn_prompt', 'answer_receipt', 'answer_post', 'quiet_notice', 'quiet_resolved', 'weekly_read', 'ack', 'nearby_ask', 'flag', 'consent', 'onboarding', 'system')),
	CONSTRAINT "outbound_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app')),
	CONSTRAINT "outbound_status_check" CHECK ("status" in ('queued', 'sent', 'failed', 'dropped')),
	CONSTRAINT "outbound_nearby_ask_actor_check" CHECK ("kind" <> 'nearby_ask' or "actor_id" is not null)
);

CREATE TABLE "quiet_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"exchange_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notice_in_app_at" timestamp with time zone,
	"notice_push_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"notify_count" integer DEFAULT 0 NOT NULL,
	"notified_member_ids" uuid[] DEFAULT '{}' NOT NULL,
	"wait_until" timestamp with time zone,
	"ask_to_check" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"outcome" text,
	"resolved_by" uuid,
	"useful" boolean,
	CONSTRAINT "quiet_events_exchange_id_key" UNIQUE("exchange_id"),
	CONSTRAINT "quiet_events_outcome_check" CHECK ("outcome" in ('answered_late', 'away', 'fine_known', 'true_concern', 'unknown'))
);

CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"card" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"exchange_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_status_check" CHECK ("status" in ('draft', 'confirmed'))
);

CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"about_member_id" uuid NOT NULL,
	"text" text NOT NULL,
	"due_date" date NOT NULL,
	"fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);

CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"exchange_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"media_id" uuid,
	"channel" text NOT NULL,
	"external_id" text,
	"to_recipient" boolean DEFAULT true NOT NULL,
	"read_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replies_kind_check" CHECK ("kind" in ('heart', 'laugh', 'hug', 'text', 'voice', 'photo')),
	CONSTRAINT "replies_channel_check" CHECK ("channel" in ('line', 'whatsapp', 'telegram', 'voice', 'app'))
);

CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"exchange_id" uuid,
	"question" text NOT NULL,
	"asked_by" uuid,
	"transcript" text,
	"media_id" uuid,
	"kept" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "story_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lang" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"theme" text NOT NULL
);

CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"payer_user_id" uuid,
	"provider" text NOT NULL,
	"external_id" text,
	"status" text NOT NULL,
	"plan_interval" text,
	"currency" text,
	"price_cents" integer,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_member_id_key" UNIQUE("member_id"),
	CONSTRAINT "subscriptions_provider_check" CHECK ("provider" in ('trial', 'stripe', 'revenuecat', 'manual')),
	CONSTRAINT "subscriptions_status_check" CHECK ("status" in ('trial', 'active', 'grace', 'lapsed', 'cancelled')),
	CONSTRAINT "subscriptions_plan_interval_check" CHECK ("plan_interval" in ('month', 'year'))
);

CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"for_member_id" uuid NOT NULL,
	"about_member_id" uuid NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);

CREATE TABLE "translations" (
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"text" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translations_object_type_object_id_lang_pk" PRIMARY KEY("object_type","object_id","lang"),
	CONSTRAINT "translations_object_type_check" CHECK ("object_type" in ('exchange', 'answer', 'reply', 'story', 'weekly_read', 'recipe'))
);

CREATE TABLE "turns" (
	"family_id" uuid NOT NULL,
	"local_day" date NOT NULL,
	"recipient_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"prompted_at" timestamp with time zone,
	"prompt_message_id" text,
	"acted_at" timestamp with time zone,
	CONSTRAINT "turns_family_id_local_day_recipient_id_pk" PRIMARY KEY("family_id","local_day","recipient_id")
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"auth_subject" text,
	"email" text,
	"phone" text,
	"display_name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"tz" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_auth_subject_key" UNIQUE("auth_subject"),
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_phone_key" UNIQUE("phone"),
	CONSTRAINT "users_language_check" CHECK ("language" in ('en', 'zh-TW', 'ja', 'de', 'hi', 'ru'))
);

CREATE TABLE "weekly_reads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"lines" jsonb NOT NULL,
	"suggestion" text,
	"stats" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reads_member_id_week_start_key" UNIQUE("member_id","week_start")
);

ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "answers" ADD CONSTRAINT "answers_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "answers" ADD CONSTRAINT "answers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "answers" ADD CONSTRAINT "answers_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_set_by_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "channel_links" ADD CONSTRAINT "channel_links_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chips" ADD CONSTRAINT "chips_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "consents" ADD CONSTRAINT "consents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_nearby_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."nearby_contacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_recipient_id_members_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_asker_id_members_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_voice_hello_id_media_id_fk" FOREIGN KEY ("voice_hello_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "families" ADD CONSTRAINT "families_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "family_channels" ADD CONSTRAINT "family_channels_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "family_channels" ADD CONSTRAINT "family_channels_linked_by_member_id_members_id_fk" FOREIGN KEY ("linked_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "invites" ADD CONSTRAINT "invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_members_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invites" ADD CONSTRAINT "invites_for_member_id_members_id_fk" FOREIGN KEY ("for_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_members_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "media" ADD CONSTRAINT "media_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "members" ADD CONSTRAINT "members_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_source_answer_id_answers_id_fk" FOREIGN KEY ("source_answer_id") REFERENCES "public"."answers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_quiet_event_id_quiet_events_id_fk" FOREIGN KEY ("quiet_event_id") REFERENCES "public"."quiet_events"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "nearby_contacts" ADD CONSTRAINT "nearby_contacts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "nearby_contacts" ADD CONSTRAINT "nearby_contacts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "outbound" ADD CONSTRAINT "outbound_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "outbound" ADD CONSTRAINT "outbound_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "outbound" ADD CONSTRAINT "outbound_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quiet_events" ADD CONSTRAINT "quiet_events_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quiet_events" ADD CONSTRAINT "quiet_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quiet_events" ADD CONSTRAINT "quiet_events_resolved_by_members_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_about_member_id_members_id_fk" FOREIGN KEY ("about_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_fact_id_memory_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."memory_facts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "replies" ADD CONSTRAINT "replies_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "replies" ADD CONSTRAINT "replies_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "replies" ADD CONSTRAINT "replies_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "stories" ADD CONSTRAINT "stories_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stories" ADD CONSTRAINT "stories_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stories" ADD CONSTRAINT "stories_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stories" ADD CONSTRAINT "stories_asked_by_members_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stories" ADD CONSTRAINT "stories_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_for_member_id_members_id_fk" FOREIGN KEY ("for_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_about_member_id_members_id_fk" FOREIGN KEY ("about_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "turns" ADD CONSTRAINT "turns_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "turns" ADD CONSTRAINT "turns_recipient_id_members_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "turns" ADD CONSTRAINT "turns_holder_id_members_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "weekly_reads" ADD CONSTRAINT "weekly_reads_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "weekly_reads" ADD CONSTRAINT "weekly_reads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "ai_calls_at_idx" ON "ai_calls" USING btree ("at");
CREATE INDEX "answers_exchange_idx" ON "answers" USING btree ("exchange_id");
CREATE INDEX "answers_member_recent_idx" ON "answers" USING btree ("member_id","received_at" DESC NULLS FIRST);
CREATE INDEX "away_active_idx" ON "away_periods" USING btree ("member_id") WHERE "ended_at" is null;
CREATE INDEX "channel_links_member_idx" ON "channel_links" USING btree ("member_id");
CREATE INDEX "events_family_at_idx" ON "events" USING btree ("family_id","at");
CREATE INDEX "events_name_at_idx" ON "events" USING btree ("name","at");
CREATE UNIQUE INDEX "exchanges_one_per_day" ON "exchanges" USING btree ("recipient_id","scheduled_for") WHERE "scheduled_for" is not null and "state" <> 'withdrawn';
CREATE INDEX "exchanges_queue_idx" ON "exchanges" USING btree ("recipient_id","when_rule","created_at") WHERE "state" = 'composed';
CREATE INDEX "exchanges_family_recent_idx" ON "exchanges" USING btree ("family_id","scheduled_for" DESC NULLS FIRST);
CREATE UNIQUE INDEX "family_channels_channel_conversation_id_idx" ON "family_channels" USING btree ("channel","conversation_id") WHERE "unlinked_at" is null;
CREATE INDEX "media_expiry_idx" ON "media" USING btree ("expires_at") WHERE "kept" = false;
CREATE UNIQUE INDEX "media_channel_provider_unique_id_idx" ON "media" USING btree ("channel","provider_unique_id") WHERE "provider_unique_id" is not null;
CREATE INDEX "members_due_idx" ON "members" USING btree ("next_wake_at") WHERE "status" = 'active';
CREATE INDEX "members_family_idx" ON "members" USING btree ("family_id");
CREATE UNIQUE INDEX "outbound_budget_idx" ON "outbound" USING btree ("member_id","local_day","kind") WHERE "kind" in ('arrival', 'repeat', 'turn_prompt', 'weekly_read', 'ack', 'answer_receipt') and "status" <> 'dropped';
CREATE INDEX "outbound_pending_idx" ON "outbound" USING btree ("queued_at") WHERE "status" = 'queued';
CREATE INDEX "quiet_open_idx" ON "quiet_events" USING btree ("member_id") WHERE "resolved_at" is null;
CREATE INDEX "replies_exchange_idx" ON "replies" USING btree ("exchange_id");
CREATE UNIQUE INDEX "replies_channel_external_id_idx" ON "replies" USING btree ("channel","external_id") WHERE "external_id" is not null;
CREATE UNIQUE INDEX "replies_one_reaction_idx" ON "replies" USING btree ("exchange_id","member_id","kind") WHERE "kind" in ('heart', 'laugh', 'hug');
