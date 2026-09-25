/**
 * `AccountWriteLimiter`, the API's per-account write limit (ADR-29, update of 26 September 2026):
 * one Durable Object per account, named by its Clerk subject, admits at most `WRITE_LIMIT.limit`
 * of the account's writes in any `WRITE_LIMIT.periodSeconds`. It replaces the Workers Rate Limiting
 * binding `API_WRITE_LIMIT`, which counts per Cloudflare location and approximately, and which on
 * staging never refused a request (25 September 2026). An object is one place holding one count,
 * so the limit holds wherever the account's requests arrive.
 *
 * The object stores one value, the times of the writes it admitted within the last period, in its
 * SQLite storage, read and written with the synchronous API: nothing runs between the read and the
 * write, so two writes at once are counted one after the other, and an eviction or a new isolate
 * keeps the count. A refused write is not counted, so an account over the limit is admitted again
 * once its oldest counted write is a period old, however often it keeps trying.
 *
 * An alarm clears the object once every time it holds is a period old, so an account's write times
 * are kept at most one period after its last write, and an account deleted from Vela leaves nothing
 * here to erase. The object stores no subject: its name is hashed into its id.
 */
import { DurableObject } from "cloudflare:workers";
import type { PilotEnv } from "./env.ts";

/**
 * At most 20 writes per account in any 60 seconds: far above what a person composing asks and
 * replies makes, and low enough that one account cannot spend Clerk's quota or Neon's compute hours.
 */
export const WRITE_LIMIT = { limit: 20, periodSeconds: 60 } as const;

const PERIOD_MS = WRITE_LIMIT.periodSeconds * 1000;

/** The only key the object stores: when each counted write was admitted, oldest first. */
export const ADMITTED_KEY = "admitted";

export class AccountWriteLimiter extends DurableObject<PilotEnv> {
  /**
   * Admits one more write of this account now and counts it, or refuses it when the account has
   * made `WRITE_LIMIT.limit` writes within the last period. Called over RPC by `limitWrites`.
   */
  async admit(): Promise<boolean> {
    const now = Date.now();
    const counted = this.#within(now);
    if (counted.length >= WRITE_LIMIT.limit) {
      return false;
    }
    this.ctx.storage.kv.put(ADMITTED_KEY, [...counted, now]);
    // With nothing counted before this write, no alarm is set: one clears this write's time.
    if (counted.length === 0) {
      await this.ctx.storage.setAlarm(now + PERIOD_MS);
    }
    return true;
  }

  /**
   * Drops the times that are a period old. While any remain, the alarm is set for when the newest
   * will be, so every time is cleared within one period of the account's last write.
   */
  override async alarm(): Promise<void> {
    const counted = this.#within(Date.now());
    const newest = counted.at(-1);
    if (newest === undefined) {
      await this.ctx.storage.deleteAll();
      return;
    }
    this.ctx.storage.kv.put(ADMITTED_KEY, counted);
    await this.ctx.storage.setAlarm(newest + PERIOD_MS);
  }

  /** The counted writes still within the period ending `now`. */
  #within(now: number): number[] {
    const stored = this.ctx.storage.kv.get<unknown>(ADMITTED_KEY);
    return Array.isArray(stored)
      ? stored.filter((at): at is number => typeof at === "number" && at > now - PERIOD_MS)
      : [];
  }
}

/** The account's own limiter: one object per Clerk subject, so no account counts another's writes. */
export function writeLimiterOf(
  namespace: DurableObjectNamespace<AccountWriteLimiter>,
  authSubject: string,
): DurableObjectStub<AccountWriteLimiter> {
  return namespace.get(namespace.idFromName(authSubject));
}
