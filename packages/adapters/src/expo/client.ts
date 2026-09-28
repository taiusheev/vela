/**
 * A small typed client for Expo's push service (ADR-34): send notifications to the app's
 * installations, and read what Apple and Google made of them. Expo stands in front of both, so one
 * token and one request reach an iPhone or an Android phone alike.
 *
 * Built against Expo's guide "Send notifications with Expo's push service" as read for the design
 * in September 2026: `POST /--/api/v2/push/send` takes up to 100 messages and answers one ticket
 * per message, in order; `POST /--/api/v2/push/getReceipts` takes up to 1,000 ticket ids and
 * answers the receipts that are ready, keyed by id, leaving out the ones that are not. Expo keeps
 * receipts for 24 hours. With Enhanced Push Security on, every request carries Vela's access token.
 *
 * Expo has no idempotency, so nothing Expo may have accepted is ever sent again by this client: a
 * 2xx it cannot read fails without a retry, and once one request of a send has been accepted, the
 * messages of a later request that fails come back as error tickets instead of an error, so the
 * caller keeps the tickets it has.
 *
 * Every failure is described by an `ExpoPushFailure`: the contract's `ChannelSendErrorCode`, which
 * the gateway already acts on, whether Vela's own push credentials were refused (`misconfigured`,
 * which is for the founder, not for a retry), Expo's own name for it, and a message. What a
 * failure means is read from Expo's `details.error` or `errors[].code`, never from its message. A
 * push token names one phone and the access token is Vela's credential, so both, and the text of
 * what was sent, are redacted from every message this client makes, whatever Expo or the runtime
 * said, and no error carries a cause.
 */
import { ChannelSendError, type ChannelSendErrorCode } from "@vela/contracts";

export const EXPO_PUSH_API_BASE_URL = "https://exp.host";
export const EXPO_PUSH_SEND_PATH = "/--/api/v2/push/send";
export const EXPO_PUSH_RECEIPTS_PATH = "/--/api/v2/push/getReceipts";
/** The most messages one send request may carry. */
export const EXPO_PUSH_SEND_LIMIT = 100;
/** The most ticket ids one receipts request may carry. */
export const EXPO_PUSH_RECEIPTS_LIMIT = 1_000;

/** A request that has not answered in 10 s is counted as failed. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Enough of Expo's own words to diagnose a refusal, and no more. */
const MAX_REASON_LENGTH = 300;
/** Visible ASCII: the access token goes into a header, where a space or a line break breaks it. */
const ACCESS_TOKEN_PATTERN = /^[\x21-\x7e]+$/;
/** A push token as the app registers it (the contract's `ExpoPushToken`). */
const PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[^\]\s]{1,200}\]$/;
/** Anything shaped like a push token in text Expo or the runtime wrote, closed or cut short. */
const ANY_PUSH_TOKEN = /Expo(?:nent)?PushToken\[[^\]\s"']*\]?/g;

/**
 * The names Expo gives a failed ticket or receipt in `details.error`. `DeveloperError`, `ExpoError`
 * and `ProviderError` are the server SDK's; the rest are in the guide.
 */
export const EXPO_PUSH_ERROR_NAMES = [
  "DeviceNotRegistered",
  "MessageTooBig",
  "MessageRateExceeded",
  "MismatchSenderId",
  "InvalidCredentials",
  "DeveloperError",
  "ExpoError",
  "ProviderError",
] as const;
export type ExpoPushErrorName = (typeof EXPO_PUSH_ERROR_NAMES)[number];

/** The codes Expo gives a whole request's failure in `errors[].code` that this client reads. */
export const EXPO_PUSH_REQUEST_ERROR_CODES = [
  "TOO_MANY_REQUESTS",
  "UNAUTHORIZED",
  "PUSH_TOO_MANY_EXPERIENCE_IDS",
  "PUSH_TOO_MANY_NOTIFICATIONS",
  "PUSH_TOO_MANY_RECEIPTS",
  "VALIDATION_ERROR",
  "INTERNAL_SERVER_ERROR",
] as const;

export interface ExpoPushApiOptions {
  /**
   * The access token Enhanced Push Security asks for, sent as a bearer token on every request.
   * Optional here; the Worker refuses to send without one (`PUSH_SEND`, ADR-34).
   */
  readonly accessToken?: string;
  readonly fetch?: typeof fetch;
  /** Defaults to https://exp.host; a test double otherwise. */
  readonly apiBaseUrl?: string;
  /** Defaults to 10 s per request. */
  readonly timeoutMs?: number;
}

/**
 * One notification to one installation. Only the fields Vela uses: never a title (the app's name
 * shows), never a badge (no counts anywhere), never anything but ids in `data`.
 */
export interface ExpoPushMessage {
  /** One `ExponentPushToken[…]`: one ticket per message keeps tickets and devices one to one. */
  readonly to: string;
  readonly body: string;
  /** Ids only (the contract's `PushData`). */
  readonly data?: Readonly<Record<string, string>>;
  /** Android's notification channel, which decides sound and importance there. */
  readonly channelId?: string;
  readonly priority?: "default" | "normal" | "high";
  /** iOS. `time-sensitive` needs the app's entitlement; `critical` is never used. */
  readonly interruptionLevel?: "active" | "passive" | "time-sensitive";
  /** iOS; Android's sound belongs to the channel. */
  readonly sound?: "default" | null;
  /** Seconds Apple or Google keep trying to deliver it. */
  readonly ttl?: number;
}

/** Why Expo, Apple or Google did not take a message, or a whole request failed. */
export interface ExpoPushFailure {
  /** What the gateway does with it: `blocked` is a device that is gone, retryable codes retry. */
  readonly code: ChannelSendErrorCode;
  /**
   * Vela's own push credentials were refused (InvalidCredentials, MismatchSenderId, UNAUTHORIZED,
   * or a 401 or 403): no retry mends it, and the founder is to be told.
   */
  readonly misconfigured: boolean;
  /**
   * Expo's name for it (`details.error`, `errors[].code`), else `http_<status>`, `network`,
   * `timeout` or `unexpected_result`: a label, safe to log.
   */
  readonly reason: string;
  /** For `outbound.error`: bounded, and never a token, the access token, or what was sent. */
  readonly message: string;
}

/** What Expo answered for one message: accepted with a ticket id to read its receipt by, or not. */
export type ExpoPushTicket =
  | { readonly status: "ok"; readonly id: string }
  | { readonly status: "error"; readonly failure: ExpoPushFailure };

/** What Apple or Google made of an accepted message. */
export type ExpoPushReceipt =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly failure: ExpoPushFailure };

