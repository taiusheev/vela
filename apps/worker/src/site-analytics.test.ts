import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilotEnv } from "./env.ts";
import { siteAnalyticsApp } from "./site-analytics.ts";
import { testEnv } from "./testing/fakes.ts";

const env = {
  ...testEnv,
  SITE_ANALYTICS: "on",
  POSTHOG_PROJECT_TOKEN: "phc_synthetic",
  POSTHOG_REGION: "eu",
};
const app = siteAnalyticsApp();
const payload = {
  id: "11111111-1111-4111-8111-111111111111",
  event: "section_viewed",
  section: "hero",
  language: "en",
};
function send(value: unknown, bindings: PilotEnv = env, origin = "http://localhost:8787") {
  return app.request(
    "http://localhost:8787/analytics/event",
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: typeof value === "string" ? value : JSON.stringify(value),
    },
    bindings,
  );
}
afterEach(() => vi.restoreAllMocks());
describe("optional website analytics", () => {
  it("is off with missing switch, key or region and never contacts PostHog", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const bindings of [
      { ...env, SITE_ANALYTICS: undefined },
      { ...env, POSTHOG_PROJECT_TOKEN: undefined },
      { ...env, POSTHOG_REGION: "https://attacker.invalid" },
    ]) {
      expect(
        (await app.request("http://localhost:8787/analytics/config", {}, bindings)).status,
      ).toBe(200);
      expect(
        await (await app.request("http://localhost:8787/analytics/config", {}, bindings)).json(),
      ).toEqual({ enabled: false, region: null });
      expect((await send(payload, bindings)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forwards only permitted counts with no visitor network details", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    expect((await send(payload)).status).toBe(204);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(options?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(options?.body))).toEqual({
      api_key: "phc_synthetic",
      distinct_id: payload.id,
      event: "section_viewed",
      properties: {
        section: "hero",
        language: "en",
        surface: "website",
        environment: "development",
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: null,
      },
    });
  });
  it.each([
    { ...payload, email: "synthetic@example.com" },
    { ...payload, section: "private family words" },
    { ...payload, event: "$snapshot" },
    { ...payload, seconds: 900000 },
    { ...payload, source: "https://private.invalid/?token=synthetic" },
    { ...payload, id: "family-id" },
    "{",
  ])("refuses unapproved data", async (value) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect((await send(value)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses foreign and missing origins", async () => {
    expect((await send(payload, env, "https://foreign.invalid")).status).toBe(403);
    expect((await send(payload, env, "")).status).toBe(403);
  });
  it("bounds payload size before parsing", async () => {
    expect((await send("x".repeat(2048))).status).toBe(413);
  });
  it("reports downstream failure without logging content or retrying", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("synthetic private transport"));
    expect((await send(payload)).status).toBe(503);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
