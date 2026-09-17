import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { createHeartbeat, LAST_RECONCILE_KEY } from "./heartbeat.ts";
import { PRIVACY_NOTICES } from "./notices.generated.ts";
import { createWorker } from "./pilot-worker.ts";
import {
  consoleLinesDuring,
  createFakePilotRuntime,
  FAILED_QUERY_LABEL,
  FAILED_QUERY_WORDS,
  type FakePilotRuntime,
  failedQueryFixture,
  inboundEventFixture,
  namesOf,
  noticesFixture,
  recordingLogger,
  testEnv,
} from "./testing/fakes.ts";

const ORIGIN = "https://vela.worker.test";

/** Staging once its vars and secrets are chosen, as the pilot Worker checks them before it runs. */
const chosenStaging: PilotEnv = {
  ...testEnv,
  ENVIRONMENT: "staging",
  TELEGRAM_BOT_USERNAME: "VelaStagingBot",
  ADMIN_CONVERSATION_ID: "123456789",
  PUBLIC_BASE_URL: "https://vela-admin.vela.example",
  PRIVACY_NOTICE_URL_EN: "https://vela.vela.example/privacy",
  PRIVACY_NOTICE_URL_ZH_TW: "https://vela.vela.example/privacy/zh-TW",
};

/** The pilot Worker as it is deployed, handed fakes: the same routes, queues, and crons. */
async function send(
  fake: FakePilotRuntime,
  request: Request,
  env: PilotEnv = testEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await createWorker(fake.runtime).fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function webhookRequest(secret: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) {
    headers.set("X-Telegram-Bot-Api-Secret-Token", secret);
  }
  return new Request(`${ORIGIN}/webhooks/telegram`, {
    method: "POST",
    headers,
    body: JSON.stringify({ update_id: 1 }),
  });
}

