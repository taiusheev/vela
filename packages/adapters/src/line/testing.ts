/**
 * Test helpers: fixture loading, webhook signing, and a recording fake `fetch` that stands in for
 * the Messaging API, so no test needs a LINE account. Signatures are made with Node's own HMAC,
 * apart from the Web Crypto code under test.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WebhookInput } from "@vela/contracts";
import { LINE_SIGNATURE_HEADER } from "./verify.ts";

/** Shaped like a channel secret (32 hex digits), and distinctive so a leak is easy to find. */
export const TEST_CHANNEL_SECRET = "2e4e6837a5d6004eab062f322de9c3e5";
/** Shaped like a long-lived channel access token, and distinctive so a leak is easy to find. */
export const TEST_CHANNEL_ACCESS_TOKEN =
  "vElA+tEsT/9kQ2rXmF8pWcN4yJ6aE1uH7oZtBqRgVxYsLp3dS0bT5nM8wK2jH6gF4cD1eA7zY9xW3vU5tR0qP2oN4mL6kJ8iH0gF2eD4cB6aZ8yX0wV2uT4sR6qP8oN0mL2kJ4iH6gF8eD0cB2aZ4y=";

export function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

/** What LINE puts in `x-line-signature` for `rawBody`: Base64(HMAC-SHA256(secret, body)). */
export function signWebhook(rawBody: string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
}

/** A webhook as the route hands it to the adapter, signed as LINE signs it. */
export function signedWebhook(
  rawBody: string,
  channelSecret: string = TEST_CHANNEL_SECRET,
): WebhookInput {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    [LINE_SIGNATURE_HEADER]: signWebhook(rawBody, channelSecret),
  });
  return { headers, rawBody };
}

/**
 * One request as the client made it. The full path, the headers and the body exactly as sent are
 * kept, so a test can show two sends byte for byte the same, read the retry key and the token, and
 * tell apart paths whose last segment is an id.
 */
export interface RecordedRequest {
  readonly method: string;
  readonly host: string;
  readonly pathname: string;
  readonly headers: Headers;
  /** The body exactly as sent, or undefined for a request without one. */
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

/** `METHOD /path`, as `lineApi` routes are keyed. */
export function routeOf(request: RecordedRequest): string {
  return `${request.method} ${request.pathname}`;
}

/** Replays an `api-*.json` fixture: a response LINE documents, as `{ status, headers?, body? }`. */
export function lineApiFixture(name: string): Response {
  const recorded: unknown = JSON.parse(readFixture(name));
  if (!isRecord(recorded) || typeof recorded.status !== "number") {
    throw new Error(`${name} must hold a status`);
  }
  const headers = new Headers(isRecord(recorded.headers) ? stringFields(recorded.headers) : {});
  if (!("body" in recorded)) return new Response(null, { status: recorded.status, headers });
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(recorded.body), { status: recorded.status, headers });
}

/**
 * Answers each `METHOD /path` from `routes`. Any other request gets LINE's 404, so a call the test
 * did not expect surfaces as a failure.
 */
export function lineApi(routes: Readonly<Record<string, () => Response>>): Responder {
  return (request) => {
    const route = routes[routeOf(request)];
    return route === undefined ? lineApiFixture("api-error-404.json") : route();
  };
}

/**
 * A responder for sends: each push or reply answers with one id per object it carried, counting up
 * from `firstId`, as LINE numbers them in the order sent.
 */
export function sequentialSends(firstId: bigint): Responder {
  let next = firstId;
  return (request) => {
    if (request.method !== "POST" || !/^\/v2\/bot\/message\/(push|reply)$/.test(request.pathname)) {
      return lineApiFixture("api-error-404.json");
    }
    const sent: unknown = JSON.parse(request.body ?? "{}");
    const count = isRecord(sent) && Array.isArray(sent.messages) ? sent.messages.length : 0;
    const sentMessages = Array.from({ length: count }, () => {
      const id = String(next);
      next += 1n;
      return { id, quoteToken: `quote-${id}` };
    });
    return Response.json({ sentMessages });
  };
}

/** The ids `sequentialSends(firstId)` gives its first `count` objects. */
export function sequentialIds(firstId: bigint, count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(firstId + BigInt(index)));
}

/** The JSON body a request carried. */
export function bodyOf(request: RecordedRequest | undefined): unknown {
  return request?.body === undefined ? undefined : JSON.parse(request.body);
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
