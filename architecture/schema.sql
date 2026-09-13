-- Vela · Postgres schema v2 (2026-09-13)
-- One database per data region (apac, eu, us). Same schema everywhere. Applied by migrations in db/migrations/.
-- Conventions: uuid primary keys (uuidv7 for time ordering), timestamptz everywhere, text + CHECK instead of enums
-- (cheaper to evolve), no soft deletes except the documented status fields, every table has created_at.
-- Spec: product/05-product-spec-v2.md. The exchange (§3) is the core object; arrivals are its deliveries.

-- gen_random_uuid() is built into Postgres 13+; no extension needed.
-- pg_trgm (admin search) is added by a later migration when the admin view needs it.

-- uuidv7 without an extension (time-ordered ids; falls back cleanly on any Postgres 15+)
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing
      substring(int8send((extract(epoch from clock_timestamp())*1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid;
$$ LANGUAGE sql VOLATILE;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------

-- A person with an account (organisers and members who use the app). Kept-light members on a messenger have no user row.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  auth_subject  text UNIQUE,                       -- id from the auth provider
  email         text UNIQUE,
  phone         text UNIQUE,                       -- E.164
  display_name  text NOT NULL,
  language      text NOT NULL DEFAULT 'en' CHECK (language IN ('en','zh-TW','ja','de','hi','ru')),
  tz            text NOT NULL DEFAULT 'UTC',       -- IANA
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE families (
  id                uuid PRIMARY KEY DEFAULT uuid_v7(),
  name              text NOT NULL,
  region            text NOT NULL CHECK (region IN ('apac','eu','us')),
  country           text NOT NULL,                 -- ISO 3166-1 alpha-2 of the kept-light member; sets region and holidays
  plan              text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','light')),
  story_day         smallint NOT NULL DEFAULT 0 CHECK (story_day BETWEEN 0 AND 6),  -- 0 = Sunday
  turns_enabled     boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz                    -- delete-family cascades within 24 h (job)
);

-- Membership of a person in a family. The kept-light member is a member with light_on = true.
CREATE TABLE members (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id           uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id),   -- NULL for members reached only through a channel
  role                text NOT NULL DEFAULT 'member' CHECK (role IN ('organiser','member')),
  billing             boolean NOT NULL DEFAULT false,  -- the organiser who pays
  display_name        text NOT NULL,                   -- "Mom", "Mia"
  address_form        text,                            -- "Mrs Ivanova", "Галина Петровна"; used in every greeting
  language            text NOT NULL DEFAULT 'en' CHECK (language IN ('en','zh-TW','ja','de','hi','ru')),
  tz                  text NOT NULL,                   -- IANA; DST handled by the tz database
  country             text NOT NULL,
  age_band            text CHECK (age_band IN ('child','teen','adult','elder')),
  status              text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','paused','left','deceased')),
  turns_in            boolean NOT NULL DEFAULT true,
  primary_surface     text NOT NULL DEFAULT 'app' CHECK (primary_surface IN ('app','parent-surface','line','whatsapp','telegram','voice')),
  -- the light
  light_on            boolean NOT NULL DEFAULT false,
  light_consented_at  timestamptz,
  light_consent_text  text,                            -- version of the consent copy she agreed to
  wake_time           time,                            -- her local wake time
  arrival_time        time NOT NULL DEFAULT '08:00',   -- local arrival hour (wake + 30 min for kept-light members)
  next_arrival_at     timestamptz,                     -- UTC; recomputed after each delivery; the scheduler's index
  quiet_after_min     integer NOT NULL DEFAULT 360,    -- T_quiet, start 6 h; tuned weekly, floor 240, cap 600
  learning_until      date,                            -- first 14 days: in-app quiet only, push after 8 h
  answer_stats        jsonb NOT NULL DEFAULT '{}',     -- {median_latency_min, sunday_median_min, n_days, updated_at}
  created_at          timestamptz NOT NULL DEFAULT now(),
  left_at             timestamptz,                     -- data deleted 30 days later by job
  UNIQUE (family_id, user_id)
);
CREATE INDEX members_due_idx ON members (next_arrival_at) WHERE status = 'active';
CREATE INDEX members_family_idx ON members (family_id);

-- Identity of a member on a channel. There is no account for her; this row is her.
CREATE TABLE channel_links (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('line','whatsapp','telegram','voice','app')),
  external_id   text NOT NULL,                       -- LINE userId, WhatsApp wa_id, Telegram chat id, E.164, device id
  display_name  text,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  blocked_at    timestamptz,                         -- unfollow / block / unreachable
  meta          jsonb NOT NULL DEFAULT '{}',
  UNIQUE (channel, external_id)
);
CREATE INDEX channel_links_member_idx ON channel_links (member_id);

-- Invites into a family (link or phone/email). Tokens are single use.
CREATE TABLE invites (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  invited_by    uuid NOT NULL REFERENCES members(id),
  for_member_id uuid REFERENCES members(id),         -- pre-created member row (e.g. the kept-light member)
  token         text NOT NULL UNIQUE,
  channel       text NOT NULL DEFAULT 'link' CHECK (channel IN ('link','line','whatsapp','telegram','sms','email')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES members(id)
);

-- Two people the organiser would call first. Consent once, in the organiser's name.
CREATE TABLE nearby_contacts (
  id                    uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id             uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id             uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- the kept-light member they are near
  name                  text NOT NULL,
  relation              text,
  phone                 text NOT NULL,
  channel               text CHECK (channel IN ('line','whatsapp','telegram','sms')),
  consent_requested_at  timestamptz,
  consented_at          timestamptz,
  declined_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------------------------

CREATE TABLE media (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  uploaded_by   uuid REFERENCES members(id),
  kind          text NOT NULL CHECK (kind IN ('audio','image')),
  storage_key   text NOT NULL UNIQUE,                -- R2 object key inside the region bucket
  mime          text NOT NULL,
  bytes         integer NOT NULL,
  duration_ms   integer,                             -- audio
  width         integer, height integer,             -- image
  kept          boolean NOT NULL DEFAULT false,      -- in the family book: exempt from the 30-day deletion
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz                          -- created_at + 30 days unless kept
);
CREATE INDEX media_expiry_idx ON media (expires_at) WHERE kept = false;

-- ---------------------------------------------------------------------------------------------
-- The exchange (spec §3): one ask, one answer, its replies
-- ---------------------------------------------------------------------------------------------

CREATE TABLE exchanges (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id           uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  recipient_id        uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  asker_id            uuid REFERENCES members(id),    -- NULL = Vela (fallback hello only)
  on_behalf_of        text,                           -- a child's name when a parent sends for them
  type                text NOT NULL CHECK (type IN ('question','photo_choice','voice_note','word','story','recipe','memory_photo','vote','hello')),
  state               text NOT NULL DEFAULT 'composed' CHECK (state IN ('composed','scheduled','delivered','seen','answered','replied','read_back','archived','withdrawn')),
  text                text,                           -- the ask, in the asker's language
  text_lang           text NOT NULL DEFAULT 'en',
  options             jsonb,                          -- vote options, photo ids for a choice, the word to teach, the story question id
  media_ids           uuid[] NOT NULL DEFAULT '{}',
  voice_hello_id      uuid REFERENCES media(id),      -- the asker's 10-second hello
  when_rule           text NOT NULL DEFAULT 'tomorrow' CHECK (when_rule IN ('tomorrow','date','whenever')),
  scheduled_for       date,                           -- recipient-local date of delivery
  delivered_at        timestamptz,
  delivery_late       boolean NOT NULL DEFAULT false,
  repeated_at         timestamptz,
  seen_at             timestamptz,
  answered_at         timestamptz,
  replied_at          timestamptz,
  read_back_at        timestamptz,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Exactly one exchange delivered per recipient per local day: the idempotency backbone (spec §4.1).
CREATE UNIQUE INDEX exchanges_one_per_day ON exchanges (recipient_id, scheduled_for)
  WHERE state IN ('scheduled','delivered','seen','answered','replied','read_back','archived');
CREATE INDEX exchanges_queue_idx ON exchanges (recipient_id, when_rule, created_at) WHERE state = 'composed';
CREATE INDEX exchanges_family_recent_idx ON exchanges (family_id, scheduled_for DESC);

-- Every text shown to a reader in their language. object = exchange ask, answer transcript, reply, story, weekly read line.
CREATE TABLE translations (
  object_type   text NOT NULL CHECK (object_type IN ('exchange','answer','reply','story','weekly_read','recipe')),
  object_id     uuid NOT NULL,
  lang          text NOT NULL,
  text          text NOT NULL,
  provider      text NOT NULL,                       -- 'claude:v3' etc.
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type, object_id, lang)
);

CREATE TABLE answers (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  exchange_id     uuid NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('voice','chip','photo_pick','vote','heart','text','photo','fine','sticker')),
  channel         text NOT NULL,
  external_id     text,                              -- provider message id; dedups duplicate webhooks
  payload         jsonb NOT NULL DEFAULT '{}',       -- chip text, picked option, vote, sticker id
  media_id        uuid REFERENCES media(id),
  transcript      text,
  transcript_lang text,
  summary         text,                              -- one neutral line (AI)
  mood_words      text[] NOT NULL DEFAULT '{}',
  mentions        jsonb NOT NULL DEFAULT '{}',       -- {people[], places[], plans[], health[], dates[]}
  flag            boolean NOT NULL DEFAULT false,
  flag_reason     text,
  away_until      date,                              -- detected "going to my sister's until Sunday"
  understood_at   timestamptz,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);
CREATE INDEX answers_exchange_idx ON answers (exchange_id);
CREATE INDEX answers_member_recent_idx ON answers (member_id, received_at DESC);

CREATE TABLE replies (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  exchange_id   uuid NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('heart','laugh','hug','text','voice','photo')),
  text          text,
  media_id      uuid REFERENCES media(id),
  to_recipient  boolean NOT NULL DEFAULT true,       -- replies among ordinary members are not read back
  read_back_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX replies_exchange_idx ON replies (exchange_id);

-- Chips drafted for a question, only ever shown to her.
CREATE TABLE chips (
  exchange_id   uuid PRIMARY KEY REFERENCES exchanges(id) ON DELETE CASCADE,
  chips         text[] NOT NULL,
  prompt_version text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Turns, suggestions, story day, the family book, memory
-- ---------------------------------------------------------------------------------------------

CREATE TABLE turns (
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  local_day     date NOT NULL,                       -- the recipient's local day the ask is for
  recipient_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  holder_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  prompted_at   timestamptz,
  acted_at      timestamptz,                         -- an exchange was composed for that day by anyone
  PRIMARY KEY (family_id, local_day, recipient_id)
);

CREATE TABLE suggestions (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id       uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  for_member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- the turn holder
  about_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- her
  type            text NOT NULL,
  text            text NOT NULL,
  source          jsonb NOT NULL DEFAULT '{}',       -- {mention_answer_id, fact_id, rotation}
  prompt_version  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  used_at         timestamptz
);

CREATE TABLE story_questions (                        -- the curated bank, per language
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  lang          text NOT NULL,
  ordinal       integer NOT NULL,
  text          text NOT NULL,
  theme         text NOT NULL
);

CREATE TABLE stories (                                -- the family book
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- the storyteller
  exchange_id   uuid REFERENCES exchanges(id),
  question      text NOT NULL,
  asked_by      uuid REFERENCES members(id),
  transcript    text,
  media_id      uuid REFERENCES media(id),
  kept          boolean NOT NULL DEFAULT true,       -- "don't keep that one" flips it and deletes media
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipes (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title         text NOT NULL,
  card          jsonb NOT NULL DEFAULT '{}',         -- {ingredients[], steps[], remarks[]}
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  exchange_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_facts (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id       uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- whose fact
  kind            text NOT NULL CHECK (kind IN ('date','person','place','health','plan','preference')),
  text            text NOT NULL,
  on_date         date,
  source_answer_id uuid REFERENCES answers(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz
);

CREATE TABLE reminders (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id       uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- who is reminded
  about_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  text            text NOT NULL,
  due_date        date NOT NULL,
  fact_id         uuid REFERENCES memory_facts(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),       -- only after a tap (spec §12)
  done_at         timestamptz
);

-- ---------------------------------------------------------------------------------------------
-- The light: quiet events, away, weekly reads
-- ---------------------------------------------------------------------------------------------

CREATE TABLE quiet_events (
  id                    uuid PRIMARY KEY DEFAULT uuid_v7(),
  exchange_id           uuid NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  member_id             uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  notice_in_app_at      timestamptz,
  notice_push_at        timestamptz,
  wait_until            timestamptz,
  ask_to_check          jsonb NOT NULL DEFAULT '[]', -- [{contact_id, sent_by, sent_at, reply}]
  resolved_at           timestamptz,
  outcome               text CHECK (outcome IN ('answered_late','away','fine_known','true_concern','unknown')),
  resolved_by           uuid REFERENCES members(id),
  useful                boolean,                     -- organiser's one-tap verdict; the precision page
  UNIQUE (exchange_id)
);
CREATE INDEX quiet_open_idx ON quiet_events (member_id) WHERE resolved_at IS NULL;

CREATE TABLE away_periods (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  from_date     date NOT NULL,
  to_date       date,                                -- NULL = until she answers ("until I'm back")
  source        text NOT NULL CHECK (source IN ('organiser','member','answer','pattern')),
  set_by        uuid REFERENCES members(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX away_active_idx ON away_periods (member_id) WHERE ended_at IS NULL;

CREATE TABLE weekly_reads (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- the kept-light member
  week_start    date NOT NULL,
  lines         jsonb NOT NULL,                      -- [{text, kind}] in the family's languages via translations
  suggestion    text,
  stats         jsonb NOT NULL,                      -- {answered_days, usual_time, drift_min, topics[], voice_len_drift}
  prompt_version text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, week_start)
);

-- ---------------------------------------------------------------------------------------------
-- Outbound (the gateway) and the notification budget
-- ---------------------------------------------------------------------------------------------

CREATE TABLE outbound (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('arrival','repeat','turn_prompt','answer_receipt','quiet_notice','weekly_read','ack','nearby_ask','flag','system')),
  channel         text NOT NULL,
  local_day       date NOT NULL,                     -- the member's local day; budget key
  idempotency_key text NOT NULL UNIQUE,              -- e.g. arrival:<member>:<day>
  actor_id        uuid REFERENCES members(id),       -- REQUIRED for nearby_ask: a person's tap (spec §8)
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','dropped')),
  attempts        integer NOT NULL DEFAULT 0,
  external_id     text,
  error           text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CHECK (kind <> 'nearby_ask' OR actor_id IS NOT NULL)
);
-- The budget (spec §15): one arrival, one repeat, one turn prompt, one weekly read, one ack per member per local day.
CREATE UNIQUE INDEX outbound_budget_idx ON outbound (member_id, local_day, kind)
  WHERE kind IN ('arrival','repeat','turn_prompt','weekly_read','ack','answer_receipt') AND status <> 'dropped';
CREATE INDEX outbound_pending_idx ON outbound (queued_at) WHERE status = 'queued';

-- ---------------------------------------------------------------------------------------------
-- AI, events, consent, deletion, flags, billing
-- ---------------------------------------------------------------------------------------------

CREATE TABLE ai_calls (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id       uuid REFERENCES families(id) ON DELETE SET NULL,
  member_id       uuid REFERENCES members(id) ON DELETE SET NULL,
  call            text NOT NULL,                     -- understand | chips | translate | suggest | weekly_read | acknowledge | hello | recipe
  prompt_version  text NOT NULL,
  model           text NOT NULL,
  input_ref       jsonb NOT NULL,                    -- {answer_id | exchange_id | ...}; inputs are never copied
  output          jsonb,
  ok              boolean NOT NULL,
  tokens_in       integer, tokens_out integer, tokens_cached integer,
  latency_ms      integer,
  cost_usd        numeric(10,6),
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_calls_at_idx ON ai_calls (at);

-- Append-only. The KPI job and the admin view read it; nothing updates it. Partitioned by month.
CREATE TABLE events (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  at            timestamptz NOT NULL DEFAULT now(),
  name          text NOT NULL,                       -- spec §18 names
  family_id     uuid,
  member_id     uuid,
  exchange_id   uuid,
  surface       text,
  local_time    time,
  props         jsonb NOT NULL DEFAULT '{}',         -- never content: kinds, types, durations, outcomes
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE TABLE events_default PARTITION OF events DEFAULT;   -- monthly partitions created by the migration job
CREATE INDEX events_family_at_idx ON events (family_id, at);
CREATE INDEX events_name_at_idx ON events (name, at);

CREATE TABLE consents (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  member_id     uuid REFERENCES members(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES nearby_contacts(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('light','nearby','privacy_notice','pilot')),
  text_version  text NOT NULL,
  lang          text NOT NULL,
  channel       text NOT NULL,
  given_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  evidence      jsonb NOT NULL DEFAULT '{}'          -- message id, screen, the exact words
);

-- Proof of deletion without keeping what was deleted.
CREATE TABLE deletions (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  object_type   text NOT NULL,
  object_id     uuid NOT NULL,
  content_hash  text NOT NULL,
  reason        text NOT NULL,
  deleted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  family_id           uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id           uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,   -- the kept-light member covered
  payer_user_id       uuid REFERENCES users(id),
  provider            text NOT NULL CHECK (provider IN ('trial','stripe','revenuecat','manual')),
  external_id         text,
  status              text NOT NULL CHECK (status IN ('trial','active','grace','lapsed','cancelled')),
  plan_interval       text CHECK (plan_interval IN ('month','year')),
  currency            text,
  price_cents         integer,
  trial_ends_at       timestamptz,
  current_period_end  timestamptz,
  grace_until         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

CREATE TABLE flags (
  key           text PRIMARY KEY,
  value         jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_access_log (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  admin         text NOT NULL,
  family_id     uuid,
  what          text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);

-- Daily rollups written by the KPI job; the founder's dashboard reads only this and events.
CREATE TABLE metrics_daily (
  day               date NOT NULL,
  family_id         uuid,
  member_id         uuid,
  delivered         integer NOT NULL DEFAULT 0,
  answered          integer NOT NULL DEFAULT 0,
  answer_kind       jsonb NOT NULL DEFAULT '{}',
  latency_min       integer,
  replies           integer NOT NULL DEFAULT 0,
  read_back         boolean,
  quiet_notice      boolean NOT NULL DEFAULT false,
  quiet_outcome     text,
  away              boolean NOT NULL DEFAULT false,
  quiet_day         boolean NOT NULL DEFAULT false,  -- fallback hello used
  PRIMARY KEY (day, member_id)
);

-- ---------------------------------------------------------------------------------------------
-- Retention jobs (documented here, implemented in the worker)
-- media: delete where expires_at < now() and kept = false; write deletions row.
-- answers: delete transcript/media refs older than 30 days unless story kept; summaries stay.
-- members: status 'left' and left_at < now() - 30 days → delete member and channel links.
-- families: deleted_at set → cascade within 24 h; export archives are outside the database.
-- events: partitions dropped after 24 months; metrics_daily kept.
