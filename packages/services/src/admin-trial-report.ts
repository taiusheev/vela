import type { LocalDate, QuietOutcome } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { answers, exchanges, families, members, outbound, quietEvents, replies } from "@vela/db";
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
}

export interface TrialRecipientReport {
  recipientId: string;
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
  };
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
          .select({ id: members.id, tz: members.tz })
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
            })
            .from(quietEvents)
            .where(and(eq(quietEvents.memberId, person.id), inArray(quietEvents.exchangeId, ids)));
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
            };
          });
          const latencies = days.flatMap((day) =>
            day.latencyMin !== null && day.latencyMin >= 0 ? [day.latencyMin] : [],
          );
          recipients.push({
            recipientId: person.id,
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
