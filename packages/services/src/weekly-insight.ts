/**
 * ADR-48: what may lie beneath the week's words, for the founder only, and feedback for each
 * organiser on their own messages, drafted beside the weekly read (`draftWeeklyRead` in jobs.ts).
 *
 * The model sees her week's own words (written answers, transcripts, the options she tapped), each
 * morning's ask with who sent it, and the family's replies and reactions to her, by first name. Code
 * then keeps only what it can stand behind: a reading only when every quote it rests on is found word
 * for word in that week's messages and it uses no clinical word; feedback only for an organiser who
 * receives the read, and never a line that holds one of her health words or another family member's
 * name. Both are stored in `weekly_reads.stats` and cleared 30 days after the week ends
 * (`applyRetention`), as her words are.
 */
import type {
  InsightDay,
  InsightMessage,
  InsightPerson,
  InsightReading,
  WeeklyInsight,
  WeeklyInsightInput,
} from "@vela/ai";
import type { LocalDate } from "@vela/contracts";
import { localTimeOf } from "@vela/core";
import { answers, exchanges, type Family, type Member, members, replies } from "@vela/db";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { Queryable } from "./repo.ts";

/** The founder-only readings as stored, with the prompt that wrote them. */
export interface StoredInsight {
  readings: InsightReading[];
  prompt_version: string;
}

/** One organiser's draft feedback as stored, by member id. */
export interface StoredFeedback {
  member_id: string;
  landed: string;
  try_next: string;
}

