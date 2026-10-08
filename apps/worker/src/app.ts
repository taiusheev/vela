/**
 * Every HTTP route the pilot Worker serves (code design §9, H1): the health check, the Telegram and
 * LINE and Clerk webhooks, the media LINE fetches, the privacy notices, and the public website. The admin pages are another
 * Worker's (`admin-app.ts`), so anything under `/admin` here is 404. `/v1` never reaches this app;
 * `pilot-worker.ts` hands it to `PilotRuntime.api`.
 *
 * Nothing here decides anything about a family: a route verifies the request, builds deps, calls
 * services, and renders what came back. Services' entry points arrive through `PilotRuntime`, so a
 * test hands the routes fakes.
 */
import { DeviceInput, type InboundEvent } from "@vela/contracts";
import {
  DeviceVoiceRefusedError,
  errorLabel,
  MAX_DEVICE_VOICE_BYTES,
  VelaError,
  WaitlistInput,
} from "@vela/services";
import { type Context, Hono } from "hono";
import { addressAdmitted, addressOf } from "./api-runtime.ts";
import { MAX_UPLOAD_READ_MS, readUploadBody } from "./api-upload.ts";
import {
  ConfigError,
  readEnvironment,
  readLineConfig,
  readPilotAdmission,
  refuseUnfilledNotices,
} from "./config.ts";
import { createLogger } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import { readHealth } from "./heartbeat.ts";
import { type Html, noticePage, sitePage } from "./html.ts";
import { MEDIA_PATH_PREFIX, openMedia } from "./media-route.ts";
import { NOTICE_LANGS, NOTICE_PATHS } from "./notices.ts";
import { requestFailed } from "./request-errors.ts";
import type { PilotRuntime } from "./runtime.ts";
import {
  SITE_LANGS,
  SITE_PATHS,
  siteHome,
  sitePrecision,
  sitePrivacy,
  unfilledSiteBlanks,
  WAITLIST_PATH,
} from "./site.ts";
import {
  canonicalOrigin,
  robotsTxt,
  sameSiteOrigin,
  securityTxt,
  siteIndexable,
  sitemapXml,
} from "./site-host.ts";

/** The most a waitlist form may send, in characters. */
const WAITLIST_MAX_BODY = 2048;

/** How long the edge keeps a rendered precision page: the figures change once a month. */
const PRECISION_CACHE_SECONDS = 3600;

/** `Authorization: Device <token>`: her phone's 43-character token (ADR-35). */
const DEVICE_AUTHORIZATION = /^Device ([A-Za-z0-9_-]{43})$/;

interface PilotAppEnv {
  Bindings: PilotEnv;
}

/** The one 404 the Worker answers, whatever was not there. */
function notFound(c: Context<PilotAppEnv>): Response {
  return c.text("not found", 404);
}

/** Legacy parent-device tokens cannot reopen a surface excluded from the closed trial. */
function pilotDeviceRefusal(c: Context<PilotAppEnv>): Response | null {
  try {
    return readPilotAdmission(c.env) === null ? null : notFound(c);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger(c.env).error("parent_device_config_refused", { error: errorLabel(error) });
    return c.json({ error: "unavailable" }, 503, { "cache-control": "no-store" });
  }
}

/** The largest body a webhook may send (Telegram's and LINE's are a few kilobytes). */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;
/** The largest body her phone's tap or words may send. */
export const MAX_DEVICE_MESSAGE_BYTES = 64 * 1024;
const BODY_READ_MS = 10_000;

/**
 * A request body as text, read in bounded pieces (security review, technical plan 6.5): never past
 * `maxBytes` whatever Content-Length says, and never past ten seconds. A failure says why.
 */
