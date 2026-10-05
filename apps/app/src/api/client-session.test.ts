import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.example");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("API request cancellation", () => {
  it("refuses an old family's response while its body is still being read", async () => {
    const { sessionRequests } = await import("./request-session.ts");
    const { fetchMe } = await import("./client.ts");
    sessionRequests.activate("first:session");
    let finish: (value: unknown) => void = () => {};
    const body = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const json = vi.fn(() => body);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json })),
    );
    const read = fetchMe("synthetic-session");
    const refused = expect(read).rejects.toMatchObject({ reason: "session" });
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    sessionRequests.activate("second:session");
    finish({ memberships: [{ family: { name: "Previous family" } }] });
    await refused;
  });

  it("bounds an uncertain write and preserves the caller's identifier for its retry", async () => {
    const { replyTo } = await import("./client.ts");
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => new Promise<never>(() => {}))
      .mockResolvedValueOnce(Response.json({ id: "synthetic-reply" }));
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers();
    const reply = { text: "Synthetic reply" };
    const write = replyTo("exchange", "same-uncertain-write", reply, "synthetic-session");
    const refused = expect(write).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await refused;
    await expect(
      replyTo("exchange", "same-uncertain-write", reply, "synthetic-session"),
    ).resolves.toEqual({ id: "synthetic-reply" });
    expect(fetch.mock.calls.map(([, options]) => options.headers["idempotency-key"])).toEqual([
      "same-uncertain-write",
      "same-uncertain-write",
    ]);
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
