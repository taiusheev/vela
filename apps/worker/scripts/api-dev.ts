/**
 * The isolated API, served on this machine for the app to talk to:
 *
 *   pnpm --filter @vela/worker api:dev
 *
 * It is a development tool, not a deployment. Neither deployed Worker mounts the API (API contract
 * §1), and this script refuses anything but a local database and a development Clerk instance, so
 * it cannot be pointed at staging or production by accident.
 *
 * Needs, in apps/worker/.env.local or the environment:
 *   DATABASE_URL          a local Postgres, for example the one `pnpm --filter @vela/db dev-db` serves
 *   CLERK_ISSUER          the Clerk Frontend API URL, https://<something>.clerk.accounts.dev
 *   API_PORT              optional, 8787 by default
 *   CLERK_SECRET_KEY      optional, and only a development key (sk_test_…). Without it the writes
 *                         answer 404, as they do on both deployed Workers; with it they are served,
 *                         because a write needs the live session check that only Clerk’s backend
 *                         can make, and nothing here weakens that check to do without one. This is
 *                         the only place a secret key may sit on a developer’s machine:
 *                         apps/worker/.env.local, which git ignores.
 *   TELEGRAM_BOT_USERNAME optional; with it, and with writes on, POST /v1/families is served too.
 */
import { serve } from "@hono/node-server";
import { connectDatabase } from "@vela/db";
import {
  authorizeFamilyAccess,
  composeApiAsk,
  createApiFamily,
  errorLabel,
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
  replyToApiExchange,
  resolveApiQuiet,
  startApiTrial,
  updateApiAccount,
} from "@vela/services";
import { createApiApp } from "../src/api-app.ts";
import { createRandom } from "../src/random.ts";
import { createClerkSessionActivityChecker, createClerkSessionVerifier } from "../src/session.ts";

const DEFAULT_PORT = 8787;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    console.error(`[api-dev] ${name} is not set. See infra/README.md, section 9a.`);
    process.exit(2);
  }
  return value.trim();
}

function localDatabase(url: string): string {
  const { hostname } = new URL(url);
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    console.error(
      `[api-dev] DATABASE_URL points at ${hostname}. This server only runs against a database on this machine.`,
    );
    process.exit(2);
  }
  return url;
}

function developmentIssuer(issuer: string): string {
  if (!issuer.startsWith("https://") || !issuer.includes(".clerk.accounts.dev")) {
    console.error(
      "[api-dev] CLERK_ISSUER must be a Clerk development Frontend API URL (https://….clerk.accounts.dev).",
    );
    process.exit(2);
  }
  return issuer.replace(/\/$/, "");
}

const databaseUrl = localDatabase(required("DATABASE_URL"));
const issuer = developmentIssuer(required("CLERK_ISSUER"));
const port = Number(process.env.API_PORT ?? DEFAULT_PORT);
const origins = [`http://localhost:${port}`, "http://localhost:8081", "http://127.0.0.1:8081"];

/**
 * A development key only. `sk_live_` belongs to the real instance whose accounts are real people,
 * and this server is not the place to hold one: it is refused rather than quietly turning writes
 * on against a credential nobody meant to use here.
 */
function developmentSecret(key: string): string {
  if (!key.startsWith("sk_test_")) {
    console.error(
      "[api-dev] CLERK_SECRET_KEY must be a development key (sk_test_…). Writes stay off.",
    );
    process.exit(2);
  }
  return key;
}

const given = process.env.CLERK_SECRET_KEY?.trim();
const secretKey = given === undefined || given.length === 0 ? undefined : developmentSecret(given);
const writesOn = secretKey !== undefined;
// The bot her invite link opens. On this machine that bot answers from its own deployment's
// database, not this one, so a link made here cannot be accepted there: `consent:dev` stands in for
// her yes (infra/README.md, section 9a).
const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim();

const connection = await connectDatabase(databaseUrl);
const app = createApiApp({
  // Expo's native builds send no Origin and no `azp`; the loopback origins above cover the web
  // preview. This is the development posture the contract describes, not the deployed one.
  verifySession: createClerkSessionVerifier({
    issuer,
    authorizedParties: origins,
    allowLocalHttpParties: true,
    allowMissingAuthorizedParty: true,
  }),
  now: () => new Date(),
  openDatabase: async () => ({ db: connection.db, close: async () => {} }),
  services: {
    loadApiMe,
    loadApiFamilyPlan,
    loadApiLights,
    loadApiToday,
    loadApiFamily,
    loadApiExchanges,
    loadApiQuiet,
    authorizeFamilyAccess,
  },
  logger: { error: (event, fields) => console.error(`[api-dev] ${event}`, fields ?? {}) },
  ...(writesOn && secretKey !== undefined
    ? {
        writes: {
          verifyActiveSession: createClerkSessionActivityChecker({ secretKey }),
          clock: { now: () => new Date() },
          services: {
            provisionApiAccount,
            updateApiAccount,
            composeApiAsk,
            replyToApiExchange,
            createApiFamily,
            resolveApiQuiet,
            pauseApiMember,
            leaveApiFamily,
            startApiTrial,
          },
          ...(botUsername === undefined || botUsername.length === 0
            ? {}
            : {
                families: {
                  random: createRandom(),
                  config: { telegramBotUsername: botUsername, regions: ["apac"] as const },
                },
              }),
        },
      }
    : {}),
});

/**
 * A browser calling this server from `expo start --web` is calling another origin, and would be
 * refused before the request arrived. The deployed API needs none of this, because the app on a
 * phone sends no Origin at all, so the allowance lives here and not in `createApiApp`: only the
 * loopback origins above, echoed one at a time rather than `*`, and no credentials, since the
 * session travels in the Authorization header.
 */
const ALLOWED_HEADERS = "authorization, content-type, accept, idempotency-key";

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin !== null && origins.includes(origin) ? origin : null;
}

async function handle(request: Request): Promise<Response> {
  const origin = allowedOrigin(request);
  if (request.method === "OPTIONS" && origin !== null) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
        "access-control-allow-headers": ALLOWED_HEADERS,
        "access-control-max-age": "600",
        vary: "origin",
      },
    });
  }
  const response = await app.fetch(request);
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", "idempotency-replayed");
  headers.append("vary", "origin");
  return new Response(response.body, { status: response.status, headers });
}

const server = serve({ fetch: handle, port, hostname: "127.0.0.1" }, (address) => {
  console.log(`[api-dev] the API is on http://127.0.0.1:${address.port}`);
  console.log(`[api-dev] verifying sessions against ${issuer}`);
  console.log(
    "[api-dev] reads: /v1/me, the family plan, the family, the lights, Today, Exchanges and the quiet notice",
  );
  console.log(
    writesOn
      ? `[api-dev] writes: the account routes, composing an ask, replying, settling a quiet morning (its messages wait for reconcile here), pausing and leaving, starting a trial${botUsername ? ", and creating a family" : ""}; sessions checked live with Clerk`
      : "[api-dev] writes answer 404: set CLERK_SECRET_KEY in apps/worker/.env.local to serve them",
  );
});

async function stop(): Promise<void> {
  server.close();
  await connection.close().catch((error: unknown) => {
    console.error(`[api-dev] ${errorLabel(error)}`);
  });
  process.exit(0);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
