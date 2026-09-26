/**
 * A small typed client for the LINE Messaging API: api.line.me for sending, profiles, leaving and
 * quota, and api-data.line.me for what people sent.
 *
 * Built against the Messaging API reference and LINE's OpenAPI files as read on 2026-09-26 (05 §1).
 * Every path is written exactly, with no trailing slash, which LINE no longer promises to accept
 * (news of 2026-08-17).
 *
 * Every failure becomes a `ChannelSendError` (05 §5.6). The channel access token travels in a
 * header, but paths carry the ids of people and chats, so error text is built from the call's name,
 * the status and LINE's own message, never from a URL or a body, and the token and every LINE id
 * are redacted from anything LINE or the runtime says.
 */
import { ChannelSendError, type ChannelSendErrorCode } from "@vela/contracts";
import { GROUP_ID, MESSAGE_ID, ROOM_ID, USER_ID } from "./ids.ts";

export const LINE_API_BASE_URL = "https://api.line.me";
export const LINE_DATA_API_BASE_URL = "https://api-data.line.me";

/**
 * A call that has not answered in 10 s is counted as failed and, for a push, retried under the same
 * retry key. A download carries up to 20 MB, so it is given longer.
 */
const REQUEST_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Visible ASCII: the token goes into a header, where a space, a control or a non-ASCII breaks it. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const ANY_LINE_ID = /[UCR][0-9a-f]{32}/g;
/** The one 429 that is not about speed (05 §5.6). */
const MONTHLY_LIMIT = /monthly limit/i;
/** Enough of LINE's message and the properties it names to diagnose a refusal, and no more. */
const MAX_REASON_LENGTH = 300;

export interface LineApiOptions {
  /** The long-lived channel access token (`infra/README.md` §8). */
  readonly channelAccessToken: string;
  readonly fetch?: typeof fetch;
  /** Defaults to https://api.line.me; a test double otherwise. */
  readonly apiBaseUrl?: string;
  /** Defaults to https://api-data.line.me, where content is downloaded. */
  readonly dataApiBaseUrl?: string;
}

export interface LinePostbackAction {
  readonly type: "postback";
  /** At most 20 grapheme clusters on a quick reply, 40 on a Flex button. */
  readonly label: string;
  /** Returned in the postback event; at most 300 characters. */
  readonly data: string;
  /** Posted in the chat as the tapper's own message; at most 300 characters. */
  readonly displayText: string;
}

export interface LineQuickReplyItem {
  readonly type: "action";
  readonly action: LinePostbackAction;
}

export interface LineFlexButton {
  readonly type: "button";
  readonly style: "secondary";
  readonly height: "sm";
  readonly action: LinePostbackAction;
}

export interface LineFlexBubble {
  readonly type: "bubble";
  readonly body: {
    readonly type: "box";
    readonly layout: "vertical";
    readonly spacing: "sm";
    readonly contents: readonly LineFlexButton[];
  };
}

export type LineMessageObject =
  | {
      readonly type: "text";
      readonly text: string;
      readonly quickReply?: { readonly items: readonly LineQuickReplyItem[] };
    }
  | {
      readonly type: "image";
      readonly originalContentUrl: string;
      readonly previewImageUrl: string;
    }
  | {
      readonly type: "audio";
      readonly originalContentUrl: string;
      /** Milliseconds. */
      readonly duration: number;
    }
  | { readonly type: "flex"; readonly altText: string; readonly contents: LineFlexBubble };

export interface LinePushRequest {
  /** A user, group or multi-person chat id. */
  readonly to: string;
  /** 1–5 objects. */
  readonly messages: readonly LineMessageObject[];
}

export interface LineReplyRequest {
  readonly replyToken: string;
  /** 1–5 objects. */
  readonly messages: readonly LineMessageObject[];
}

export type LineReplyResult =
  | { readonly accepted: true; readonly sentMessageIds: readonly string[] }
  /** LINE refused the token (used, expired or unknown), so nothing was sent. */
  | { readonly accepted: false };

/** A download, or `ready: false` while LINE is still preparing a large audio or video (202). */
export type LineDownload =
  | { readonly ready: true; readonly body: ArrayBuffer; readonly contentType: string | null }
  | { readonly ready: false };

export const LINE_TRANSCODING_STATUSES = ["processing", "succeeded", "failed"] as const;
export type LineTranscodingStatus = (typeof LINE_TRANSCODING_STATUSES)[number];

