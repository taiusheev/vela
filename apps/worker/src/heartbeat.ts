/**
 * The watchdog's evidence that the pilot Worker is alive (W1, W2). If the Worker, its crons, or the
 * database stop, no arrivals and no quiet notices go out, and a family reads the silence as "all
 * fine"; so something outside Cloudflare must notice. `reconcile` records the time it finished in
 * one Durable Object, `ReconcileHeartbeat`, and `GET /healthz` reports how old that time is, which
 * a GitHub Actions workflow reads every 15 minutes (.github/workflows/watchdog.yml).
 *
 * The time lives in a Durable Object rather than in Postgres, so `/healthz` never wakes Neon, which
 * scales to zero between reconciliations, and rather than in a new Cloudflare resource.
 */
import { DurableObject } from "cloudflare:workers";
import { errorLabel, type Heartbeat, type Logger } from "@vela/services";
import type { PilotEnv } from "./env.ts";

/** The one object's name: there is one heartbeat per deployed pilot Worker. */
const HEARTBEAT_NAME = "reconcile";

/** The only key the object stores; tests age it to see a stale heartbeat. */
export const LAST_RECONCILE_KEY = "lastReconcileAt";

/**
 * The oldest a last reconciliation may be and still count as alive: two 15-minute cron runs and five
 * minutes over, so one run that fails, or a cron that fires late, does not alert anyone, and a
 * stopped Worker alerts within about 35 minutes plus the watchdog's own delay.
 */
export const HEARTBEAT_FRESH_SECONDS = 35 * 60;

export class ReconcileHeartbeat extends DurableObject<PilotEnv> {
  /** Records that a reconciliation finished now, by this object's clock. */
  async recordReconcile(): Promise<void> {
    await this.ctx.storage.put(LAST_RECONCILE_KEY, Date.now());
  }

  /** When the last reconciliation finished, in milliseconds since the epoch; null before the first. */
  async lastReconcileAt(): Promise<number | null> {
    return (await this.ctx.storage.get<number>(LAST_RECONCILE_KEY)) ?? null;
  }
}

function heartbeatStub(
  env: Pick<PilotEnv, "RECONCILE_HEARTBEAT">,
): DurableObjectStub<ReconcileHeartbeat> {
  return env.RECONCILE_HEARTBEAT.get(env.RECONCILE_HEARTBEAT.idFromName(HEARTBEAT_NAME));
}

/**
 * The heartbeat port `reconcile` pings when it finishes. A failed write must not fail the
 * reconciliation that was otherwise fine: it is logged by its label, and the watchdog then sees the
 * silence it should.
 */
export function createHeartbeat(
  env: Pick<PilotEnv, "RECONCILE_HEARTBEAT">,
  logger: Logger,
): Heartbeat {
  return {
    async ping() {
      try {
        await heartbeatStub(env).recordReconcile();
      } catch (error) {
        logger.warn("heartbeat_failed", { error: errorLabel(error) });
      }
    },
  };
}

/** What `/healthz` answers: no content and no ids, only whether reconciliation is running. */
export type Health =
  | { readonly status: "ok"; readonly lastReconcileAgeSeconds: number }
  | { readonly status: "stale" }
  | { readonly status: "no_reconcile_yet" };

/** The health a last reconciliation time means at `now`. */
export function healthOf(lastReconcileAt: number | null, now: number): Health {
  if (lastReconcileAt === null) {
    return { status: "no_reconcile_yet" };
  }
  const age = Math.max(0, Math.floor((now - lastReconcileAt) / 1000));
  return age <= HEARTBEAT_FRESH_SECONDS
    ? { status: "ok", lastReconcileAgeSeconds: age }
    : { status: "stale" };
}

/** The pilot Worker's health now, read from the heartbeat object and nothing else. */
export async function readHealth(env: Pick<PilotEnv, "RECONCILE_HEARTBEAT">): Promise<Health> {
  return healthOf(await heartbeatStub(env).lastReconcileAt(), Date.now());
}
