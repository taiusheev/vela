import type { LocalDate, QuietOutcome } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  awayPeriods,
  events,
  exchanges,
  families,
  members,
  outbound,
  quietEvents,
  replies,
} from "@vela/db";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { type AdminContext, recordAdminView } from "./admin.ts";
import type { Deps } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";

export interface TrialDay {
  day: LocalDate;
  fallback: boolean;
  delivered: boolean;
  failed: boolean;
  answered: boolean;
  arrivalAttempts: number;
  arrivalUnsuccessfulAttempts: number;
  arrivalSent: number;
  arrivalFailed: number;
  arrivalDropped: number;
  arrivalPending: number;
  answerCount: number;
  latencyMin: number | null;
  humanReplies: number;
  repliesReadBack: number;
  readBackAttempts: number;
  readBackUnsuccessfulAttempts: number;
  readBackSent: number;
  readBackFailed: number;
  readBackDropped: number;
  readBackPending: number;
  quietNotices: number;
  quietOutcome: QuietOutcome | null;
  /** The organiser's answer to "was this notice useful?"; null when not asked or not answered. */
  quietUseful: boolean | null;
  /** Inside one of her away periods: kept out of the answer-rate denominator. */
  away: boolean;
}

export interface TrialRecipientReport {
  recipientId: string;
  /** Her light is on: the trial's numbers are about kept-light members. */
  lightOn: boolean;
  timezone: string;
  from: LocalDate;
  through: LocalDate;
  /** Calendar days with no prepared exchange, not automatically missed eligible mornings. */
  unobservedDays: number;
  expiredArrivalMetadata: number;
  days: TrialDay[];
  summary: {
    recordedDays: number;
    deliveredDays: number;
    failedDays: number;
    answeredDays: number;
    fallbackDays: number;
    answerCount: number;
    humanReplies: number;
    repliesReadBack: number;
    /** Median among nonnegative arrival-to-first-answer intervals only. */
    medianLatencyMin: number | null;
    latencySamples: number;
    preArrivalAnswers: number;
    /** Delivered days outside away periods, and how many of them she answered. */
    eligibleDays: number;
    eligibleAnsweredDays: number;
    awayDays: number;
    /** Answered days whose family replies reached her the next morning. */
    repliesHeardDays: number;
    /** Days with at least one quiet notice, and the organisers' verdicts on them. */
    quietNoticeDays: number;
    usefulYes: number;
    usefulNo: number;
    trueConcern: number;
    /** Times she said stop inside the window. */
    stopsSaid: number;
  };
}

export type TrialStatus = "on_track" | "watch" | "kill" | "too_early" | "founder_check";

export interface TrialNumber {
  key:
    | "answer_rate"
    | "useful_notices"
    | "notices_per_month"
    | "missed_trouble"
    | "stops"
    | "fallback_share"
    | "replies_heard";
  /** The measured share or count; null when there is no denominator yet. */
  value: number | null;
  numerator: number;
  denominator: number;
  status: TrialStatus;
}

/**
 * The trial's targets (plan/product-week.md, research/14 §2). Shares are fractions; a number is
 * "too early" below its minimum sample so one bad day does not read as a kill signal.
 */
export const TRIAL_TARGETS = {
  answerRate: { onTrack: 0.75, kill: 0.5, minDays: 7 },
  useful: { onTrack: 0.6, kill: 0.3, minVerdicts: 3 },
  noticesPerMonth: { onTrack: 4, minDays: 7 },
  fallbackShare: { onTrack: 0.15, kill: 0.3, minDays: 7 },
  repliesHeard: { onTrack: 0.5, minDays: 7 },
} as const;

