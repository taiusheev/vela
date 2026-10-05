/**
 * The ports every service receives (code design §8). Services never import platform code: the
 * clock, queues, the scheduler, storage, the channels, and the AI arrive here, wired by the worker
 * in production and by the harness in tests.
 */
import type { Ai, Stt } from "@vela/ai";
import {
  CHANNEL_SEND_ERROR_CODES,
  type Channel,
  type ChannelAdapter,
  ChannelSendError,
  type ChannelSendErrorCode,
  type Lang,
  type Region,
} from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import type { PilotAdmission } from "./pilot-admission.ts";

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

/** Vela's own storage for the media a family sends: one object per key, written once and deleted. */
export interface MediaStore {
  put(key: string, body: ArrayBuffer, mime: string): Promise<void>;
  get(key: string): Promise<{ body: ArrayBuffer; mime: string } | null>;
  delete(key: string): Promise<void>;
  /** Whether an object is there, without its bytes: its size and type, or null (ADR-33). */
  head(key: string): Promise<{ bytes: number; mime: string } | null>;
  /** Optional metadata listing for orphan cleanup; no object content is returned. */
  list?(input: { prefix: string; cursor?: string; limit: number }): Promise<{
    objects: { key: string; uploadedAt: Date }[];
    cursor: string | null;
  }>;
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

// Push (ADR-34) -------------------------------------------------------------------------------

/**
 * One push to one installation of the app. Its text is names and times only, and its `data` ids
 * only (the contract's `PushData`): both pass through Expo, Apple and Google. Never a title, never
 * a badge.
 */
export interface PushMessage {
  /** The device's Expo push token. */
  readonly to: string;
  readonly body: string;
  readonly data?: Readonly<Record<string, string>>;
  /** Android's notification channel, which decides sound and importance there. */
  readonly channelId?: string;
  readonly priority?: "default" | "normal" | "high";
  readonly interruptionLevel?: "active" | "passive" | "time-sensitive";
  readonly sound?: "default" | null;
  /** Seconds Apple or Google keep trying to deliver it. */
  readonly ttl?: number;
}

/**
 * Why a push was not taken, by Expo when it was sent or by Apple or Google in its receipt, or why a
 * whole request failed.
 */
export interface PushFailure {
  /**
   * What the gateway does with it: `blocked` is a device that is gone (DeviceNotRegistered), a
   * retryable code may pass on another try, and the rest never will.
   */
  readonly code: ChannelSendErrorCode;
  /** Vela's own push credentials were refused: no retry mends it, and the founder is to be told. */
  readonly misconfigured: boolean;
  /** Expo's own name for it, or `http_<status>`, `network`, `timeout`: a label, safe to log. */
  readonly reason: string;
  /** For `outbound.error`: bounded, and never a token or what was sent. */
  readonly message: string;
}

/** What was answered for one message: accepted, with the id its receipt is read by, or not. */
export type PushResult =
  | { readonly status: "ok"; readonly id: string }
  | { readonly status: "error"; readonly failure: PushFailure };

/** What Apple or Google made of an accepted push. */
export type PushReceipt =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly failure: PushFailure };

/**
 * Expo's push service (ADR-34), or `null` while the Worker's `PUSH_SEND` is "off": then no push is
 * made or sent, a device counts toward nobody being told, and no receipt is read, while devices are
 * still registered, ready for the switch.
 */
export interface PushPort {
  /**
   * One result per message, in the order given. Throws a `ChannelSendError` only when nothing was
   * accepted (retry it as its code says); when it carries `failure` (`pushFailureOf`), that says
   * whether Vela's own credentials were refused.
   */
  send(messages: readonly PushMessage[]): Promise<readonly PushResult[]>;
  /**
   * The receipts that are ready, by ticket id. An id left out is not ready yet, or is older than
   * Expo keeps receipts (24 hours). Throws when the check cannot be made; asking again is safe.
   */
  getReceipts(ids: readonly string[]): Promise<Readonly<Record<string, PushReceipt>>>;
}

/** The `PushFailure` a push port's thrown error carries, or null for any other error. */
export function pushFailureOf(error: unknown): PushFailure | null {
  if (!(error instanceof ChannelSendError) || !("failure" in error)) {
    return null;
  }
  const failure: unknown = error.failure;
  if (
    typeof failure === "object" &&
    failure !== null &&
    "code" in failure &&
    "misconfigured" in failure &&
    "reason" in failure &&
    "message" in failure &&
    typeof failure.misconfigured === "boolean" &&
    typeof failure.reason === "string" &&
    typeof failure.message === "string" &&
    CHANNEL_SEND_ERROR_CODES.some((code) => code === failure.code)
  ) {
    return {
      code: error.code,
      misconfigured: failure.misconfigured,
      reason: failure.reason,
      message: failure.message,
    };
  }
  return null;
}

export type OutboundJob = { type: "deliver"; outboundId: string };
export type MediaJob =
  | { type: "ingest_answer_media"; answerId: string }
  | { type: "ingest_exchange_media"; mediaId: string };
export type UnderstandJob = { type: "understand_answer"; answerId: string };

export interface Config {
  /** Explicit private trial admission; absent or null preserves the normal product behavior. */
  pilotAdmission?: PilotAdmission | null;
  telegramBotUsername: string;
  /** The LINE Official Account's basic id (`@…`) a LINE invite link opens; null while LINE is off. */
  lineBasicId: string | null;
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
  /**
   * Whether understanding keeps her dated plans as memory facts for reminders (spec §12, `MEMORY`).
   * Off in production until the privacy notice names memory and counsel has answered on health
   * words (data map row 29); a plan is then not kept at all.
   */
  memory: boolean;
  /**
   * Whether her answers to a story ask are kept in the family book beyond 30 days (ADR-39, `BOOK`).
   * Off in production until the privacy notice describes the book: version 1 says it comes later.
   */
  book: boolean;
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
  /**
   * Vela's own storage, or `null` while the Worker's `MEDIA_STORAGE` is "off" (decision M,
   * 2026-09-20). With `null` nothing is copied out of the channel: a media row keeps the provider
   * file id it arrived with and no storage key, the bytes a transcription needs are fetched from
   * the channel each time, and retention has no object to delete.
   */
  media: MediaStore | null;
  channels: ChannelRegistry;
  /** Expo's push service, or `null` while `PUSH_SEND` is "off" (ADR-34). */
  push: PushPort | null;
  ai: Ai;
  stt: Stt;
  heartbeat: Heartbeat;
  config: Config;
}