async function readBoundedText(
  request: Request,
  env: PilotEnv,
  maxBytes: number,
): Promise<string | { status: 400 | 408 | 413 }> {
  const read = await readUploadBody(request, createLogger(env), maxBytes, BODY_READ_MS);
  if (!read.ok) return { status: read.status };
  return new TextDecoder().decode(read.bytes);
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
    const channels = runtime.createChannels(c.env);
    const adapter = channels.get("telegram");
    // Telegram's secret is a header, so nothing of an unsigned request's body is read at all.
    if (!(await adapter.verify({ headers: c.req.raw.headers, rawBody: "" }))) {
      return c.text("unauthorized", 401);
    }
    const body = await readBoundedText(c.req.raw, c.env, MAX_WEBHOOK_BYTES);
    if (typeof body !== "string") {
      // A signed body that is too big or unreadable would come back the same: answered, not retried.
      if (body.status === 408) return c.text("timeout", 500);
      createLogger(c.env).error("telegram_webhook_unreadable", { status: body.status });
      return c.text("ok");
    }
    const input = { headers: c.req.raw.headers, rawBody: body };
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

  app.post("/webhooks/clerk", (c) => runtime.clerk(c.req.raw, c.env));

  /**
   * Her phone on the parent surface (ADR-35): her tap or her words, as the inbound event a Telegram
   * chat would make, handed to the same router. Her device token is checked before anything else
   * is read; an unknown one is 401, a body that is not the contract's 400. Nothing she sent is
   * logged. Her phone reads what Vela sent it from the API (`GET /v1/device/messages`).
   */
  app.post("/device/messages", async (c) => {
    const refused = pilotDeviceRefusal(c);
    if (refused !== null) return refused;
    const presented = DEVICE_AUTHORIZATION.exec(c.req.header("Authorization") ?? "");
    if (presented === null) return c.json({ error: "unauthorized" }, 401);
    const text = await readBoundedText(c.req.raw, c.env, MAX_DEVICE_MESSAGE_BYTES);
    if (typeof text !== "string")
      return c.json({ error: "invalid" }, text.status === 413 ? 413 : 400);
    let body: unknown;
    try {
      body = JSON.parse(text);
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
    } catch (error) {
      // A voice naming no recording of hers.
      if (error instanceof VelaError && error.code === "not_found") {
        return c.json({ error: "invalid" }, 400);
      }
      throw error;
    } finally {
      c.executionCtx.waitUntil(handle.close());
    }
  });

  /**
   * Her recording from her phone (ADR-35, P4), before it is sent as a voice: the `.m4a` bytes as
   * the body (`Content-Type: audio/mp4`, at most 3 MiB), the recording's own key in
   * `Idempotency-Key`, and its length in `X-Duration-Ms`. It answers 201 `{media_id}`, the same id
   * again for the same key; 400 for anything that is not a recording, 413 past the size, 429 past a
   * day's recordings, 404 where nothing is stored, and 401 for an unknown token.
   */
  app.post("/device/voice", async (c) => {
    const refused = pilotDeviceRefusal(c);
    if (refused !== null) return refused;
    const presented = DEVICE_AUTHORIZATION.exec(c.req.header("Authorization") ?? "");
    if (presented === null) return c.json({ error: "unauthorized" }, 401);
    if ((c.req.header("Content-Type") ?? "").split(";")[0]?.trim() !== "audio/mp4") {
      return c.json({ error: "invalid" }, 400);
    }
    const key = c.req.header("Idempotency-Key") ?? "";
    const duration = Number(c.req.header("X-Duration-Ms") ?? "");
    // Read in bounded pieces, never past 3 MiB, whatever Content-Length says or leaves out.
    const read = await readUploadBody(
      c.req.raw,
      createLogger(c.env),
      MAX_DEVICE_VOICE_BYTES,
      MAX_UPLOAD_READ_MS,
    );
    if (!read.ok) {
      const error = read.status === 413 ? "too_large" : "invalid";
      return c.json({ error }, read.status);
    }
    const body = read.bytes;
    const handle = await runtime.createDeps(c.env);
    try {
      const deps = handle.deps;
      const her = await runtime.services.memberOfDeviceToken(deps.db, presented[1] ?? "");
      if (her === null) return c.json({ error: "unauthorized" }, 401);
      const stored = await runtime.services.storeDeviceVoice(
        deps,
        her,
        key,
        body,
        Number.isFinite(duration) ? duration : null,
      );
      return c.json({ media_id: stored.mediaId }, 201);
    } catch (error) {
      if (error instanceof DeviceVoiceRefusedError) {
        const status = { invalid: 400, too_large: 413, limit: 429, off: 404 } as const;
        return c.json({ error: error.reason }, status[error.reason]);
      }
      throw error;
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
    const rawBody = await readBoundedText(c.req.raw, c.env, MAX_WEBHOOK_BYTES);
    if (typeof rawBody !== "string") {
      // Nothing can be verified without the body; LINE's own bodies are far smaller than the cap.
      return rawBody.status === 408 ? c.text("timeout", 500) : c.text("unauthorized", 401);
    }
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

  /**
   * The public website (launch gate 14), in each language. Production serves no page whose copy
   * still holds a founder's blank (`[price]`); it answers 503 and logs which blanks remain, so the
   * site is never published half-chosen. Development and staging show them. Only production may be
   * indexed. The stylesheet, script and pictures are static assets the platform serves before this
   * app (`assets` in wrangler.jsonc).
   */
  for (const lang of SITE_LANGS) {
    const refusal = (c: Context<PilotAppEnv>): Response | null => {
      if (readEnvironment(c.env) !== "production") return null;
      const blanks = unfilledSiteBlanks(lang);
      if (blanks.length === 0) return null;
      createLogger(c.env).error("site_unfilled", { lang, blanks: blanks.join(",") });
      return c.text("unavailable", 503, { "cache-control": "no-store" });
    };
    const render = (
      c: Context<PilotAppEnv>,
      page: "home" | "precision" | "privacy",
      content: { title: string; description: string; body: Html },
    ) =>
      sitePage(
        {
          lang,
          ...content,
          path: SITE_PATHS[lang][page],
          alternates: SITE_LANGS.map((other) => ({ lang: other, path: SITE_PATHS[other][page] })),
        },
        {
          indexable: siteIndexable(c.env, new URL(c.req.url)),
          origin: canonicalOrigin(c.env, new URL(c.req.url)),
        },
      );

    app.get(SITE_PATHS[lang].privacy, (c) => {
      const refused = refusal(c);
      if (refused !== null) return refused;
      return render(c, "privacy", sitePrivacy(lang));
    });

    app.get(SITE_PATHS[lang].home, (c) => {
      const refused = refusal(c);
      if (refused !== null) return refused;
      const joined = c.req.query("joined");
      const flash = joined === "1" ? "joined" : joined === "email" ? "email" : null;
      return render(c, "home", siteHome(lang, flash));
    });

    /**
     * How Vela is doing: every family's ended months that reach the floor (`loadPublicPrecision`).
     * It reads the database, so a rendered page is kept at the edge for an hour: a crawler or a
     * busy day costs one query an hour per language, not one per visit.
     */
    app.get(SITE_PATHS[lang].precision, async (c) => {
      const refused = refusal(c);
      if (refused !== null) return refused;
      const cache = caches.default;
      const key = new Request(new URL(c.req.url).origin + SITE_PATHS[lang].precision);
      const kept = await cache.match(key);
      if (kept !== undefined) return kept;
      const handle = await runtime.createDeps(c.env);
      try {
        const precision = await runtime.services.loadPublicPrecision(handle.deps.db, new Date());
        const response = render(c, "precision", sitePrecision(lang, precision));
        response.headers.set("cache-control", `public, max-age=${PRECISION_CACHE_SECONDS}`);
        c.executionCtx.waitUntil(cache.put(key, response.clone()));
        return response;
      } finally {
        c.executionCtx.waitUntil(handle.close());
      }
    });
  }

  /** Where search engines may go: the site on its own address, nowhere anywhere else. */
  app.get("/robots.txt", (c) => {
    const url = new URL(c.req.url);
    return c.text(robotsTxt(siteIndexable(c.env, url), canonicalOrigin(c.env, url)), 200, {
      "cache-control": "public, max-age=3600",
    });
  });

  /** How to report a security problem (RFC 9116), on every address. */
  app.get("/.well-known/security.txt", (c) =>
    c.text(securityTxt(canonicalOrigin(c.env, new URL(c.req.url)), new Date()), 200, {
      "cache-control": "public, max-age=86400",
    }),
  );

  app.get("/sitemap.xml", (c) =>
    c.body(sitemapXml(canonicalOrigin(c.env, new URL(c.req.url))), 200, {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    }),
  );

  /**
   * The website's waitlist form. A browser without script posts the form and is sent back to the
   * page with the answer (`?joined=1#join`); the page's script asks for JSON instead. Joining twice
   * answers the same as joining once, so the answer never says whether an address was on the list.
   * A filled-in hidden field is a robot's: answered as joined, nothing stored. Each address is
   * counted by the same best-effort per-address limit as the API, under its own key.
   */
  app.post(WAITLIST_PATH, async (c) => {
    const wantsJson = (c.req.header("accept") ?? "").includes("application/json");
    // A form from another site is refused: browsers name the page a form was sent from, and only
    // this address and the website's own may post here.
    const origin = c.req.header("origin");
    if (origin !== undefined && !sameSiteOrigin(origin, new URL(c.req.url), c.env)) {
      return c.json({ error: "forbidden" }, 403, { "cache-control": "no-store" });
    }
    if (!(c.req.header("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
      return c.json({ error: "unsupported" }, 415, { "cache-control": "no-store" });
    }
    // An address, a language and a choice fit in far less; anything bigger is not this form.
    const raw = await c.req.text();
    if (raw.length > WAITLIST_MAX_BODY) {
      return c.json({ error: "too_large" }, 413, { "cache-control": "no-store" });
    }
    const form = new URLSearchParams(raw);
    const field = (name: string) => form.get(name) ?? "";
    const lang = (SITE_LANGS as readonly string[]).includes(field("lang"))
      ? (field("lang") as (typeof SITE_LANGS)[number])
      : "en";
    const back = (answer: "1" | "email") =>
      c.redirect(`${SITE_PATHS[lang].home}?joined=${answer}#join`, 303);
    const done = () =>
      wantsJson ? c.json({ joined: true }, 200, { "cache-control": "no-store" }) : back("1");

    const logger = createLogger(c.env);
    if (!(await addressAdmitted(c.env.API_IP_LIMIT, `waitlist:${addressOf(c.req.raw)}`, logger))) {
      return c.json({ error: "rate_limited" }, 429, { "cache-control": "no-store" });
    }
    if (field("website") !== "") return done();
    const input = WaitlistInput.safeParse({
      email: field("email"),
      lang,
      role: ["organiser", "parent", "other"].includes(field("role")) ? field("role") : null,
    });
    if (!input.success) {
      return wantsJson
        ? c.json({ error: "email" }, 400, { "cache-control": "no-store" })
        : back("email");
    }
    const handle = await runtime.createDeps(c.env);
    try {
      await runtime.services.joinWaitlist(handle.deps.db, input.data);
    } finally {
      c.executionCtx.waitUntil(handle.close());
    }
    logger.info("waitlist_joined", { lang });
    return done();
  });

  app.notFound(notFound);
  app.onError(requestFailed);

  return app;
}