/** A user's main profile. The picture URL and status message are never read. */
export interface LineUserProfile {
  readonly displayName?: string;
  /** BCP 47; LINE leaves it out until the user has agreed to LY Corporation's privacy policy. */
  readonly language?: string;
}

export interface LineMemberProfile {
  readonly displayName?: string;
}

export type LineQuota =
  | { readonly type: "none" }
  /** `value` is this month's messages, free and bought. */
  | { readonly type: "limited"; readonly value: number };

export interface LineClient {
  /** Returns the ids of the objects sent, in order; a 409 for a key already accepted is success. */
  push(request: LinePushRequest, retryKey: string): Promise<readonly string[]>;
  reply(request: LineReplyRequest): Promise<LineReplyResult>;
  /** Rejects bodies larger than `maxBytes`. */
  content(messageId: string, maxBytes: number): Promise<LineDownload>;
  transcodingStatus(messageId: string): Promise<LineTranscodingStatus>;
  /** Rejects bodies larger than `maxBytes`. */
  preview(messageId: string, maxBytes: number): Promise<LineDownload>;
  /** Null when LINE does not know the user (404). */
  profile(userId: string): Promise<LineUserProfile | null>;
  /** Null when the group or the user in it is not found (404). */
  groupMemberProfile(groupId: string, userId: string): Promise<LineMemberProfile | null>;
  /** A group the bot is no longer in (404) counts as left. */
  leaveGroup(groupId: string): Promise<void>;
  /** A multi-person chat the bot is no longer in (404) counts as left. */
  leaveRoom(roomId: string): Promise<void>;
  quota(): Promise<LineQuota>;
  /** Messages counted this month so far, which LINE calls approximate. */
  quotaConsumption(): Promise<number>;
}

