import { Hono } from "hono";
import { z } from "zod";
import { addressAdmitted, addressOf } from "./api-runtime.ts";
import { createLogger } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import { sameSiteOrigin } from "./site-host.ts";

const input = z
  .object({
    id: z.uuid(),
    event: z.enum([
      "site_viewed",
      "section_viewed",
      "section_active_time",
      "waitlist_opened",
      "waitlist_submitted",
      "waitlist_acknowledged",
      "waitlist_failed",
      "demo_step_viewed",
    ]),
    section: z.enum(["hero", "idea", "exchange", "care", "faq", "join"]).optional(),
    seconds: z.number().int().min(0).max(60).optional(),
    step: z.number().int().min(0).max(2).optional(),
    language: z.enum(["en", "zh-TW"]),
    source: z.enum(["direct", "instagram", "facebook", "google", "university", "other"]).optional(),
  })
  .strict();

function configured(env: PilotEnv): boolean {
  return (
    env.SITE_ANALYTICS === "on" &&
    /^phc_[A-Za-z0-9]+$/.test(env.POSTHOG_PROJECT_TOKEN ?? "") &&
    (env.POSTHOG_REGION === "eu" || env.POSTHOG_REGION === "us")
  );
}

/** Public counts only. A bounded same-origin relay never forwards IP, headers or free text. */
export function siteAnalyticsApp() {
  const app = new Hono<{ Bindings: PilotEnv }>();
  app.get("/analytics/config", (c) =>
    c.json(
      { enabled: configured(c.env), region: configured(c.env) ? c.env.POSTHOG_REGION : null },
      200,
      { "cache-control": "no-store" },
    ),
  );
  app.post("/analytics/event", async (c) => {
    if (!configured(c.env)) return c.body(null, 404);
    const origin = c.req.header("origin");
    if (!origin || !sameSiteOrigin(origin, new URL(c.req.url), c.env)) return c.body(null, 403);
    if (c.req.header("content-type") !== "application/json") return c.body(null, 415);
    // Stream bound: do not allocate an attacker-supplied unbounded request body.
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.body(null, 400);
    let raw = "";
    const decoder = new TextDecoder();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
    }, 3000);
    try {
      let bytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024) {
          void reader.cancel().catch(() => {});
          return c.body(null, 413);
        }
        raw += decoder.decode(part.value, { stream: true });
      }
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) return c.body(null, 408);
    raw += decoder.decode();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return c.body(null, 400);
    }
    const parsed = input.safeParse(value);
    if (!parsed.success) return c.body(null, 400);
    if (
      !(await addressAdmitted(
        c.env.API_IP_LIMIT,
        `analytics:${addressOf(c.req.raw)}`,
        createLogger(c.env),
      ))
    )
      return c.body(null, 429);
    const { id, event, ...properties } = parsed.data;
    try {
      const response = await fetch(`https://${c.env.POSTHOG_REGION}.i.posthog.com/i/v0/e/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: c.env.POSTHOG_PROJECT_TOKEN,
          event,
          distinct_id: id,
          properties: {
            ...properties,
            surface: "website",
            environment: c.env.ENVIRONMENT,
            $process_person_profile: false,
            $geoip_disable: true,
            $ip: null,
          },
        }),
        signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
      return c.body(null, response.ok ? 204 : 503);
    } catch {
      return c.body(null, 503);
    }
  });
  return app;
}
