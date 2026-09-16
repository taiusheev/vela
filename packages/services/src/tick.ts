/**
 * One kept-light member's scheduler tick (architecture §6, flows §3.4 to §3.8, §3.12, §3.14,
 * §3.15): the database mapped to core's `ScheduleInput`, the due actions run through the flow
 * modules, and the next wake persisted for the Durable Object alarm and for `reconcile`. Every
 * action is idempotent, so a tick that runs twice, or beside a reconciliation, produces one effect.
 * `reconcile` also re-runs the answers that were never understood, and tells the founder once when
 * an answer has failed three times.
 */
import type { LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  addDays,
  addMinutes,
  type DayState,
  type DueAction,
  decideSchedule,
  localDateOf,
  outboundKey,
  type ScheduleInput,
  zonedInstant,
} from "@vela/core";
import {
  answers,
  awayPeriods,
  type Exchange,
  exchanges,
  families,
  members,
  type QuietEvent,
  quietEvents,
  turns,
  weeklyReads,
} from "@vela/db";
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { ADMIN_CHANNEL, ADMIN_LANG, adminLink } from "./admin.ts";
import { deliverArrival, prepareDay, sendRepeat, sendTurnPrompt } from "./arrivals.ts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { applyPendingEffects, enqueueOutbound, redriveStrandedOutbound } from "./gateway.ts";
import { draftWeeklyRead } from "./jobs.ts";
import { MAX_PROCESSING_ATTEMPTS } from "./pipeline.ts";
import { notifyQuiet, openQuiet } from "./quiet.ts";
import { familyById, memberById, type Queryable } from "./repo.ts";

/**
 * How many decide-and-execute rounds one tick runs. Executing an action changes what the next
 * decision sees, so the loop runs until nothing is due, or until a round changes nothing (an
 * arrival stays due until the gateway has sent it, which wakes the scheduler again).
 */
export const MAX_TICK_ROUNDS = 5;

/** A wake this far in the past without a tick counts as missed (flows §3.15). */
export const RECONCILE_LATE_MINUTES = 10;

/** An answer not understood is re-run once it is this old, until it is a day old. */
export const RERUN_AFTER_MINUTES = 15;
export const RERUN_WITHIN_HOURS = 24;

/**
 * `reconcile` notes an answer whose attempts are spent only once it is this old: an hour after its
 * last possible re-run, so no attempt it started can still be running or waiting in the queue.
 */
export const FAILURE_NOTE_AFTER_HOURS = RERUN_WITHIN_HOURS + 1;
/** The note is still sent up to this age, so reconciliations missing for most of a day lose none. */
const FAILURE_NOTE_WITHIN_HOURS = 2 * RERUN_WITHIN_HOURS;

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * When her first answer of each local date between `from` and `to` arrived: an answer sent before
 * the day's arrival attaches to the previous exchange and still counts for the day (flows §3.9).
 */
async function firstAnswersByDate(
  db: Queryable,
  memberId: string,
  timeZone: string,
  from: LocalDate,
  to: LocalDate,
): Promise<Map<LocalDate, Date>> {
  const rows = await db
    .select({ receivedAt: answers.receivedAt })
    .from(answers)
    .where(
      and(
        eq(answers.memberId, memberId),
        gte(answers.receivedAt, zonedInstant(from, "00:00", timeZone)),
        lt(answers.receivedAt, zonedInstant(addDays(to, 1), "00:00", timeZone)),
      ),
    )
    .orderBy(asc(answers.receivedAt));
  const first = new Map<LocalDate, Date>();
  for (const row of rows) {
    const date = localDateOf(row.receivedAt, timeZone);
    if (!first.has(date)) {
      first.set(date, row.receivedAt);
    }
  }
  return first;
}

function dayStateOf(
  date: LocalDate,
  exchange: Exchange | null,
  quiet: QuietEvent | null,
  firstAnswer: Date | null,
): DayState {
  return {
    date,
    prepared: exchange !== null && exchange.state !== "composed",
    deliveredAt: exchange?.deliveredAt ?? null,
    deliveryFailed: exchange !== null && exchange.deliveryFailedAt !== null,
    answeredAt: earliest(exchange?.answeredAt ?? null, firstAnswer),
    repeatSentAt: exchange?.repeatedAt ?? null,
    quiet:
      quiet === null
        ? null
        : {
            openedAt: quiet.openedAt,
            lastNotifiedAt: quiet.lastNotifiedAt,
            waitUntil: quiet.waitUntil,
            resolvedAt: quiet.resolvedAt,
          },
  };
}

