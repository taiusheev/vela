import { describe, expect, it } from "vitest";
import { probeHealthz } from "./peer-health.ts";

const URL_ = "https://vela.vela-light.workers.dev/healthz";

function answering(status: number, body: string): typeof fetch {
  return async () =>
    new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("probeHealthz", () => {
  it("is ok only for a 200 that says ok", async () => {
    expect(
      await probeHealthz(URL_, answering(200, '{"status":"ok","lastReconcileAgeSeconds":61}')),
    ).toEqual({ ok: true, seen: "ok" });
    expect(await probeHealthz(URL_, answering(200, '{"status":"fine"}'))).toEqual({
      ok: false,
      seen: "fine",
    });
  });

  it("keeps the status a failing health check names, and nothing else of its body", async () => {
    expect(
      await probeHealthz(URL_, answering(503, '{"status":"stale","lastReconcileAgeSeconds":4000}')),
    ).toEqual({ ok: false, seen: "stale" });
    expect(await probeHealthz(URL_, answering(503, '{"status":"no_reconcile_yet"}'))).toEqual({
      ok: false,
      seen: "no_reconcile_yet",
    });
    // A status that is not a short word, or a body that is not JSON, is told by the HTTP status.
    expect(
      await probeHealthz(URL_, answering(503, '{"status":"Error: something long and odd"}')),
    ).toEqual({ ok: false, seen: "http_503" });
    expect(await probeHealthz(URL_, answering(502, "<html>Bad gateway</html>"))).toEqual({
      ok: false,
      seen: "http_502",
    });
    expect(await probeHealthz(URL_, answering(500, '{"status":"ok"}'))).toEqual({
      ok: false,
      seen: "http_500",
    });
  });

  it("says no_answer when the request fails or times out, and never throws", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("network connection lost");
    };
    expect(await probeHealthz(URL_, failing)).toEqual({ ok: false, seen: "no_answer" });
  });

  it("asks for JSON, follows no redirect, and gives up after its timeout", async () => {
    let seen: RequestInit | undefined;
    await probeHealthz(URL_, async (_input, init) => {
      seen = init;
      return new Response('{"status":"ok"}');
    });
    expect(seen?.redirect).toBe("manual");
    expect(new Headers(seen?.headers).get("accept")).toBe("application/json");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});
