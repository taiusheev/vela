/**
 * The scheduled jobs beyond one member's morning (flows §3.14, §3.15): the weekly read draft, the
 * nightly metrics rollup, and retention. The weekly read's counts are numbers services compute and
 * store; the model is given only the days she answered and writes lines and a suggestion, and the
 * founder is told there is a draft with a link and nothing else. Retention implements the pilot
 * data map rule by rule and reports a count per rule, so the nightly run is auditable.
 */
import { type AiCallRecord, isAiOff, type Mentions, type WeeklyDay } from "@vela/ai";
import type { LocalDate, LocalTime } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  addDays,
  localDateOf,
  localTimeOf,
  minutesBetween,
  outboundKey,
  quietAfterMinutes,
  TUNING,
  weekdayOf,
  zonedInstant,
} from "@vela/core";
import {
  accountLinkChallenges,
  aiCalls,
  answers,
  apiRequestReceipts,
  awayPeriods,
  chips,
  consents,
  deletions,
  type Exchange,
  events,
  exchanges,
  families,
  invites,
  type Media,
  type Member,
  media,
  members,
  messageRefs,
  metricsDaily,
  onboardingSessions,
  outbound,
  quietEvents,
  replies,
  suggestions,
  translations,
  weeklyReads,
} from "@vela/db";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { ADMIN_CHANNEL, ADMIN_LANG, adminLink } from "./admin.ts";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { forgetFamilySubjects, forgetMembersWithTheirContacts, recordDeletion } from "./proofs.ts";
import { familyById, memberById, type Queryable, recentAnswerLatencies } from "./repo.ts";

const DAYS_IN_WEEK = 7;
const RETENTION_DAYS = 30;
const RETENTION_MONTHS = 24;
/**
 * Consent and deletion proofs are kept this many calendar years once they no longer permit anything
 * (L5): long enough to answer a question about what someone agreed to or what was deleted.
 */
const PROOF_RETENTION_YEARS = 5;
const DAY_MS = 86_400_000;
/**
 * The `prompt_version` of a weekly read drafted while AI was off: no prompt wrote it, and prompt
 * versions are compared by what they wrote.
 */
const DRAFTED_WITH_AI_OFF = "ai_off";

export interface AiCallLog {
  familyId: string | null;
  memberId: string | null;
  record: AiCallRecord;
  /** What the call was about, as ids; inputs are referenced, never copied. */
  inputRef: Record<string, unknown>;
  /** The call's output when it succeeded; retention clears it after 30 days. */
  output: unknown;
  at: Date;
}

/** Every AI call is logged (flows §3.10), inside the caller's transaction when it has one. */
export async function recordAiCall(db: Queryable, log: AiCallLog): Promise<void> {
  const { record } = log;
  await db.insert(aiCalls).values({
    familyId: log.familyId,
    memberId: log.memberId,
    call: record.call,
    promptVersion: record.promptVersion,
    model: record.model,
    inputRef: log.inputRef,
    output: record.ok ? log.output : null,
    ok: record.ok,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    tokensCached: record.tokensCached,
    latencyMs: record.latencyMs,
    costUsd: record.costUsd,
    at: log.at,
  });
}

// weekly read ----------------------------------------------------------------------------------

/** The local dates from `from` to `to` inclusive. */
function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return a.getTime() <= b.getTime() ? a : b;
}

interface AnswerOnDay {
  receivedAt: Date;
  exchangeId: string;
  kind: string;
  summary: string | null;
  mentions: Record<string, unknown>;
  voiceMs: number | null;
}

interface WeekDay {
  date: LocalDate;
  exchange: Exchange | null;
  askerName: string | null;
  /** When she answered, by the rule of flows §3.9: the exchange's answer or her first message that day. */
  answeredAt: Date | null;
  /** The answers attached to the day's exchange, oldest first. */
  answers: AnswerOnDay[];
}

/**
 * Her days between two dates: each date's exchange, its asker, the answers attached to it, and when
 * the day counts as answered. An answer she sent on a date before that date's arrival attaches to the
 * previous exchange and still counts for the date it was sent on (flows §3.9).
 */
