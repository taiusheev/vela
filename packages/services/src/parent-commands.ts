/**
 * Her plain-word commands (spec §9, flows §3.13): stop pauses everything and clears her scheduler,
 * start brings it back, and "what does the family see" shows her what her answers became, in her
 * language: the summaries of her last seven answered days and the lines of the latest sent weekly
 * read, never its counts or its suggestion (spec §8: she is never shown missed days).
 *
 * The router has already matched the words (`parseParentCommand`); this module checks the gate of
 * §3.9 again, so a command before consent or after the end changes nothing.
 */
import type { InboundEvent, Lang, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  localDateOf,
  outboundKey,
  type ParentCommand,
  renderWeeklyRead,
  type WeeklyReadStats,
} from "@vela/core";
import {
  answers,
  exchanges,
  type Family,
  type Member,
  members,
  translations,
  type VelaTransaction,
  weeklyReads,
} from "@vela/db";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import { canAnswer } from "./answers.ts";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { fitMessageText, formatAwayDate } from "./format.ts";
import { enqueueOutbound } from "./gateway.ts";
import { summariesForHer } from "./pipeline.ts";
import { activeOrganisersWithLinks, familyById, markWakeDue } from "./repo.ts";
import { type TickMember, tickMember } from "./tick.ts";

/** The pilot's organisers are reached on Telegram (flows §3.13). */
const ORGANISER_CHANNEL = "telegram";

/** "The summaries of her last seven answered days" (flows §3.13). */
const SUMMARY_DAYS = 7;

/** The counts in `weekly_reads.stats`, read loosely: her copy never shows them (flows §3.13). */
const Stats = z
  .object({
    counted_days: z.number().int().optional(),
    answered_days: z.number().int().optional(),
    hello_mornings: z.number().int().optional(),
    family_asks: z.number().int().optional(),
  })
  .loose();

/** Her reply, keyed by the inbound event, so a redelivered command answers once. */
async function reply(
  deps: Deps,
  db: VelaTransaction | Deps["db"],
  member: Member,
  event: InboundEvent,
  suffix: string,
  text: string,
): Promise<void> {
  await enqueueOutbound(deps, db, {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: event.conversation.externalId,
      suffix: `${suffix}:${event.eventId}`,
    }),
    memberId: member.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    lang: member.language,
    text,
  });
}

/**
 * Stop (flows §3.13): she is paused and her scheduler is cleared, in one transaction under her row
 * lock; the organisers hear it without judgement. A stop while already paused only repeats her
 * reply, so the event and the organisers' note are recorded once.
 */
async function stop(deps: Deps, member: Member, event: InboundEvent, now: Date): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(members).where(eq(members.id, member.id)).for("update");
    if (locked === undefined) {
      return;
    }
    await reply(deps, tx, locked, event, "stopped", t(locked.language, "parent.stopped"));
    if (locked.status !== "active") {
      return;
    }
    await tx
      .update(members)
      .set({ status: "paused", nextWakeAt: null })
      .where(eq(members.id, locked.id));
    const organisers = await activeOrganisersWithLinks(tx, locked.familyId, ORGANISER_CHANNEL);
    for (const organiser of organisers) {
      const lang = organiser.member.language;
      await enqueueOutbound(deps, tx, {
        kind: "system",
        idempotencyKey: outboundKey("system", {
          conversationId: organiser.link.externalId,
          suffix: `stopped:${event.eventId}`,
        }),
        memberId: organiser.member.id,
        channel: organiser.link.channel,
        conversationId: organiser.link.externalId,
        lang,
        text: t(lang, "organiser.stopped", { name: locked.displayName }),
      });
    }
    await recordEvent(
      tx,
      { name: "stop_said", familyId: locked.familyId, memberId: locked.id, surface: event.channel },
      now,
    );
  });
  // Paused means nothing is due: the alarm and everything the object stores go (flows §3.15).
  await deps.scheduler.wakeAt(member.id, null);
}

/** The later of two local dates; a null start date holds nothing back. */
function laterOf(a: LocalDate | null, b: LocalDate): LocalDate {
  return a !== null && a > b ? a : b;
}

/**
 * Start (flows §3.13), only when she paused: active again, with arrivals from today at the earliest
 * so a morning already past is not sent late at night, then her schedule is ticked. True when she
 * was paused, so a repeated start changes nothing more.
 */
async function start(deps: Deps, member: Member, event: InboundEvent, now: Date): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(members).where(eq(members.id, member.id)).for("update");
    if (locked === undefined || locked.status !== "paused") {
      return false;
    }
    const today = localDateOf(now, locked.tz);
    await tx
      .update(members)
      .set({ status: "active", lightStartsOn: laterOf(locked.lightStartsOn, today) })
      .where(eq(members.id, locked.id));
    await markWakeDue(tx, locked.id, now);
    await reply(
      deps,
      tx,
      locked,
      event,
      "started",
      t(locked.language, "parent.started", { time: locked.arrivalTime }),
    );
    await recordEvent(
      tx,
      {
        name: "start_said",
        familyId: locked.familyId,
        memberId: locked.id,
        surface: event.channel,
      },
      now,
    );
    return true;
  });
}

interface DaySummary {
  date: LocalDate;
  summary: string;
}

/**
 * The summary of each of her last seven answered days, newest first, in her language: the latest
 * summarised answer of each exchange she answered. The model writes summaries in the family's
 * language, so when hers differs each is read from its translation for her, and as stored when
 * there is none. A day whose answer is not understood yet has nothing to show.
 */
