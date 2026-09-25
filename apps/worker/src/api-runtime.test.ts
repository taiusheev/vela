import { ApiIdempotencyError, type SessionIdentity } from "@vela/services";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type ApiRuntime, type ApiWriteServices, createApiApp } from "./api-app.ts";
import {
  API_READ_SERVICES,
  API_WRITE_SERVICES,
  type ApiApp,
  apiRuntimeFor,
  buildApiApp,
  createApiHandler,
  createApiNudges,
  limitWrites,
} from "./api-runtime.ts";
import type { ApiConfig } from "./config.ts";
import type { PilotEnv } from "./env.ts";
import type { SessionActivityChecker } from "./session.ts";
import {
  consoleLinesDuring,
  FAILED_QUERY_LABEL,
  FAILED_QUERY_WORDS,
  failedQueryFixture,
  type LogLine,
  recordingLogger,
  testEnv,
} from "./testing/fakes.ts";

const DEV_ISSUER = "https://ideal-vulture-9262.clerk.accounts.dev";
// Shaped like Clerk's keys, and distinctive enough that a log line holding one would show. Joined at
// run time: Clerk shares Stripe's sk_ prefixes, and secret scanning would take a literal for a real key.
const TEST_KEY = ["sk", "test", "StagingKeyNeverLogged42"].join("_");
const LIVE_KEY = ["sk", "live", "ProductionKeyNeverLogged42"].join("_");
const ADDRESS = "203.0.113.7";

/** What `readApiConfig` makes of `stagingEnv()`. */
const STAGING_CONFIG: ApiConfig = {
  environment: "staging",
  issuer: DEV_ISSUER,
  secretKey: TEST_KEY,
  telegramBotUsername: "VelaStagingBot",
  regions: ["apac"],
};

const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const UNAUTHENTICATED = { error: { code: "unauthenticated", message: "Sign in required." } };
const RATE_LIMITED = { error: { code: "rate_limited", message: "Too many requests." } };
const UNAVAILABLE = {
  error: { code: "unavailable", message: "Service temporarily unavailable." },
};
const INTERNAL = { error: { code: "internal", message: "Internal server error." } };

interface FakeLimiter {
  readonly limit: Mock<RateLimit["limit"]>;
}

/** A Workers Rate Limiting binding that answers `success` every time and records the keys. */
function fakeLimiter(success = true): FakeLimiter {
  return { limit: vi.fn<RateLimit["limit"]>().mockResolvedValue({ success }) };
}

type WriteLimiters = NonNullable<PilotEnv["ACCOUNT_WRITE_LIMITER"]>;

interface FakeWriteLimiters {
  readonly namespace: WriteLimiters;
  /** The name of each object asked for, in order. */
  readonly names: string[];
  readonly admit: Mock<() => Promise<boolean>>;
}

/**
 * Write limiter objects that answer `admitted` every time, for the tests about what reaches them;
 * the tests about the limit itself use the real objects wrangler.jsonc binds (`realWriteLimiters`).
 */
function fakeWriteLimiters(admitted = true): FakeWriteLimiters {
  const names: string[] = [];
  const admit = vi.fn<() => Promise<boolean>>().mockResolvedValue(admitted);
  const namespace = {
    idFromName: (name: string) => {
      names.push(name);
      return `id:${name}`;
    },
    get: () => ({ admit }),
  } as unknown as WriteLimiters;
  return { namespace, names, admit };
}

/** The `AccountWriteLimiter` objects development binds, which the tests' runtime runs. */
function realWriteLimiters(): WriteLimiters {
  if (testEnv.ACCOUNT_WRITE_LIMITER === undefined) {
    throw new Error("wrangler.jsonc binds no ACCOUNT_WRITE_LIMITER in development");
  }
  return testEnv.ACCOUNT_WRITE_LIMITER;
}

/** A signed-in account no other test writes as, so each test starts with the whole allowance. */
function freshIdentity(): SessionIdentity {
  return { authSubject: `user_${crypto.randomUUID()}`, sessionId: "sess_limited" };
}