async function loadWeekDays(
  db: Queryable,
  member: Member,
  from: LocalDate,
  to: LocalDate,
): Promise<WeekDay[]> {
  const rows = await db
    .select({ exchange: exchanges, askerName: members.displayName })
    .from(exchanges)
    .leftJoin(members, eq(members.id, exchanges.askerId))
    .where(
      and(
        eq(exchanges.recipientId, member.id),
        gte(exchanges.scheduledFor, from),
        lte(exchanges.scheduledFor, to),
        ne(exchanges.state, "withdrawn"),
      ),
    );
  const byDate = new Map(rows.map((row) => [row.exchange.scheduledFor, row]));
  const exchangeIds = rows.map((row) => row.exchange.id);
  const answerRows = await db
    .select({
      receivedAt: answers.receivedAt,
      exchangeId: answers.exchangeId,
      kind: answers.kind,
      summary: answers.summary,
      mentions: answers.mentions,
      voiceMs: media.durationMs,
    })
    .from(answers)
    .leftJoin(media, eq(media.id, answers.mediaId))
    .where(
      and(
        eq(answers.memberId, member.id),
        or(
          exchangeIds.length === 0 ? sql`false` : inArray(answers.exchangeId, exchangeIds),
          and(
            gte(answers.receivedAt, zonedInstant(from, "00:00", member.tz)),
            lt(answers.receivedAt, zonedInstant(addDays(to, 1), "00:00", member.tz)),
          ),
        ),
      ),
    )
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  const firstOnDate = new Map<LocalDate, Date>();
  for (const row of answerRows) {
    const date = localDateOf(row.receivedAt, member.tz);
    if (!firstOnDate.has(date)) {
      firstOnDate.set(date, row.receivedAt);
    }
  }
  return datesBetween(from, to).map((date) => {
    const row = byDate.get(date);
    const exchange = row?.exchange ?? null;
    return {
      date,
      exchange,
      askerName: row?.askerName ?? null,
      answeredAt: earliest(exchange?.answeredAt ?? null, firstOnDate.get(date) ?? null),
      answers:
        exchange === null
          ? []
          : answerRows
              .filter((answer) => answer.exchangeId === exchange.id)
              .map((answer) => ({
                receivedAt: answer.receivedAt,
                exchangeId: answer.exchangeId,
                kind: answer.kind,
                summary: answer.summary,
                mentions: answer.mentions,
                voiceMs: answer.kind === "voice" ? answer.voiceMs : null,
              })),
    };
  });
}

function minutesOfDay(time: LocalTime): number {
  const [hour, minute] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function timeOfMinutes(minutes: number): LocalTime {
  const hour = Math.floor(minutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[middle - 1] ?? upper) + upper) / 2);
}

/** When she usually answered that week: the median wall-clock minute of her answered days. */
function usualTimeOf(days: readonly WeekDay[], timeZone: string): LocalTime | null {
  const minutes = days.flatMap((day) =>
    day.answeredAt === null ? [] : [minutesOfDay(localTimeOf(day.answeredAt, timeZone))],
  );
  const result = median(minutes);
  return result === null ? null : timeOfMinutes(result);
}

function meanVoiceMs(days: readonly WeekDay[]): number | null {
  const lengths = days.flatMap((day) =>
    day.answers.flatMap((answer) => (answer.voiceMs === null ? [] : [answer.voiceMs])),
  );
  if (lengths.length === 0) {
    return null;
  }
  return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}

/**
 * The mention lists a week's topics are drawn from. Never `health`: topics are stored in
 * `weekly_reads.stats`, kept while the family uses Vela, and health words are kept only 30 days and
 * only under a yes she can withdraw (ADR-27). A list is named here to count, so a new kind of mention
 * stays out until someone decides it may be kept that long.
 */
const TOPIC_MENTIONS = ["people", "places", "plans", "dates"] as const satisfies readonly Exclude<
  keyof Mentions,
  "health"
>[];

/** Things she mentioned on two or more days, in her words, at most ten; never her health words. */
function repeatedMentions(days: readonly WeekDay[]): string[] {
  const datesByMention = new Map<string, { text: string; dates: Set<LocalDate> }>();
  for (const day of days) {
    for (const answer of day.answers) {
      for (const list of TOPIC_MENTIONS.map((kind) => answer.mentions[kind])) {
        if (!Array.isArray(list)) {
          continue;
        }
        for (const item of list) {
          if (typeof item !== "string" || item.trim().length === 0) {
            continue;
          }
          const key = item.trim().toLowerCase();
          const entry = datesByMention.get(key) ?? { text: item.trim(), dates: new Set() };
          entry.dates.add(day.date);
          datesByMention.set(key, entry);
        }
      }
    }
  }
  return [...datesByMention.values()]
    .filter((entry) => entry.dates.size >= 2)
    .map((entry) => entry.text.slice(0, 120))
    .slice(0, 10);
}

