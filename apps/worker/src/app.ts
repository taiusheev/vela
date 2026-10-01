/**
 * Every HTTP route the pilot Worker serves (code design §9, H1): the health check, the Telegram and
 * LINE webhooks, the media LINE fetches, and the privacy notices. The admin pages are another
 * Worker's (`admin-app.ts`), so anything under `/admin` here is 404. `/v1` never reaches this app;
 * `pilot-worker.ts` hands it to `PilotRuntime.api`.
 *
 * Nothing here decides anything about a family: a route verifies the request, builds deps, calls
 * services, and renders what came back. Services' entry points arrive through `PilotRuntime`, so a
 * test hands the routes fakes.
 */
import { DeviceInput, type InboundEvent } from "@vela/contracts";
import { errorLabel } from "@vela/services";
import { type Context, Hono } from "hono";
import { readEnvironment, readLineConfig, refuseUnfilledNotices } from "./config.ts";
import { createLogger } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import { readHealth } from "./heartbeat.ts";
import { noticePage } from "./html.ts";
import { MEDIA_PATH_PREFIX, openMedia } from "./media-route.ts";
import { NOTICE_LANGS, NOTICE_PATHS } from "./notices.ts";
import { requestFailed } from "./request-errors.ts";
import type { PilotRuntime } from "./runtime.ts";

/** `Authorization: Device <token>`: her phone's 43-character token (ADR-35). */
const DEVICE_AUTHORIZATION = /^Device ([A-Za-z0-9_-]{43})$/;

interface PilotAppEnv {
  Bindings: PilotEnv;
}

/** The one 404 the Worker answers, whatever was not there. */
function notFound(c: Context<PilotAppEnv>): Response {
  return c.text("not found", 404);
}

export function createApp(runtime: PilotRuntime): Hono<PilotAppEnv> {
  const app = new Hono<PilotAppEnv>();

  /**
   * Whether reconciliation is running (W2), for the watchdog outside Cloudflare: 200 while the last
   * run finished at most 35 minutes ago, 503 otherwise. It reads the heartbeat object and builds no
   * deps, so it never wakes the database, and it says nothing about any family.
   */
  app.get("/healthz", async (c) => {
    const health = await readHealth(c.env);
    return c.json(health, health.status === "ok" ? 200 : 503, { "cache-control": "no-store" });
  });

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
   * Her phone on the parent surface (ADR-35): her tap or her words, as the inbound event a Telegram
   * chat would make, handed to the same router. Her device token is checked before anything else
   * is read; an unknown one is 401, a body that is not the contract's 400. Nothing she sent is
   * logged. Her phone reads what Vela sent it from the API (`GET /v1/device/messages`).
   */
  app.post("/device/messages", async (c) => {
    const presented = DEVICE_AUTHORIZATION.exec(c.req.header("Authorization") ?? "");
    if (presented === null) return c.json({ error: "unauthorized" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid" }, 400);
    }
    const input = DeviceInput.safeParse(body);
    if (!input.success) return c.json({ error: "invalid" }, 400);
    const handle = await runtime.createDeps(c.env);
    try {
      const deps = handle.deps;
      const her = await runtime.services.memberOfDeviceToken(deps.db, presented[1] ?? "");
      if (her === null) return c.json({ error: "unauthorized" }, 401);
      const id = crypto.randomUUID();
      const event = await runtime.services.deviceInboundEvent(
        deps.db,
        her,
        input.data,
        { eventId: id, messageId: id },
        deps.clock.now(),
      );
      if (event === null) return c.json({ error: "unauthorized" }, 401);
      await runtime.services.handleInbound(deps, [event]);
      return c.json({ ok: true });
    } finally {
      c.executionCtx.waitUntil(handle.close());
    }
  });

  /**
   * LINE's webhook (05 §5.10). Where LINE is off it answers the Worker's one 404 and reads nothing.
   * Otherwise the signature is checked before anything is built, and nothing is handled here: the
   * events go to the inbound queue in one job, and LINE is answered without a database connection,
   * inside the 2 seconds it waits whatever Neon's state (05 §1 fact 6). It answers 500 only for
   * what LINE's redelivery can fix, since LINE may stop redelivering after many 500s: a bad
   * signature is 401, and a signed body that cannot be read is dropped with a 200. Nothing about the
   * body is logged: it is what the family wrote, and who wrote it.
   */
  app.post("/webhooks/line", async (c) => {
    const line = readLineConfig(c.env);
    if (line === null) {
      return notFound(c);
    }
    const rawBody = await c.req.text();
    const adapter = runtime.createChannels(c.env).get("line");
    const input = { headers: c.req.raw.headers, rawBody };
    if (!(await adapter.verify(input))) {
      return c.text("unauthorized", 401);
    }
    let events: InboundEvent[];
    try {
      events = adapter.parse(input);
    } catch (error) {
      // LINE signed it, so a redelivery would bring the same unreadable body again.
      createLogger(c.env).error("line_webhook_unreadable", { error: errorLabel(error) });
      return c.text("ok");
    }
    if (events.length > 0) {
      await line.inboundQueue.send({ type: "handle_inbound", events });
    }
    return c.text("ok");
  });

  /**
   * The copies LINE is sent by URL (`media-route.ts`). Where LINE is off, and for any URL this
   * Worker did not sign or whose object is gone, the Worker's one 404, logged nowhere. A failure
   * is logged by its label alone: `request_failed` would name the path, which holds the storage key
   * and the signature that opens it.
   */
  app.get(`${MEDIA_PATH_PREFIX}:key/:file`, async (c) => {
    try {
      const line = readLineConfig(c.env);
      const media =
        line === null
          ? null
          : await openMedia(line, c.req.param("key"), c.req.param("file"), c.req.raw.headers);
      return media ?? notFound(c);
    } catch (error) {
      createLogger(c.env).error("media_request_failed", { error: errorLabel(error) });
      return c.text("internal error", 500);
    }
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

  app.notFound(notFound);
  app.onError(requestFailed);

  return app;
}
