/**
 * Telling the founder when Vela itself goes wrong, and once a day how it went (technical plan steps
 * 2.1 and 2.2). Both read only content-free records — the events, the AI call log — and send a
 * system message to the admin chat, never a family's words, names or ids beyond the overview link.
 *
 * Alerts run with every reconcile: a kind that happened in the current UTC hour is told once that
 * hour, with its count so far. The digest runs with the nightly jobs and covers the last 24 hours,
 * once a UTC day. Each message is claimed in `flags` before it is sent, as LINE's quota alert is
 * (`quota.ts`), so two runs never both send it; a send that fails and may succeed later gives the
 * claim back. Claims older than a week are cleared by the digest.
 */
import { ChannelSendError } from "@vela/contracts";
import { t } from "@vela/copy";
import { aiCalls, events, flags } from "@vela/db";
import { and, eq, gte, like, lt, sql } from "drizzle-orm";
import { ADMIN_CHANNEL, ADMIN_LANG, adminOverviewLink } from "./admin-alerts.ts";
import type { Deps } from "./deps.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CLAIM_PREFIX = "ops:";

/** AI is failing when at least this many calls in the last hour, and over this share, failed. */
export const AI_ALERT_MIN_CALLS = 5;
export const AI_ALERT_SHARE = 0.2;

type EventAlert = "arrival_delivery_failed" | "gateway_dropped" | "scheduler_missed";

const EVENT_ALERTS: Readonly<
  Record<
    EventAlert,
    "admin.ops_arrival_failed" | "admin.ops_dropped" | "admin.ops_scheduler_missed"
  >
> = {
  arrival_delivery_failed: "admin.ops_arrival_failed",
  gateway_dropped: "admin.ops_dropped",
  scheduler_missed: "admin.ops_scheduler_missed",
};

function hourOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/** `2026-10-08T03`: the UTC hour a claim belongs to. */
function hourKey(at: Date): string {
  return at.toISOString().slice(0, 13);
}

async function countEvents(deps: Deps, name: string, from: Date, to: Date): Promise<number> {
  const [row] = await deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.name, name as EventAlert), gte(events.at, from), lt(events.at, to)));
  return row?.count ?? 0;
}

async function aiTotals(deps: Deps, from: Date, to: Date) {
  const [row] = await deps.db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where not ${aiCalls.ok})::int`,
      cost: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)::float8`,
    })
    .from(aiCalls)
    .where(and(gte(aiCalls.at, from), lt(aiCalls.at, to)));
  return { total: row?.total ?? 0, failed: row?.failed ?? 0, cost: row?.cost ?? 0 };
}

/**
 * Sends `text` to the founder unless `key` was claimed. Returns whether this run sent it. Nothing
 * is claimed without an admin chat, so an environment that gains one later still hears.
 */
async function tellFounderOnce(deps: Deps, key: string, text: string): Promise<boolean> {
  const admin = deps.config.adminConversationId;
  if (admin === null) return false;
  const claimed = await deps.db
    .insert(flags)
    .values({ key, value: { at: deps.clock.now().toISOString() }, updatedAt: deps.clock.now() })
    .onConflictDoNothing({ target: flags.key })
    .returning({ key: flags.key });
  if (claimed.length === 0) return false;
  try {
    await deps.channels.get(ADMIN_CHANNEL).send({
      kind: "system",
      idempotencyKey: key,
      lang: ADMIN_LANG,
      to: { channel: ADMIN_CHANNEL, conversationId: admin },
      text,
    });
  } catch (error) {
    if (error instanceof ChannelSendError && !error.retryable) {
      deps.logger.warn("ops_message_refused", { key, code: error.code });
      return false;
    }
    await deps.db.delete(flags).where(eq(flags.key, key));
    if (error instanceof ChannelSendError) {
      deps.logger.warn("ops_message_failed", { key, code: error.code });
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * Step 2.1: failed arrivals, dropped sends and missed scheduler runs in the current UTC hour, and
 * AI failing in the last hour, each told at most once an hour. Returns how many messages it sent.
 */
export async function opsAlerts(deps: Deps): Promise<number> {
  const now = deps.clock.now();
  const since = hourOf(now);
  const hour = hourKey(since);
  const link = adminOverviewLink(deps.config);
  const environment = deps.config.environment;
  const sinceText = since.toISOString().slice(11, 16);
  let sent = 0;
  for (const [name, key] of Object.entries(EVENT_ALERTS) as [
    EventAlert,
    (typeof EVENT_ALERTS)[EventAlert],
  ][]) {
    const count = await countEvents(deps, name, since, new Date(now.getTime() + 1));
    if (count === 0) continue;
    const text = t(ADMIN_LANG, key, { count, since: sinceText, environment, link });
    if (await tellFounderOnce(deps, `${CLAIM_PREFIX}${name}:${hour}`, text)) sent += 1;
  }
  const ai = await aiTotals(deps, new Date(now.getTime() - HOUR_MS), new Date(now.getTime() + 1));
  if (ai.total >= AI_ALERT_MIN_CALLS && ai.failed / ai.total > AI_ALERT_SHARE) {
    const text = t(ADMIN_LANG, "admin.ops_ai_failing", {
      failed: ai.failed,
      total: ai.total,
      environment,
      link,
    });
    if (await tellFounderOnce(deps, `${CLAIM_PREFIX}ai_failing:${hour}`, text)) sent += 1;
  }
  return sent;
}

/** Step 2.2: the last 24 hours in one message, once a UTC day. Returns whether it was sent. */
export async function opsDigest(deps: Deps): Promise<boolean> {
  const now = deps.clock.now();
  const to = new Date(now.getTime() + 1);
  const from = new Date(now.getTime() - DAY_MS);
  const count = (name: string) => countEvents(deps, name, from, to);
  const ai = await aiTotals(deps, from, to);
  const text = t(ADMIN_LANG, "admin.ops_digest", {
    environment: deps.config.environment,
    delivered: await count("arrival_delivered"),
    failed: await count("arrival_delivery_failed"),
    answers: await count("answer_recorded"),
    replies: await count("reply_posted"),
    readbacks: await count("readback_delivered"),
    quiet: await count("quiet_notice_sent"),
    resolved: await count("quiet_notice_resolved"),
    flags: await count("flag_raised"),
    stops: await count("stop_said"),
    ai_calls: ai.total,
    ai_failed: ai.failed,
    ai_cost: ai.cost.toFixed(2),
    dropped: await count("gateway_dropped"),
    missed: await count("scheduler_missed"),
    link: adminOverviewLink(deps.config),
  });
  // A week of hourly and daily claims is plenty to stop repeats; older ones only take space.
  await deps.db
    .delete(flags)
    .where(
      and(
        like(flags.key, `${CLAIM_PREFIX}%`),
        lt(flags.updatedAt, new Date(now.getTime() - 7 * DAY_MS)),
      ),
    );
  return tellFounderOnce(deps, `${CLAIM_PREFIX}digest:${now.toISOString().slice(0, 10)}`, text);
}
