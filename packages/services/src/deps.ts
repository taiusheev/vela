/**
 * The ports every service receives (code design §8). Services never import platform code: the
 * clock, queues, the scheduler, storage, the channels, and the AI arrive here, wired by the worker
 * in production and by the harness in tests.
 */
import type { Ai, Stt } from "@vela/ai";
import type { Channel, ChannelAdapter, Lang, Region } from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";

export interface Clock {
  now(): Date;
}

/** Fields are flat and content-free: never message text, transcripts, phone numbers, or tokens. */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface Random {
  /** A base64url token; invite tokens. */
  token(bytes?: number): string;
}

export interface JobQueue<J> {
  send(job: J, options?: { delaySeconds?: number }): Promise<void>;
}

export interface MemberScheduler {
  /** Sets the member's next wake; `null` deletes the alarm and everything the object stores. */
  wakeAt(memberId: string, at: Date | null): Promise<void>;
}

export interface MediaStore {
  put(key: string, body: ArrayBuffer, mime: string): Promise<void>;
  get(key: string): Promise<{ body: ArrayBuffer; mime: string } | null>;
  delete(key: string): Promise<void>;
}

/**
 * That a reconciliation finished. The Worker records the time where a watchdog outside Cloudflare
 * reads it, so a Worker, cron, or database that stopped shows as silence rather than as a quiet
 * family.
 */
export interface Heartbeat {
  ping(): Promise<void>;
}

export interface ChannelRegistry {
  get(channel: Channel): ChannelAdapter;
}

export type OutboundJob = { type: "deliver"; outboundId: string };
export type MediaJob =
  | { type: "ingest_answer_media"; answerId: string }
  | { type: "ingest_exchange_media"; mediaId: string };
export type UnderstandJob = { type: "understand_answer"; answerId: string };

export interface Config {
  telegramBotUsername: string;
  /** The founder's chat with the bot; `null` sends no admin messages. */
  adminConversationId: string | null;
  environment: "development" | "staging" | "production";
  /** The regions whose database exists in this environment; the pilot has apac only. */
  regions: readonly Region[];
  /** The Worker's public origin; admin links are publicBaseUrl + "/admin/...". */
  publicBaseUrl: string;
  /** The privacy notice URL per language; a language without its own notice carries the English URL. */
  privacyNoticeUrls: Record<Lang, string>;
  /**
   * The version line of the notices those URLs serve (`privacy-notice.v1`): the text version of a
   * `privacy_notice` consent tapped in the family group (flows §3.3), which must name the notice
   * the adult actually read, so it comes from the notices rather than from a constant here.
   */
  privacyNoticeVersion: string;
}

export interface Deps {
  db: VelaDatabase;
  clock: Clock;
  logger: Logger;
  random: Random;
  queues: {
    outbound: JobQueue<OutboundJob>;
    media: JobQueue<MediaJob>;
    understand: JobQueue<UnderstandJob>;
  };
  scheduler: MemberScheduler;
  media: MediaStore;
  channels: ChannelRegistry;
  ai: Ai;
  stt: Stt;
  heartbeat: Heartbeat;
  config: Config;
}