/**
 * The member's state as core's schedule reads it, at `now`: her yesterday and today, tomorrow's
 * preparation and turn, her away periods, and the weeks already read. Null for a member who does
 * not exist or whose family's deletion was requested (flows §3.17), which the tick treats as
 * nothing to schedule.
 */
export async function loadScheduleInput(
  deps: Deps,
  memberId: string,
  now: Date,
): Promise<ScheduleInput | null> {
  const db = deps.db;
  const member = await memberById(db, memberId);
  const family = member === null ? null : await familyById(db, member.familyId);
  if (member === null || family === null || family.deletedAt !== null) {
    return null;
  }
  const timeZone = member.tz;
  const today = localDateOf(now, timeZone);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  const rows = await db
    .select({ exchange: exchanges, quiet: quietEvents })
    .from(exchanges)
    .leftJoin(quietEvents, eq(quietEvents.exchangeId, exchanges.id))
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        inArray(exchanges.scheduledFor, [yesterday, today, tomorrow]),
        ne(exchanges.state, "withdrawn"),
      ),
    );
  const byDate = new Map(rows.map((row) => [row.exchange.scheduledFor, row]));
  const firstAnswers = await firstAnswersByDate(db, memberId, timeZone, yesterday, today);
  const days = [yesterday, today].map((date) => {
    const row = byDate.get(date);
    return dayStateOf(
      date,
      row?.exchange ?? null,
      row?.quiet ?? null,
      firstAnswers.get(date) ?? null,
    );
  });

  const tomorrowExchange = byDate.get(tomorrow)?.exchange ?? null;
  // The turn row is written with the prompt's outbound row, or alone when there is no group, so its
  // presence means the evening's question was asked, or recorded as not to be asked (flows §3.4).
  const [turn] = await db
    .select({ recipientId: turns.recipientId })
    .from(turns)
    .where(
      and(
        eq(turns.familyId, family.id),
        eq(turns.localDay, tomorrow),
        eq(turns.recipientId, memberId),
      ),
    )
    .limit(1);
  const away = await db
    .select({ fromDate: awayPeriods.fromDate, toDate: awayPeriods.toDate })
    .from(awayPeriods)
    .where(and(eq(awayPeriods.memberId, memberId), isNull(awayPeriods.endedAt)));
  const reads = await db
    .select({ weekStart: weeklyReads.weekStart })
    .from(weeklyReads)
    .where(
      and(eq(weeklyReads.memberId, memberId), gte(weeklyReads.weekStart, addDays(today, -13))),
    );
  const weekStarts = new Set(reads.map((read) => read.weekStart));

  return {
    now,
    member: {
      timeZone,
      arrivalTime: member.arrivalTime,
      status: member.status,
      lightOn: member.lightOn,
      quietAfterMinutes: member.quietAfterMin,
      startsOn: member.lightStartsOn,
      learningUntil: member.learningUntil,
    },
    family: { turnsEnabled: family.turnsEnabled },
    days,
    tomorrow: {
      prepared: tomorrowExchange !== null && tomorrowExchange.state !== "composed",
      turnPromptSent: turn !== undefined,
      askScheduled: tomorrowExchange !== null && tomorrowExchange.state === "composed",
    },
    awayOn: (date) =>
      away.some(
        (period) => period.fromDate <= date && (period.toDate === null || period.toDate >= date),
      ),
    weeklyReadDoneFor: (weekEnd) => weekStarts.has(addDays(weekEnd, -6)),
  };
}

