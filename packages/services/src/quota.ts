/**
 * LINE's monthly quota (05-line-flows.md §6 and §5.10, ADR-32). The pilot Worker reads it every 15
 * minutes, after reconcile, where LINE is on. `recordChannelQuota` keeps the reading in the `flags`
 * row `line_quota` for the admin overview, and tells the founder when the month's use reaches 70%
 * and 90% of the limit and when it is spent, each at most once a quota month (D10: move to the
 * larger plan at 70%, since a spent quota fails her mornings).
 *
 * A quota is nobody's, and an outbound row belongs to a member, so the gateway cannot carry the
 * founder's message: it goes straight to the admin conversation, as `sendOutsideGateway` in
 * `group.ts` sends to someone who is not a member yet. "Once" is a `flags` row,
 * `line_quota:<yyyy-mm>:<level>`, claimed before the send, so another reading that month finds it
 * and sends nothing. A send that failed for a reason that can pass gives the claim back, and the
 * next reading, 15 minutes later, tries again; one the platform refused for good keeps it, as the
 * gateway would not retry that send either.
 *
 * LINE does not say in which zone its quota month resets, so the month is the reading's calendar
 * month in Taipei, and an alert near a month's edge may count in the next month.
 */
import { type Channel, type ChannelQuota, ChannelSendError } from "@vela/contracts";
import { t } from "@vela/copy";
import { localDateOf } from "@vela/core";
import { flags } from "@vela/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ADMIN_CHANNEL, ADMIN_LANG, adminOverviewLink } from "./admin-alerts.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";

/** The channels that bill per message sent, whose quota Vela reads: LINE alone. */
export type BilledChannel = Extract<Channel, "line">;

/** A reading as the adapter gives it, and as the `flags` row keeps it. */
const QuotaReading = z.object({
  limit: z.number().int().nonnegative().nullable(),
  used: z.number().int().nonnegative(),
  readAt: z.iso.datetime({ offset: true }),
});
type QuotaReading = z.infer<typeof QuotaReading>;

/** A channel's quota as the pilot Worker last read it: all the admin overview shows of LINE. */
export interface ChannelQuotaSnapshot {
  /** Messages allowed this month; null when the plan sets no limit. */
  readonly limit: number | null;
  /** Messages counted this month when it was read (LINE calls the count approximate). */
  readonly used: number;
  readonly readAt: Date;
}

/** The pilot's families are in Taiwan, whose calendar month keys the alerts. */
const QUOTA_MONTH_ZONE = "Asia/Taipei";

type AlertLevel = "70" | "90" | "exhausted";

/**
 * Highest first. A reading tells only the highest level it has reached, so one that jumps past 90%
 * sends one message, not two, and a spent quota is told without the 90% before it.
 */
const LEVELS: readonly {
  readonly level: AlertLevel;
  reached(used: number, limit: number): boolean;
}[] = [
  { level: "exhausted", reached: (used, limit) => used >= limit },
  { level: "90", reached: (used, limit) => used * 10 >= limit * 9 },
  { level: "70", reached: (used, limit) => used * 10 >= limit * 7 },
];

/** The `flags` key of the channel's last reading, and the prefix of its alerts' claims. */
function snapshotKey(channel: BilledChannel): string {
  return `${channel}_quota`;
}

/**
 * Keeps the reading as the channel's quota, replacing the one before, then tells the founder the
 * highest level it has reached, unless that level was told already this quota month. A plan with
 * no limit is kept and tells nothing. A reading that is not a count and a time is refused.
 */
export async function recordChannelQuota(
  deps: Deps,
  channel: BilledChannel,
  quota: ChannelQuota,
): Promise<void> {
  const parsed = QuotaReading.safeParse(quota);
  if (!parsed.success) {
    throw new VelaError(
      "invalid_payload",
      `the ${channel} quota reading is not a count and a time`,
    );
  }
  const reading = parsed.data;
  const now = deps.clock.now();
  await deps.db
    .insert(flags)
    .values({ key: snapshotKey(channel), value: reading, updatedAt: now })
    .onConflictDoUpdate({ target: flags.key, set: { value: reading, updatedAt: now } });
  const { limit, used } = reading;
  if (limit === null) {
    return;
  }
  const reached = LEVELS.find((candidate) => candidate.reached(used, limit));
  if (reached !== undefined) {
    await tellFounderOnce(deps, channel, reached.level, reading, limit);
  }
}

/**
 * The founder's message for `level`, sent unless this quota month's claim on it exists. Nothing is
 * claimed without an admin conversation, so an environment that gains one later still hears.
 */
async function tellFounderOnce(
  deps: Deps,
  channel: BilledChannel,
  level: AlertLevel,
  reading: QuotaReading,
  limit: number,
): Promise<void> {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return;
  }
  const month = localDateOf(new Date(reading.readAt), QUOTA_MONTH_ZONE).slice(0, 7);
  const key = `${snapshotKey(channel)}:${month}:${level}`;
  const claimed = await deps.db
    .insert(flags)
    .values({ key, value: reading, updatedAt: deps.clock.now() })
    .onConflictDoNothing({ target: flags.key })
    .returning({ key: flags.key });
  if (claimed.length === 0) {
    return;
  }
  const link = adminOverviewLink(deps.config);
  const text =
    level === "exhausted"
      ? t(ADMIN_LANG, "admin.line_quota_exhausted", { link })
      : t(ADMIN_LANG, "admin.line_quota", { used: reading.used, limit, link });
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
      deps.logger.warn("channel_quota_alert_refused", { channel, level, code: error.code });
      return;
    }
    await deps.db.delete(flags).where(eq(flags.key, key));
    if (error instanceof ChannelSendError) {
      deps.logger.warn("channel_quota_alert_failed", { channel, level, code: error.code });
      return;
    }
    throw error;
  }
  deps.logger.info("channel_quota_alert_sent", { channel, level });
}

/**
 * The channel's last reading, or null before the first. A row that no longer reads as one is
 * logged and shown as not read.
 */
export async function loadChannelQuota(
  deps: Pick<Deps, "db" | "logger">,
  channel: BilledChannel,
): Promise<ChannelQuotaSnapshot | null> {
  const [row] = await deps.db
    .select({ value: flags.value })
    .from(flags)
    .where(eq(flags.key, snapshotKey(channel)))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const parsed = QuotaReading.safeParse(row.value);
  if (!parsed.success) {
    deps.logger.warn("channel_quota_unreadable", { channel });
    return null;
  }
  const { limit, used, readAt } = parsed.data;
  return { limit, used, readAt: new Date(readAt) };
}