function weeklyDayOf(day: WeekDay, answeredAt: Date, timeZone: string): WeeklyDay {
  const summary = day.answers.find((answer) => answer.summary !== null)?.summary ?? null;
  const voiceMs = day.answers.find((answer) => answer.voiceMs !== null)?.voiceMs ?? null;
  return {
    date: day.date,
    answeredAt: localTimeOf(answeredAt, timeZone),
    askerName: day.exchange === null || day.exchange.type === "hello" ? null : day.askerName,
    askType: day.exchange?.type ?? null,
    summary,
    voiceSeconds: voiceMs === null ? null : voiceMs / 1000,
  };
}

/** Sunday, as `weekdayOf` numbers the days. */
const SUNDAY = 0;

/**
 * T_quiet from her own rhythm (spec §8): the median answer latency of her last 14 answered days
 * plus two hours, floored at 4 h and capped at 10 h, recomputed once a week with her read, so
 * silence is measured against the person rather than against the six-hour default she starts on.
 * Below 14 answered days `quietAfterMinutes` keeps that default.
 *
 * `answer_stats` records what the number was computed from, the Sunday median beside it. The
 * schedule holds one threshold for every day, so the Sunday median is stored rather than applied:
 * spec §8's Sunday and holiday branch needs `ScheduleInput` to carry both, which is core's to give.
 */
async function tuneQuietAfter(deps: Deps, member: Member): Promise<void> {
  const timings = await recentAnswerLatencies(deps.db, member.id, TUNING.minSamples);
  const latencies = timings.map((row) => minutesBetween(row.deliveredAt, row.answeredAt));
  const sundays = timings.flatMap((row) =>
    weekdayOf(localDateOf(row.answeredAt, member.tz)) === SUNDAY
      ? [minutesBetween(row.deliveredAt, row.answeredAt)]
      : [],
  );
  const minutes = quietAfterMinutes(latencies);
  await deps.db
    .update(members)
    .set({
      quietAfterMin: minutes,
      answerStats: {
        median_latency_min: median(latencies),
        sunday_median_min: median(sundays),
        n_days: latencies.length,
        updated_at: deps.clock.now().toISOString(),
      },
    })
    .where(eq(members.id, member.id));
  deps.logger.info("quiet_after_tuned", {
    memberId: member.id,
    minutes,
    days: latencies.length,
  });
}

/**
 * Drafts the read for the week ending `weekEnd` (a Sunday): the counts into `weekly_reads.stats`,
 * the lines and the suggestion from `ai.weeklyRead` given only the days she answered (its safe
 * default, no lines and a generic suggestion, when the call fails or AI is off), and one
 * content-free note to the founder. T_quiet is retuned in the same weekly pass. A week already
 * drafted is left as it is.
 */