/** A Hyperdrive binding that counts every read of its connection string, and refuses each one. */
function untouchedDatabase(): { readonly binding: Hyperdrive; reads(): number } {
  let reads = 0;
  const binding = {
    get connectionString(): string {
      reads += 1;
      throw new Error("the test opened a database");
    },
  } as unknown as Hyperdrive;
  return { binding, reads: () => reads };
}

/**
 * Staging with every value chosen, as `config.test.ts` has it, and the API on: Clerk's development
 * instance, a development key, and fake limiters, so each test reaches the check it is about. The
 * hosts are under the reserved `.example` domain.
 */
function stagingEnv(overrides: Partial<PilotEnv> = {}): PilotEnv {
  return {
    ...testEnv,
    ENVIRONMENT: "staging",
    TELEGRAM_BOT_USERNAME: "VelaStagingBot",
    ADMIN_CONVERSATION_ID: "123456789",
    PUBLIC_BASE_URL: "https://vela-admin.vela.example",
    PRIVACY_NOTICE_URL_EN: "https://vela.vela.example/privacy",
    PRIVACY_NOTICE_URL_ZH_TW: "https://vela.vela.example/privacy/zh-TW",
    API_V1: "on",
    CLERK_ISSUER: DEV_ISSUER,
    CLERK_SECRET_KEY: TEST_KEY,
    API_IP_LIMIT: fakeLimiter(),
    ACCOUNT_WRITE_LIMITER: fakeWriteLimiters().namespace,
    HYPERDRIVE: untouchedDatabase().binding,
    ...overrides,
  };
}

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://vela.vela-light-staging.workers.dev${path}`, init);
}

/** An app that answers every request with an empty JSON object, for the tests about the host. */
function stubApp(): ApiApp {
  return { fetch: async () => Response.json({}) };
}

type Build = (env: PilotEnv, config: ApiConfig) => ApiApp;

async function expectAnswer(response: Response, status: number, body: unknown): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(body);
}

/**
 * Every value of `env` a log line must never hold: all of them but the environment's name, which
 * every line carries, and the short words the switches and regions are (on, off, apac).
 */
function configuredValues(env: PilotEnv): string[] {
  return Object.entries(env).flatMap(([name, value]) =>
    typeof value === "string" && name !== "ENVIRONMENT" && value.length > 4 ? [value] : [],
  );
}

function base64url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A token shaped as Clerk's are, three base64url parts, RS256 with a `kid`, so the verifier would
 * go on to fetch Clerk's keys for it; its signature is none, so no key could ever verify it.
 */
