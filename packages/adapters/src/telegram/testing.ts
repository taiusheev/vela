/**
 * Test helpers: fixture loading and a recording fake `fetch` that stands in for the Bot API.
 */
import { readFileSync } from "node:fs";

/** Shaped like a real token so the client accepts it, and distinctive so leaks are easy to find. */
export const TEST_BOT_TOKEN = "7412589630:AAHf3kTq-9Zx_vN2mLp8RwYc4bD6sE1uJ0o";
export const TEST_WEBHOOK_SECRET = "vela-test_secret-0123456789";

export function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export interface RecordedRequest {
  readonly url: string;
  readonly httpMethod: string;
  /** The last path segment: the Bot API method, or the file name of a download. */
  readonly apiMethod: string;
  readonly contentType: string | null;
  /** The parsed JSON body, or undefined for requests without one. */
  readonly params: unknown;
}

export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

export function createRecordingFetch(responder: Responder): RecordingFetch {
  const requests: RecordedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    const request: RecordedRequest = {
      url,
      httpMethod: init?.method ?? "GET",
      apiMethod: url.slice(url.lastIndexOf("/") + 1),
      contentType: new Headers(init?.headers).get("content-type"),
      params: typeof body === "string" ? JSON.parse(body) : undefined,
    };
    requests.push(request);
    return responder(request);
  };
  return { fetch: fakeFetch, requests };
}

export function telegramOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Replays a recorded Bot API error body with the HTTP status Telegram sends alongside it. */
export function telegramErrorFixture(name: string): Response {
  const text = readFixture(name);
  const body: unknown = JSON.parse(text);
  const status =
    typeof body === "object" &&
    body !== null &&
    "error_code" in body &&
    typeof body.error_code === "number"
      ? body.error_code
      : 500;
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

/**
 * Answers each Bot API method from `results`. Any other method gets Telegram's 404, so a call the
 * test did not expect surfaces as a failed request.
 */
export function botApi(results: Readonly<Record<string, (params: unknown) => unknown>>): Responder {
  return (request) => {
    const result = results[request.apiMethod];
    if (result === undefined) {
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 404,
          description: `Not Found: ${request.apiMethod}`,
        }),
        { status: 404 },
      );
    }
    return telegramOk(result(request.params));
  };
}

/** A responder for sends: each call returns the next message id, starting at `firstId`. */
export function sequentialSends(firstId: number): Responder {
  let next = firstId;
  const message = (): { message_id: number } => {
    const sent = { message_id: next };
    next += 1;
    return sent;
  };
  return botApi({
    sendMessage: message,
    sendPhoto: message,
    sendVoice: message,
    sendMediaGroup: (params) => {
      const media =
        typeof params === "object" &&
        params !== null &&
        "media" in params &&
        Array.isArray(params.media)
          ? params.media
          : [];
      return media.map(() => message());
    },
  });
}
