import {
  type ApiMutationResponse,
  type ApiWeekDay,
  ApiWeeklyRead,
  OpenWeeklyRead,
  type WeekDayState,
} from "@vela/contracts";
import { addDays, localTimeOf } from "@vela/core";
import { members, quietEvents, subscriptions, type VelaTransaction, weeklyReads } from "@vela/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
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
  options: { pilotFree?: boolean } = {},
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
    .where(and(eq(subscriptions.memberId, her.id), eq(subscriptions.familyId, familyId)))
    .limit(1);
  const covered =
    options.pilotFree === true ||
    (subscription !== undefined &&
      COVERING.has(subscription.status) &&
      (subscription.status !== "trial" ||
        subscription.trialEndsAt === null ||
        subscription.trialEndsAt > now));

  const [read] = await db
    .select()
    .from(weeklyReads)
    .where(
      and(
        eq(weeklyReads.memberId, her.id),
        eq(weeklyReads.familyId, familyId),
        isNotNull(weeklyReads.sentAt),
      ),
    )
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

/**
 * Record a visible opening separately from GET: a fetch or a locked preview is not an opening.
 * Authorisation runs again before every replay. Only identifiers and the organiser's local time
 * enter the event or the receipt; neither query needs the read's sealed content.
 */
export async function openApiWeeklyRead(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  weeklyReadId: string,
  input: unknown,
  options: { pilotFree?: boolean } = {},
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!OpenWeeklyRead.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  const parsedId = ApiWeeklyRead.shape.read.unwrap().shape.id.safeParse(weeklyReadId);
  if (!parsedId.success) throw new VelaError("not_found", "Weekly read not found");
  const id = parsedId.data.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: weeklyReads.familyId, memberId: weeklyReads.memberId })
    .from(weeklyReads)
    .where(eq(weeklyReads.id, id))
    .limit(1);

  const authorize = async (tx: VelaTransaction) => {
    if (found === undefined) throw new VelaError("not_found", "Weekly read not found");
    const access = await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
    if (access.kind !== "granted") throw new VelaError("not_found", "Weekly read not found");
    // Keep both memberships stable while recording, including when another organiser changes one.
    const memberships = await tx
      .select({
        id: members.id,
        role: members.role,
        status: members.status,
        leftAt: members.leftAt,
        tz: members.tz,
      })
      .from(members)
      .where(
        and(
          eq(members.familyId, found.familyId),
          inArray(members.id, [access.access.memberId, found.memberId]),
        ),
      )
      .for("share");
    const organiser = memberships.find((member) => member.id === access.access.memberId);
    const her = memberships.find((member) => member.id === found.memberId);
    const live = (member: (typeof memberships)[number] | undefined) =>
      member !== undefined &&
      member.leftAt === null &&
      (member.status === "active" || member.status === "paused");
    if (
      !live(organiser) ||
      organiser?.role !== "organiser" ||
      !live(her) ||
      her?.role !== "member"
    ) {
      throw new VelaError("not_found", "Weekly read not found");
    }
    const [read] = await tx
      .select({ sentAt: weeklyReads.sentAt })
      .from(weeklyReads)
      .where(
        and(
          eq(weeklyReads.id, id),
          eq(weeklyReads.familyId, found.familyId),
          eq(weeklyReads.memberId, found.memberId),
        ),
      )
      .for("share");
    const [subscription] = await tx
      .select({ status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt })
      .from(subscriptions)
      .where(
        and(eq(subscriptions.familyId, found.familyId), eq(subscriptions.memberId, found.memberId)),
      )
      .for("share");
    const now = deps.clock.now();
    if (
      read === undefined ||
      read.sentAt === null ||
      read.sentAt > now ||
      (options.pilotFree !== true &&
        (subscription === undefined ||
          !COVERING.has(subscription.status) ||
          (subscription.status === "trial" &&
            subscription.trialEndsAt !== null &&
            subscription.trialEndsAt <= now)))
    ) {
      throw new VelaError("not_found", "Weekly read not found");
    }
    // The current account/family rules also apply after waiting for the membership locks.
    const current = await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
    if (current.kind !== "granted" || current.access.memberId !== organiser.id) {
      throw new VelaError("not_found", "Weekly read not found");
    }
    return { familyId: found.familyId, memberId: found.memberId, organiser, now };
  };

  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "weekly-read.opened:v1",
      input: { weekly_read_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.memberId }),
    },
    {
      authorize: async (tx) => {
        await authorize(tx);
      },
      mutate: async (tx) => {
        const allowed = await authorize(tx);
        await recordEvent(
          tx,
          {
            name: "weekly_read_opened",
            familyId: allowed.familyId,
            memberId: allowed.organiser.id,
            surface: "app",
            props: {
              weekly_read_id: id,
              recipient_member_id: allowed.memberId,
              local_time: localTimeOf(allowed.now, allowed.organiser.tz),
            },
          },
          allowed.now,
        );
        return { status: 200, body: { weekly_read_id: id, opened: true } };
      },
    },
  );
}
