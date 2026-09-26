/**
 * The API under /v1 on the pilot Worker (ADR-29): the handler `createWorker` hands `/v1` and every
 * path under it to, before the pilot's own routes. It checks its own configuration
 * (`readApiConfig`) and never builds the pilot's deps, so a Clerk setting the API cannot run with
 * leaves the webhook, the notices, and `/healthz` answering, and an unfilled notice or a missing
 * Telegram secret leaves /v1 answering.
 *
 * Each request meets, in this order: the configuration check (503 `unavailable` when it refuses),
 * the off switch (404 `not_found`), the per-address limit (429 `rate_limited`), then the app, built
 * once per isolate and kept. The per-account write limit runs inside the app, after authentication
 * and the body's validation and before the live session check calls Clerk (`limitWrites`). The
 * address limit is a Workers Rate Limiting binding and best effort: on staging it was never shown
 * to refuse anything. The write limit is counted in a Durable Object per account
 * (`write-limit.ts`), which does.
 *
 * Photos from the app (ADR-33) are kept in the same media store the pilot Worker copies voice notes
 * into, `MEDIA_STORAGE`'s: a store that cannot be built leaves /v1 answering, with photos off.
 *
 * The lines this file logs are event names and error labels only: `api_config_refused`,
 * `api_rate_limit_failed`, and `api_request_failed`. A 4xx is never logged, and neither is a token,
 * an address, a body, a key, or any configured value.
 */
import type { ApiErrorBody } from "@vela/contracts";
import { connectDatabase } from "@vela/db";
import {
  ApiIdempotencyError,
  type ApiNudges,
  authorizeFamilyAccess,
  composeApiAsk,
  createApiFamily,
  errorLabel,
  type Logger,
  leaveApiFamily,
  loadApiExchanges,
  loadApiFamily,
  loadApiFamilyPlan,
  loadApiLights,
  loadApiMe,
  loadApiQuiet,
  loadApiToday,
  pauseApiMember,
  provisionApiAccount,
  readApiMedia,
  replyToApiExchange,
  resolveApiQuiet,
  startApiTrial,
  updateApiAccount,
  uploadApiMedia,
} from "@vela/services";
import {
  type ApiReadServices,
  type ApiRuntime,
  type ApiWriteServices,
  createApiApp,
} from "./api-app.ts";
import { type ApiConfig, readApiConfig } from "./config.ts";
import { createLogger, createMediaPort, createSchedulerPort } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import { createRandom } from "./random.ts";
import {
  createClerkSessionActivityChecker,
  createClerkSessionVerifier,
  type SessionActivityChecker,
} from "./session.ts";
import { type AccountWriteLimiter, writeLimiterOf } from "./write-limit.ts";

/** What `PilotRuntime.api` is: one request under /v1 in, its answer out. */
export type ApiHandler = (request: Request, env: PilotEnv) => Promise<Response>;

/** The API app as the handler uses it; `createApiApp` returns one. */
export interface ApiApp {
  fetch(request: Request): Response | Promise<Response>;
}

/**
 * The reads the API serves: the same list `scripts/api-dev.ts` serves on a laptop. A service added
 * to `ApiReadServices` fails `tsc` here until it is added to this list as well.
 */
export const API_READ_SERVICES: ApiReadServices = {
  loadApiMe,
  loadApiFamilyPlan,
  loadApiLights,
  loadApiToday,
  loadApiFamily,
  loadApiExchanges,
  loadApiQuiet,
  authorizeFamilyAccess,
  readApiMedia,
};

/**
 * The writes the API serves: the same list `scripts/api-dev.ts` serves on a laptop. A service
 * added to `ApiWriteServices` fails `tsc` here until it is added to this list as well.
 */
export const API_WRITE_SERVICES: ApiWriteServices = {
  provisionApiAccount,
  updateApiAccount,
  composeApiAsk,
  replyToApiExchange,
  createApiFamily,
  resolveApiQuiet,
  pauseApiMember,
  leaveApiFamily,
  startApiTrial,
  uploadApiMedia,
};

/**
 * The address limit: every request per client address (per /64 for IPv6), after the config check
 * and off switch, before the app. A Workers Rate Limiting binding, as each environment that serves
 * the API declares it in wrangler.jsonc; src/wrangler-config.test.ts holds the file to this.
 * Cloudflare counts per location, so the limit is approximate at best, and on staging's workers.dev
 * host, 355 requests from one address in about two minutes were all admitted (25 September 2026).
 * It is kept as a best effort in front of the app; what bounds each account is `limitWrites`.
 */
export const API_ADDRESS_LIMIT = {
  name: "API_IP_LIMIT",
  namespace_id: "1001",
  simple: { limit: 120, period: 60 },
} as const;