describe("the Telegram webhook", () => {
  it("refuses a request whose secret does not match and hands nothing to the router", async () => {
    const fake = createFakePilotRuntime({
      webhookSecret: "right",
      events: [inboundEventFixture()],
    });
    const response = await send(fake, webhookRequest("wrong"));

    expect(response.status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a request with no secret header at all", async () => {
    const fake = createFakePilotRuntime({ webhookSecret: "right" });
    expect((await send(fake, webhookRequest(null))).status).toBe(401);
  });

  it("hands the parsed events to the router and answers 200", async () => {
    const event = inboundEventFixture({ eventId: "telegram:77", text: "hello" });
    const fake = createFakePilotRuntime({ webhookSecret: "right", events: [event] });

    const response = await send(fake, webhookRequest("right"));

    expect(response.status).toBe(200);
    expect(fake.inbound).toEqual([event]);
    expect(fake.closed()).toBe(fake.built());
  });

  it("builds no deps when the update parsed to nothing", async () => {
    const fake = createFakePilotRuntime({ webhookSecret: "right", events: [] });

    expect((await send(fake, webhookRequest("right"))).status).toBe(200);
    expect(fake.built()).toBe(0);
  });

  it("answers 500 when the router throws, so Telegram redelivers", async () => {
    const fake = createFakePilotRuntime({
      webhookSecret: "right",
      events: [inboundEventFixture()],
      services: {
        handleInbound: async () => {
          throw new Error("database is away");
        },
      },
    });

    expect((await send(fake, webhookRequest("right"))).status).toBe(500);
    expect(fake.closed()).toBe(1);
  });

  it("logs a failure by its error label, never by the message that carries the family's words", async () => {
    const fake = createFakePilotRuntime({
      webhookSecret: "right",
      events: [inboundEventFixture()],
      services: {
        handleInbound: async () => {
          throw failedQueryFixture();
        },
      },
    });

    const { result: response, lines } = await consoleLinesDuring(() =>
      send(fake, webhookRequest("right")),
    );

    expect(response.status).toBe(500);
    expect(lines).toEqual([
      {
        level: "error",
        event: "request_failed",
        path: "/webhooks/telegram",
        method: "POST",
        error: FAILED_QUERY_LABEL,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(FAILED_QUERY_WORDS);
  });
});

/** The one heartbeat object `/healthz` reads, set to a last reconciliation this old, or none. */
async function heartbeatAged(ageMs: number | null): Promise<void> {
  const namespace = testEnv.RECONCILE_HEARTBEAT;
  const stub = namespace.get(namespace.idFromName("reconcile"));
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAll();
    if (ageMs !== null) {
      await state.storage.put(LAST_RECONCILE_KEY, Date.now() - ageMs);
    }
  });
}

/** `/healthz` as the watchdog reads it: status, caching, and the JSON body. */
async function health(
  fake: FakePilotRuntime,
  env: PilotEnv = testEnv,
): Promise<{ status: number; cache: string | null; body: unknown }> {
  const response = await send(fake, new Request(`${ORIGIN}/healthz`), env);
  return {
    status: response.status,
    cache: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

describe("/healthz, which the watchdog outside Cloudflare reads", () => {
  it("answers 503 no_reconcile_yet before any reconciliation, building nothing", async () => {
    await heartbeatAged(null);
    const fake = createFakePilotRuntime();

    expect(await health(fake)).toEqual({
      status: 503,
      cache: "no-store",
      body: { status: "no_reconcile_yet" },
    });
    expect(fake.built()).toBe(0);
  });

  it("answers 200 ok with the age in whole seconds once reconcile has recorded the heartbeat", async () => {
    await heartbeatAged(null);
    await createHeartbeat(testEnv, recordingLogger([])).ping();
    const fake = createFakePilotRuntime();

    const answer = await health(fake);

    expect(answer.status).toBe(200);
    expect(answer.cache).toBe("no-store");
    expect(answer.body).toEqual({ status: "ok", lastReconcileAgeSeconds: expect.any(Number) });
    expect(fake.built()).toBe(0);
  });

  // The exact 35-minute boundary is healthOf's (heartbeat.test.ts); a minute either side leaves a
  // slow test runner no room to cross it between the write and the read.
  it("answers ok a minute inside 35 minutes and 503 stale a minute past, with no content and no ids", async () => {
    const fake = createFakePilotRuntime();

    await heartbeatAged(34 * 60 * 1000);
    expect(await health(fake)).toMatchObject({ status: 200, body: { status: "ok" } });

    await heartbeatAged(36 * 60 * 1000);
    expect(await health(fake)).toEqual({
      status: 503,
      cache: "no-store",
      body: { status: "stale" },
    });
    expect(fake.built()).toBe(0);
  });

  // A deployed Worker that refuses its configuration builds no deps, so it never reconciles: the
  // health check must still answer, and say so, rather than fail with the configuration.
  it("still answers, from the heartbeat alone, in a deployed environment that refuses its configuration", async () => {
    await heartbeatAged(null);
    const fake = createFakePilotRuntime();
    const refused: PilotEnv = { ...testEnv, ENVIRONMENT: "production" };

    expect(await health(fake, refused)).toMatchObject({
      status: 503,
      body: { status: "no_reconcile_yet" },
    });
    expect(fake.built()).toBe(0);
    expect(namesOf(fake.calls)).toEqual([]);
  });
});

describe("the pilot Worker's other addresses", () => {
  // The admin pages are the admin Worker's, behind Cloudflare Access; the pilot Worker, which
  // Telegram must reach without a sign-in, has none of them.
  it.each([
    ["GET", "/admin"],
    ["GET", "/admin/families/11111111-1111-7111-8111-111111111111"],
    ["POST", "/admin/families/11111111-1111-7111-8111-111111111111/delete_family"],
  ])("answers 404 to %s %s and calls nothing", async (method, path) => {
    const fake = createFakePilotRuntime();

    const response = await send(
      fake,
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: { Origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: method === "POST" ? "confirm=delete" : null,
      }),
    );

    expect(response.status).toBe(404);
    expect(namesOf(fake.calls)).toEqual([]);
    expect(fake.built()).toBe(0);
  });
});

describe("the privacy notice pages", () => {
  it.each([
    ["/privacy", "en", "Vela pilot: privacy notice"],
    ["/privacy/zh-TW", "zh-TW", "Vela 試辦計畫：隱私權告知事項"],
  ])(
    "serves %s in its language, with no scripts and no requests elsewhere",
    async (path, lang, title) => {
      const fake = createFakePilotRuntime();

      const response = await send(fake, new Request(`${ORIGIN}${path}`));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(body).toContain(`<html lang="${lang}">`);
      expect(body).toContain(`<title>${title}</title>`);
      expect(body).toContain(`<h1>${title}</h1>`);
      expect(body).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
      );
      expect(body).not.toContain("<script");
      expect(body).not.toMatch(/(src|href)=/);
      expect(body).not.toContain("[");
      expect(fake.built()).toBe(0);
    },
  );

  it("serves the committed notices in development, blanks and all, for the founder to read", async () => {
    const fake = createFakePilotRuntime({ notices: PRIVACY_NOTICES });

    const response = await send(fake, new Request(`${ORIGIN}/privacy/zh-TW`));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(PRIVACY_NOTICES["zh-TW"].html);
  });

  it("serves a filled-in notice in a deployed environment", async () => {
    const fake = createFakePilotRuntime();

    expect((await send(fake, new Request(`${ORIGIN}/privacy`), chosenStaging)).status).toBe(200);
  });

  // No family may ever read an unfilled notice: outside development the page is refused while
  // either language still holds a blank, and the log names the file to fill in.
  it("refuses either page in a deployed environment while a notice holds a blank", async () => {
    const notices = noticesFixture();
    const unfilled = {
      ...notices,
      "zh-TW": { ...notices["zh-TW"], html: "<p>Vela 由 <strong>[創辦人全名]</strong> 經營。</p>" },
    };
    const fake = createFakePilotRuntime({ notices: unfilled });

    const { result, lines } = await consoleLinesDuring(async () => ({
      en: await send(fake, new Request(`${ORIGIN}/privacy`), chosenStaging),
      zh: await send(fake, new Request(`${ORIGIN}/privacy/zh-TW`), chosenStaging),
    }));

    expect([result.en.status, result.zh.status]).toEqual([500, 500]);
    expect(await result.zh.text()).not.toContain("創辦人全名");
    expect(lines).toEqual([
      {
        level: "error",
        event: "request_failed",
        path: "/privacy",
        method: "GET",
        error: "ConfigError:privacy-notice.zh-TW.md",
      },
      {
        level: "error",
        event: "request_failed",
        path: "/privacy/zh-TW",
        method: "GET",
        error: "ConfigError:privacy-notice.zh-TW.md",
      },
    ]);
  });
});
