/**
 * Test helpers for the Expo push client: fixture loading, a recording fake `fetch`, and a fake
 * Expo push service, so no test needs an Expo account or reaches exp.host.
 *
 * Push tokens and the access token are made at run time and never written whole: a literal shaped
 * like either would look like a credential to secret scanning. Fixtures name them by placeholder
 * (`{{token:1}}`, `{{ticket:1}}`, `{{access_token}}`), which `expoApiFixture` fills in.
 */
import { readFileSync } from "node:fs";
import { EXPO_PUSH_RECEIPTS_PATH, EXPO_PUSH_SEND_PATH } from "./client.ts";

/** A push token for `label`, shaped as the app gets one, and distinctive so a leak shows. */
export function expoPushToken(label: string): string {
  return `${["Exponent", "Push", "Token"].join("")}[vela-test-${label}]`;
}

/** Shaped like an access token, and distinctive so a leak is easy to find. */
export const TEST_EXPO_ACCESS_TOKEN = ["vela", "expo", "test", "AccessTokenNeverLogged42"].join(
  "_",
);

export function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export interface FixtureValues {
  /** `{{token:1}}` is `tokens[0]`. */
  readonly tokens?: readonly string[];
  /** `{{ticket:1}}` is `tickets[0]`. */
  readonly tickets?: readonly string[];
  readonly accessToken?: string;
}

/** A fixture's JSON with its placeholders filled in. */
export function filledFixture(name: string, values: FixtureValues = {}): unknown {
  const pick = (list: readonly string[] | undefined, index: string, what: string): string => {
    const value = list?.[Number(index) - 1];
    if (value === undefined) throw new Error(`${name} needs ${what} ${index}`);
    return value;
  };
  const text = readFixture(name)
    .replace(/\{\{token:(\d+)\}\}/g, (_, index: string) => pick(values.tokens, index, "token"))
    .replace(/\{\{ticket:(\d+)\}\}/g, (_, index: string) => pick(values.tickets, index, "ticket"))
    .replace(/\{\{access_token\}\}/g, () => {
      if (values.accessToken === undefined) throw new Error(`${name} needs the access token`);
      return values.accessToken;
    });
  return JSON.parse(text);
}

/**
 * Replays a fixture: a response Expo documents, as `{ status, headers?, body? , text? }`, where
 * `body` is JSON and `text` is anything else (a proxy's HTML page).
 */
export function expoApiFixture(name: string, values: FixtureValues = {}): Response {
  const recorded = filledFixture(name, values);
  if (!isRecord(recorded) || typeof recorded.status !== "number") {
    throw new Error(`${name} must hold a status`);
  }
  const headers = new Headers(isRecord(recorded.headers) ? stringFields(recorded.headers) : {});
  if (typeof recorded.text === "string") {
    return new Response(recorded.text, { status: recorded.status, headers });
  }
  if (!("body" in recorded)) return new Response(null, { status: recorded.status, headers });
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(recorded.body), { status: recorded.status, headers });
}

/** One request as the client made it. */
export interface RecordedRequest {
  readonly method: string;
  readonly host: string;
  readonly pathname: string;
  readonly headers: Headers;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

export function createRecordingFetch(responder: Responder): RecordingFetch {
  const requests: RecordedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const body = init?.body;
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      host: url.host,
      pathname: url.pathname,
      headers: new Headers(init?.headers),
      body: typeof body === "string" ? body : undefined,
      signal: init?.signal ?? undefined,
    };
    requests.push(request);
    return responder(request);
  };
  return { fetch: fakeFetch, requests };
}

/** The JSON body a request carried. */
export function bodyOf(request: RecordedRequest | undefined): unknown {
  return request?.body === undefined ? undefined : JSON.parse(request.body);
}

/** A ticket id as Expo writes one, numbered so a test knows it before it is issued. */
export function ticketId(serial: number): string {
  return `0198f6aa-7e57-7000-8000-${String(serial).padStart(12, "0")}`;
}

/** What the fake Expo service is told to answer for a receipt. */
export type FakeReceipt =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly error: string; readonly message?: string };

export interface FakeExpoPushService {
  readonly responder: Responder;
  /** Every message it accepted, in order. */
  readonly accepted: unknown[];
  /** From now on a message to `token` gets a DeviceNotRegistered ticket. */
  unregister(token: string): void;
  /** The receipt it answers for a ticket; unset tickets are not ready. */
  receipt(id: string, receipt: FakeReceipt): void;
}

/**
 * Expo's push service in miniature: a send answers one ticket per message, numbered from 1, or
 * DeviceNotRegistered for a token it was told is gone; a receipts request answers what it was told.
 * Anything else answers 404, so a request the test did not expect surfaces as a failure.
 */
export function fakeExpoPushService(): FakeExpoPushService {
  let serial = 0;
  const gone = new Set<string>();
  const receipts = new Map<string, FakeReceipt>();
  const accepted: unknown[] = [];
  const responder: Responder = (request) => {
    if (request.method === "POST" && request.pathname === EXPO_PUSH_SEND_PATH) {
      const messages: unknown = bodyOf(request);
      if (!Array.isArray(messages)) return Response.json({ errors: [] }, { status: 400 });
      const data = messages.map((message: unknown) => {
        const to = isRecord(message) && typeof message.to === "string" ? message.to : "";
        if (gone.has(to)) {
          return {
            status: "error",
            message: `"${to}" is not a registered push notification recipient`,
            details: { error: "DeviceNotRegistered", expoPushToken: to },
          };
        }
        serial += 1;
        accepted.push(message);
        return { status: "ok", id: ticketId(serial) };
      });
      return Response.json({ data });
    }
    if (request.method === "POST" && request.pathname === EXPO_PUSH_RECEIPTS_PATH) {
      const asked: unknown = bodyOf(request);
      const ids = isRecord(asked) && Array.isArray(asked.ids) ? asked.ids : [];
      const data: Record<string, unknown> = {};
      for (const id of ids) {
        const receipt = typeof id === "string" ? receipts.get(id) : undefined;
        if (typeof id !== "string" || receipt === undefined) continue;
        data[id] =
          receipt.status === "ok"
            ? { status: "ok" }
            : {
                status: "error",
                message: receipt.message ?? receipt.error,
                details: { error: receipt.error },
              };
      }
      return Response.json({ data });
    }
    return Response.json(
      { errors: [{ code: "NOT_FOUND", message: "Not found" }] },
      { status: 404 },
    );
  };
  return {
    responder,
    accepted,
    unregister: (token) => {
      gone.add(token);
    },
    receipt: (id, receipt) => {
      receipts.set(id, receipt);
    },
  };
}

function stringFields(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
