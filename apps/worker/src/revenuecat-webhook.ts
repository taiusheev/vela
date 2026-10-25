/** Purchases of Vela Light reported by RevenueCat; off wherever its Authorization value is unset. */
import { connectDatabase, type VelaDatabase } from "@vela/db";
import {
  applyStoreEvent,
  type Clock,
  errorLabel,
  type Logger,
  type StoreEvent,
} from "@vela/services";
import { readRevenueCatWebhookAuth, secret } from "./config.ts";
import { createLogger } from "./deps.ts";
import type { PilotEnv } from "./env.ts";

export const MAX_REVENUECAT_WEBHOOK_BYTES = 64 * 1024;

export interface RevenueCatWebhookRuntime {
  readonly clock: Clock;
  readonly apply: typeof applyStoreEvent;
  openDatabase(env: PilotEnv): Promise<{ db: VelaDatabase; close(): Promise<void> }>;
  logger(env: PilotEnv): Pick<Logger, "error" | "info">;
}

export type RevenueCatWebhookHandler = (request: Request, env: PilotEnv) => Promise<Response>;

const runtime: RevenueCatWebhookRuntime = {
  clock: { now: () => new Date() },
  apply: applyStoreEvent,
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

/** Compares in time that does not depend on where two values first differ. */
function sameText(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1)
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function instant(value: unknown): Date | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? new Date(value)
    : null;
}

/**
 * RevenueCat's webhook body (`{ api_version, event }`) as the store event the services read, or
 * null when it is not one. Only the fields below are read; nothing else in the body is kept.
 */
export function storeEventOf(body: unknown): StoreEvent | null {
  const event = record(record(body)?.event);
  if (event === null) return null;
  const id = text(event.id);
  const type = text(event.type, 64);
  const appUserId = text(event.app_user_id);
  if (id === null || type === null || appUserId === null) return null;
  const member = record(record(event.subscriber_attributes)?.vela_member_id);
  const price = event.price_in_purchased_currency;
  return {
    id,
    type,
    appUserId,
    memberId: text(member?.value, 64),
    expiresAt: instant(event.expiration_at_ms),
    graceUntil: instant(event.grace_period_expiration_at_ms),
    periodType: text(event.period_type, 32),
    productId: text(event.product_id, 128),
    price: typeof price === "number" && Number.isFinite(price) ? price : null,
    currency: text(event.currency, 8),
    originalTransactionId: text(event.original_transaction_id, 128),
  };
}

async function readBody(request: Request): Promise<string | 400 | 413> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    return 400;
  if (declared !== null && Number(declared) > MAX_REVENUECAT_WEBHOOK_BYTES) return 413;
  if (request.body === null) return 400;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_REVENUECAT_WEBHOOK_BYTES) {
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
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return 400;
  }
}

/**
 * `POST /webhooks/revenuecat` (API contract, webhooks). The Authorization header is checked before
 * the body is read. A wrong value is 401; an unset one is 503, so the switch stays off until the
 * founder sets it. Every well-formed event is answered 200, applied or not, so RevenueCat stops
 * retrying; only a failure to reach the database is 500, which RevenueCat retries.
 */
export function createRevenueCatWebhookHandler(
  ports: RevenueCatWebhookRuntime = runtime,
): RevenueCatWebhookHandler {
  return async (request, env) => {
    if (request.method !== "POST") return answer(405, "method_not_allowed");
    const logger = ports.logger(env);
    let expected: string;
    try {
      expected = readRevenueCatWebhookAuth(env);
    } catch (error) {
      logger.error("revenuecat_webhook_config_refused", { error: errorLabel(error) });
      return answer(503, "unavailable");
    }
    if (!sameText(request.headers.get("authorization") ?? "", expected))
      return answer(401, "unauthorized");
    const body = await readBody(request);
    if (typeof body === "number") return answer(body, body === 413 ? "too_large" : "invalid");
    let event: StoreEvent | null;
    try {
      event = storeEventOf(JSON.parse(body));
    } catch {
      return answer(400, "invalid");
    }
    if (event === null) return answer(400, "invalid");
    try {
      const handle = await ports.openDatabase(env);
      try {
        const outcome = await ports.apply({ db: handle.db, clock: ports.clock }, event);
        logger.info("revenuecat_event", { type: event.type, outcome });
      } finally {
        try {
          await handle.close();
        } catch (error) {
          logger.error("revenuecat_webhook_close_failed", { error: errorLabel(error) });
        }
      }
      return answer(200);
    } catch (error) {
      logger.error("revenuecat_webhook_failed", { error: errorLabel(error) });
      return answer(500, "unavailable");
    }
  };
}