export async function draftWeeklyRead(
  deps: Deps,
  memberId: string,
  weekEnd: LocalDate,
): Promise<void> {
  const member = await memberById(deps.db, memberId);
  const family = member === null ? null : await familyById(deps.db, member.familyId);
  if (member === null || family === null || family.deletedAt !== null) {
    deps.logger.warn("weekly_read_context_missing", { memberId, weekEnd });
    return;
  }
  const weekStart = addDays(weekEnd, 1 - DAYS_IN_WEEK);
  const [existing] = await deps.db
    .select({ id: weeklyReads.id })
    .from(weeklyReads)
    .where(and(eq(weeklyReads.memberId, memberId), eq(weeklyReads.weekStart, weekStart)))
    .limit(1);
  if (existing !== undefined) {
    return;
  }
  // A first week counts only the days since her light started (flows §3.14).
  const firstCounted =
    member.lightStartsOn !== null && member.lightStartsOn > weekStart
      ? member.lightStartsOn
      : weekStart;
  if (firstCounted > weekEnd) {
    deps.logger.warn("weekly_read_before_start", { memberId, weekEnd });
    return;
  }
  // Before the model is asked anything, so a week whose draft fails still retunes her threshold.
  await tuneQuietAfter(deps, member);
  const lastWeekStart = addDays(weekStart, -DAYS_IN_WEEK);
  const allDays = await loadWeekDays(deps.db, member, lastWeekStart, weekEnd);
  const lastWeek = allDays.filter((day) => day.date < weekStart);
  const counted = allDays.filter((day) => day.date >= firstCounted);

  const answered = counted.filter((day) => day.answeredAt !== null);
  const helloMornings = counted.filter((day) => day.exchange?.type === "hello").length;
  const familyAsks = counted.filter(
    (day) => day.exchange !== null && day.exchange.type !== "hello",
  ).length;
  const usualTime = usualTimeOf(counted, member.tz);
  const lastUsualTime = usualTimeOf(lastWeek, member.tz);
  const driftMin =
    usualTime === null || lastUsualTime === null
      ? null
      : minutesOfDay(usualTime) - minutesOfDay(lastUsualTime);
  const voiceMs = meanVoiceMs(counted);
  const lastVoiceMs = meanVoiceMs(lastWeek);
  const voiceLenDrift =
    voiceMs === null || lastVoiceMs === null || lastVoiceMs === 0
      ? null
      : Math.round(((voiceMs - lastVoiceMs) / lastVoiceMs) * 100);
  const topics = repeatedMentions(counted);

  const outcome = await deps.ai.weeklyRead({
    lang: family.language,
    elderName: member.displayName,
    weekEnd,
    days: answered.flatMap((day) =>
      day.answeredAt === null ? [] : [weeklyDayOf(day, day.answeredAt, member.tz)],
    ),
    usualAnswerTime: usualTime,
    answerTimeDriftMinutes: driftMin,
    voiceLengthDriftPercent: voiceLenDrift,
    repeatedMentions: topics,
  });
  // AI off is not a failure: the draft is the safe default, and nothing is logged as a failed call.
  if (!outcome.ok && !isAiOff(outcome)) {
    deps.logger.warn("weekly_read_draft_failed", { memberId, weekEnd, error: outcome.error });
  }
  const now = deps.clock.now();
  const stats = {
    counted_days: counted.length,
    answered_days: answered.length,
    hello_mornings: helloMornings,
    family_asks: familyAsks,
    usual_time: usualTime,
    drift_min: driftMin,
    topics,
    voice_len_drift: voiceLenDrift,
  };
  await deps.db.transaction(async (tx) => {
    if (!isAiOff(outcome)) {
      await recordAiCall(tx, {
        familyId: family.id,
        memberId: member.id,
        record: outcome.record,
        inputRef: { member_id: member.id, week_end: weekEnd },
        output: outcome.value,
        at: now,
      });
    }
    const [read] = await tx
      .insert(weeklyReads)
      .values({
        familyId: family.id,
        memberId: member.id,
        weekStart,
        lines: outcome.value.lines,
        suggestion: outcome.value.suggestion,
        stats,
        promptVersion: isAiOff(outcome) ? DRAFTED_WITH_AI_OFF : outcome.record.promptVersion,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: weeklyReads.id });
    if (read === undefined) {
      return;
    }
    await recordEvent(
      tx,
      {
        name: "weekly_read_drafted",
        familyId: family.id,
        memberId: member.id,
        props: {
          week_end: weekEnd,
          counted_days: counted.length,
          answered_days: answered.length,
          lines: outcome.value.lines.length,
          ok: outcome.ok,
          // Tells a draft made while AI was off from one whose call failed; both are not ok.
          ai_off: isAiOff(outcome),
        },
      },
      now,
    );
    const admin = deps.config.adminConversationId;
    if (admin === null) {
      return;
    }
    await enqueueOutbound(deps, tx, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: admin,
        suffix: `weekly_read_draft:${read.id}`,
      }),
      memberId: member.id,
      channel: ADMIN_CHANNEL,
      conversationId: admin,
      lang: ADMIN_LANG,
      text: t(ADMIN_LANG, "admin.weekly_read_draft", {
        family: family.name,
        link: adminLink(deps.config, family.id),
      }),
    });
  });
}

// metrics ----------------------------------------------------------------------------------------

/**
 * Writes yesterday's `metrics_daily` row for every kept-light member of a family that is not being
 * deleted, her local yesterday, from her exchange of that day. A row already written is refreshed,
 * so a second run of the night changes nothing it should not. Returns the rows written.
 */
