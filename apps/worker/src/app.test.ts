import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboundJob, PilotEnv } from "./env.ts";
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
  lineOnEnv,
  namesOf,
  noticesFixture,
  recordingLogger,
  recordingQueue,
  signLineBody,
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

/** The kept-light member's LINE user id and her words, which no log line or answer may carry. */
const HER_LINE_ID = "U3bf020427417f5c0decf3c1612d4e59a";
const HER_WORDS = "今天去市場買了空心菜";

/** One LINE webhook body holding one event, as LINE sends it (the adapter's fixtures' shapes). */
function lineBody(event: Record<string, unknown>): string {
  return JSON.stringify({ destination: "U2ba6561a468b4afe9fa1df6d946e23de", events: [event] });
}

/** Her good morning in her own chat. */
const HER_TEXT = lineBody({
  replyToken: "c49772f8bb2228e107007ca23b93a3b3",
  type: "message",
  mode: "active",
  timestamp: 1790463748405,
  source: { type: "user", userId: HER_LINE_ID },
  webhookEventId: "01M3FZ9A9NW73PK6SZ3PDQ7PYS",
  deliveryContext: { isRedelivery: false },
  message: { id: "552078231551808266", type: "text", quoteToken: "q", text: HER_WORDS },
});

/** The family talking among themselves in their group, which Vela never reads (05 §3.2). */
const FAMILY_TALK = lineBody({
  replyToken: "83aec881b5e25e3f98821133280d3916",
  type: "message",
  mode: "active",
  timestamp: 1790463890898,
  source: {
    type: "group",
    groupId: "Ce5f4dcc362130dc312c78866466c6fff",
    userId: "U8f8c4117e99b1a4fa8346f3d1c56731b",
  },
  webhookEventId: "01M3FZDNEJB6CAQXHRGFE5R844",
  deliveryContext: { isRedelivery: false },
  message: { id: "529385796544261132", type: "text", text: "Who is picking Grandma up on Sunday?" },
});

/** What the Verify button in LINE's console sends: no event at all (05 §1 fact 6). */
const VERIFY_BODY = '{"destination":"U2ba6561a468b4afe9fa1df6d946e23de","events":[]}';

function lineRequest(body: string, signature: string | null): Request {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (signature !== null) {
    headers.set("x-line-signature", signature);
  }
  return new Request(`${ORIGIN}/webhooks/line`, { method: "POST", headers, body });
}

/** A body signed with the test channel's secret, as LINE signs it. */
async function signedLineRequest(body: string): Promise<Request> {
  return lineRequest(body, await signLineBody(body));
}

