/**
 * Technical plan 2.3: this Worker's 15-minute run reads the other environment's `/healthz`, which
 * answers `{"status":"ok"}` only while that environment's last reconcile is at most 35 minutes old
 * (`heartbeat.ts`). Only a short word of the answer is kept — `ok`, the status it names,
 * `http_<code>`, or `no_answer` — so nothing else it sends reaches a log or the admin chat.
 */
import type { PeerAnswer } from "@vela/services";

/** How long one check waits for the whole answer before it counts as no answer. */
export const PEER_PROBE_TIMEOUT_MS = 10_000;

const STATUS_WORD = /^[a-z_]{1,32}$/;

export async function probeHealthz(
  url: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<PeerAnswer> {
  let response: Response;
  let status: unknown = null;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(PEER_PROBE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, seen: "no_answer" };
  }
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "status" in body) status = body.status;
  } catch {
    // A body that is not JSON, or that did not arrive in time, is told by its HTTP status.
  }
  if (response.status === 200 && status === "ok") return { ok: true, seen: "ok" };
  if (typeof status === "string" && status !== "ok" && STATUS_WORD.test(status)) {
    return { ok: false, seen: status };
  }
  return { ok: false, seen: `http_${response.status}` };
}
