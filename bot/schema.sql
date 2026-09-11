-- Vela pilot bot schema (Cloudflare D1 / SQLite). Idempotent.

CREATE TABLE IF NOT EXISTS families (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  child_chat_id   INTEGER NOT NULL UNIQUE,
  child_name      TEXT NOT NULL,
  child_lang      TEXT NOT NULL DEFAULT 'ru',      -- ru | en
  child_tz        TEXT NOT NULL,                   -- IANA, e.g. Asia/Taipei
  parent_chat_id  INTEGER UNIQUE,                  -- NULL until the parent taps the invite link
  parent_name     TEXT NOT NULL,                   -- e.g. "Галина"
  parent_address  TEXT NOT NULL,                   -- how the bot addresses her, e.g. "Галина Петровна"
  parent_lang     TEXT NOT NULL DEFAULT 'ru',
  parent_tz       TEXT NOT NULL,
  wake_time       TEXT NOT NULL,                   -- "HH:MM" parent local; morning message at wake + 30 min
  status          TEXT NOT NULL DEFAULT 'invited', -- invited | active | paused | deleted
  invite_token    TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per family per parent-local day.
CREATE TABLE IF NOT EXISTS days (
  family_id          INTEGER NOT NULL,
  day                TEXT NOT NULL,                -- YYYY-MM-DD in the parent's time zone
  morning_sent_at    TEXT,
  nudge_sent_at      TEXT,
  admin_card_at      TEXT,
  admin_card_msg_id  INTEGER,
  admin_decision     TEXT,                         -- notify | wait | ok
  reply_at           TEXT,                         -- first sign of life today (button, text, voice)
  reply_kind         TEXT,                         -- button | text | voice
  reply_summary      TEXT,                         -- one line, written by the AI, for tomorrow's context and the child's note
  escalation         TEXT,                         -- reason text if the AI flagged something today
  assistant_turns    INTEGER NOT NULL DEFAULT 0,
  child_note_at      TEXT,
  child_note_draft   TEXT,
  child_note_text    TEXT,
  PRIMARY KEY (family_id, day)
);

-- Conversation log. Rolling: rows older than 7 days are deleted by the scheduler.
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL,
  day         TEXT NOT NULL,
  role        TEXT NOT NULL,                       -- parent | assistant | relay
  text        TEXT NOT NULL,
  delivered   INTEGER NOT NULL DEFAULT 1,          -- relays from the child wait for the next morning
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_family_day ON messages(family_id, day);

-- Child onboarding state machine (one row per chat while onboarding).
CREATE TABLE IF NOT EXISTS onboarding (
  chat_id    INTEGER PRIMARY KEY,
  step       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',           -- JSON of answers so far
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