async function execute(deps: Deps, memberId: string, action: DueAction): Promise<void> {
  switch (action.kind) {
    case "deliver_arrival":
      await deliverArrival(deps, memberId, action.date, action.late);
      return;
    case "send_repeat":
      await sendRepeat(deps, memberId, action.date);
      return;
    case "open_quiet":
      await openQuiet(deps, memberId, action.date, action.notify);
      return;
    case "notify_quiet":
      await notifyQuiet(deps, memberId, action.date);
      return;
    case "send_turn_prompt":
      await sendTurnPrompt(deps, memberId, action.forDate);
      return;
    case "prepare":
      await prepareDay(deps, memberId, action.forDate);
      return;
    case "draft_weekly_read":
      await draftWeeklyRead(deps, memberId, action.weekEnd);
      return;
  }
}

function sameActions(a: readonly DueAction[], b: readonly DueAction[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Her schedule, run after a change that can make something due (flows §3.2, §3.13, §3.17). It is
 * `tickMember`; the flows take it as a parameter so a test can watch the call without running a
 * whole schedule.
 */
export type TickMember = (deps: Deps, memberId: string) => Promise<unknown>;

/**
 * Decides what is due for the member, runs it, and decides again until nothing is due or a round
 * changed nothing, at most `MAX_TICK_ROUNDS` times; then stores `next_wake_at` from the last
 * decision, arms the scheduler with it, and returns it. Null clears the scheduler: the member is
 * paused, her light is off, or her family is being deleted.
 */
export async function tickMember(deps: Deps, memberId: string): Promise<Date | null> {
  let previous: DueAction[] | null = null;
  let nextWakeAt: Date | null = null;
  const kinds: string[] = [];
  for (let round = 1; round <= MAX_TICK_ROUNDS; round += 1) {
    const input = await loadScheduleInput(deps, memberId, deps.clock.now());
    if (input === null) {
      nextWakeAt = null;
      break;
    }
    const decision = decideSchedule(input);
    nextWakeAt = decision.nextWakeAt;
    if (decision.due.length === 0 || (previous !== null && sameActions(previous, decision.due))) {
      break;
    }
    for (const action of decision.due) {
      kinds.push(action.kind);
      await execute(deps, memberId, action);
    }
    previous = decision.due;
  }
  await deps.db.update(members).set({ nextWakeAt }).where(eq(members.id, memberId));
  await deps.scheduler.wakeAt(memberId, nextWakeAt);
  deps.logger.info("scheduler_tick", {
    memberId,
    actions: kinds.join(","),
    nextWakeAt: nextWakeAt?.toISOString() ?? null,
  });
  return nextWakeAt;
}

export interface ReconcileResult {
  ticked: number;
  missed: number;
  rerun: number;
  /** Sent rows whose effects were applied late (D-B1). */
  effects: number;
}

/** True for a voice answer that still has no words to understand. */
function needsTranscript(answer: { kind: string; transcript: string | null }): boolean {
  return answer.kind === "voice" && (answer.transcript === null || answer.transcript.trim() === "");
}

/**
 * Re-enqueues the answers not yet understood (flows §3.15): received 15 minutes to 24 hours ago,
 * fewer than three attempts, in families that are not being deleted. Voice without a transcript goes
 * back to ingestion; anything else to understanding. Re-runs send nothing twice: every message the
 * jobs produce is keyed per answer.
 */
async function rerunUnderstanding(deps: Deps, now: Date): Promise<number> {
  const rows = await deps.db
    .select({ id: answers.id, kind: answers.kind, transcript: answers.transcript })
    .from(answers)
    .innerJoin(members, eq(members.id, answers.memberId))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        isNull(families.deletedAt),
        isNull(answers.understoodAt),
        lt(answers.processingAttempts, MAX_PROCESSING_ATTEMPTS),
        gte(answers.receivedAt, addMinutes(now, -RERUN_WITHIN_HOURS * 60)),
        lte(answers.receivedAt, addMinutes(now, -RERUN_AFTER_MINUTES)),
      ),
    )
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  for (const row of rows) {
    if (needsTranscript(row)) {
      await deps.queues.media.send({ type: "ingest_answer_media", answerId: row.id });
    } else {
      await deps.queues.understand.send({ type: "understand_answer", answerId: row.id });
    }
  }
  if (rows.length > 0) {
    deps.logger.info("understanding_rerun", { answers: rows.length });
  }
  return rows.length;
}