/** How LINE's answer to a send or a lookup maps to the contract's codes (05 §5.6). */
export function lineErrorCode(status: number, message: string): ChannelSendErrorCode {
  if (status === 400 || status === 403 || status === 413 || status === 415) {
    return "invalid_request";
  }
  // A wrong or revoked token: retrying gives the founder time to put a new one in place.
  if (status === 401) return "unavailable";
  if (status === 404) return "not_found";
  // LINE says the monthly limit can lift again while another delivery holds part of the quota.
  if (status === 429) return MONTHLY_LIMIT.test(message) ? "quota_exhausted" : "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

/**
 * Downloads differ in two statuses: content answered 400 for about 1½ hours during LINE's outage of
 * 3 February 2026, and 410 means the sender unsent the message (05 §5.7).
 */
export function lineContentErrorCode(status: number, message: string): ChannelSendErrorCode {
  if (status === 400) return "unavailable";
  if (status === 410) return "not_found";
  return lineErrorCode(status, message);
}

interface Call {
  /** Names the call in error text, which never carries its URL. */
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: string;
  readonly retryKey?: string;
}

interface Answer {
  readonly status: number;
  /** The parsed JSON body, or undefined when it is not JSON. */
  readonly body: unknown;
}

export function createLineClient(options: LineApiOptions): LineClient {
  const token = options.channelAccessToken;
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("LINE channel access token must be visible ASCII without spaces");
  }
  const apiBaseUrl = (options.apiBaseUrl ?? LINE_API_BASE_URL).replace(/\/+$/, "");
  const dataApiBaseUrl = (options.dataApiBaseUrl ?? LINE_DATA_API_BASE_URL).replace(/\/+$/, "");
  // Invoked unbound: Workers reject the platform fetch when it is called as a method of an object.
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  const redact = (text: string): string =>
    text.replaceAll(token, "[token]").replace(ANY_LINE_ID, "[id]");

  const networkError = (name: string, error: unknown, timeoutMs: number): ChannelSendError =>
    new ChannelSendError(
      "unavailable",
      isTimeout(error)
        ? `line ${name} failed: no answer within ${timeoutMs / 1000} s`
        : `line ${name} failed: network error (${redact(describe(error))})`,
    );

  const failure = (name: string, answer: Answer, code: ChannelSendErrorCode): ChannelSendError => {
    const reason = redact(reasonOf(answer.body)).slice(0, MAX_REASON_LENGTH);
    // The row's error then says why a send keeps failing without anyone reading the logs.
    const auth = answer.status === 401 ? " line_auth" : "";
    return new ChannelSendError(
      code,
      `line ${name} failed: ${answer.status}${auth}${reason === "" ? "" : ` ${reason}`}`,
    );
  };

  function headersFor(call: Pick<Call, "body" | "retryKey">): Headers {
    const headers = new Headers({ authorization: `Bearer ${token}` });
    if (call.body !== undefined) headers.set("content-type", "application/json");
    if (call.retryKey !== undefined) headers.set("x-line-retry-key", call.retryKey);
    return headers;
  }

  async function exchange(call: Call): Promise<Answer> {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(call.url, {
        method: call.method,
        headers: headersFor(call),
        body: call.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      throw networkError(call.name, error, REQUEST_TIMEOUT_MS);
    }
    return { status: response.status, body: parseJson(text) };
  }

  /** A lookup: its body when LINE answers 2xx, null on 404, and an error otherwise. */
  async function read(name: string, url: string): Promise<unknown> {
    const answer = await exchange({ name, method: "GET", url });
    if (isSuccess(answer.status)) return answer.body;
    if (answer.status === 404) return null;
    throw failure(name, answer, lineErrorCode(answer.status, reasonOf(answer.body)));
  }

  async function leave(name: string, url: string): Promise<void> {
    const answer = await exchange({ name, method: "POST", url });
    if (isSuccess(answer.status) || answer.status === 404) return;
    throw failure(name, answer, lineErrorCode(answer.status, reasonOf(answer.body)));
  }

  async function download(name: string, url: string, maxBytes: number): Promise<LineDownload> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: headersFor({}),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw networkError(name, error, DOWNLOAD_TIMEOUT_MS);
    }
    if (response.status === 202) return { ready: false };
    if (!isSuccess(response.status)) {
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw networkError(name, error, DOWNLOAD_TIMEOUT_MS);
      }
      const answer = { status: response.status, body: parseJson(text) };
      throw failure(name, answer, lineContentErrorCode(answer.status, reasonOf(answer.body)));
    }
    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (declaredBytes > maxBytes) throw tooLarge(name, maxBytes);
    let body: ArrayBuffer;
    try {
      body = await response.arrayBuffer();
    } catch (error) {
      throw networkError(name, error, DOWNLOAD_TIMEOUT_MS);
    }
    if (body.byteLength > maxBytes) throw tooLarge(name, maxBytes);
    return { ready: true, body, contentType: response.headers.get("content-type") };
  }

  const contentUrl = (messageId: string): string =>
    `${dataApiBaseUrl}/v2/bot/message/${pathId(messageId, MESSAGE_ID, "message")}/content`;

  return {
    async push(request, retryKey) {
      const answer = await exchange({
        name: "push",
        method: "POST",
        url: `${apiBaseUrl}/v2/bot/message/push`,
        body: JSON.stringify(request),
        retryKey,
      });
      // A 409 means LINE already accepted this key: it names the first request's messages.
      if (isSuccess(answer.status) || answer.status === 409) {
        const ids = sentMessageIds(answer.body, request.messages.length);
        if (ids !== undefined) return ids;
        // The retry key makes sending again safe: a retry either sends once or answers 409.
        throw new ChannelSendError(
          "unavailable",
          `line push answered ${answer.status} without readable message ids`,
        );
      }
      throw failure("push", answer, lineErrorCode(answer.status, reasonOf(answer.body)));
    },

    async reply(request) {
      const answer = await exchange({
        name: "reply",
        method: "POST",
        url: `${apiBaseUrl}/v2/bot/message/reply`,
        body: JSON.stringify(request),
      });
      if (isSuccess(answer.status)) {
        const ids = sentMessageIds(answer.body, request.messages.length);
        if (ids !== undefined) return { accepted: true, sentMessageIds: ids };
        // A reply has no retry key, and a 2xx means it went out: retrying would send it twice.
        throw new ChannelSendError(
          "unknown",
          `line reply answered ${answer.status} without readable message ids`,
        );
      }
      if (answer.status === 400) return { accepted: false };
      throw failure("reply", answer, lineErrorCode(answer.status, reasonOf(answer.body)));
    },

    // Async throughout, so an id refused before the request rejects rather than throws.
    async content(messageId, maxBytes) {
      return download("content", contentUrl(messageId), maxBytes);
    },

    async transcodingStatus(messageId) {
      const name = "content transcoding";
      const answer = await exchange({
        name,
        method: "GET",
        url: `${contentUrl(messageId)}/transcoding`,
      });
      if (!isSuccess(answer.status)) {
        throw failure(name, answer, lineContentErrorCode(answer.status, reasonOf(answer.body)));
      }
      const status = isRecord(answer.body) ? answer.body.status : undefined;
      if (!isTranscodingStatus(status)) throw unexpectedResult(name);
      return status;
    },

    async preview(messageId, maxBytes) {
      return download("content preview", `${contentUrl(messageId)}/preview`, maxBytes);
    },

    async profile(userId) {
      const name = "profile";
      const body = await read(
        name,
        `${apiBaseUrl}/v2/bot/profile/${pathId(userId, USER_ID, "user")}`,
      );
      if (body === null) return null;
      if (!isRecord(body)) throw unexpectedResult(name);
      const displayName = nonEmptyString(body.displayName);
      const language = nonEmptyString(body.language);
      return {
        ...(displayName !== undefined && { displayName }),
        ...(language !== undefined && { language }),
      };
    },

    async groupMemberProfile(groupId, userId) {
      const name = "group member profile";
      const group = pathId(groupId, GROUP_ID, "group");
      const user = pathId(userId, USER_ID, "user");
      const body = await read(name, `${apiBaseUrl}/v2/bot/group/${group}/member/${user}`);
      if (body === null) return null;
      if (!isRecord(body)) throw unexpectedResult(name);
      const displayName = nonEmptyString(body.displayName);
      return displayName === undefined ? {} : { displayName };
    },

    async leaveGroup(groupId) {
      const group = pathId(groupId, GROUP_ID, "group");
      await leave("leave group", `${apiBaseUrl}/v2/bot/group/${group}/leave`);
    },

    async leaveRoom(roomId) {
      const room = pathId(roomId, ROOM_ID, "room");
      await leave("leave room", `${apiBaseUrl}/v2/bot/room/${room}/leave`);
    },

    async quota() {
      const name = "quota";
      const body = await read(name, `${apiBaseUrl}/v2/bot/message/quota`);
      if (isRecord(body) && body.type === "none") return { type: "none" };
      if (isRecord(body) && body.type === "limited" && isCount(body.value)) {
        return { type: "limited", value: body.value };
      }
      throw unexpectedResult(name);
    },

    async quotaConsumption() {
      const name = "quota consumption";
      const body = await read(name, `${apiBaseUrl}/v2/bot/message/quota/consumption`);
      if (isRecord(body) && isCount(body.totalUsage)) return body.totalUsage;
      throw unexpectedResult(name);
    },
  };
}

