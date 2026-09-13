export interface Env {
  DB: D1Database;
  BOT_USERNAME: string;
  MODEL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
  ADMIN_CHAT_ID: string;
}

export type Lang = "ru" | "en";

export interface Family {
  id: number;
  child_chat_id: number;
  child_name: string;
  child_lang: Lang;
  child_tz: string;
  parent_chat_id: number | null;
  parent_name: string;
  parent_address: string;
  parent_lang: Lang;
  parent_tz: string;
  wake_time: string;
  status: "invited" | "active" | "paused" | "deleted";
  invite_token: string;
  created_at: string;
}

export interface DayRow {
  family_id: number;
  day: string;
  morning_sent_at: string | null;
  nudge_sent_at: string | null;
  admin_card_at: string | null;
  admin_card_msg_id: number | null;
  admin_decision: "notify" | "wait" | "ok" | null;
  reply_at: string | null;
  reply_kind: "button" | "text" | "voice" | null;
  reply_summary: string | null;
  escalation: string | null;
  assistant_turns: number;
  child_note_at: string | null;
  child_note_draft: string | null;
  child_note_text: string | null;
}

export interface MessageRow {
  id: number;
  family_id: number;
  day: string;
  role: "parent" | "assistant" | "relay";
  text: string;
  delivered: number;
  created_at: string;
}

// Minimal Telegram update shapes we actually use.
export interface TgUser {
  id: number;
  first_name?: string;
  language_code?: string;
}
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  voice?: { file_id: string; duration: number };
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