// The API app's own error bodies (`api-app.ts`), copied rather than imported, since that module
// keeps them to itself: an answer made here reads exactly like one of the app's.
const NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Not found." },
};
const RATE_LIMITED: ApiErrorBody = {
  error: { code: "rate_limited", message: "Too many requests." },
};
const UNAVAILABLE: ApiErrorBody = {
  error: { code: "unavailable", message: "Service temporarily unavailable." },
};
const INTERNAL: ApiErrorBody = {
  error: { code: "internal", message: "Internal server error." },
};

function answer(
  body: ApiErrorBody,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/**
 * Whether the address limiter admits one more request from `address`. One that fails is skipped
 * rather than closing the API, and the failure is logged by its label, never with the address:
 * authentication and, for a write, the per-account limit still stand behind it. No limiter at all is
 * development's, since `readApiConfig` refuses a deployed environment without one.
 */
async function addressAdmitted(
  limiter: RateLimit | undefined,
  address: string,
  logger: Pick<Logger, "error">,
): Promise<boolean> {
  if (limiter === undefined) {
    return true;
  }
  try {
    const { success } = await limiter.limit({ key: address });
    return success;
  } catch (error) {
    logger.error("api_rate_limit_failed", { scope: "address", error: errorLabel(error) });
    return true;
  }
}

/**
 * What the address limit counts a request under: the address Cloudflare saw it come from, or, for
 * IPv6, that address's /64. One subscriber holds a whole /64 (a phone on a mobile network, a home,
 * a cloud host), and could take a fresh count for every request by changing its low 64 bits. An
 * IPv4 address, written inside IPv6 or not, is counted alone, and every request without an address
 * shares one count.
 */
function addressOf(request: Request): string {
  const address = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (address === "") {
    return "unknown";
  }
  return address.includes(":") && !address.includes(".") ? ipv6NetworkOf(address) : address;
}

/** An IPv6 address's /64, written one way for every address in it: `2001:db8:1:2::/64`. */
function ipv6NetworkOf(address: string): string {
  const [head = "", tail = ""] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const zeros = Math.max(0, 8 - left.length - right.length);
  const groups = address.includes("::")
    ? [...left, ...Array<string>(zeros).fill("0"), ...right]
    : left;
  const network = groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":");
  return `${network}::/64`;
}

/**
 * What a committed write left behind, carried out at once: its outbound rows go to this
 * environment's outbound queue, which this Worker's own consumer delivers, and its wakes to the
 * member's `MemberScheduler`. A failure is logged by the API app and `reconcile` re-drives it.
 */
export function createApiNudges(
  env: Pick<PilotEnv, "OUTBOUND_QUEUE" | "MEMBER_SCHEDULER">,
): ApiNudges {
  const scheduler = createSchedulerPort(env);
  return {
    async deliver(outboundId) {
      await env.OUTBOUND_QUEUE.send({ type: "deliver", outboundId });
    },
    wake: (memberId, at) => scheduler.wakeAt(memberId, at),
  };
}

/**
 * The live session check, behind the per-account write limit (`write-limit.ts`). It runs where the
 * check does: after authentication and the body's validation, so the account is a verified one and
 * a malformed body spends none of its allowance, and before the call to Clerk, so a caller over the
 * limit spends none of Clerk's quota and opens no database connection. Over it, the write answers
 * 429 `rate_limited` through the API app's own mapping of `ApiIdempotencyError`, and nothing is
 * logged.
 *
 * A limiter that cannot answer closes the write, unlike the address limit: an account that floods
 * its own object until Cloudflare reports it overloaded would otherwise lift its own limit. The
 * write answers 503 `unavailable`, as it does when Clerk cannot answer the live check, and the
 * failure is logged by its label, never with the subject. No limiter at all is development's, since
 * `readApiConfig` refuses a deployed environment without one.
 */
export function limitWrites(
  limiters: DurableObjectNamespace<AccountWriteLimiter> | undefined,
  check: SessionActivityChecker,
  logger: Pick<Logger, "error">,
): SessionActivityChecker {
  return async (identity) => {
    if (limiters !== undefined) {
      let admitted: boolean;
      try {
        admitted = await writeLimiterOf(limiters, identity.authSubject).admit();
      } catch (error) {
        logger.error("api_rate_limit_failed", { scope: "writes", error: errorLabel(error) });
        throw new ApiIdempotencyError("unavailable");
      }
      if (!admitted) {
        throw new ApiIdempotencyError("rate_limited");
      }
    }
    return check(identity);
  };
}

/**
 * What the API app runs on in the pilot Worker. Sessions are verified against the environment's
 * Clerk instance with no authorized parties and the native-client opt-in: the app on a phone sends
 * no `Origin` and its tokens carry no `azp`, so they pass, while a request carrying `Origin`, or a
 * token carrying `azp`, is refused, since an empty list holds neither. No browser client exists;
 * one would need its own ADR, its origin listed, and CORS. Each request that passes authentication
 * opens one connection through Hyperdrive, which the app closes before it answers. Writes are
 * served only with Clerk's secret key, which every deployed environment requires.
 */
