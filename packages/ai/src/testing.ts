/**
 * Test support: a `fetch` that records every request and answers from a script, so provider clients
 * run end to end without a network. Not exported from the package.
 */

export interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  /** The body as text, for JSON requests. */
  readonly text: string;
  /** The body as bytes, for binary uploads. */
  readonly bytes: Uint8Array;
}

/** What the fake returns for one request: a response, or an error to throw as a network failure. */
export type Reply = Response | Error;

export interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

/**
 * Answers the nth request with `replies[n]`, repeating the last reply once the script runs out, so
 * a single failing reply also covers the client's retries.
 */
export function createRecordingFetch(replies: readonly Reply[]): RecordingFetch {
  // Each scripted body is read once and served as a fresh Response per request: a client cancels
  // the bodies of responses it retries, and cancelling one branch of a cloned body never settles.
  const script = replies.map((reply) =>
    reply instanceof Error
      ? reply
      : { status: reply.status, headers: reply.headers, body: reply.arrayBuffer() },
  );
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (resource, init) => {
    const request = new Request(resource, init);
    const bytes = new Uint8Array(await request.arrayBuffer());
    requests.push({
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      text: new TextDecoder().decode(bytes),
      bytes,
    });
    const reply = script[Math.min(requests.length, script.length) - 1];
    if (reply === undefined) {
      throw new Error("the recording fetch has no scripted reply");
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return new Response(await reply.body, { status: reply.status, headers: reply.headers });
  };
  return { fetch: fetchImpl, requests };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
