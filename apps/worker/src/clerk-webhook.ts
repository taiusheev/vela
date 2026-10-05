/** Verified account deletion is independent of Telegram, AI and family onboarding configuration. */
import { connectDatabase, type VelaDatabase } from "@vela/db";
import { type Clock, disableApiAccount, errorLabel, type Logger } from "@vela/services";
import { readClerkWebhookSigningSecret, secret } from "./config.ts";
import { createLogger } from "./deps.ts";
import type { PilotEnv } from "./env.ts";

export const MAX_CLERK_WEBHOOK_BYTES = 128 * 1024;
export const CLERK_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface ClerkWebhookRuntime {
  readonly clock: Clock;
  readonly disableAccount: typeof disableApiAccount;
  openDatabase(env: PilotEnv): Promise<{ db: VelaDatabase; close(): Promise<void> }>;
  logger(env: PilotEnv): Pick<Logger, "error">;
}

export type ClerkWebhookHandler = (request: Request, env: PilotEnv) => Promise<Response>;

const runtime: ClerkWebhookRuntime = {
  clock: { now: () => new Date() },
  disableAccount: disableApiAccount,
  openDatabase: (env) =>
    connectDatabase(env.HYPERDRIVE.connectionString, secret(env, "CONTENT_KEY_V1")),
  logger: createLogger,
};

function answer(status: number, error?: string): Response {
  return Response.json(error === undefined ? { ok: true } : { error }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function signatureBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
    const decoded = atob(value);
    return decoded.length === 32
      ? Uint8Array.from(decoded, (character) => character.charCodeAt(0))
      : null;
  } catch {
    return null;
  }
}

/** The exact Svix HMAC input is id.timestamp.raw-body, including unchanged JSON whitespace. */
export async function verifyClerkWebhook(
  headers: Headers,
  body: Uint8Array<ArrayBuffer>,
  key: Uint8Array<ArrayBuffer>,
  now: Date,
): Promise<boolean> {
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const signatures = headers.get("svix-signature") ?? "";
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
    !/^[0-9]{1,12}$/.test(timestamp) ||
    signatures.length === 0 ||
    signatures.length > 4096 ||
    !Number.isFinite(now.getTime())
  )
    return false;
  const seconds = Number(timestamp);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(now.getTime() / 1000 - seconds) > CLERK_WEBHOOK_TOLERANCE_SECONDS
  )
    return false;
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, signed));
  let valid = 0;
  for (const signature of signatures.split(/\s+/)) {
    if (!signature.startsWith("v1,")) continue;
    const supplied = signatureBytes(signature.slice(3));
    if (supplied !== null) valid |= Number(equalBytes(expected, supplied));
  }
  return valid !== 0;
}

async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer> | 400 | 413> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    return 400;
  if (declared !== null && Number(declared) > MAX_CLERK_WEBHOOK_BYTES) return 413;
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_CLERK_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return 400;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createClerkWebhookHandler(
  ports: ClerkWebhookRuntime = runtime,
): ClerkWebhookHandler {
  return async (request, env) => {
    if (request.method !== "POST") return answer(405, "method_not_allowed");
    const logger = ports.logger(env);
    let key: Uint8Array<ArrayBuffer>;
    try {
      key = readClerkWebhookSigningSecret(env);
    } catch (error) {
      logger.error("clerk_webhook_config_refused", { error: errorLabel(error) });
      return answer(503, "unavailable");
    }
    const body = await readBody(request);
    if (typeof body === "number") return answer(body, body === 413 ? "too_large" : "invalid");
    try {
      if (!(await verifyClerkWebhook(request.headers, body, key, ports.clock.now())))
        return answer(401, "unauthorized");
      let event: Record<string, unknown> | null;
      try {
        event = record(
          JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body)),
        );
      } catch {
        return answer(400, "invalid");
      }
      if (event?.object !== "event" || typeof event.type !== "string" || event.type.length > 128)
        return answer(400, "invalid");
      // Bans can be lifted and locks expire: user.updated never creates a permanent tombstone.
      if (event.type !== "user.deleted") return answer(200);
      const data = record(event.data);
      if (
        data?.object !== "user" ||
        data.deleted !== true ||
        typeof data.id !== "string" ||
        !/^user_[A-Za-z0-9_-]{1,128}$/.test(data.id)
      )
        return answer(400, "invalid");
      const handle = await ports.openDatabase(env);
      try {
        await ports.disableAccount({ db: handle.db, clock: ports.clock }, data.id);
      } finally {
        try {
          await handle.close();
        } catch (error) {
          logger.error("clerk_webhook_close_failed", { error: errorLabel(error) });
        }
      }
      return answer(200);
    } catch (error) {
      logger.error("clerk_webhook_failed", { error: errorLabel(error) });
      return answer(500, "unavailable");
    }
  };
}
