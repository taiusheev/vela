import { ApiPrecision, PublicPrecision, type QuietOutcome } from "@vela/contracts";
import { members, quietEvents } from "@vela/db";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import type { Queryable } from "./repo.ts";

/**
 * One month of quiet mornings, for the precision pages (spec §8 "Precision accounting", §18): counts
 * only. A notice is a quiet morning that told someone (`notify_count` > 0); one that settled before
 * anyone was told, as in the learning period, is not. Outcomes and verdicts are counted over
 * notices; a notice not yet settled has no outcome.
 */
export interface QuietPrecisionMonth {
  /** The UTC month the quiet morning opened, `YYYY-MM`. */
  month: string;
  quietMornings: number;
  notices: number;
  /** Notices not yet settled. */
  open: number;
  outcomes: Record<QuietOutcome, number>;
  useful: { yes: number; no: number };
  /** How many families the month's notices came from. */
  families: number;
}

/** How many months back the precision pages reach, this month included. */
export const PRECISION_MONTHS = 12;

/**
 * The fewest notices, from the fewest families, a Vela month needs before the app shows it: below
 * either, one family's quiet morning could be read out of Vela's numbers by another family.
 */
export const VELA_MONTH_MINIMUM = { notices: 10, families: 3 } as const;

/** The first instant of the UTC month `back` months before `now`'s. */
function utcMonthStart(now: Date, back: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
}

/**
 * Quiet mornings by the UTC month they opened, newest first, for the last `PRECISION_MONTHS`
 * months; months with none are left out. `familyId` null counts every family and names none.
 */
export async function quietPrecision(
  db: Queryable,
  now: Date,
  familyId: string | null,
): Promise<QuietPrecisionMonth[]> {
  const notice = sql`${quietEvents.notifyCount} > 0`;
  const month = sql<string>`to_char(${quietEvents.openedAt} at time zone 'UTC', 'YYYY-MM')`;
  const counted = (where: ReturnType<typeof sql>) =>
    sql<number>`count(*) filter (where ${notice} and ${where})`.mapWith(Number);
  const outcomeCount = (outcome: QuietOutcome) => counted(sql`${quietEvents.outcome} = ${outcome}`);
  const since = gte(quietEvents.openedAt, utcMonthStart(now, PRECISION_MONTHS - 1));
  const rows = await db
    .select({
      month,
      quietMornings: count(),
      notices: sql<number>`count(*) filter (where ${notice})`.mapWith(Number),
      open: counted(sql`${quietEvents.resolvedAt} is null`),
      answeredLate: outcomeCount("answered_late"),
      away: outcomeCount("away"),
      fineKnown: outcomeCount("fine_known"),
      trueConcern: outcomeCount("true_concern"),
      unknown: outcomeCount("unknown"),
      usefulYes: counted(sql`${quietEvents.useful}`),
      usefulNo: counted(sql`not ${quietEvents.useful}`),
      families: sql<number>`count(distinct ${members.familyId}) filter (where ${notice})`.mapWith(
        Number,
      ),
    })
    .from(quietEvents)
    .innerJoin(members, eq(members.id, quietEvents.memberId))
    .where(familyId === null ? since : and(since, eq(members.familyId, familyId)))
    .groupBy(month)
    .orderBy(desc(month));
  return rows.map((row) => ({
    month: row.month,
    quietMornings: row.quietMornings,
    notices: row.notices,
    open: row.open,
    outcomes: {
      answered_late: row.answeredLate,
      away: row.away,
      fine_known: row.fineKnown,
      true_concern: row.trueConcern,
      unknown: row.unknown,
    },
    useful: { yes: row.usefulYes, no: row.usefulNo },
    families: row.families,
  }));
}

/** `YYYY-MM` of a UTC month start. */
function monthKey(start: Date): string {
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Whether a month across every family is big enough to show beside other families' (no one family readable). */
function meetsVelaMinimum(month: QuietPrecisionMonth): boolean {
  return (
    month.notices >= VELA_MONTH_MINIMUM.notices && month.families >= VELA_MONTH_MINIMUM.families
  );
}

/** A month as the app is given it: notices only, never her quiet mornings or the family count. */
function apiMonth(month: QuietPrecisionMonth): ApiPrecision["family"][number] {
  return {
    month: month.month,
    notices: month.notices,
    open: month.open,
    outcomes: month.outcomes,
    useful: month.useful,
  };
}

/**
 * How Vela is doing (`GET /v1/families/:familyId/precision`, API contract §7, spec §8), for the
 * family's organisers: the family's own notices by month, and Vela's across every family for the
 * months that reach `VELA_MONTH_MINIMUM`. Anyone else, and a family that is not the caller's, is
 * null. Months with no notice are left out of both: a quiet morning that told nobody is no notice.
 */
export async function loadApiPrecision(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  now: Date,
): Promise<ApiPrecision | null> {
  const access = await authorizeFamilyAccess(db, identity, familyId, "organiser");
  if (access.kind !== "granted") return null;
  const family = await quietPrecision(db, now, familyId);
  const vela = await quietPrecision(db, now, null);
  return ApiPrecision.parse({
    family: family.filter((month) => month.notices > 0).map(apiMonth),
    vela: vela.filter(meetsVelaMinimum).map(apiMonth),
    vela_minimum: VELA_MONTH_MINIMUM,
  });
}

/**
 * Vela's precision for the public website (spec §8: "published monthly … on the website"). A month
 * is published once it has ended, so a figure never changes under a reader while the month runs,
 * and only at `VELA_MONTH_MINIMUM`, as in the app. Notices still open in an ended month are shown as
 * open. Needs no caller: it names no family and counts nothing per family.
 */
export async function loadPublicPrecision(db: Queryable, now: Date): Promise<PublicPrecision> {
  const current = monthKey(utcMonthStart(now, 0));
  const months = await quietPrecision(db, now, null);
  return PublicPrecision.parse({
    months: months
      .filter((month) => month.month < current && meetsVelaMinimum(month))
      .map(apiMonth),
    minimum: VELA_MONTH_MINIMUM,
    through: monthKey(utcMonthStart(now, 1)),
  });
}