function share(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * The four numbers (and two supporting ones) for one kept-light member, each with a status against
 * its target. Missed real trouble cannot be counted from events: a true concern that resolved well
 * is shown, and the founder confirms "none missed" from the check-in calls.
 */
export function trialNumbers(summary: TrialRecipientReport["summary"]): TrialNumber[] {
  const s = summary;
  const t = TRIAL_TARGETS;
  const answerRate = share(s.eligibleAnsweredDays, s.eligibleDays);
  const verdicts = s.usefulYes + s.usefulNo;
  const useful = share(s.usefulYes, verdicts);
  const perMonth = s.recordedDays === 0 ? null : (s.quietNoticeDays * 30) / s.recordedDays;
  const fallback = share(s.fallbackDays, s.recordedDays);
  const heard = share(s.repliesHeardDays, s.answeredDays);
  const band = (
    value: number | null,
    enough: boolean,
    onTrack: (v: number) => boolean,
    kill: (v: number) => boolean,
  ): TrialStatus =>
    value === null || !enough
      ? "too_early"
      : onTrack(value)
        ? "on_track"
        : kill(value)
          ? "kill"
          : "watch";
  return [
    {
      key: "answer_rate",
      value: answerRate,
      numerator: s.eligibleAnsweredDays,
      denominator: s.eligibleDays,
      status: band(
        answerRate,
        s.eligibleDays >= t.answerRate.minDays,
        (v) => v >= t.answerRate.onTrack,
        (v) => v < t.answerRate.kill,
      ),
    },
    {
      key: "useful_notices",
      value: useful,
      numerator: s.usefulYes,
      denominator: verdicts,
      status: band(
        useful,
        verdicts >= t.useful.minVerdicts,
        (v) => v > t.useful.onTrack,
        (v) => v < t.useful.kill,
      ),
    },
    {
      key: "notices_per_month",
      value: perMonth,
      numerator: s.quietNoticeDays,
      denominator: s.recordedDays,
      status: band(
        perMonth,
        s.recordedDays >= t.noticesPerMonth.minDays,
        (v) => v < t.noticesPerMonth.onTrack,
        () => false,
      ),
    },
    {
      key: "missed_trouble",
      value: s.trueConcern,
      numerator: s.trueConcern,
      denominator: s.quietNoticeDays,
      status: "founder_check",
    },
    {
      key: "stops",
      value: s.stopsSaid,
      numerator: s.stopsSaid,
      denominator: 1,
      status: s.stopsSaid === 0 ? "on_track" : "watch",
    },
    {
      key: "fallback_share",
      value: fallback,
      numerator: s.fallbackDays,
      denominator: s.recordedDays,
      status: band(
        fallback,
        s.recordedDays >= t.fallbackShare.minDays,
        (v) => v < t.fallbackShare.onTrack,
        (v) => v > t.fallbackShare.kill,
      ),
    },
    {
      key: "replies_heard",
      value: heard,
      numerator: s.repliesHeardDays,
      denominator: s.answeredDays,
      status: band(
        heard,
        s.answeredDays >= t.repliesHeard.minDays,
        (v) => v >= t.repliesHeard.onTrack,
        () => false,
      ),
    },
  ];
}

export interface TrialReport {
  familyId: string;
  generatedAt: Date;
  windowDays: 7 | 30;
  recipients: TrialRecipientReport[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] ?? 0)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function unsuccessfulAttempts(rows: { attempts: number; status: string }[]): number {
  return rows.reduce(
    (n, row) => n + Math.max(0, row.attempts - (row.status === "sent" ? 1 : 0)),
    0,
  );
}

/**
 * Founder-only, audited trial counts. No content columns, conversation IDs, phones, provider
 * errors, or tokens are selected. Complete recipient-local dates are used; failed delivery
 * remains a recorded day. Missing exchanges cannot establish historical consent/away eligibility.
 */
export async function loadAdminTrialReport(
  deps: Deps,
  ctx: AdminContext,
  familyId: string,
  windowDays: 7 | 30 = 30,
): Promise<TrialReport | null> {
  if (
    !z.uuid().safeParse(familyId).success ||
    (windowDays !== 7 && windowDays !== 30) ||
    (ctx.familyId !== undefined && ctx.familyId !== familyId)
  ) {
    throw new VelaError("invalid_payload", "Invalid trial report scope");
  }
  const [family] = await deps.db
    .select({ id: families.id })
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)));
  if (family === undefined) return null;
  await recordAdminView(deps, ctx, {
    familyIds: [familyId],
    memberId: null,
    what: `/admin/families/${familyId}/trial?days=${windowDays}`,
  });
  const generatedAt = deps.clock.now();
  try {
    return await deps.db.transaction(
      async (tx) => {
        // A deletion cannot begin halfway through the report and leave a partial apparent success.
        const [held] = await tx
          .select({ id: families.id })
          .from(families)
          .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
          .for("share");
        if (held === undefined) return null;
        const people = await tx
          .select({ id: members.id, tz: members.tz, lightOn: members.lightOn })
          .from(members)
          .where(eq(members.familyId, familyId))
          .orderBy(asc(members.createdAt), asc(members.id));
        const recipients: TrialRecipientReport[] = [];
        for (const person of people) {
          const through = addDays(localDateOf(generatedAt, person.tz), -1);
          const from = addDays(through, 1 - windowDays);
          const rows = await tx
            .select({
              id: exchanges.id,
              day: exchanges.scheduledFor,
              type: exchanges.type,
              deliveredAt: exchanges.deliveredAt,
              failedAt: exchanges.deliveryFailedAt,
              answeredAt: exchanges.answeredAt,
            })
            .from(exchanges)
            .where(
              and(
                eq(exchanges.familyId, familyId),
                eq(exchanges.recipientId, person.id),
                gte(exchanges.scheduledFor, from),
                lte(exchanges.scheduledFor, through),
                ne(exchanges.state, "withdrawn"),
                ne(exchanges.state, "composed"),
              ),
            )
            .orderBy(asc(exchanges.scheduledFor));
          if (rows.length === 0) continue;
          const ids = rows.map((row) => row.id);
          const answerRows = await tx
            .select({ exchangeId: answers.exchangeId })
            .from(answers)
            .where(and(inArray(answers.exchangeId, ids), eq(answers.memberId, person.id)));
          const replyRows = await tx
            .select({ exchangeId: replies.exchangeId, readBackAt: replies.readBackAt })
            .from(replies)
            .innerJoin(members, eq(members.id, replies.memberId))
            .where(
              and(
                inArray(replies.exchangeId, ids),
                eq(members.familyId, familyId),
                eq(replies.toRecipient, true),
                inArray(replies.kind, ["text", "voice", "photo"]),
              ),
            );
          const arrivalRows = await tx
            .select({
              exchangeId: outbound.exchangeId,
              attempts: outbound.attempts,
              status: outbound.status,
            })
            .from(outbound)
            .where(
              and(
                eq(outbound.memberId, person.id),
                eq(outbound.kind, "arrival"),
                inArray(outbound.exchangeId, ids),
              ),
            );
          // The next arrival names the previous exchange in non-content effect metadata. Do not
          // filter by its own date: a read-back may arrive after this report's last scheduled date.
          const previousId = sql<string>`${outbound.payload}->'effect'->>'previousExchangeId'`;
          const readBackRows = await tx
            .select({
              exchangeId: previousId,
              attempts: outbound.attempts,
              status: outbound.status,
            })
            .from(outbound)
            .where(
              and(
                eq(outbound.memberId, person.id),
                eq(outbound.kind, "arrival"),
                inArray(previousId, ids),
              ),
            );
          const expiredMetadata = await tx
            .select({ id: outbound.id })
            .from(outbound)
            .where(
              and(
                eq(outbound.memberId, person.id),
                eq(outbound.kind, "arrival"),
                gte(outbound.localDay, addDays(from, 1)),
                lte(outbound.localDay, localDateOf(generatedAt, person.tz)),
                sql`${outbound.payload} = '{}'::jsonb`,
              ),
            );
          const quietRows = await tx
            .select({
              exchangeId: quietEvents.exchangeId,
              notices: quietEvents.notifyCount,
              outcome: quietEvents.outcome,
              useful: quietEvents.useful,
            })
            .from(quietEvents)
            .where(and(eq(quietEvents.memberId, person.id), inArray(quietEvents.exchangeId, ids)));
          const awayRows = await tx
            .select({
              fromDate: awayPeriods.fromDate,
              toDate: awayPeriods.toDate,
              endedAt: awayPeriods.endedAt,
            })
            .from(awayPeriods)
            .where(and(eq(awayPeriods.memberId, person.id), lte(awayPeriods.fromDate, through)));
          // An open-ended period runs until it was ended, or to the end of the window.
          const awayOn = (day: LocalDate): boolean =>
            awayRows.some((period) => {
              const last =
                period.toDate ??
                (period.endedAt === null ? through : localDateOf(period.endedAt, person.tz));
              return period.fromDate <= day && day <= last;
            });
          const stopRows = await tx
            .select({ id: events.id })
            .from(events)
            .where(
              and(
                eq(events.memberId, person.id),
                eq(events.name, "stop_said"),
                gte(events.at, new Date(generatedAt.getTime() - windowDays * 86_400_000)),
              ),
            );
          const days = rows.map((row): TrialDay => {
            const arrivals = arrivalRows.filter((item) => item.exchangeId === row.id);
            const readBacks = readBackRows.filter((item) => item.exchangeId === row.id);
            const human = replyRows.filter((item) => item.exchangeId === row.id);
            const quiet = quietRows.find((item) => item.exchangeId === row.id);
            return {
              day: row.day as LocalDate,
              fallback: row.type === "hello",
              delivered: row.deliveredAt !== null,
              failed: row.failedAt !== null,
              answered: row.answeredAt !== null,
              arrivalAttempts: arrivals.reduce((n, item) => n + item.attempts, 0),
              arrivalUnsuccessfulAttempts: unsuccessfulAttempts(arrivals),
              arrivalSent: arrivals.filter((item) => item.status === "sent").length,
              arrivalFailed: arrivals.filter((item) => item.status === "failed").length,
              arrivalDropped: arrivals.filter((item) => item.status === "dropped").length,
              arrivalPending: arrivals.filter((item) => item.status === "queued").length,
              answerCount: answerRows.filter((item) => item.exchangeId === row.id).length,
              latencyMin:
                row.deliveredAt === null || row.answeredAt === null
                  ? null
                  : (row.answeredAt.getTime() - row.deliveredAt.getTime()) / 60_000,
              humanReplies: human.length,
              repliesReadBack: human.filter((item) => item.readBackAt !== null).length,
              readBackAttempts: readBacks.reduce((n, item) => n + item.attempts, 0),
              readBackUnsuccessfulAttempts: unsuccessfulAttempts(readBacks),
              readBackSent: readBacks.filter((item) => item.status === "sent").length,
              readBackFailed: readBacks.filter((item) => item.status === "failed").length,
              readBackDropped: readBacks.filter((item) => item.status === "dropped").length,
              readBackPending: readBacks.filter((item) => item.status === "queued").length,
              quietNotices: quiet?.notices ?? 0,
              quietOutcome: quiet?.outcome ?? null,
              quietUseful: quiet?.useful ?? null,
              away: awayOn(row.day as LocalDate),
            };
          });
          const latencies = days.flatMap((day) =>
            day.latencyMin !== null && day.latencyMin >= 0 ? [day.latencyMin] : [],
          );
          const eligible = days.filter((day) => day.delivered && !day.away);
          recipients.push({
            recipientId: person.id,
            lightOn: person.lightOn,
            timezone: person.tz,
            from,
            through,
            unobservedDays: windowDays - days.length,
            expiredArrivalMetadata: expiredMetadata.length,
            days,
            summary: {
              recordedDays: days.length,
              deliveredDays: days.filter((day) => day.delivered).length,
              failedDays: days.filter((day) => day.failed).length,
              answeredDays: days.filter((day) => day.answered).length,
              fallbackDays: days.filter((day) => day.fallback).length,
              answerCount: days.reduce((n, day) => n + day.answerCount, 0),
              humanReplies: days.reduce((n, day) => n + day.humanReplies, 0),
              repliesReadBack: days.reduce((n, day) => n + day.repliesReadBack, 0),
              medianLatencyMin: median(latencies),
              latencySamples: latencies.length,
              preArrivalAnswers: days.filter((day) => day.latencyMin !== null && day.latencyMin < 0)
                .length,
              eligibleDays: eligible.length,
              eligibleAnsweredDays: eligible.filter((day) => day.answered).length,
              awayDays: days.filter((day) => day.away).length,
              repliesHeardDays: days.filter((day) => day.answered && day.repliesReadBack > 0)
                .length,
              quietNoticeDays: days.filter((day) => day.quietNotices > 0).length,
              usefulYes: days.filter((day) => day.quietNotices > 0 && day.quietUseful === true)
                .length,
              usefulNo: days.filter((day) => day.quietNotices > 0 && day.quietUseful === false)
                .length,
              trueConcern: days.filter((day) => day.quietOutcome === "true_concern").length,
              stopsSaid: stopRows.length,
            },
          });
        }
        return { familyId, generatedAt, windowDays, recipients };
      },
      { isolationLevel: "repeatable read" },
    );
  } catch (error) {
    // PostgreSQL refuses a repeatable-read row lock when deletion committed after the snapshot.
    // Resolve only the confirmed deletion; unrelated query/conflict failures remain failures.
    if (/:40001(?: <- |$)/.test(errorLabel(error))) {
      const [current] = await deps.db
        .select({ id: families.id })
        .from(families)
        .where(and(eq(families.id, familyId), isNull(families.deletedAt)));
      if (current === undefined) return null;
    }
    throw error;
  }
}

