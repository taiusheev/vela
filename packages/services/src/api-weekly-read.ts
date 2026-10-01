import { type ApiWeekDay, ApiWeeklyRead, type WeekDayState } from "@vela/contracts";
import { addDays, localTimeOf } from "@vela/core";
import { quietEvents, subscriptions, weeklyReads } from "@vela/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { loadWeekDays } from "./jobs.ts";
import { memberById, type Queryable } from "./repo.ts";

/** Subscription states that cover her: the read is Vela Light's (spec §13, A9). */
const COVERING = new Set(["trial", "active", "grace"]);

/**
 * Her latest weekly read the founder sent, for the Sunday tab (`GET
 * /v1/families/:familyId/weekly-read?member=`, API contract §7, spec A9). Organisers only: the read
 * carries the counts of her week, which she is never shown (spec §8). `member` must be a kept-light
 * member of the family who said yes; anyone else, a stranger, and a family that is not the caller's
 * all answer null.
 *
 * Only a sent read is shown: the founder edits each draft before it goes (Appendix A), so the app
 * shows what Telegram's organisers were sent. The seven days are read again from her answers by the
 * draft's own rule (`loadWeekDays`); the counts are the numbers stored when it was drafted. Without
 * a Vela Light trial or plan covering her, the days show and the rest is locked (`locked`).
 */
export async function loadApiWeeklyRead(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  memberId: string | undefined,
  now: Date,
): Promise<ApiWeeklyRead | null> {
  const access = await authorizeFamilyAccess(db, identity, familyId, "organiser");
  if (access.kind !== "granted" || memberId === undefined) return null;
  const parsedId = ApiWeeklyRead.shape.member_id.safeParse(memberId);
  if (!parsedId.success) return null;
  const her = await memberById(db, parsedId.data);
  if (
    her === null ||
    her.familyId !== familyId ||
    her.role !== "member" ||
    her.leftAt !== null ||
    (her.status !== "active" && her.status !== "paused")
  ) {
    return null;
  }

  const [subscription] = await db
    .select({ status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt })
    .from(subscriptions)
    .where(eq(subscriptions.memberId, her.id))
    .limit(1);
  const covered =
    subscription !== undefined &&
    COVERING.has(subscription.status) &&
    (subscription.status !== "trial" ||
      subscription.trialEndsAt === null ||
      subscription.trialEndsAt > now);

  const [read] = await db
    .select()
    .from(weeklyReads)
    .where(and(eq(weeklyReads.memberId, her.id), isNotNull(weeklyReads.sentAt)))
    .orderBy(desc(weeklyReads.weekStart))
    .limit(1);
  const base = { member_id: her.id, display_name: her.displayName, locked: !covered };
  if (read === undefined || read.sentAt === null) {
    return ApiWeeklyRead.parse({ ...base, read: null });
  }

  const weekEnd = addDays(read.weekStart, 6);
  const days = await loadWeekDays(db, her, read.weekStart, weekEnd);
  const exchangeIds = days.flatMap((day) => (day.exchange === null ? [] : [day.exchange.id]));
  const quietOpened = new Map(
    exchangeIds.length === 0
      ? []
      : (
          await db
            .select({ exchangeId: quietEvents.exchangeId, openedAt: quietEvents.openedAt })
            .from(quietEvents)
            .where(inArray(quietEvents.exchangeId, exchangeIds))
        ).map((row) => [row.exchangeId, row.openedAt]),
  );
  // A first week counts only the days since her light started, as the draft counted them.
  const firstCounted =
    her.lightStartsOn !== null && her.lightStartsOn > read.weekStart
      ? her.lightStartsOn
      : read.weekStart;
  const week: ApiWeekDay[] = days.map((day) => {
    const opened = day.exchange === null ? undefined : quietOpened.get(day.exchange.id);
    const state: WeekDayState =
      day.date < firstCounted
        ? "not_counted"
        : day.answeredAt === null
          ? "unanswered"
          : opened !== undefined && opened < day.answeredAt
            ? "late"
            : "answered";
    return {
      date: day.date,
      state,
      answered_at:
        state === "answered" || state === "late"
          ? localTimeOf(day.answeredAt as Date, her.tz)
          : null,
    };
  });

  const stats = read.stats;
  return ApiWeeklyRead.parse({
    ...base,
    read: {
      id: read.id,
      week_start: read.weekStart,
      week_end: weekEnd,
      sent_at: read.sentAt.toISOString(),
      days: week,
      counts: covered
        ? {
            counted_days: stats.counted_days,
            answered_days: stats.answered_days,
            hello_mornings: stats.hello_mornings,
            family_asks: stats.family_asks,
          }
        : null,
      notes: covered ? (read.sentLines ?? []) : null,
      suggestion:
        covered && read.sentSuggestion !== null && read.sentSuggestion.trim().length > 0
          ? read.sentSuggestion
          : null,
    },
  });
}