export function apiRuntimeFor(env: PilotEnv, config: ApiConfig): ApiRuntime {
  const logger = createLogger(env);
  const { secretKey } = config;
  const photos = apiMediaFor(env, config, logger);
  return {
    ...photos,
    verifySession: createClerkSessionVerifier({
      issuer: config.issuer,
      authorizedParties: [],
      allowMissingAuthorizedParty: true,
      allowLocalHttpParties: false,
    }),
    now: () => new Date(),
    openDatabase: async () => connectDatabase(env.HYPERDRIVE.connectionString),
    services: API_READ_SERVICES,
    logger,
    ...(secretKey === null
      ? {}
      : {
          writes: {
            verifyActiveSession: limitWrites(
              env.ACCOUNT_WRITE_LIMITER,
              createClerkSessionActivityChecker({ secretKey }),
              logger,
            ),
            clock: { now: () => new Date() },
            services: API_WRITE_SERVICES,
            families: {
              random: createRandom(),
              config: { telegramBotUsername: config.telegramBotUsername, regions: config.regions },
            },
            nudges: createApiNudges(env),
          },
        }),
  };
}

/**
 * Where the API keeps photos from the app (ADR-33): the store `MEDIA_STORAGE` names, built as the
 * pilot Worker builds it (`createMediaPort`), with the Worker's CSPRNG for the keys an upload
 * mints. "off" builds none, and `createMediaPort` says so once per start (`media_storage_off`). A
 * store that cannot be built, such as "r2" with no bucket bound, is logged as `api_config_refused`
 * by its label and leaves photos off with `media_storage_unavailable`: the rest of /v1 answers as
 * before, since a photo setting is no reason to close the whole API (ADR-29's isolation).
 */
export function apiMediaFor(
  env: PilotEnv,
  config: ApiConfig,
  logger: Logger,
): Pick<ApiRuntime, "media" | "mediaOff"> {
  try {
    const store = createMediaPort(env, config.environment, "wrangler.jsonc", logger);
    return store === null
      ? { mediaOff: "media_storage_off" }
      : { media: { store, random: createRandom() } };
  } catch (error) {
    logger.error("api_config_refused", { error: errorLabel(error) });
    return { mediaOff: "media_storage_unavailable" };
  }
}

/** The API app as the pilot Worker serves it: `createApiApp` on `apiRuntimeFor`'s runtime. */
export function buildApiApp(env: PilotEnv, config: ApiConfig): ApiApp {
  return createApiApp(apiRuntimeFor(env, config));
}

/**
 * The handler `pilotRuntime.api` is. It keeps one app per isolate, as `createAccessVerifier` keeps
 * one key cache: the app's session verifier holds Clerk's keys for ten minutes, and an app built
 * for every request would fetch them for every request. The app is kept by value, not by `env`
 * object, whose bindings name the same resources on every request of an isolate; a changed issuer
 * or secret key, which arrives with a new deployment, builds it again. `build` is replaced only in
 * tests.
 */
export function createApiHandler(
  build: (env: PilotEnv, config: ApiConfig) => ApiApp = buildApiApp,
): ApiHandler {
  let kept: {
    readonly issuer: string;
    readonly secretKey: string | null;
    readonly app: ApiApp;
  } | null = null;

  function appFor(env: PilotEnv, config: ApiConfig): ApiApp {
    if (kept === null || kept.issuer !== config.issuer || kept.secretKey !== config.secretKey) {
      kept = { issuer: config.issuer, secretKey: config.secretKey, app: build(env, config) };
    }
    return kept.app;
  }

  return async (request, env) => {
    const logger = createLogger(env);
    let config: ApiConfig | null;
    try {
      config = readApiConfig(env);
    } catch (error) {
      logger.error("api_config_refused", { error: errorLabel(error) });
      return answer(UNAVAILABLE, 503);
    }
    if (config === null) {
      return answer(NOT_FOUND, 404);
    }
    if (!(await addressAdmitted(env.API_IP_LIMIT, addressOf(request), logger))) {
      return answer(RATE_LIMITED, 429, { "retry-after": String(API_ADDRESS_LIMIT.simple.period) });
    }
    let app: ApiApp;
    try {
      app = appFor(env, config);
    } catch (error) {
      // What the configuration check cannot see, such as an issuer the verifier refuses to build.
      logger.error("api_config_refused", { error: errorLabel(error) });
      return answer(UNAVAILABLE, 503);
    }
    try {
      return await app.fetch(request);
    } catch (error) {
      logger.error("api_request_failed", { error: errorLabel(error) });
      return answer(INTERNAL, 500);
    }
  };
}