describe("the LINE webhook", () => {
  // Development and every deployed environment are off until the staging loop (05 §8).
  it("answers the Worker's one 404 where LINE is off, and reads, builds and queues nothing", async () => {
    const fake = createFakePilotRuntime();
    const sent: InboundJob[] = [];
    const off: PilotEnv = { ...testEnv, INBOUND_QUEUE: recordingQueue(sent) };

    const response = await send(fake, await signedLineRequest(HER_TEXT), off);
    const nowhere = await send(fake, new Request(`${ORIGIN}/nowhere`), off);

    expect(testEnv.LINE_CHANNEL).toBe("off");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(await nowhere.text());
    expect(sent).toEqual([]);
    expect(fake.channelsBuilt()).toBe(0);
    expect(fake.built()).toBe(0);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it.each([
    [
      "a body changed after LINE signed it",
      async () => lineRequest(HER_TEXT.replace("空心菜", "高麗菜"), await signLineBody(HER_TEXT)),
    ],
    ["no signature at all", async () => lineRequest(HER_TEXT, null)],
    [
      "a signature made with another channel's secret",
      async () => lineRequest(HER_TEXT, await signLineBody(HER_TEXT, "0f".repeat(16))),
    ],
  ] as const)("answers 401 to %s, building no deps and queueing nothing", async (_, request) => {
    const fake = createFakePilotRuntime();
    const sent: InboundJob[] = [];

    const { result: response, lines } = await consoleLinesDuring(async () =>
      send(fake, await request(), lineOnEnv({ INBOUND_QUEUE: recordingQueue(sent) })),
    );

    expect(response.status).toBe(401);
    expect(sent).toEqual([]);
    expect(fake.built()).toBe(0);
    expect(namesOf(fake.calls)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("answers the console's Verify body, which holds no event, with 200 and queues nothing", async () => {
    const fake = createFakePilotRuntime();
    const sent: InboundJob[] = [];

    const response = await send(
      fake,
      await signedLineRequest(VERIFY_BODY),
      lineOnEnv({ INBOUND_QUEUE: recordingQueue(sent) }),
    );

    expect(response.status).toBe(200);
    expect(sent).toEqual([]);
    expect(fake.built()).toBe(0);
  });

  // Nothing is handled inside LINE's 2 seconds: the queue's consumer does it (05 §5.10).
  it("puts her message on the inbound queue as one job, with no deps built and nothing handled here", async () => {
    const fake = createFakePilotRuntime();
    const sent: InboundJob[] = [];

    const response = await send(
      fake,
      await signedLineRequest(HER_TEXT),
      lineOnEnv({ INBOUND_QUEUE: recordingQueue(sent) }),
    );

    expect(response.status).toBe(200);
    expect(sent).toEqual([
      {
        type: "handle_inbound",
        events: [
          expect.objectContaining({
            channel: "line",
            eventId: "line:01M3FZ9A9NW73PK6SZ3PDQ7PYS",
            kind: "text",
            text: HER_WORDS,
            conversation: { externalId: HER_LINE_ID, kind: "private" },
          }),
        ],
      },
    ]);
    expect(fake.built()).toBe(0);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("queues nothing for the family's own talk in their group, which the adapter drops unread", async () => {
    const fake = createFakePilotRuntime();
    const sent: InboundJob[] = [];

    const { result: response, lines } = await consoleLinesDuring(async () =>
      send(
        fake,
        await signedLineRequest(FAMILY_TALK),
        lineOnEnv({ INBOUND_QUEUE: recordingQueue(sent) }),
      ),
    );

    expect(response.status).toBe(200);
    expect(sent).toEqual([]);
    expect(lines).toEqual([]);
  });

  // LINE signed it, so a redelivery would bring the same body: a 500 would only teach LINE to stop
  // redelivering the ones a retry could fix.
  it.each([
    ["not JSON", "not json", "SyntaxError"],
    ["without its events", '{"destination":"U2ba6561a468b4afe9fa1df6d946e23de"}', "TypeError"],
  ])(
    "answers 200 to a signed body %s, queues nothing, and logs its label alone",
    async (_, body, label) => {
      const fake = createFakePilotRuntime();
      const sent: InboundJob[] = [];

      const { result: response, lines } = await consoleLinesDuring(async () =>
        send(
          fake,
          await signedLineRequest(body),
          lineOnEnv({ INBOUND_QUEUE: recordingQueue(sent) }),
        ),
      );

      expect(response.status).toBe(200);
      expect(sent).toEqual([]);
      expect(lines).toEqual([
        {
          level: "error",
          event: "line_webhook_unreadable",
          environment: testEnv.ENVIRONMENT,
          error: label,
        },
      ]);
    },
  );

  it("answers 500 when the queue refuses the job, so LINE redelivers, logging neither her words nor who she is", async () => {
    const fake = createFakePilotRuntime();
    const refusing = recordingQueue<InboundJob>([], new Error(`queue full: ${HER_WORDS}`));

    const { result: response, lines } = await consoleLinesDuring(async () =>
      send(fake, await signedLineRequest(HER_TEXT), lineOnEnv({ INBOUND_QUEUE: refusing })),
    );

    expect(response.status).toBe(500);
    expect(lines).toEqual([
      {
        level: "error",
        event: "request_failed",
        path: "/webhooks/line",
        method: "POST",
        error: "Error",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(HER_WORDS);
    expect(JSON.stringify(lines)).not.toContain(HER_LINE_ID);
  });

  it("answers 500 naming the variable, and queues nothing, while LINE is on without its secret", async () => {
    const fake = createFakePilotRuntime();
    const sent: InboundJob[] = [];

    const { result: response, lines } = await consoleLinesDuring(async () =>
      send(
        fake,
        await signedLineRequest(HER_TEXT),
        lineOnEnv({ INBOUND_QUEUE: recordingQueue(sent), LINE_CHANNEL_SECRET: undefined }),
      ),
    );

    expect(response.status).toBe(500);
    expect(lines).toEqual([
      {
        level: "error",
        event: "request_failed",
        path: "/webhooks/line",
        method: "POST",
        error: "ConfigError:LINE_CHANNEL_SECRET",
      },
    ]);
    expect(sent).toEqual([]);
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
