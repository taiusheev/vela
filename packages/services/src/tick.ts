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
  events,
  exchanges,
  families,
  members,
  type QuietEvent,
  quietEvents,
  turns,
  weeklyReads,
} from "@vela/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { ADMIN_CHANNEL, ADMIN_LANG, adminLink } from "./admin.ts";
import { deliverArrival, prepareDay, sendRepeat, sendTurnPrompt } from "./arrivals.ts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { applyPendingEffects, enqueueOutbound, redriveStrandedOutbound } from "./gateway.ts";
import { draftWeeklyRead } from "./jobs.ts";
import { MAX_PROCESSING_ATTEMPTS } from "./pipeline.ts";
import { notifyQuiet, openQuiet } from "./quiet.ts";
import { familyById, firstAnswersByDate, memberById } from "./repo.ts";

/**
 * How many decide-and-execute rounds one tick runs. Executing an action changes what the next
 * decision sees, so the loop runs until nothing is due, or until a round changes nothing (an
 * arrival stays due until the gateway has sent it, which wakes the scheduler again).
 */
export const MAX_TICK_ROUNDS = 5;

/*
 * `reconcile` runs every 15 minutes (2026-09-18, W3): a 5-minute cron would keep Neon awake all
 * month and spend the free plan's compute hours. The thresholds below were checked against that
 * cadence, and none needs to move: the Durable Object alarms still send every arrival at its minute,
 * and a threshold only says how old a row must be before a sweep treats it as stuck, so a slower
 * sweep catches the same rows up to 15 minutes later. A missed wake is still ticked within 25
 * minutes, long before an arrival counts as late (three hours), and the three understanding
 * attempts now fall within about 45 minutes of the answer instead of 25.
 */

/** A wake this far in the past without a tick counts as missed (flows §3.15). */
export const RECONCILE_LATE_MINUTES = 10;

/** An answer not understood is re-run once it is this old, until it is a day old. */
export const RERUN_AFTER_MINUTES = 15;
export const RERUN_WITHIN_HOURS = 24;

/**
 * `reconcile` notes an answer whose attempts are spent only once it is this old: an hour after its
 * last possible re-run, so no attempt it started can still be running or waiting in the queue. The
 * last re-run starts at most one 15-minute sweep after the day ends, which leaves 45 minutes over.
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
 * preparation and turn, her away periods, her last start, and the weeks already read. Null for a
 * member who does not exist or whose family's deletion was requested (flows §3.17), which the tick
 * treats as nothing to schedule.
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
  // A period ended since yesterday began can still hold back a threshold of yesterday or today
  // reached before its end (see `awayOn` below); every such threshold comes after one ended earlier.
  const away = await db
    .select({
      fromDate: awayPeriods.fromDate,
      toDate: awayPeriods.toDate,
      endedAt: awayPeriods.endedAt,
    })
    .from(awayPeriods)
    .where(
      and(
        eq(awayPeriods.memberId, memberId),
        or(
          isNull(awayPeriods.endedAt),
          gte(awayPeriods.endedAt, zonedInstant(yesterday, "00:00", timeZone)),
        ),
      ),
    );
  // Her last start, which `start` records with her status in one transaction and only the event log
  // keeps (flows §3.13). One before her yesterday began came before every morning read here.
  const [resumed] = await db
    .select({ at: events.at })
    .from(events)
    .where(
      and(
        eq(events.name, "start_said"),
        eq(events.memberId, memberId),
        gte(events.at, zonedInstant(yesterday, "00:00", timeZone)),
      ),
    )
    .orderBy(desc(events.at))
    .limit(1);
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
      resumedAt: resumed?.at ?? null,
    },
    family: { turnsEnabled: family.turnsEnabled },
    days,
    tomorrow: {
      prepared: tomorrowExchange !== null && tomorrowExchange.state !== "composed",
      turnPromptSent: turn !== undefined,
      askScheduled: tomorrowExchange !== null && tomorrowExchange.state === "composed",
    },
    // A period covers its dates until it ends, by `end_away` or by her answer (flows §3.17): the
    // repeat and quiet thresholds reached before the end stay held back, or they would all fall due
    // at the end, yesterday's included, while the ones reached after it come as on any day.
    awayOn: (date, at) =>
      away.some(
        (period) =>
          period.fromDate <= date &&
          (period.toDate === null || period.toDate >= date) &&
          (period.endedAt === null || at.getTime() < period.endedAt.getTime()),
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
 * The `next_wake_at` a tick stores for its decision `decided`, in one statement, so a wake marked
 * between the tick's reads and its write is never lost. `observed` is the wake the tick read before
 * anything its decision reads. A stored wake that differs from it was written while the tick ran,
 * by a flow marking its change or by another tick, and the decision may not have seen why: the
 * sooner of the two is kept, as the Durable Object keeps the sooner alarm, and a change the decision
 * did see costs one tick that finds nothing due. No clock reading can tell such a wake apart: a flow
 * stamps it with the time it read before its own work, which can be before the tick started. The
 * wake the tick read (the one that caused it, or an earlier decision) is replaced. It is compared to
 * the millisecond, the precision of the `Date` it was read into: a wake written by hand in SQL can
 * hold microseconds, and would otherwise look changed to every tick and be kept, waking her at once,
 * forever. Null clears the wake whatever is stored, as the scheduler is cleared.
 */
function storedWake(decided: Date | null, observed: Date | null): SQL | null {
  if (decided === null) {
    return null;
  }
  return sql`case when date_trunc('milliseconds', ${members.nextWakeAt}) is distinct from ${observed}::timestamptz then least(${members.nextWakeAt}, ${decided}::timestamptz) else ${decided}::timestamptz end`;
}

/**
 * Decides what is due for the member, runs it, and decides again until nothing is due or a round
 * changed nothing, at most `MAX_TICK_ROUNDS` times; then stores `next_wake_at` from the last
 * decision, or the sooner wake another flow asked for during the tick (`storedWake`), arms the
 * scheduler with what was stored, and returns it. Null clears the scheduler: the member is paused,
 * her light is off, or her family is being deleted.
 */
export async function tickMember(deps: Deps, memberId: string): Promise<Date | null> {
  // Read before anything the decision reads, so every wake marked after it shows as a change.
  const observed = (await memberById(deps.db, memberId))?.nextWakeAt ?? null;
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
  const [stored] = await deps.db
    .update(members)
    .set({ nextWakeAt: storedWake(nextWakeAt, observed) })
    .where(eq(members.id, memberId))
    .returning({ nextWakeAt: members.nextWakeAt });
  // No row means the member is gone, and her decision was already null.
  const wake = stored?.nextWakeAt ?? null;
  await deps.scheduler.wakeAt(memberId, wake);
  deps.logger.info("scheduler_tick", {
    memberId,
    actions: kinds.join(","),
    nextWakeAt: wake?.toISOString() ?? null,
  });
  return wake;
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
 * Every 15 minutes (flows §3.15): finishes the sends whose effects never landed; re-drives the
 * queued sends whose delivery job was lost; ticks the active kept-light members whose wake never
 * came, logging each missed one; re-runs the answers not understood; notes the ones that failed for
 * good; then records the heartbeat, which only a run that got this far reaches, so the watchdog
 * outside Cloudflare sees a silence when reconciliation stops. A member whose tick throws is logged
 * and skipped, so one broken member never holds the others back.
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