export async function rollupMetrics(deps: Deps): Promise<number> {
  const now = deps.clock.now();
  const rows = await deps.db
    .select({ member: members })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        isNull(families.deletedAt),
        or(eq(members.lightOn, true), isNotNull(members.lightConsentedAt)),
      ),
    )
    .orderBy(asc(members.createdAt), asc(members.id));
  let written = 0;
  for (const { member } of rows) {
    const day = addDays(localDateOf(now, member.tz), -1);
    if (member.lightStartsOn !== null && day < member.lightStartsOn) {
      continue;
    }
    const [weekDay] = await loadWeekDays(deps.db, member, day, day);
    if (weekDay === undefined) {
      continue;
    }
    const exchange = weekDay.exchange;
    const replyCount =
      exchange === null
        ? 0
        : (
            await deps.db
              .select({ id: replies.id })
              .from(replies)
              .where(and(eq(replies.exchangeId, exchange.id), eq(replies.toRecipient, true)))
          ).length;
    const [quiet] =
      exchange === null
        ? []
        : await deps.db
            .select()
            .from(quietEvents)
            .where(eq(quietEvents.exchangeId, exchange.id))
            .limit(1);
    const away = await deps.db
      .select({ id: awayPeriods.id })
      .from(awayPeriods)
      .where(
        and(
          eq(awayPeriods.memberId, member.id),
          isNull(awayPeriods.endedAt),
          lte(awayPeriods.fromDate, day),
          or(isNull(awayPeriods.toDate), gte(awayPeriods.toDate, day)),
        ),
      )
      .limit(1);
    const answerKind: Record<string, number> = {};
    for (const answer of weekDay.answers) {
      answerKind[answer.kind] = (answerKind[answer.kind] ?? 0) + 1;
    }
    const deliveredAt = exchange?.deliveredAt ?? null;
    const values = {
      delivered: deliveredAt === null ? 0 : 1,
      answered: weekDay.answeredAt === null ? 0 : 1,
      answerKind,
      latencyMin:
        deliveredAt === null || weekDay.answeredAt === null
          ? null
          : minutesBetween(deliveredAt, weekDay.answeredAt),
      replies: replyCount,
      readBack: exchange === null ? null : exchange.readBackAt !== null,
      quietNotice: quiet !== undefined && quiet.notifyCount > 0,
      quietOutcome: quiet?.outcome ?? null,
      away: away.length > 0,
      quietDay: exchange?.type === "hello",
    };
    await deps.db
      .insert(metricsDaily)
      .values({ day, familyId: member.familyId, memberId: member.id, ...values })
      .onConflictDoUpdate({ target: [metricsDaily.day, metricsDaily.memberId], set: values });
    written += 1;
  }
  deps.logger.info("metrics_rolled_up", { rows: written });
  return written;
}

// retention --------------------------------------------------------------------------------------

/** `exchanges.options` with every occurrence of the id removed, whatever shape the options take. */
function optionsWithout(id: string) {
  const asJson = sql`to_jsonb(${id}::text)`;
  const options = exchanges.options;
  return sql`case jsonb_typeof(${options})
    when 'array' then (select coalesce(jsonb_agg(element), '[]'::jsonb) from jsonb_array_elements(${options}) element where element <> ${asJson})
    when 'object' then (select coalesce(jsonb_object_agg(key, case when jsonb_typeof(value) = 'array' then (select coalesce(jsonb_agg(element), '[]'::jsonb) from jsonb_array_elements(value) element where element <> ${asJson}) else value end), '{}'::jsonb) from jsonb_each(${options}) where value <> ${asJson})
    else ${options} end`;
}

/**
 * Deletes one media file: the stored object first, so no object outlives its row, then in one
 * transaction the proof of deletion (the hash of `media:<id>`, never of the storage key or the
 * provider file id, L4), the id's removal from `exchanges.media_ids` and `exchanges.options`, and
 * the row; the foreign keys set the other references null.
 *
 * With storage off (decision M) a row has no storage key and there is no object to delete, so the
 * proof and the row go as they always do. A row that was stored before storage was switched off
 * keeps an object nobody here can reach: that is logged, because only the founder can delete it.
 */