/** A request that failed as a whole, before Expo accepted anything of it. */
export class ExpoPushRequestError extends ChannelSendError {
  readonly failure: ExpoPushFailure;

  constructor(failure: ExpoPushFailure, options: { retryAfterSeconds?: number } = {}) {
    super(failure.code, failure.message, options);
    this.failure = failure;
  }
}

export interface ExpoPushClient {
  /**
   * One ticket per message, in the order given, sent in requests of at most 100. Throws an
   * `ExpoPushRequestError` only when nothing was accepted: when the first request fails, or a
   * message is not addressed to a push token (then nothing is sent at all).
   */
  send(messages: readonly ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  /**
   * The receipts that are ready, by ticket id, asked for in requests of at most 1,000. An id left
   * out is not ready yet, or is older than Expo keeps. Throws an `ExpoPushRequestError` when a
   * request fails; asking again is safe.
   */
  getReceipts(ids: readonly string[]): Promise<Record<string, ExpoPushReceipt>>;
}

interface Mapped {
  readonly code: ChannelSendErrorCode;
  readonly misconfigured: boolean;
}

const fails = (code: ChannelSendErrorCode, misconfigured = false): Mapped => ({
  code,
  misconfigured,
});

/** How a ticket's or a receipt's `details.error` maps (ADR-34). */
export function expoPushErrorCode(name: string | undefined): Mapped {
  switch (name) {
    case "DeviceNotRegistered":
      return fails("blocked");
    case "MessageRateExceeded":
      return fails("rate_limited");
    case "MessageTooBig":
    case "DeveloperError":
      return fails("invalid_request");
    case "InvalidCredentials":
    case "MismatchSenderId":
      return fails("unknown", true);
    // Expo's own failure, or Apple's or Google's for the moment: another try may go through.
    case "ExpoError":
    case "ProviderError":
      return fails("unavailable");
    default:
      return fails("unknown");
  }
}

/**
 * How a whole request's failure maps: Expo's `errors[].code` when it is one this client knows, the
 * HTTP status otherwise. `PUSH_TOO_MANY_EXPERIENCE_IDS` cannot be mended by a retry, and is ruled
 * out by building every environment from one EAS project (ADR-34).
 */
export function expoRequestErrorCode(status: number, code: string | undefined): Mapped {
  switch (code) {
    case "TOO_MANY_REQUESTS":
      return fails("rate_limited");
    case "UNAUTHORIZED":
      return fails("unknown", true);
    case "PUSH_TOO_MANY_EXPERIENCE_IDS":
    case "PUSH_TOO_MANY_NOTIFICATIONS":
    case "PUSH_TOO_MANY_RECEIPTS":
    case "VALIDATION_ERROR":
      return fails("invalid_request");
    case "INTERNAL_SERVER_ERROR":
      return fails("unavailable");
  }
  if (status === 429) return fails("rate_limited");
  if (status === 401 || status === 403) return fails("unknown", true);
  if (status >= 500) return fails("unavailable");
  if (status >= 400) return fails("invalid_request");
  return fails("unknown");
}

interface Answer {
  readonly status: number;
  /** The parsed JSON body, or undefined when it is not JSON. */
  readonly body: unknown;
  readonly retryAfterSeconds: number | undefined;
}

export function createExpoPushClient(options: ExpoPushApiOptions = {}): ExpoPushClient {
  const accessToken = options.accessToken;
  if (accessToken !== undefined && !ACCESS_TOKEN_PATTERN.test(accessToken)) {
    throw new Error("Expo access token must be visible ASCII without spaces");
  }
  const apiBaseUrl = (options.apiBaseUrl ?? EXPO_PUSH_API_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Invoked unbound: Workers reject the platform fetch when it is called as a method of an object.
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  /**
   * Takes out of `text` the access token, the push tokens and the words of what is being sent, and
   * anything else shaped like a push token, then bounds it. Longer values go first, so one that
   * holds another is taken out whole.
   */
  const redactorFor = (messages: readonly ExpoPushMessage[]) => {
    const secrets: [string, string][] = [
      ...(accessToken === undefined ? [] : [[accessToken, "[access token]"] as [string, string]]),
      ...messages.flatMap((message): [string, string][] => [
        [message.to, "[push token]"],
        [message.body, "[text]"],
      ]),
    ];
    const literals = secrets
      .filter(([value]) => value.length >= 3)
      .sort(([a], [b]) => b.length - a.length);
    return (text: string): string => {
      let redacted = text;
      for (const [literal, mark] of literals) redacted = redacted.replaceAll(literal, mark);
      return redacted.replace(ANY_PUSH_TOKEN, "[push token]").slice(0, MAX_REASON_LENGTH);
    };
  };

  const failure = (
    call: string,
    mapped: Mapped,
    reason: string,
    detail: string,
    redact: (text: string) => string,
  ): ExpoPushFailure => ({
    ...mapped,
    reason,
    message: redact(`expo ${call}: ${reason}${detail === "" ? "" : ` ${detail}`}`),
  });

  async function exchange(
    call: string,
    path: string,
    body: unknown,
    redact: (text: string) => string,
  ): Promise<Answer> {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    if (accessToken !== undefined) headers.set("authorization", `Bearer ${accessToken}`);
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${apiBaseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      const timedOut = isTimeout(error);
      throw new ExpoPushRequestError(
        failure(
          call,
          fails("unavailable"),
          timedOut ? "timeout" : "network",
          timedOut ? `no answer within ${timeoutMs / 1000} s` : `(${describe(error)})`,
          redact,
        ),
      );
    }
    return {
      status: response.status,
      body: parseJson(text),
      retryAfterSeconds: retryAfterOf(response.headers.get("retry-after")),
    };
  }

  /** The request's failure when Expo named one or the status is not a success, else null. */
  function requestFailure(
    call: string,
    answer: Answer,
    redact: (text: string) => string,
  ): ExpoPushRequestError | null {
    const first = firstRequestError(answer.body);
    if (first === null && isSuccess(answer.status)) return null;
    const reason = labelOf(first?.code) ?? `http_${answer.status}`;
    const mapped = expoRequestErrorCode(answer.status, first?.code);
    return new ExpoPushRequestError(
      failure(
        call,
        mapped,
        reason,
        `(${answer.status})${first?.message ? ` ${first.message}` : ""}`,
        redact,
      ),
      answer.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: answer.retryAfterSeconds },
    );
  }

  function unexpected(call: string, redact: (text: string) => string): ExpoPushRequestError {
    // A 2xx without the documented result is not retried: Expo may have sent it, and has no
    // idempotency, and a changed API does not heal by itself.
    return new ExpoPushRequestError(
      failure(call, fails("unknown"), "unexpected_result", "", redact),
    );
  }

  return {
    async send(messages) {
      for (const message of messages) {
        if (!PUSH_TOKEN.test(message.to)) {
          throw new ExpoPushRequestError({
            code: "invalid_request",
            misconfigured: false,
            reason: "not_a_push_token",
            message: "expo push send: a message is not addressed to an Expo push token",
          });
        }
      }
      const redact = redactorFor(messages);
      const tickets: ExpoPushTicket[] = [];
      for (let start = 0; start < messages.length; start += EXPO_PUSH_SEND_LIMIT) {
        const chunk = messages.slice(start, start + EXPO_PUSH_SEND_LIMIT);
        let chunkTickets: ExpoPushTicket[];
        try {
          const answer = await exchange("push send", EXPO_PUSH_SEND_PATH, chunk, redact);
          const refused = requestFailure("push send", answer, redact);
          if (refused !== null) throw refused;
          const read = ticketsOf(answer.body, chunk.length, redact);
          if (read === undefined) throw unexpected("push send", redact);
          chunkTickets = read;
        } catch (error) {
          // Nothing accepted yet: the caller may send again. Otherwise what was accepted stands,
          // and the messages not sent are failed tickets carrying why.
          if (start === 0) throw error;
          const why =
            error instanceof ExpoPushRequestError
              ? error.failure
              : failure("push send", fails("unknown"), "unexpected_error", "", redact);
          for (let index = start; index < messages.length; index += 1) {
            tickets.push({ status: "error", failure: why });
          }
          return tickets;
        }
        tickets.push(...chunkTickets);
      }
      return tickets;
    },

    async getReceipts(ids) {
      const redact = redactorFor([]);
      const receipts: Record<string, ExpoPushReceipt> = {};
      for (let start = 0; start < ids.length; start += EXPO_PUSH_RECEIPTS_LIMIT) {
        const chunk = ids.slice(start, start + EXPO_PUSH_RECEIPTS_LIMIT);
        const answer = await exchange(
          "push receipts",
          EXPO_PUSH_RECEIPTS_PATH,
          { ids: chunk },
          redact,
        );
        const refused = requestFailure("push receipts", answer, redact);
        if (refused !== null) throw refused;
        const read = receiptsOf(answer.body, chunk, redact);
        if (read === undefined) throw unexpected("push receipts", redact);
        Object.assign(receipts, read);
      }
      return receipts;
    },
  };
}

/** One ticket per message, or undefined when Expo's answer is not that. */
function ticketsOf(
  body: unknown,
  count: number,
  redact: (text: string) => string,
): ExpoPushTicket[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) return undefined;
  const data: readonly unknown[] = body.data;
  if (data.length !== count) return undefined;
  const tickets: ExpoPushTicket[] = [];
  for (const item of data) {
    const outcome = outcomeOf(item, "push ticket", redact);
    if (outcome === undefined) return undefined;
    if (outcome.status === "ok") {
      if (!isRecord(item) || typeof item.id !== "string" || item.id === "") return undefined;
      tickets.push({ status: "ok", id: item.id });
    } else {
      tickets.push(outcome);
    }
  }
  return tickets;
}

