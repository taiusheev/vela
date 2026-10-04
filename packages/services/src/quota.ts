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
 * `line_quota:<quota month>:<level>`, claimed before the send, so another reading that quota month
 * finds it and sends nothing. A send that failed for a reason that can pass gives the claim back,
 * and the next reading, 15 minutes later, tries again; one the platform refused for good keeps it,
 * as the gateway would not retry that send either.
 *
 * LINE does not say in which zone its quota month resets, nor how soon its approximate count
 * follows, and the 16:00 UTC run falls exactly at Taipei's midnight. Keyed by the reading's own
 * month in Taipei, a reading that still showed the old month's count would take the new month's
 * claim and silence the new month's alert, D10's decision point among them. So a reading counts in
 * the Taipei month of the day before it: a month's first day still counts in the month before,
 * whatever LINE's count shows, and the new month's claims open with its second day. Every zone's
 * midnight falls between 18:00 on a month's last day and 20:00 on its first in Taipei, so a count
 * read on either day is the old month's, or the new month's first hours, which reach no level. A
 * level the new month reaches on its first day is told on its second.
 */
import { type Channel, type ChannelQuota, ChannelSendError } from "@vela/contracts";
import { t } from "@vela/copy";
import { addDays, localDateOf } from "@vela/core";
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

/** The pilot's families are in Taiwan, whose calendar keys the alerts. */
const QUOTA_MONTH_ZONE = "Asia/Taipei";

/**
 * The quota month (`yyyy-mm`) a reading taken at `readAt` counts in: the Taipei month of the day
 * before it, so a month's first day still counts in the month before (the module's comment says
 * why).
 */
function quotaMonthOf(readAt: string): string {
  return addDays(localDateOf(new Date(readAt), QUOTA_MONTH_ZONE), -1).slice(0, 7);
}

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
  reading: QuotaReading | { refusedAt: string },
  limit: number | null,
): Promise<void> {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return;
  }
  const at = "readAt" in reading ? reading.readAt : reading.refusedAt;
  const key = `${snapshotKey(channel)}:${quotaMonthOf(at)}:${level}`;
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
      : t(ADMIN_LANG, "admin.line_quota", {
          used: "used" in reading ? reading.used : 0,
          limit: limit ?? 0,
          link,
        });
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
 * A send the channel refused because the month's quota is spent (05-line-flows §5.11): the founder
 * hears once a quota month, through the same claim a reading that shows the month spent takes, so
 * whichever sees it first tells, keyed by the quota month of the refusal's time.
 */
export async function channelQuotaRefused(deps: Deps, channel: BilledChannel): Promise<void> {
  await tellFounderOnce(
    deps,
    channel,
    "exhausted",
    { refusedAt: deps.clock.now().toISOString() },
    null,
  );
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
