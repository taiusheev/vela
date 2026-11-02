import { afterEach, describe, expect, it, vi } from "vitest";

const id = "11111111-1111-4111-8111-111111111111";
async function client() {
  vi.resetModules();
  vi.stubEnv("EXPO_PUBLIC_POSTHOG_TOKEN", "phc_synthetic");
  vi.stubEnv("EXPO_PUBLIC_POSTHOG_REGION", "eu");
  vi.stubEnv("EXPO_PUBLIC_ANALYTICS_ENVIRONMENT", "staging");
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://synthetic.invalid");
  vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "false");
  return import("./client.ts");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("optional analytics transport", () => {
  it("makes no request before permission", async () => {
    const api = await client();
    const fetch = vi.spyOn(globalThis, "fetch");
    api.captureUsage("screen_viewed", "today");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends only allowlisted metadata after opt-in", async () => {
    const api = await client();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    api.setAnalyticsIdentity(id);
    api.captureUsage("screen_viewed", "today");
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      distinct_id: id,
      properties: { screen: "today", environment: "staging", $ip: null },
    });
    api.setAnalyticsIdentity(null);
  });
  it("aborts pending transport on withdrawal and blocks further counts", async () => {
    const api = await client();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      expect(options?.signal?.aborted).toBe(false);
      return new Promise<Response>((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(new Error("stopped"))),
      );
    });
    api.setAnalyticsIdentity(id);
    api.captureUsage("screen_viewed", "today");
    const [, options] = fetch.mock.calls[0] ?? [];
    api.setAnalyticsIdentity(null);
    expect(options?.signal?.aborted).toBe(true);
    api.captureUsage("screen_viewed", "today");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not send a stale screen duration under another account", async () => {
    const api = await client();
    const fetch = vi.spyOn(globalThis, "fetch");
    api.setAnalyticsIdentity("22222222-2222-4222-8222-222222222222");
    api.captureUsage("screen_active_time", "today", 30, id);
    expect(fetch).not.toHaveBeenCalled();
    api.setAnalyticsIdentity(null);
  });
  it("keeps demo and absent config off even after a local choice", async () => {
    await client();
    vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "true");
    vi.resetModules();
    let api = await import("./client.ts");
    expect(api.analyticsConfigured).toBe(false);
    vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "false");
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_TOKEN", "");
    vi.resetModules();
    api = await import("./client.ts");
    expect(api.analyticsConfigured).toBe(false);
  });
});