/** Refused before any request, so the id never reaches a URL and never appears in the error. */
function pathId(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) {
    throw new ChannelSendError("invalid_request", `not a LINE ${what} id`);
  }
  return value;
}

/**
 * The ids of what a push or reply sent, one per object sent, or undefined when they cannot be read.
 * The reference types them as numbers while its examples and the OpenAPI file give strings; they
 * exceed 2^53, so only decimal strings are read, and a number, which would have lost digits, is not.
 */
function sentMessageIds(body: unknown, count: number): string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.sentMessages)) return undefined;
  const sent: readonly unknown[] = body.sentMessages;
  const ids = sent.flatMap((item) => {
    const id = isRecord(item) ? item.id : undefined;
    return typeof id === "string" && MESSAGE_ID.test(id) ? [id] : [];
  });
  return ids.length === sent.length && ids.length === count ? ids : undefined;
}

/** LINE's error body is `{ message, details?: [{ message, property }] }`; its message leads. */
function reasonOf(body: unknown): string {
  if (!isRecord(body) || typeof body.message !== "string") return "";
  const details: readonly unknown[] = Array.isArray(body.details) ? body.details : [];
  const properties = details.flatMap((detail) =>
    isRecord(detail) && typeof detail.property === "string" ? [detail.property] : [],
  );
  return properties.length === 0 ? body.message : `${body.message} (${properties.join(", ")})`;
}

function tooLarge(name: string, maxBytes: number): ChannelSendError {
  return new ChannelSendError(
    "invalid_request",
    `line ${name} exceeds the ${maxBytes}-byte download limit`,
  );
}

// A 2xx without the documented result is not retried: a changed API does not heal by itself.
function unexpectedResult(name: string): ChannelSendError {
  return new ChannelSendError("unknown", `line ${name} returned an unexpected result`);
}

/** `AbortSignal.timeout` rejects the fetch with a `DOMException` named `TimeoutError`. */
function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// Proxies in front of the API answer outages with HTML; such bodies fall back to the status alone.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isTranscodingStatus(value: unknown): value is LineTranscodingStatus {
  return LINE_TRANSCODING_STATUSES.some((status) => status === value);
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
