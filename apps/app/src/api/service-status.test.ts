import { afterEach, describe, expect, it, vi } from "vitest";
import { readServiceStatus } from "./service-status.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("public service status", () => {
  it("checks only the public heartbeat without account or family credentials", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "ok", lastReconcileAgeSeconds: 12 }));
    vi.stubGlobal("fetch", fetch);
    await expect(readServiceStatus("https://vela.example")).resolves.toBe("responding");
    expect(fetch).toHaveBeenCalledWith("https://vela.example/healthz", {
      signal: expect.any(AbortSignal),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it.each(["stale", "no_reconcile_yet"])(
    "shows the service's reported %s failure",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ status }, { status: 503 })),
      );
      await expect(readServiceStatus("https://vela.example")).resolves.toBe("degraded");
    },
  );

  it.each([
    { status: "ok" },
    { status: "ok", lastReconcileAgeSeconds: 2_101 },
    { status: "ok", lastReconcileAgeSeconds: -1 },
    { status: "unknown" },
    null,
  ])("never treats malformed or stale success as a healthy service: %j", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    await expect(readServiceStatus("https://vela.example")).resolves.toBe("unreachable");
  });

  it("does not mistake rate limiting or an invalid response for a reported outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("limited", { status: 429 })),
    );
    await expect(readServiceStatus("https://vela.example")).resolves.toBe("unreachable");
  });

  it("bounds an unresponsive request and aborts it", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const result = readServiceStatus("https://vela.example");
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(result).resolves.toBe("unreachable");
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds an unfinished response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: () => new Promise(() => {}) })),
    );
    const result = readServiceStatus("https://vela.example");
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(result).resolves.toBe("unreachable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles cancellation even when the transport ignores abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const controller = new AbortController();
    const result = readServiceStatus("https://vela.example", controller.signal);
    controller.abort();
    await expect(result).resolves.toBe("unreachable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never calls a live system when unconfigured, already cancelled or given credentials", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(readServiceStatus(undefined)).resolves.toBe("unconfigured");
    await expect(readServiceStatus("https://vela.example", AbortSignal.abort())).resolves.toBe(
      "unreachable",
    );
    await expect(readServiceStatus("https://synthetic:fixture@vela.example")).resolves.toBe(
      "unreachable",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