async function recentSummaries(deps: Deps, member: Member, family: Family): Promise<DaySummary[]> {
  const days = await deps.db
    .select({
      id: exchanges.id,
      scheduledFor: exchanges.scheduledFor,
      answeredAt: exchanges.answeredAt,
    })
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, member.id),
        isNotNull(exchanges.answeredAt),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .orderBy(desc(exchanges.answeredAt), desc(exchanges.id))
    .limit(SUMMARY_DAYS);
  if (days.length === 0) {
    return [];
  }
  const rows = await deps.db
    .select({ id: answers.id, exchangeId: answers.exchangeId, summary: answers.summary })
    .from(answers)
    .where(
      and(
        inArray(
          answers.exchangeId,
          days.map((day) => day.id),
        ),
        isNotNull(answers.summary),
      ),
    )
    .orderBy(desc(answers.receivedAt), desc(answers.id));
  const latest = new Map<string, { id: string; summary: string }>();
  for (const row of rows) {
    if (row.summary !== null && !latest.has(row.exchangeId)) {
      latest.set(row.exchangeId, { id: row.id, summary: row.summary });
    }
  }
  const translated =
    family.language === member.language
      ? new Map<string, string>()
      : await summariesForHer(
          deps.db,
          [...latest.values()].map((answer) => answer.id),
          member.language,
        );
  const summaries = new Map<string, string>();
  for (const [exchangeId, answer] of latest) {
    summaries.set(exchangeId, translated.get(answer.id) ?? answer.summary);
  }
  return days.flatMap((day) => {
    const summary = summaries.get(day.id);
    if (summary === undefined || day.answeredAt === null) {
      return [];
    }
    return [{ date: day.scheduledFor ?? localDateOf(day.answeredAt, member.tz), summary }];
  });
}

/** `9月21日（星期日）：…` in Traditional Chinese, `Sunday 21 September: …` otherwise. */
function dayLine(lang: Lang, day: DaySummary): string {
  const separator = lang === "zh-TW" ? "：" : ": ";
  return `${formatAwayDate(day.date, lang)}${separator}${day.summary}`;
}

/**
 * The lines of the most recent sent weekly read, as she may read them (flows §3.13): its
 * `translations` row in her language when one was written, else the lines as sent; rendered for
 * her audience, which is the lines alone. Null when no read was sent or the read has no lines.
 */
async function latestWeeklyReadLines(deps: Deps, member: Member): Promise<string | null> {
  const [read] = await deps.db
    .select()
    .from(weeklyReads)
    .where(and(eq(weeklyReads.memberId, member.id), isNotNull(weeklyReads.sentAt)))
    .orderBy(desc(weeklyReads.sentAt), desc(weeklyReads.id))
    .limit(1);
  if (read === undefined || read.sentLines === null) {
    return null;
  }
  const [translation] = await deps.db
    .select({ text: translations.text })
    .from(translations)
    .where(
      and(
        eq(translations.objectType, "weekly_read"),
        eq(translations.objectId, read.id),
        eq(translations.lang, member.language),
      ),
    )
    .limit(1);
  const lines = translation === undefined ? read.sentLines : translation.text.split("\n");
  const parsed = Stats.safeParse(read.stats);
  const stats: WeeklyReadStats = {
    countedDays: parsed.success ? (parsed.data.counted_days ?? 0) : 0,
    answeredDays: parsed.success ? (parsed.data.answered_days ?? 0) : 0,
    helloMornings: parsed.success ? (parsed.data.hello_mornings ?? 0) : 0,
    familyAsks: parsed.success ? (parsed.data.family_asks ?? 0) : 0,
  };
  return renderWeeklyRead({
    lang: member.language,
    name: member.displayName,
    stats,
    lines,
    suggestion: read.sentSuggestion ?? "",
    audience: "kept_light_member",
  });
}

/** What the family sees (flows §3.13), as one message in her language. */
async function whatFamilySees(
  deps: Deps,
  member: Member,
  family: Family,
  event: InboundEvent,
): Promise<void> {
  const lang = member.language;
  const summaries = await recentSummaries(deps, member, family);
  const paragraphs: string[] = [];
  if (summaries.length === 0) {
    paragraphs.push(t(lang, "parent.family_sees_empty"));
  } else {
    paragraphs.push(
      [t(lang, "parent.family_sees_heading"), ...summaries.map((day) => dayLine(lang, day))].join(
        "\n",
      ),
    );
  }
  const read = await latestWeeklyReadLines(deps, member);
  if (read !== null) {
    paragraphs.push(`${t(lang, "parent.family_sees_weekly_read")}\n${read}`);
  }
  await reply(deps, deps.db, member, event, "family_sees", fitMessageText(paragraphs.join("\n\n")));
}

/**
 * One command from the kept-light member in her private chat. The caller matched the words; the
 * gate of §3.9 is checked again here. `tick` runs her schedule after a start.
 */
export async function handleParentCommand(
  deps: Deps,
  member: Member,
  command: ParentCommand,
  event: InboundEvent,
  tick: TickMember = tickMember,
): Promise<void> {
  if (event.conversation.kind !== "private") {
    return;
  }
  const family = await familyById(deps.db, member.familyId);
  if (family === null || !canAnswer(member, family)) {
    deps.logger.info("parent_command_ignored", { command, status: member.status });
    return;
  }
  const now = deps.clock.now();
  switch (command) {
    case "stop":
      await stop(deps, member, event, now);
      return;
    case "start": {
      const resumed = await start(deps, member, event, now);
      if (resumed) {
        await tick(deps, member.id);
      }
      return;
    }
    case "what_family_sees":
      await whatFamilySees(deps, member, family, event);
      return;
  }
}