async function deleteMedia(deps: Deps, row: Media, reason: string): Promise<void> {
  if (row.storageKey !== null) {
    if (deps.media === null) {
      deps.logger.error("media_object_unreachable", { mediaId: row.id, reason });
    } else {
      await deps.media.delete(row.storageKey);
    }
  }
  await deps.db.transaction(async (tx) => {
    await recordDeletion(tx, {
      objectType: "media",
      objectId: row.id,
      reason,
      at: deps.clock.now(),
    });
    await tx
      .update(exchanges)
      .set({ mediaIds: sql`array_remove(${exchanges.mediaIds}, ${row.id}::uuid)` })
      .where(sql`${row.id}::uuid = any(${exchanges.mediaIds})`);
    await tx
      .update(exchanges)
      .set({ options: optionsWithout(row.id) })
      .where(
        and(isNotNull(exchanges.options), sql`${exchanges.options}::text like ${`%${row.id}%`}`),
      );
    await tx.delete(media).where(eq(media.id, row.id));
  });
}

/** Clears a kept-light member's Durable Object storage and alarm; other members have none. */
async function clearSchedulers(
  deps: Deps,
  rows: readonly { id: string; lightOn: boolean; lightConsentedAt: Date | null }[],
): Promise<void> {
  for (const row of rows) {
    if (row.lightOn || row.lightConsentedAt !== null) {
      await deps.scheduler.wakeAt(row.id, null);
    }
  }
}

/** A kept-light member still invited who never tapped Yes (a No deletes her at once). */
function neverAnswered(): SQL {
  return sql`${members.status} = 'invited' and ${members.lightConsentedAt} is null`;
}

/**
 * The members a rule deletes, in one transaction: their consent rows and their nearby contacts'
 * are forgotten first (flows §3.15, "Consent proofs"), or the delete fails on
 * `consents_subject_deleted_check`. Returns the deleted rows, for their schedulers.
 */
async function deleteMembers(
  deps: Deps,
  select: (tx: Queryable) => Promise<{ id: string }[]>,
  now: Date,
): Promise<{ id: string; lightOn: boolean; lightConsentedAt: Date | null }[]> {
  return deps.db.transaction(async (tx) => {
    const ids = (await select(tx)).map((row) => row.id);
    if (ids.length === 0) {
      return [];
    }
    await forgetMembersWithTheirContacts(tx, ids, now);
    return tx.delete(members).where(inArray(members.id, ids)).returning({
      id: members.id,
      lightOn: members.lightOn,
      lightConsentedAt: members.lightConsentedAt,
    });
  });
}

/**
 * The pilot's retention rules (flows §3.15, ADR-24, ADR-28), one after the other, each reporting how
 * many rows it changed. Families whose deletion was requested go first, their media before them so
 * every file gets its proof of deletion; then expired media; then members who left 30 days ago; then
 * invited members who never answered, 30 days after their last invite expired; then the 30-day
 * clearing and deletion; then the 24-month deletion; then the proofs that stopped permitting
 * anything 5 years ago. Every deletion of a member or a contact forgets their consent rows first.
 * Every count is recorded in one `retention_deleted` event.
 */
