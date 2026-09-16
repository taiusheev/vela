/**
 * Every HTTP route the pilot Worker serves (code design §9, H1): the health check, the Telegram
 * webhook, and the privacy notices. The admin pages are another Worker's (`admin-app.ts`), so
 * anything under `/admin` here is 404.
 *
 * Nothing here decides anything about a family: a route verifies the request, builds deps, calls
 * services, and renders what came back. Services' entry points arrive through `PilotRuntime`, so a
 * test hands the routes fakes.
 */
import { Hono } from "hono";
import { readEnvironment, refuseUnfilledNotices } from "./config.ts";
import type { PilotEnv } from "./env.ts";
import { noticePage } from "./html.ts";
import { NOTICE_LANGS, NOTICE_PATHS } from "./notices.ts";
import { requestFailed } from "./request-errors.ts";
import type { PilotRuntime } from "./runtime.ts";

interface PilotAppEnv {
  Bindings: PilotEnv;
}

export function createApp(runtime: PilotRuntime): Hono<PilotAppEnv> {
  const app = new Hono<PilotAppEnv>();

  app.get("/healthz", (c) => c.text("ok"));

  /**
   * Telegram's webhook. The secret is checked before anything else is built, so an unsigned
   * request costs one comparison. An unexpected failure answers 500 and Telegram redelivers; every
   * handler behind `handleInbound` is idempotent, so a redelivery changes nothing twice.
   */
  app.post("/webhooks/telegram", async (c) => {
    const rawBody = await c.req.text();
    const channels = runtime.createChannels(c.env);
    const adapter = channels.get("telegram");
    const input = { headers: c.req.raw.headers, rawBody };
    if (!(await adapter.verify(input))) {
      return c.text("unauthorized", 401);
    }
    const events = adapter.parse(input);
    if (events.length === 0) {
      return c.text("ok");
    }
    const handle = await runtime.createDeps(c.env, { channels });
    try {
      await runtime.services.handleInbound(handle.deps, events);
    } finally {
      c.executionCtx.waitUntil(handle.close());
    }
    return c.text("ok");
  });

  /**
   * The privacy notice in each language, the pages `PRIVACY_NOTICE_URL_EN` and `_ZH_TW` link.
   * Outside development a notice with a blank left in either language is refused as the deps are,
   * with a 500 logged as `ConfigError:<notice file>`, so no family reads an unfilled notice.
   */
  for (const lang of NOTICE_LANGS) {
    app.get(NOTICE_PATHS[lang], (c) => {
      refuseUnfilledNotices(readEnvironment(c.env), runtime.notices);
      return noticePage(lang, runtime.notices[lang]);
    });
  }

  app.notFound((c) => c.text("not found", 404));
  app.onError(requestFailed);

  return app;
}