/** The receipts Expo has for the ids asked for; anything else in its answer is ignored. */
function receiptsOf(
  body: unknown,
  ids: readonly string[],
  redact: (text: string) => string,
): Record<string, ExpoPushReceipt> | undefined {
  if (!isRecord(body) || !isRecord(body.data)) return undefined;
  const data = body.data;
  const receipts: Record<string, ExpoPushReceipt> = {};
  for (const id of ids) {
    if (!Object.hasOwn(data, id)) continue;
    const outcome = outcomeOf(data[id], "push receipt", redact);
    if (outcome === undefined) return undefined;
    receipts[id] = outcome;
  }
  return receipts;
}

/** A ticket's or a receipt's status, and its failure read from `details.error`. */
function outcomeOf(
  item: unknown,
  what: string,
  redact: (text: string) => string,
):
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly failure: ExpoPushFailure }
  | undefined {
  if (!isRecord(item)) return undefined;
  if (item.status === "ok") return { status: "ok" };
  if (item.status !== "error") return undefined;
  const name =
    isRecord(item.details) && typeof item.details.error === "string" && item.details.error !== ""
      ? item.details.error
      : undefined;
  const reason = labelOf(name) ?? (name === undefined ? "unnamed_error" : "unrecognised_error");
  const said = typeof item.message === "string" ? ` ${item.message}` : "";
  return {
    status: "error",
    failure: {
      ...expoPushErrorCode(name),
      reason,
      message: redact(`expo ${what}: ${reason}${said}`),
    },
  };
}

/** The first of a request's `errors`, or null when it names none. */
function firstRequestError(body: unknown): { code?: string; message?: string } | null {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) return null;
  const first: unknown = body.errors[0];
  if (!isRecord(first)) return {};
  return {
    ...(typeof first.code === "string" && first.code !== "" ? { code: first.code } : {}),
    ...(typeof first.message === "string" ? { message: first.message } : {}),
  };
}

/** Expo's name for a failure as a log may carry it: a short identifier, or nothing. */
function labelOf(name: string | undefined): string | undefined {
  return name !== undefined && /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : undefined;
}

/** `Retry-After` in whole seconds; an HTTP date or anything else is ignored. */
function retryAfterOf(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return undefined;
  return Number(value.trim());
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

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