export async function applyRetention(deps: Deps): Promise<Record<string, number>> {
  const now = deps.clock.now();
  const cutoff30 = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const cutoff24m = new Date(now.getTime());
  cutoff24m.setUTCMonth(cutoff24m.getUTCMonth() - RETENTION_MONTHS);
  const cutoff5y = new Date(now.getTime());
  cutoff5y.setUTCFullYear(cutoff5y.getUTCFullYear() - PROOF_RETENTION_YEARS);
  const counts: Record<string, number> = {};
  const db = deps.db;

  counts.account_link_challenges_deleted = (
    await db
      .delete(accountLinkChallenges)
      .where(
        or(
          and(isNull(accountLinkChallenges.completedAt), lte(accountLinkChallenges.expiresAt, now)),
          lte(accountLinkChallenges.completedAt, new Date(now.getTime() - DAY_MS)),
        ),
      )
      .returning({ id: accountLinkChallenges.id })
  ).length;

  // A request reusing an expired receipt holds that row while it deletes the actor's other expired
  // rows, so a nightly delete that waited for it would close a lock cycle and PostgreSQL would
  // abort one side: the job, losing the rest of the night's rules, or the family's write. Skipping
  // the rows a request holds costs nothing, because the next night deletes them.
  const expiredReceipts = db
    .select({ id: apiRequestReceipts.id })
    .from(apiRequestReceipts)
    .where(lte(apiRequestReceipts.expiresAt, now))
    .for("update", { skipLocked: true });
  counts.api_request_receipts_deleted = (
    await db
      .delete(apiRequestReceipts)
      .where(inArray(apiRequestReceipts.id, expiredReceipts))
      .returning({ id: apiRequestReceipts.id })
  ).length;

  // Families whose deletion was requested, within 24 hours: media first, then everything cascades.
  const doomed = await db
    .select({ id: families.id })
    .from(families)
    .where(and(isNotNull(families.deletedAt), lte(families.deletedAt, now)));
  let familyMedia = 0;
  for (const family of doomed) {
    const files = await db.select().from(media).where(eq(media.familyId, family.id));
    for (const file of files) {
      await deleteMedia(deps, file, "family_deleted");
      familyMedia += 1;
    }
    const lit = await db
      .select({
        id: members.id,
        lightOn: members.lightOn,
        lightConsentedAt: members.lightConsentedAt,
      })
      .from(members)
      .where(eq(members.familyId, family.id));
    await db.transaction(async (tx) => {
      await forgetFamilySubjects(tx, family.id, now);
      await tx.delete(families).where(eq(families.id, family.id));
    });
    await clearSchedulers(deps, lit);
  }
  counts.families_deleted = doomed.length;
  counts.family_media_deleted = familyMedia;

  const expired = await db
    .select()
    .from(media)
    .where(and(eq(media.kept, false), isNotNull(media.expiresAt), lte(media.expiresAt, now)));
  for (const file of expired) {
    await deleteMedia(deps, file, "expired");
  }
  counts.media_deleted = expired.length;

  const gone = await deleteMembers(
    deps,
    (tx) =>
      tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.status, "left"), lt(members.leftAt, cutoff30))),
    now,
  );
  await clearSchedulers(deps, gone);
  counts.members_deleted = gone.length;

  // An invited member who never answered holds only what setup stored: she goes 30 days after her
  // last invite expired (L7), her invites and nearby contacts with her. She has no scheduler.
  counts.invited_members_deleted = (
    await deleteMembers(
      deps,
      (tx) =>
        tx
          .select({ id: members.id })
          .from(members)
          .where(
            and(
              neverAnswered(),
              sql`exists (select 1 from ${invites} where ${invites.forMemberId} = ${members.id})`,
              sql`not exists (select 1 from ${invites} where ${invites.forMemberId} = ${members.id} and ${invites.expiresAt} >= ${cutoff30})`,
            ),
          ),
      now,
    )
  ).length;

  // The ask's own words go 30 days after delivery, and 30 days after they were written when the
  // morning never reached her: `delivered_at` stays null on a failed arrival and on a whenever ask
  // nothing ever scheduled, and a NULL comparison would keep those words for good.
  counts.exchanges_cleared = (
    await db
      .update(exchanges)
      .set({ text: null, options: null })
      .where(
        and(
          lt(sql`coalesce(${exchanges.deliveredAt}, ${exchanges.createdAt})`, cutoff30),
          or(isNotNull(exchanges.text), isNotNull(exchanges.options)),
        ),
      )
      .returning({ id: exchanges.id })
  ).length;
  // The same for the rendered message: `sent_at` stays null on a row that failed, was dropped, or
  // is still queued, and the payload of a quiet notice carries the nearby contacts' phone numbers.
  counts.outbound_payloads_cleared = (
    await db
      .update(outbound)
      .set({ payload: {} })
      .where(
        and(
          lt(sql`coalesce(${outbound.sentAt}, ${outbound.queuedAt})`, cutoff30),
          sql`${outbound.payload} <> '{}'::jsonb`,
        ),
      )
      .returning({ id: outbound.id })
  ).length;
  counts.chips_deleted = (
    await db.delete(chips).where(lt(chips.createdAt, cutoff30)).returning({ id: chips.exchangeId })
  ).length;
  counts.translations_deleted = (
    await db
      .delete(translations)
      .where(lt(translations.createdAt, cutoff30))
      .returning({ id: translations.objectId })
  ).length;
  counts.replies_cleared = (
    await db
      .update(replies)
      .set({ text: null })
      .where(and(lt(replies.createdAt, cutoff30), isNotNull(replies.text)))
      .returning({ id: replies.id })
  ).length;
  counts.answers_cleared = (
    await db
      .update(answers)
      .set({
        payload: sql`${answers.payload} - 'text'`,
        transcript: null,
        mentions: {},
        moodWords: [],
        flagReason: null,
      })
      .where(
        and(
          lt(answers.receivedAt, cutoff30),
          or(
            isNotNull(answers.transcript),
            isNotNull(answers.flagReason),
            sql`${answers.payload} ? 'text'`,
            sql`${answers.mentions} <> '{}'::jsonb`,
            sql`cardinality(${answers.moodWords}) > 0`,
          ),
        ),
      )
      .returning({ id: answers.id })
  ).length;
  counts.suggestions_cleared = (
    await db
      .update(suggestions)
      .set({ text: "" })
      .where(and(lt(suggestions.createdAt, cutoff30), ne(suggestions.text, "")))
      .returning({ id: suggestions.id })
  ).length;
  counts.ai_call_outputs_cleared = (
    await db
      .update(aiCalls)
      .set({ output: null })
      .where(and(lt(aiCalls.at, cutoff30), isNotNull(aiCalls.output)))
      .returning({ id: aiCalls.id })
  ).length;
  counts.ask_to_check_replies_cleared = (
    await db
      .update(quietEvents)
      .set({
        askToCheck: sql`(select coalesce(jsonb_agg(case when entry ? 'reply' then jsonb_set(entry, '{reply}', 'null'::jsonb) else entry end), '[]'::jsonb) from jsonb_array_elements(${quietEvents.askToCheck}) entry)`,
      })
      .where(
        and(
          lt(quietEvents.openedAt, cutoff30),
          sql`exists (select 1 from jsonb_array_elements(${quietEvents.askToCheck}) entry where entry ? 'reply' and jsonb_typeof(entry -> 'reply') <> 'null')`,
        ),
      )
      .returning({ id: quietEvents.id })
  ).length;
  counts.message_refs_deleted = (
    await db
      .delete(messageRefs)
      .where(lt(messageRefs.createdAt, cutoff30))
      .returning({ id: messageRefs.messageId })
  ).length;
  counts.invites_deleted = (
    await db
      .delete(invites)
      .where(
        and(
          or(
            lt(invites.acceptedAt, cutoff30),
            and(isNull(invites.acceptedAt), lt(invites.expiresAt, cutoff30)),
          ),
          // An invite meant for a member who never answered is how the rule above finds her, so it
          // stays until she is deleted and goes with her.
          sql`not exists (select 1 from ${members} where ${members.id} = ${invites.forMemberId} and ${neverAnswered()})`,
        ),
      )
      .returning({ id: invites.id })
  ).length;
  counts.onboarding_sessions_deleted = (
    await db
      .delete(onboardingSessions)
      .where(lt(onboardingSessions.expiresAt, now))
      .returning({ id: onboardingSessions.conversationId })
  ).length;

  counts.events_deleted = (
    await db.delete(events).where(lt(events.at, cutoff24m)).returning({ id: events.id })
  ).length;
  counts.metrics_deleted = (
    await db
      .delete(metricsDaily)
      .where(lt(metricsDaily.day, localDateOf(cutoff24m, "UTC")))
      .returning({ id: metricsDaily.memberId })
  ).length;
  counts.ai_calls_deleted = (
    await db.delete(aiCalls).where(lt(aiCalls.at, cutoff24m)).returning({ id: aiCalls.id })
  ).length;
  counts.outbound_deleted = (
    await db.delete(outbound).where(lt(outbound.queuedAt, cutoff24m)).returning({ id: outbound.id })
  ).length;

  // A standing yes whose subject still exists is never deleted by age: Vela still relies on it. A
  // proof that stopped permitting anything is kept 5 years from when it stopped (L5).
  counts.consents_deleted = (
    await db
      .delete(consents)
      .where(
        and(
          or(
            eq(consents.answer, "no"),
            isNotNull(consents.withdrawnAt),
            isNotNull(consents.subjectDeletedAt),
          ),
          // greatest() skips nulls: the latest of the times that are set.
          lt(
            sql`greatest(${consents.givenAt}, ${consents.withdrawnAt}, ${consents.subjectDeletedAt})`,
            cutoff5y,
          ),
        ),
      )
      .returning({ id: consents.id })
  ).length;
  counts.deletions_deleted = (
    await db
      .delete(deletions)
      .where(lt(deletions.deletedAt, cutoff5y))
      .returning({ id: deletions.id })
  ).length;

  await recordEvent(db, { name: "retention_deleted", props: counts }, now);
  deps.logger.info("retention_applied", counts);
  return counts;
}
