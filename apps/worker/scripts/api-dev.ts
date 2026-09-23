/**
 * The isolated API, served on this machine for the app to talk to:
 *
 *   pnpm --filter @vela/worker api:dev
 *
 * It is a development tool, not a deployment. Neither deployed Worker mounts the API (API contract
 * §1), and this script refuses anything but a local database and a development Clerk instance, so
 * it cannot be pointed at staging or production by accident. Writes stay off: it serves the reads
 * the app needs today.
 *
 * Needs, in apps/worker/.env.local or the environment:
 *   DATABASE_URL          a local Postgres, for example the one `pnpm --filter @vela/db dev-db` serves
 *   CLERK_ISSUER          the Clerk Frontend API URL, https://<something>.clerk.accounts.dev
 *   API_PORT              optional, 8787 by default
 */
import { serve } from "@hono/node-server";
import { connectDatabase } from "@vela/db";
import {
  authorizeFamilyAccess,
  errorLabel,
  loadApiFamilyPlan,
  loadApiLights,
  loadApiMe,
} from "@vela/services";
import { createApiApp } from "../src/api-app.ts";
import { createClerkSessionVerifier } from "../src/session.ts";

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
  services: { loadApiMe, loadApiFamilyPlan, loadApiLights, authorizeFamilyAccess },
  logger: { error: (event, fields) => console.error(`[api-dev] ${event}`, fields ?? {}) },
});

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (address) => {
  console.log(`[api-dev] the API is on http://127.0.0.1:${address.port}`);
  console.log(`[api-dev] verifying sessions against ${issuer}`);
  console.log("[api-dev] writes are off; reads are /v1/me, the family plan and the lights");
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