/**
 * Tells the founder once about each answer that failed its third attempt: a content-free note with
 * a link to the family's admin page. The job that ran the attempt sends the same note under the
 * same key when it ends (flows §3.15), so this only catches a job that never got to it (a crash
 * after counting the attempt), and the key makes a later reconciliation add nothing.
 *
 * Stored state cannot tell a crashed job from one still running: an answer whose third attempt is
 * under way, or whose third ingestion succeeded with its understanding still queued, looks the same.
 * So the note waits until no attempt can still be alive: attempts start only when the answer
 * arrives and on re-runs within its first day, so an hour after that day nothing is left to finish.
 */
async function noteUnderstandFailures(deps: Deps, now: Date): Promise<void> {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return;
  }
  const failed = await deps.db
    .select({ id: answers.id, exchangeId: answers.exchangeId, member: members, family: families })
    .from(answers)
    .innerJoin(members, eq(members.id, answers.memberId))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        isNull(families.deletedAt),
        isNull(answers.understoodAt),
        gte(answers.processingAttempts, MAX_PROCESSING_ATTEMPTS),
        gte(answers.receivedAt, addMinutes(now, -FAILURE_NOTE_WITHIN_HOURS * 60)),
        lte(answers.receivedAt, addMinutes(now, -FAILURE_NOTE_AFTER_HOURS * 60)),
      ),
    );
  for (const row of failed) {
    const result = await enqueueOutbound(deps, deps.db, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: admin,
        suffix: `understand_failed:${row.id}`,
      }),
      memberId: row.member.id,
      channel: ADMIN_CHANNEL,
      conversationId: admin,
      exchangeId: row.exchangeId,
      lang: ADMIN_LANG,
      text: t(ADMIN_LANG, "admin.understand_failed", {
        family: row.family.name,
        link: adminLink(deps.config, row.family.id),
      }),
    });
    if ("outboundId" in result) {
      deps.logger.warn("understand_failed", { answerId: row.id, familyId: row.family.id });
    }
  }
}

/**
 * Every five minutes (flows §3.15): finishes the sends whose effects never landed; re-drives the
 * queued sends whose delivery job was lost; ticks the active kept-light members whose wake never
 * came, logging each missed one; re-runs the answers not understood; notes the ones that failed for
 * good; pings the heartbeat. A member whose tick throws
 * is logged and skipped, so one broken member never holds the others back.
 */
export async function reconcile(deps: Deps): Promise<ReconcileResult> {
  const now = deps.clock.now();
  // Before the ticks: an arrival sent whose exchange never moved to `delivered` would otherwise
  // look undelivered to the schedule (D-B1), and one whose delivery was lost can only go out
  // through its own row, since the schedule's next try finds the same idempotency key.
  const effects = await applyPendingEffects(deps);
  await redriveStrandedOutbound(deps);
  const lateBefore = addMinutes(now, -RECONCILE_LATE_MINUTES);
  const due = await deps.db
    .select({ member: members })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        isNull(families.deletedAt),
        eq(members.status, "active"),
        eq(members.lightOn, true),
        or(isNull(members.nextWakeAt), lt(members.nextWakeAt, lateBefore)),
      ),
    )
    .orderBy(asc(members.nextWakeAt), asc(members.id));
  let ticked = 0;
  let missed = 0;
  for (const { member } of due) {
    const wake = member.nextWakeAt;
    try {
      if (wake !== null) {
        const lateMinutes = Math.floor((now.getTime() - wake.getTime()) / 60_000);
        deps.logger.warn("scheduler_missed", { memberId: member.id, lateMinutes });
        await recordEvent(
          deps.db,
          {
            name: "scheduler_missed",
            familyId: member.familyId,
            memberId: member.id,
            props: { late_minutes: lateMinutes },
          },
          now,
        );
        missed += 1;
      }
      await tickMember(deps, member.id);
      ticked += 1;
    } catch (error) {
      deps.logger.error("reconcile_tick_failed", {
        memberId: member.id,
        error: errorLabel(error),
      });
    }
  }
  const rerun = await rerunUnderstanding(deps, now);
  await noteUnderstandFailures(deps, now);
  await deps.heartbeat.ping();
  return { ticked, missed, rerun, effects };
}