/** The week as the model reads it, and what code needs to check its answer. */
export interface InsightWeek {
  input: WeeklyInsightInput;
  /** The family member behind each key ("f1" → member id). */
  memberOf: ReadonlyMap<string, string>;
  /** Her health words that week (`mentions.health`), which no feedback line may hold. */
  healthWords: readonly string[];
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The most family members the input names; a larger family's later writers are left out. */
const MAX_PEOPLE = 12;

/** Clinical words a reading or a feedback line may never use, whatever the model wrote. */
const CLINICAL =
  /\b(?:depress\w*|dementia|alzheimer\w*|disorder|cognitive|diagnos\w*|symptom\w*)\b|憂鬱|失智|焦慮症|症狀|診斷/iu;

function weekdayOf(date: LocalDate): (typeof WEEKDAY_NAMES)[number] {
  return WEEKDAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "Sunday";
}

function textIn(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null || !Object.hasOwn(payload, key)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Her answer as the model reads it: its form and its words, as written, said, or tapped. */
function answerMessage(answer: {
  kind: string;
  payload: unknown;
  transcript: string | null;
}): Pick<InsightMessage, "form" | "text"> {
  switch (answer.kind) {
    case "voice":
      return { form: "voice", text: answer.transcript };
    case "text":
      return { form: "words", text: textIn(answer.payload, "text") };
    case "photo":
      return { form: "photo", text: textIn(answer.payload, "text") };
    case "chip":
    case "vote":
      return { form: "tap", text: textIn(answer.payload, "choice") };
    case "photo_pick": {
      const payload = answer.payload as { index?: unknown } | null;
      const index = typeof payload?.index === "number" ? payload.index : null;
      return { form: "tap", text: index === null ? null : `photo ${index + 1}` };
    }
    case "fine":
      return { form: "tap", text: "I'm fine" };
    case "not_okay":
      return { form: "tap", text: "Not okay" };
    case "heart":
      return { form: "reaction", text: "heart" };
    case "sticker":
      return { form: "reaction", text: "sticker" };
    default:
      return { form: "tap", text: null };
  }
}

function replyMessage(reply: {
  kind: string;
  text: string | null;
}): Pick<InsightMessage, "form" | "text"> {
  switch (reply.kind) {
    case "text":
      return { form: "words", text: reply.text };
    case "voice":
      return { form: "voice", text: reply.text };
    case "photo":
      return { form: "photo", text: reply.text };
    default:
      return { form: "reaction", text: reply.kind };
  }
}

/**
 * Her week from `weekStart` to `weekEnd`: each morning's ask, her answers, and the family's replies
 * to her, oldest first. Organisers in `organiserIds` get feedback; everyone else who wrote is named
 * so a reading can tell who said what. Null when the week holds no message at all.
 */
export async function loadInsightWeek(
  db: Queryable,
  member: Member,
  family: Family,
  weekStart: LocalDate,
  weekEnd: LocalDate,
  organiserIds: ReadonlySet<string>,
): Promise<InsightWeek | null> {
  const asks = await db
    .select({
      id: exchanges.id,
      date: exchanges.scheduledFor,
      type: exchanges.type,
      text: exchanges.text,
      askerId: exchanges.askerId,
    })
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, member.id),
        gte(exchanges.scheduledFor, weekStart),
        lte(exchanges.scheduledFor, weekEnd),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .orderBy(asc(exchanges.scheduledFor));
  if (asks.length === 0) {
    return null;
  }
  const ids = asks.map((ask) => ask.id);
  const hers = await db
    .select({
      exchangeId: answers.exchangeId,
      kind: answers.kind,
      payload: answers.payload,
      transcript: answers.transcript,
      mentions: answers.mentions,
      at: answers.receivedAt,
    })
    .from(answers)
    .where(and(eq(answers.memberId, member.id), inArray(answers.exchangeId, ids)))
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  const theirs = await db
    .select({
      exchangeId: replies.exchangeId,
      memberId: replies.memberId,
      kind: replies.kind,
      text: replies.text,
      at: replies.createdAt,
    })
    .from(replies)
    .where(
      and(
        inArray(replies.exchangeId, ids),
        ne(replies.memberId, member.id),
        eq(replies.toRecipient, true),
      ),
    )
    .orderBy(asc(replies.createdAt), asc(replies.id));
  const names = new Map(
    (
      await db
        .select({ id: members.id, name: members.displayName })
        .from(members)
        .where(eq(members.familyId, family.id))
    ).map((row) => [row.id, row.name]),
  );

  // Keys in the order people first wrote to her: asks first, then replies.
  const keyOf = new Map<string, string>();
  const keyFor = (memberId: string | null): string | null => {
    if (memberId === null || memberId === member.id || !names.has(memberId)) return null;
    const known = keyOf.get(memberId);
    if (known !== undefined) return known;
    if (keyOf.size >= MAX_PEOPLE) return null;
    const key = `f${keyOf.size + 1}`;
    keyOf.set(memberId, key);
    return key;
  };
  for (const ask of asks) keyFor(ask.askerId);
  for (const reply of theirs) keyFor(reply.memberId);

  const days: InsightDay[] = [];
  for (const ask of asks) {
    const messages: (InsightMessage & { sortAt: number })[] = [
      ...hers
        .filter((answer) => answer.exchangeId === ask.id)
        .map((answer) => ({
          from: "elder",
          at: localTimeOf(answer.at, member.tz),
          ...answerMessage(answer),
          sortAt: answer.at.getTime(),
        })),
      ...theirs.flatMap((reply) => {
        const key = reply.exchangeId === ask.id ? keyFor(reply.memberId) : null;
        return key === null
          ? []
          : [
              {
                from: key,
                at: localTimeOf(reply.at, member.tz),
                ...replyMessage(reply),
                sortAt: reply.at.getTime(),
              },
            ];
      }),
    ];
    // The query bounds the date, so a null one is only the type's; it is skipped all the same.
    if (messages.length === 0 || ask.date === null) continue;
    messages.sort((a, b) => a.sortAt - b.sortAt);
    days.push({
      date: ask.date,
      weekday: weekdayOf(ask.date),
      ask: {
        from: ask.type === "hello" ? "vela" : (keyFor(ask.askerId) ?? "vela"),
        type: ask.type,
        text: ask.text,
      },
      messages: messages.map(({ sortAt: _sortAt, ...message }) => message),
    });
  }
  if (days.length === 0) {
    return null;
  }
  const family_: InsightPerson[] = [...keyOf].map(([memberId, key]) => ({
    key,
    name: names.get(memberId) ?? key,
    feedback: organiserIds.has(memberId),
  }));
  const healthWords = hers.flatMap((answer) => {
    const health = (answer.mentions as { health?: unknown }).health;
    return Array.isArray(health)
      ? health.filter((word): word is string => typeof word === "string" && word.trim() !== "")
      : [];
  });
  return {
    input: {
      lang: family.language,
      elderName: member.displayName,
      weekEnd,
      days: days.slice(-7),
      family: family_,
    },
    memberOf: new Map([...keyOf].map(([memberId, key]) => [key, memberId])),
    healthWords,
  };
}

function normalised(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * What code keeps of the model's answer (ADR-48). A reading stays only when every quote is found in
 * one message of the week, word for word apart from spacing and case, and it uses no clinical word;
 * each quote then carries the date of the message it was found in. Feedback stays only for a person
 * marked to get it, and only when neither line holds a clinical word, one of her health words, or
 * another family member's name.
 */
export function keptInsight(
  week: InsightWeek,
  output: WeeklyInsight,
): { readings: InsightReading[]; feedback: StoredFeedback[] } {
  const texts = week.input.days.flatMap((day) => [
    ...(day.ask?.text ? [{ date: day.date, text: normalised(day.ask.text) }] : []),
    ...day.messages.flatMap((message) =>
      message.text === null ? [] : [{ date: day.date, text: normalised(message.text) }],
    ),
  ]);
  const readings = output.readings.flatMap((reading) => {
    if (CLINICAL.test(reading.reading)) return [];
    const quotes = reading.quotes.map((quote) => {
      const wanted = normalised(quote.text);
      const found =
        wanted.length === 0
          ? undefined
          : (texts.find((entry) => entry.date === quote.date && entry.text.includes(wanted)) ??
            texts.find((entry) => entry.text.includes(wanted)));
      return found === undefined ? null : { date: found.date, text: quote.text.trim() };
    });
    return quotes.every((quote) => quote !== null) ? [{ ...reading, quotes }] : [];
  });

  const health = week.healthWords.map(normalised).filter((word) => word.length > 0);
  const feedback = output.feedback.flatMap((entry) => {
    const person = week.input.family.find((candidate) => candidate.key === entry.key);
    const memberId = week.memberOf.get(entry.key);
    if (person === undefined || memberId === undefined || !person.feedback) return [];
    const both = normalised(`${entry.landed}\n${entry.tryNext}`);
    const others = week.input.family
      .filter((candidate) => candidate.key !== entry.key)
      .map((candidate) => normalised(candidate.name))
      .filter((name) => name.length >= 2);
    if (
      CLINICAL.test(both) ||
      health.some((word) => both.includes(word)) ||
      others.some((name) => both.includes(name))
    ) {
      return [];
    }
    return [{ member_id: memberId, landed: entry.landed.trim(), try_next: entry.tryNext.trim() }];
  });
  return { readings, feedback };
}