export interface TrialOverview {
  generatedAt: Date;
  windowDays: 7 | 30;
  /** Kept-light members across every family with one, each with their family for the link. */
  parents: { familyId: string; report: TrialRecipientReport }[];
  /** The same numbers over all of them together: the trial's answer to "are we winning?". */
  totals: TrialRecipientReport["summary"];
  /** Kept-light members who said stop at least once in the window. */
  parentsWhoStopped: number;
}

const SUMMED_KEYS = [
  "recordedDays",
  "deliveredDays",
  "failedDays",
  "answeredDays",
  "fallbackDays",
  "answerCount",
  "humanReplies",
  "repliesReadBack",
  "latencySamples",
  "preArrivalAnswers",
  "eligibleDays",
  "eligibleAnsweredDays",
  "awayDays",
  "repliesHeardDays",
  "quietNoticeDays",
  "usefulYes",
  "usefulNo",
  "trueConcern",
  "stopsSaid",
] as const;

/**
 * Every family with a kept-light member, through the same audited per-family report (one view log
 * per family read). Counts only, like the report; the median latency of the totals is left out
 * because medians do not add.
 */
export async function loadAdminTrialOverview(
  deps: Deps,
  ctx: AdminContext,
  windowDays: 7 | 30 = 30,
): Promise<TrialOverview> {
  if (ctx.familyId !== undefined) {
    throw new VelaError("invalid_payload", "Invalid trial overview scope");
  }
  const rows = await deps.db
    .selectDistinct({ familyId: members.familyId })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .where(and(eq(members.lightOn, true), isNull(families.deletedAt)))
    .orderBy(asc(members.familyId));
  const parents: TrialOverview["parents"] = [];
  for (const { familyId } of rows) {
    const report = await loadAdminTrialReport(deps, ctx, familyId, windowDays);
    for (const recipient of report?.recipients ?? []) {
      if (recipient.lightOn) parents.push({ familyId, report: recipient });
    }
  }
  const totals = Object.fromEntries(
    SUMMED_KEYS.map((key) => [key, parents.reduce((n, p) => n + p.report.summary[key], 0)]),
  ) as Omit<TrialRecipientReport["summary"], "medianLatencyMin">;
  return {
    generatedAt: deps.clock.now(),
    windowDays,
    parents,
    totals: { ...totals, medianLatencyMin: null },
    parentsWhoStopped: parents.filter((p) => p.report.summary.stopsSaid > 0).length,
  };
}