const WELL_FORMED_TOKEN = [
  base64url(JSON.stringify({ alg: "RS256", kid: "vela-test", typ: "JWT" })),
  base64url(JSON.stringify({ sub: "user_test", sid: "sess_test" })),
  base64url("no signature"),
].join(".");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the API's host on the pilot Worker", () => {
  // ADR-29: a deployed API without its settings answers 503 on /v1 alone, and says which variable
  // in its log, never the value.
  it.each([
    ["no Clerk secret key", { CLERK_SECRET_KEY: undefined }, "CLERK_SECRET_KEY"],
    ["a production key", { CLERK_SECRET_KEY: LIVE_KEY }, "CLERK_SECRET_KEY"],
    [
      "a placeholder issuer",
      { CLERK_ISSUER: "https://PLACEHOLDER_STAGING_CLERK_HOST" },
      "CLERK_ISSUER",
    ],
    ["no address limiter", { API_IP_LIMIT: undefined }, "API_IP_LIMIT"],
    ["no write limiter", { ACCOUNT_WRITE_LIMITER: undefined }, "ACCOUNT_WRITE_LIMITER"],
  ] as const)(
    "answers 503 on staging with %s, logging the variable and no value",
    async (_, overrides, variable) => {
      const env = stagingEnv(overrides);
      const build = vi.fn<Build>(stubApp);

      const { result: response, lines } = await consoleLinesDuring(() =>
        createApiHandler(build)(apiRequest("/v1/me"), env),
      );

      await expectAnswer(response, 503, UNAVAILABLE);
      expect(lines).toEqual([
        {
          level: "error",
          event: "api_config_refused",
          environment: "staging",
          error: `ConfigError:${variable}`,
        },
      ]);
      expect(build).not.toHaveBeenCalled();
      for (const value of configuredValues(env)) {
        expect(JSON.stringify(lines)).not.toContain(value);
      }
    },
  );

  it("answers 404 while API_V1 is off, before the limiter and without building anything", async () => {
    const address = fakeLimiter();
    const build = vi.fn<Build>(stubApp);
    // Production as wrangler.jsonc ships it: the API off, no issuer, no key, no limiters.
    const env = stagingEnv({
      ENVIRONMENT: "production",
      API_V1: "off",
      CLERK_ISSUER: undefined,
      CLERK_SECRET_KEY: undefined,
      API_IP_LIMIT: address,
      ACCOUNT_WRITE_LIMITER: undefined,
    });

    const { result: response, lines } = await consoleLinesDuring(() =>
      createApiHandler(build)(apiRequest("/v1/me"), env),
    );

    await expectAnswer(response, 404, NOT_FOUND);
    expect(address.limit).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("answers 429 with Retry-After once an address is over its limit, building nothing and logging nothing", async () => {
    const address = fakeLimiter(false);
    const build = vi.fn<Build>(stubApp);
    const env = stagingEnv({ API_IP_LIMIT: address });
    const handler = createApiHandler(build);

    const { result: responses, lines } = await consoleLinesDuring(async () => [
      await handler(apiRequest("/v1/me", { headers: { "cf-connecting-ip": ADDRESS } }), env),
      await handler(apiRequest("/v1/me"), env),
    ]);

    for (const response of responses) {
      expect(response.headers.get("retry-after")).toBe("60");
      await expectAnswer(response, 429, RATE_LIMITED);
    }
    // Requests with no address, which Cloudflare always sets, are counted together.
    expect(address.limit.mock.calls).toEqual([[{ key: ADDRESS }], [{ key: "unknown" }]]);
    expect(build).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  // One subscriber holds a whole IPv6 /64, so a caller changing the low 64 bits of its address on
  // every request must still spend one count.
  it("counts an IPv6 address under its /64, however it is written", async () => {
    const address = fakeLimiter();
    const env = stagingEnv({ API_IP_LIMIT: address });
    const handler = createApiHandler(stubApp);

    for (const from of [
      "2001:db8:1:2::1",
      "2001:db8:1:2:ffff::9",
      "2001:0DB8:0001:0002:0000:0000:0000:ABCD",
      "2001:db8:1:3::1",
      "::ffff:203.0.113.7",
    ]) {
      await handler(apiRequest("/v1/me", { headers: { "cf-connecting-ip": from } }), env);
    }

    expect(address.limit.mock.calls.map(([options]) => options.key)).toEqual([
      "2001:db8:1:2::/64",
      "2001:db8:1:2::/64",
      "2001:db8:1:2::/64",
      "2001:db8:1:3::/64",
      // An IPv4 address written as IPv6 is one IPv4 client, counted alone as the others are.
      "::ffff:203.0.113.7",
    ]);
  });

  it("lets a request through when the address limiter fails, logging the failure's label only", async () => {
    const failure = new Error(`the limiter could not count ${ADDRESS}`);
    failure.name = "RateLimitUnavailable";
    const address = { limit: vi.fn<RateLimit["limit"]>().mockRejectedValue(failure) };
    const build = vi.fn<Build>(stubApp);

    const { result: response, lines } = await consoleLinesDuring(() =>
      createApiHandler(build)(
        apiRequest("/v1/me", { headers: { "cf-connecting-ip": ADDRESS } }),
        stagingEnv({ API_IP_LIMIT: address }),
      ),
    );

    expect(response.status).toBe(200);
    expect(build).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      {
        level: "error",
        event: "api_rate_limit_failed",
        environment: "staging",
        scope: "address",
        error: "RateLimitUnavailable",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(ADDRESS);
  });

  // One app per isolate keeps one cache of Clerk's keys, whichever `env` object a request carries.
  it("builds the app once for equal settings, even from another env object", async () => {
    const build = vi.fn<Build>(stubApp);
    const handler = createApiHandler(build);

    const responses = [
      await handler(apiRequest("/v1/me"), stagingEnv()),
      await handler(apiRequest("/v1/me"), stagingEnv()),
      await handler(apiRequest("/v1/me"), stagingEnv({ CLERK_ISSUER: `${DEV_ISSUER}/` })),
    ];

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(build).toHaveBeenCalledOnce();
  });

  it("builds the app again when the secret key or the issuer changes", async () => {
    const build = vi.fn<Build>(stubApp);
    const handler = createApiHandler(build);
    const rotated = ["sk", "test", "RotatedKeyNeverLogged42"].join("_");
    const otherIssuer = "https://other-instance-7.clerk.accounts.dev";

    await handler(apiRequest("/v1/me"), stagingEnv());
    await handler(apiRequest("/v1/me"), stagingEnv({ CLERK_SECRET_KEY: rotated }));
    await handler(apiRequest("/v1/me"), stagingEnv({ CLERK_SECRET_KEY: rotated }));
    await handler(
      apiRequest("/v1/me"),
      stagingEnv({ CLERK_SECRET_KEY: rotated, CLERK_ISSUER: otherIssuer }),
    );

    expect(build.mock.calls.map(([, config]) => [config.issuer, config.secretKey])).toEqual([
      [DEV_ISSUER, TEST_KEY],
      [DEV_ISSUER, rotated],
      [otherIssuer, rotated],
    ]);
  });

  it("answers 503 when the app cannot be built, logs the label, and builds again next time", async () => {
    const build = vi
      .fn<Build>()
      .mockImplementationOnce(() => {
        throw new Error(`Invalid session verifier configuration for ${DEV_ISSUER}`);
      })
      .mockImplementation(stubApp);
    const handler = createApiHandler(build);

    const { result: refused, lines } = await consoleLinesDuring(() =>
      handler(apiRequest("/v1/me"), stagingEnv()),
    );
    const next = await handler(apiRequest("/v1/me"), stagingEnv());

    await expectAnswer(refused, 503, UNAVAILABLE);
    expect(next.status).toBe(200);
    expect(build).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      { level: "error", event: "api_config_refused", environment: "staging", error: "Error" },
    ]);
    expect(JSON.stringify(lines)).not.toContain(DEV_ISSUER);
  });

  it("answers 500 when the app throws, logging the error's label and never its message", async () => {
    const handler = createApiHandler(() => ({
      fetch: async () => {
        throw failedQueryFixture();
      },
    }));

    const { result: response, lines } = await consoleLinesDuring(() =>
      handler(apiRequest("/v1/me"), stagingEnv()),
    );

    await expectAnswer(response, 500, INTERNAL);
    expect(lines).toEqual([
      {
        level: "error",
        event: "api_request_failed",
        environment: "staging",
        error: FAILED_QUERY_LABEL,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(FAILED_QUERY_WORDS);
  });
});

// The real app, as staging builds it, driven with requests that never need a database or a
// network: any call to `fetch` would be a JWKS or Clerk request leaving the test.
describe("the API as staging serves it", () => {
  let network: Mock<typeof fetch>;

  beforeEach(() => {
    network = vi.fn<typeof fetch>().mockRejectedValue(new Error("no network in tests"));
    vi.stubGlobal("fetch", network);
  });

  function staging(): {
    readonly env: PilotEnv;
    readonly writes: FakeWriteLimiters;
    reads(): number;
  } {
    const database = untouchedDatabase();
    const writes = fakeWriteLimiters();
    return {
      env: stagingEnv({ HYPERDRIVE: database.binding, ACCOUNT_WRITE_LIMITER: writes.namespace }),
      writes,
      reads: database.reads,
    };
  }

  it("answers 401 to a request without a token, or with one that is not a token", async () => {
    const { env, reads } = staging();
    const handler = createApiHandler();

    await expectAnswer(await handler(apiRequest("/v1/me"), env), 401, UNAUTHENTICATED);
    await expectAnswer(
      await handler(
        apiRequest("/v1/me", { headers: { authorization: "Bearer not-a-token" } }),
        env,
      ),
      401,
      UNAUTHENTICATED,
    );
    expect(network).not.toHaveBeenCalled();
    expect(reads()).toBe(0);
  });

  // No browser client exists: a request carrying Origin is refused before Clerk's keys are fetched,
  // however well formed its token is.
  it("answers 401 to a well-formed token sent with an Origin, without fetching Clerk's keys", async () => {
    const { env, reads } = staging();

    const response = await createApiHandler()(
      apiRequest("/v1/me", {
        headers: { authorization: `Bearer ${WELL_FORMED_TOKEN}`, origin: "https://example.com" },
      }),
      env,
    );

    await expectAnswer(response, 401, UNAUTHENTICATED);
    expect(network).not.toHaveBeenCalled();
    expect(reads()).toBe(0);
  });

  // The control for the test above: without Origin the same token does reach for Clerk's keys, so
  // the 401 there is the Origin refusal and not the token's shape.
  it("reaches for Clerk's keys for the same token sent without an Origin", async () => {
    const { env, reads } = staging();

    const { result: response } = await consoleLinesDuring(() =>
      createApiHandler()(
        apiRequest("/v1/me", { headers: { authorization: `Bearer ${WELL_FORMED_TOKEN}` } }),
        env,
      ),
    );

    await expectAnswer(response, 503, UNAVAILABLE);
    expect(network).toHaveBeenCalledOnce();
    expect(String(network.mock.calls[0]?.[0])).toBe(`${DEV_ISSUER}/.well-known/jwks.json`);
    expect(reads()).toBe(0);
  });

  it("serves no CORS: OPTIONS is 404 and no Access-Control- header is sent", async () => {
    const { env } = staging();

    const response = await createApiHandler()(
      apiRequest("/v1/me", {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "GET" },
      }),
      env,
    );

    await expectAnswer(response, 404, NOT_FOUND);
    expect(
      [...response.headers.keys()].filter((name) => name.startsWith("access-control-")),
    ).toEqual([]);
  });

  it("answers 404 to HEAD and to a path it does not serve", async () => {
    const { env } = staging();
    const handler = createApiHandler();

    const head = await handler(apiRequest("/v1/me", { method: "HEAD" }), env);
    expect(head.status).toBe(404);
    expect(head.headers.get("cache-control")).toBe("no-store");
    await expectAnswer(await handler(apiRequest("/v1/nope"), env), 404, NOT_FOUND);
  });

  // 404 would mean the writes, or creating a family, were not mounted.
  it.each(["/v1/me/provision", "/v1/families"])(
    "mounts POST %s: 401 without a token, before the write limit or the database",
    async (path) => {
      const { env, writes, reads } = staging();

      const response = await createApiHandler()(apiRequest(path, { method: "POST" }), env);

      await expectAnswer(response, 401, UNAUTHENTICATED);
      expect(writes.admit).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
      expect(reads()).toBe(0);
    },
  );

  it("serves reads only on a laptop without a Clerk secret key: a write is 404", async () => {
    const database = untouchedDatabase();
    const laptop: PilotEnv = {
      ...testEnv,
      CLERK_SECRET_KEY: undefined,
      API_IP_LIMIT: fakeLimiter(),
      ACCOUNT_WRITE_LIMITER: fakeWriteLimiters().namespace,
      HYPERDRIVE: database.binding,
    };
    const handler = createApiHandler();

    await expectAnswer(
      await handler(apiRequest("/v1/me/provision", { method: "POST" }), laptop),
      404,
      NOT_FOUND,
    );
    await expectAnswer(await handler(apiRequest("/v1/me"), laptop), 401, UNAUTHENTICATED);
    expect(database.reads()).toBe(0);
  });

  it("builds with the configuration buildApiApp is handed", async () => {
    const { env } = staging();
    const build = vi.fn<Build>(buildApiApp);

    await createApiHandler(build)(apiRequest("/v1/me"), env);

    expect(build).toHaveBeenCalledExactlyOnceWith(env, STAGING_CONFIG);
  });
});

// What `buildApiApp` hands `createApiApp`, looked at directly: the requests above stop at
// authentication, and a write that reaches the limit, the nudges or the database needs a token
// Clerk signed.
describe("the runtime staging's API app runs on", () => {
  let network: Mock<typeof fetch>;

  beforeEach(() => {
    network = vi.fn<typeof fetch>().mockRejectedValue(new Error("no network in tests"));
    vi.stubGlobal("fetch", network);
  });

  function writesOf(runtime: ApiRuntime): NonNullable<ApiRuntime["writes"]> {
    if (runtime.writes === undefined) {
      throw new Error("the runtime serves no writes");
    }
    return runtime.writes;
  }

  const identity: SessionIdentity = { authSubject: "user_x", sessionId: "sess_x" };

  it("refuses a write over the account's limit, asking the account's own object, without calling Clerk", async () => {
    const writes = fakeWriteLimiters(false);
    const runtime = apiRuntimeFor(
      stagingEnv({ ACCOUNT_WRITE_LIMITER: writes.namespace }),
      STAGING_CONFIG,
    );

    const refusal = await writesOf(runtime)
      .verifyActiveSession(identity)
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({ name: "ApiIdempotencyError", code: "rate_limited" });
    expect(writes.names).toEqual(["user_x"]);
    expect(writes.admit).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
  });

  it("asks Clerk about the session with the environment's key, within the account's limit", async () => {
    const writes = fakeWriteLimiters();
    const runtime = apiRuntimeFor(
      stagingEnv({ ACCOUNT_WRITE_LIMITER: writes.namespace }),
      STAGING_CONFIG,
    );

    await expect(writesOf(runtime).verifyActiveSession(identity)).rejects.toMatchObject({
      name: "SessionVerificationUnavailable",
    });

    expect(writes.names).toEqual(["user_x"]);
    expect(writes.admit).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledOnce();
    const [url, init] = network.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.clerk.com/v1/sessions/sess_x");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TEST_KEY}`);
  });

  it("serves every write, creates families with the bot and regions, and nudges the queue", async () => {
    const send = vi.fn(async () => {});
    const runtime = apiRuntimeFor(
      stagingEnv({ OUTBOUND_QUEUE: { send } as unknown as PilotEnv["OUTBOUND_QUEUE"] }),
      STAGING_CONFIG,
    );

    await writesOf(runtime).nudges?.deliver("o1");

    expect(runtime.services).toBe(API_READ_SERVICES);
    expect(writesOf(runtime).services).toBe(API_WRITE_SERVICES);
    expect(writesOf(runtime).families).toEqual({
      random: expect.anything(),
      config: { telegramBotUsername: "VelaStagingBot", regions: ["apac"] },
    });
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "deliver", outboundId: "o1" });
  });

  it("opens the database through the environment's Hyperdrive", async () => {
    const database = untouchedDatabase();
    const runtime = apiRuntimeFor(stagingEnv({ HYPERDRIVE: database.binding }), STAGING_CONFIG);

    await expect(runtime.openDatabase()).rejects.toThrow("the test opened a database");
    expect(database.reads()).toBe(1);
  });

  it("serves no writes on a laptop without a secret key", () => {
    const laptop: ApiConfig = { ...STAGING_CONFIG, environment: "development", secretKey: null };

    expect(apiRuntimeFor(testEnv, laptop).writes).toBeUndefined();
  });
});

describe("what a committed write leaves behind", () => {
  it("hands each outbound row to this environment's outbound queue as a delivery", async () => {
    const send = vi.fn(async () => {});
    const nudges = createApiNudges({
      OUTBOUND_QUEUE: { send } as unknown as PilotEnv["OUTBOUND_QUEUE"],
      MEMBER_SCHEDULER: testEnv.MEMBER_SCHEDULER,
    });

    await nudges.deliver("o1");

    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "deliver", outboundId: "o1" });
  });

  it("wakes the member's own scheduler object", async () => {
    const steps: string[] = [];
    const wakeAt = vi.fn(async () => {});
    const namespace = {
      idFromName: (name: string) => {
        steps.push(`idFromName ${name}`);
        return `id:${name}`;
      },
      get: (id: string) => {
        steps.push(`get ${id}`);
        return { wakeAt };
      },
    } as unknown as PilotEnv["MEMBER_SCHEDULER"];
    const at = new Date("2026-09-25T00:00:00.000Z");

    await createApiNudges({
      OUTBOUND_QUEUE: testEnv.OUTBOUND_QUEUE,
      MEMBER_SCHEDULER: namespace,
    }).wake("m1", at);

    expect(steps).toEqual(["idFromName m1", "get id:m1"]);
    expect(wakeAt).toHaveBeenCalledExactlyOnceWith("m1", at);
  });
});

describe("the per-account write limit", () => {
  const NOW = new Date("2026-09-26T00:00:00.000Z");
  const USER = {
    id: "0199a000-0000-7000-8000-000000000001",
    display_name: "Synthetic user",
    language: "en",
    tz: "Asia/Taipei",
  } as const;

  /** Asks `verify` for `identity` `count` times in turn, and returns what each answered or threw. */
  async function outcomes(
    verify: SessionActivityChecker,
    identity: SessionIdentity,
    count: number,
  ): Promise<unknown[]> {
    const answers: unknown[] = [];
    for (let i = 0; i < count; i += 1) {
      answers.push(
        await verify(identity).catch((error: unknown) =>
          error instanceof ApiIdempotencyError ? error.code : error,
        ),
      );
    }
    return answers;
  }

  // The limit that matters: the real object, as a deployed Worker reaches it.
  it("admits an account's first 20 writes in a minute and refuses the rest before the live check calls Clerk, logging nothing", async () => {
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);
    const logs: LogLine[] = [];
    const verify = limitWrites(realWriteLimiters(), check, recordingLogger(logs));

    const answers = await outcomes(verify, freshIdentity(), 23);

    expect(answers).toEqual([...Array<boolean>(20).fill(true), ...Array(3).fill("rate_limited")]);
    expect(check).toHaveBeenCalledTimes(20);
    expect(logs).toEqual([]);
  });

  it.each([true, false])("answers with the live check's %s within the limit", async (active) => {
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(active);
    const identity = freshIdentity();

    await expect(
      limitWrites(realWriteLimiters(), check, recordingLogger([]))(identity),
    ).resolves.toBe(active);
    expect(check).toHaveBeenCalledExactlyOnceWith(identity);
  });

  it("counts each account alone", async () => {
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);
    const verify = limitWrites(realWriteLimiters(), check, recordingLogger([]));
    const spent = freshIdentity();
    await outcomes(verify, spent, 20);

    expect(await outcomes(verify, spent, 1)).toEqual(["rate_limited"]);
    expect(await outcomes(verify, freshIdentity(), 1)).toEqual([true]);
  });

  // An account flooding its own object until Cloudflare reports it overloaded must not lift its own
  // limit: the write is closed, as it is when Clerk cannot answer the live check.
  it("closes the write when the limiter cannot answer: unavailable, without the live check, logging the label only", async () => {
    const failure = new Error("Durable Object is overloaded. Too many requests queued.");
    failure.name = "DurableObjectOverloaded";
    const writes = fakeWriteLimiters();
    writes.admit.mockRejectedValue(failure);
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);
    const logs: LogLine[] = [];
    const identity = freshIdentity();

    const refusal = await limitWrites(
      writes.namespace,
      check,
      recordingLogger(logs),
    )(identity).catch((error: unknown) => error);

    expect(refusal).toMatchObject({ name: "ApiIdempotencyError", code: "unavailable" });
    expect(check).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        level: "error",
        event: "api_rate_limit_failed",
        fields: { scope: "writes", error: "DurableObjectOverloaded" },
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(identity.authSubject);
  });

  it("closes the write when the account's object cannot even be named", async () => {
    const broken = {
      idFromName: () => {
        throw new TypeError("the namespace is unavailable");
      },
    } as unknown as WriteLimiters;
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);
    const logs: LogLine[] = [];

    const refusal = await limitWrites(
      broken,
      check,
      recordingLogger(logs),
    )(freshIdentity()).catch((error: unknown) => error);

    expect(refusal).toMatchObject({ name: "ApiIdempotencyError", code: "unavailable" });
    expect(check).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        level: "error",
        event: "api_rate_limit_failed",
        fields: { scope: "writes", error: "TypeError" },
      },
    ]);
  });

  it("limits nothing where no limiter is bound, which only development may be", async () => {
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);

    const answers = await outcomes(
      limitWrites(undefined, check, recordingLogger([])),
      freshIdentity(),
      25,
    );

    expect(answers).toEqual(Array<boolean>(25).fill(true));
  });

  /** The API app with its writes behind the real limit, and fakes for Clerk and the database. */
  function limitedApp(identity: SessionIdentity) {
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);
    const close = vi.fn(async () => {});
    const openDatabase = vi.fn<ApiRuntime["openDatabase"]>().mockResolvedValue({
      db: {} as Awaited<ReturnType<ApiRuntime["openDatabase"]>>["db"],
      close,
    });
    const provision = vi
      .fn<ApiWriteServices["provisionApiAccount"]>()
      .mockResolvedValue({ response: { status: 200, body: USER }, replayed: false });
    const logger = { error: vi.fn<ApiRuntime["logger"]["error"]>() };
    const app = createApiApp({
      verifySession: async () => identity,
      now: () => NOW,
      openDatabase,
      services: API_READ_SERVICES,
      logger,
      writes: {
        verifyActiveSession: limitWrites(realWriteLimiters(), check, logger),
        clock: { now: () => NOW },
        services: { ...API_WRITE_SERVICES, provisionApiAccount: provision },
      },
    });
    let sent = 0;
    async function provisionWith(body: unknown): Promise<Response> {
      sent += 1;
      return app.request("https://vela.vela-light-staging.workers.dev/v1/me/provision", {
        method: "POST",
        headers: {
          authorization: "Bearer good",
          "content-type": "application/json",
          "idempotency-key": `request-${sent}`,
        },
        body: JSON.stringify(body),
      });
    }
    return { check, openDatabase, provision, logger, provisionWith };
  }

  const PROFILE = { display_name: "Synthetic user", language: "en", tz: "Asia/Taipei" };

  it("answers an account's 21st write in a minute with 429 through the API app, with no Retry-After, before Clerk and the database", async () => {
    const f = limitedApp(freshIdentity());

    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      statuses.push((await f.provisionWith(PROFILE)).status);
    }
    const refused = await f.provisionWith(PROFILE);

    expect(statuses).toEqual(Array<number>(20).fill(200));
    await expectAnswer(refused, 429, RATE_LIMITED);
    expect(refused.headers.get("retry-after")).toBeNull();
    expect(f.check).toHaveBeenCalledTimes(20);
    expect(f.openDatabase).toHaveBeenCalledTimes(20);
    expect(f.provision).toHaveBeenCalledTimes(20);
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  // The body is validated before the limit, so a malformed write spends none of the allowance.
  it("counts no write whose body is refused", async () => {
    const f = limitedApp(freshIdentity());

    const malformed: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      malformed.push((await f.provisionWith({ display_name: 42 })).status);
    }
    const valid: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      valid.push((await f.provisionWith(PROFILE)).status);
    }

    expect(malformed).toEqual(Array<number>(5).fill(400));
    expect(valid).toEqual([...Array<number>(20).fill(200), 429]);
  });

  it("answers 503 through the API app when the limiter cannot answer, before Clerk and the database", async () => {
    const failure = new Error("Durable Object is overloaded. Too many requests queued.");
    failure.name = "DurableObjectOverloaded";
    const writes = fakeWriteLimiters();
    writes.admit.mockRejectedValue(failure);
    const check = vi.fn<SessionActivityChecker>().mockResolvedValue(true);
    const openDatabase = vi.fn<ApiRuntime["openDatabase"]>();
    const logs: LogLine[] = [];
    const logger = recordingLogger(logs);
    const app = createApiApp({
      verifySession: async () => freshIdentity(),
      now: () => NOW,
      openDatabase,
      services: API_READ_SERVICES,
      logger,
      writes: {
        verifyActiveSession: limitWrites(writes.namespace, check, logger),
        clock: { now: () => NOW },
        services: API_WRITE_SERVICES,
      },
    });

    const response = await app.request(
      "https://vela.vela-light-staging.workers.dev/v1/me/provision",
      {
        method: "POST",
        headers: {
          authorization: "Bearer good",
          "content-type": "application/json",
          "idempotency-key": "request-1",
        },
        body: JSON.stringify(PROFILE),
      },
    );

    await expectAnswer(response, 503, UNAVAILABLE);
    expect(check).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        level: "error",
        event: "api_rate_limit_failed",
        fields: { scope: "writes", error: "DurableObjectOverloaded" },
      },
      {
        level: "error",
        event: "api_request_failed",
        fields: { error: "ApiIdempotencyError:unavailable" },
      },
    ]);
  });
});
