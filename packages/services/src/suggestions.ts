/**
 * Tomorrow's suggestion (build plan 3.3): one ask per kept-light member per local day, written by
 * the nightly job for her next three days and shown on Today until someone composes an ask.
 *
 * Each day starts from Vela's question bank (`ASK_BANK` in `@vela/copy`): the weekday's type in a
 * rotation, never an item or its near-duplicates within six weeks, never one an ask was composed
 * from, while the bank has another, and not what her days nearby or the family's other members were
 * given. The pick is a pure function of what is stored, so a run repeated or raced picks the same
 * item. While AI is on, the model may draft a warmer ask on the same day from her recent answers; a
 * draft that fails, or that reads as a check on how she is, is dropped for the bank item. A bank row
 * stores no words at all: each reader sees the bank item in their own language.
 */
import {
  type AiOutcome,
  isAiOff,
  type Suggestion as SuggestDraft,
  type SuggestInput,
} from "@vela/ai";
import { type ExchangeType, type Lang, type LocalDate, MVP_LANGS } from "@vela/contracts";
import {
  ASK_BANK,
  ASK_BANK_TYPES,
  type AskBankItem,
  type AskBankLang,
  type AskBankType,
  askBankItem,
} from "@vela/copy";
import {
  FORBIDDEN_ZH_TW,
  GENDERED_PRONOUNS,
  HEALTH_CHECK,
  SURVEILLANCE_WORDS,
} from "@vela/copy/rules";
import { addDays, localDateOf, weekdayOf } from "@vela/core";
import {
  answers,
  exchanges,
  type Family,
  families,
  type Member,
  members,
  type Suggestion,
  suggestions,
} from "@vela/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { canBeAsked, isAskable } from "./askable.ts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { recordAiCall } from "./jobs.ts";
import { exchangeForLocalDate, familyById, familyHasEnded, memberById } from "./repo.ts";

/** The `prompt_version` of a row that holds the bank item alone: no prompt wrote it. */
export const BANK_PROMPT_VERSION = "bank.v1";
/**
 * No bank item, or another of its group, is suggested to her twice in this many days running, while
 * the bank has another.
 */
export const SUGGESTION_REPEAT_DAYS = 42;
/**
 * The days ahead of her local today each nightly run writes. Tomorrow's suggestion is there by the
 * morning before it, and a night the job misses still leaves tomorrow written by an earlier one.
 */
export const SUGGESTION_DAYS_AHEAD = [1, 2, 3] as const;
/**
 * The type each weekday proposes, Sunday first: three questions, two stories, a recipe and a word a
 * week, which the bank covers for six weeks without a repeat while few of its items are used.
 * Sunday, the default story day, is a question, since Vela's own story question may take that
 * morning.
 */
export const SUGGESTION_ROTATION: readonly AskBankType[] = [
  "question",
  "story",
  "question",
  "recipe",
  "story",
  "question",
  "word",
];
/** A group given to another member of the family is not given to her within this many days. */
const FAMILY_REPEAT_DAYS = 7;
/** Her suggestions within this many days of each other never share a topic. */
const TOPIC_GAP_DAYS = 2;
/** Her asks within this many days before a day move its rotation off their types. */
const RECENT_ASK_DAYS = 2;
/** How far back her answers' mentions reach, and how many the model is given. */
const MENTION_DAYS = 14;
const MAX_MENTIONS = 20;
/** `SuggestInput.recentMentions` holds strings of at most this many characters. */
const MENTION_LENGTH = 120;
/** How far back her last ask by anyone reaches, for the model not to repeat it. */
const LAST_ASK_DAYS = 30;
const DAY_MS = 86_400_000;

/** Wording that makes an AI draft a check on her, or that assumes her gender, in either language. */
const DRAFT_GUARDS: readonly RegExp[] = [
  HEALTH_CHECK.en,
  HEALTH_CHECK["zh-TW"],
  SURVEILLANCE_WORDS,
  GENDERED_PRONOUNS,
  FORBIDDEN_ZH_TW,
];

export type SuggestionOutcome = "written" | "existing" | "claimed" | "inactive";

export interface SuggestionsRun {
  written: number;
  existing: number;
  claimed: number;
  inactive: number;
  failed: number;
}

type WriterDeps = Pick<Deps, "db" | "clock" | "ai" | "logger">;

/** One stored suggestion, as the pick reads it: its day and its bank item. */
export interface SuggestedDay {
  readonly bankId: string;
  readonly localDay: LocalDate;
}

export interface BankPickInput {
  readonly memberId: string;
  readonly forDate: LocalDate;
  /** Her family's story day, 0 for Sunday. */
  readonly storyDay: number;
  /** Her suggestions; those beyond `SUGGESTION_REPEAT_DAYS` of `forDate` are not considered. */
  readonly recent: readonly SuggestedDay[];
  /** The bank ids of her suggestions an ask was composed from, of any age. */
  readonly used: readonly string[];
  /** The family's other members' suggestions; only those within a week of `forDate` count. */
  readonly family: readonly SuggestedDay[];
  /** The types of her asks scheduled for the two days before `forDate`, withdrawn ones left out. */
  readonly recentAskTypes: readonly ExchangeType[];
}

function isAskBankType(type: string): type is AskBankType {
  return (ASK_BANK_TYPES as readonly string[]).includes(type);
}

function groupOf(bankId: string): string {
  return askBankItem(bankId)?.group ?? bankId;
}

function within(row: SuggestedDay, forDate: LocalDate, days: number): boolean {
  return row.localDay >= addDays(forDate, -days) && row.localDay <= addDays(forDate, days);
}

/** FNV-1a over the UTF-8 bytes: a small, stable hash, so every run picks the same item. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The weekday's type, moved on to the next one in the rotation while it is blocked: a story, a
 * recipe or a word already asked for one of the two days before, or a story on her family's story
 * day. A question is never blocked, because every other type can also be composed as one.
 */
function rotationTypeFor(input: BankPickInput): AskBankType {
  const weekday = weekdayOf(input.forDate);
  const blocked = new Set<AskBankType>(
    input.recentAskTypes.filter(isAskBankType).filter((type) => type !== "question"),
  );
  if (weekday === input.storyDay) {
    blocked.add("story");
  }
  for (let step = 0; step < SUGGESTION_ROTATION.length; step += 1) {
    const type = SUGGESTION_ROTATION[(weekday + step) % SUGGESTION_ROTATION.length];
    if (type !== undefined && !blocked.has(type)) {
      return type;
    }
  }
  return "question";
}

/**
 * When every item is excluded: the one least recently suggested to her, an item an ask was composed
 * from last of all, ties by id. It keeps the pick total however long a family uses Vela.
 */
function leastRecent(input: BankPickInput): AskBankItem {
  const used = new Set(input.used.map(groupOf));
  const lastSeen = new Map<string, LocalDate>();
  for (const row of input.recent) {
    const group = groupOf(row.bankId);
    const seen = lastSeen.get(group);
    if (seen === undefined || row.localDay > seen) {
      lastSeen.set(group, row.localDay);
    }
  }
  const ranked = [...ASK_BANK].sort(
    (a, b) =>
      Number(used.has(a.group)) - Number(used.has(b.group)) ||
      (lastSeen.get(a.group) ?? "").localeCompare(lastSeen.get(b.group) ?? "") ||
      a.id.localeCompare(b.id),
  );
  const [first] = ranked;
  if (first === undefined) {
    throw new Error("the question bank is empty");
  }
  return first;
}

/**
 * The bank item for her day, a pure function of what is stored.
 *
 * Never repeated: an item whose group she was given in the `SUGGESTION_REPEAT_DAYS` days around the
 * day, that an ask was ever composed from, or that another member of her family was given within a
 * week. Kept apart where it can be: an item whose topic one of her days within two was given.
 * Candidates come from the first of these that holds any: the rotation's type kept apart, the
 * rotation's type, any type kept apart, any type (`rotationTypeFor`); so the type holds before a
 * topic is kept apart, and changes before an item repeats. Among them, an item of no group comes
 * before a near-duplicate, since giving one holds its siblings back too; this keeps every type in
 * the rotation through six weeks. They are sorted by id and one is taken by a hash of her id and the
 * day, so members of one family differ and a second run agrees with the first.
 */
export function pickBankItem(input: BankPickInput): AskBankItem {
  const { forDate } = input;
  // Days apart, not a calendar window: one repeat day apart is `SUGGESTION_REPEAT_DAYS` days.
  const own = input.recent.filter(
    (row) => row.localDay !== forDate && within(row, forDate, SUGGESTION_REPEAT_DAYS - 1),
  );
  const excludedGroups = new Set([
    ...own.map((row) => groupOf(row.bankId)),
    ...input.used.map(groupOf),
    ...input.family
      .filter((row) => within(row, forDate, FAMILY_REPEAT_DAYS))
      .map((row) => groupOf(row.bankId)),
  ]);
  const nearbyTopics = new Set(
    own
      .filter((row) => within(row, forDate, TOPIC_GAP_DAYS))
      .map((row) => askBankItem(row.bankId)?.topic),
  );
  const unrepeated = ASK_BANK.filter((item) => !excludedGroups.has(item.group));
  const fresh = unrepeated.filter((item) => !nearbyTopics.has(item.topic));
  const type = rotationTypeFor(input);
  const ofType = (items: readonly AskBankItem[]) => items.filter((item) => item.type === type);
  const [tier] = [ofType(fresh), ofType(unrepeated), fresh, unrepeated].filter(
    (items) => items.length > 0,
  );
  if (tier === undefined) {
    return leastRecent(input);
  }
  const solo = tier.filter((item) => item.group === item.id);
  const candidates = [...(solo.length > 0 ? solo : tier)].sort((a, b) => a.id.localeCompare(b.id));
  return (
    candidates[fnv1a32(`${input.memberId}:${forDate}`) % candidates.length] ?? leastRecent(input)
  );
}

/** A language the bank is written in: the one given, or English. */
function readerLang(lang: Lang): AskBankLang {
  return MVP_LANGS.find((candidate) => candidate === lang) ?? "en";
}

/** What a reader is shown of a suggestion: the words, the type they go with, and where from. */
export interface RenderedSuggestion {
  readonly text: string;
  readonly type: ExchangeType;
  /** The text is an AI draft built on something she mentioned. */
  readonly fromHerWords: boolean;
}

/**
 * A suggestion in the reader's language (their `members.language`; English when it has no bank
 * text): an AI draft when it was written in that language and retention has not cleared it, and
 * otherwise the bank item it stands on, with that item's type. Null only for a bank id the bank
 * does not hold, which appending ids alone rules out.
 */
export function renderSuggestion(
  row: Pick<Suggestion, "bankId" | "type" | "text" | "lang" | "source">,
  viewerLang: Lang,
): RenderedSuggestion | null {
  const lang = readerLang(viewerLang);
  if (row.text.trim() !== "" && row.lang === lang) {
    return { text: row.text, type: row.type, fromHerWords: row.source.ai_source === "mention" };
  }
  const item = askBankItem(row.bankId);
  return item === undefined
    ? null
    : { text: item.text[lang], type: item.type, fromHerWords: false };
}

// the writer --------------------------------------------------------------------------------------

interface Plan {
  readonly member: Member;
  readonly family: Family;
  readonly dates: readonly LocalDate[];
}

interface StoredDay extends SuggestedDay {
  readonly memberId: string;
  readonly familyId: string;
}

interface AskOnDay {
  readonly date: LocalDate;
  readonly type: ExchangeType;
}

/**
 * Everything the writer reads before it writes, for every member of a run at once: the rows near
 * the days, the bank ids used, her asks around the days, and the model's input.
 */
interface WriterContext {
  readonly days: StoredDay[];
  readonly used: ReadonlyMap<string, readonly string[]>;
  readonly asks: ReadonlyMap<string, readonly AskOnDay[]>;
  readonly organisers: ReadonlyMap<string, Member>;
  readonly mentions: ReadonlyMap<string, readonly string[]>;
  readonly lastAsks: ReadonlyMap<string, { type: ExchangeType; text: string | null }>;
}

function grouped<T, V>(
  rows: readonly T[],
  key: (row: T) => string,
  value: (row: T) => V,
): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list === undefined) {
      map.set(key(row), [value(row)]);
    } else {
      list.push(value(row));
    }
  }
  return map;
}

/** A mention as the model takes it: trimmed, and cut to its length without splitting a character. */
function mentionText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let text = "";
  for (const character of value.trim()) {
    if (text.length + character.length > MENTION_LENGTH) {
      break;
    }
    text += character;
  }
  return text.length === 0 ? null : text;
}

/**
 * The people, places and plans she mentioned in her answers of the last two weeks, newest first,
 * each once. Never her health or dates: a suggestion is never about how she is.
 */
function mentionsOf(rows: readonly Record<string, unknown>[]): string[] {
  const found: string[] = [];
  for (const mentions of rows) {
    for (const kind of ["people", "places", "plans"] as const) {
      const values = mentions[kind];
      for (const value of Array.isArray(values) ? values : []) {
        const text = mentionText(value);
        if (text !== null && !found.includes(text) && found.length < MAX_MENTIONS) {
          found.push(text);
        }
      }
    }
  }
  return found;
}

async function loadContext(
  db: WriterDeps["db"],
  now: Date,
  plans: readonly Plan[],
): Promise<WriterContext> {
  const empty: WriterContext = {
    days: [],
    used: new Map(),
    asks: new Map(),
    organisers: new Map(),
    mentions: new Map(),
    lastAsks: new Map(),
  };
  const dates = plans.flatMap((plan) => plan.dates).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) {
    return empty;
  }
  const memberIds = plans.map((plan) => plan.member.id);
  const familyIds = [...new Set(plans.map((plan) => plan.family.id))];

  const stored = await db
    .select({
      memberId: suggestions.aboutMemberId,
      familyId: suggestions.familyId,
      localDay: suggestions.localDay,
      bankId: suggestions.bankId,
      usedAt: suggestions.usedAt,
    })
    .from(suggestions)
    .where(
      and(
        inArray(suggestions.familyId, familyIds),
        or(
          and(
            gte(suggestions.localDay, addDays(first, -SUGGESTION_REPEAT_DAYS)),
            lte(suggestions.localDay, addDays(last, SUGGESTION_REPEAT_DAYS)),
          ),
          isNotNull(suggestions.usedAt),
        ),
      ),
    );
  const asks = await db
    .select({ memberId: exchanges.recipientId, date: exchanges.scheduledFor, type: exchanges.type })
    .from(exchanges)
    .where(
      and(
        inArray(exchanges.recipientId, memberIds),
        gte(exchanges.scheduledFor, addDays(first, -RECENT_ASK_DAYS)),
        lte(exchanges.scheduledFor, last),
        ne(exchanges.state, "withdrawn"),
      ),
    );
  const context: WriterContext = {
    ...empty,
    days: stored.map((row) => ({
      memberId: row.memberId,
      familyId: row.familyId,
      localDay: row.localDay,
      bankId: row.bankId,
    })),
    used: grouped(
      stored.filter((row) => row.usedAt !== null),
      (row) => row.memberId,
      (row) => row.bankId,
    ),
    asks: grouped(
      asks.flatMap((row) => (row.date === null ? [] : [{ ...row, date: row.date }])),
      (row) => row.memberId,
      (row) => ({ date: row.date, type: row.type }),
    ),
  };

  // The model's input is read only for members with a day still to write.
  const pending = plans.filter((plan) =>
    plan.dates.some((date) => dayState(context, plan.member.id, date) === null),
  );
  if (pending.length === 0) {
    return context;
  }
  const pendingIds = pending.map((plan) => plan.member.id);
  const organiserRows = await db
    .select()
    .from(members)
    .where(
      and(
        inArray(members.familyId, [...new Set(pending.map((plan) => plan.family.id))]),
        eq(members.role, "organiser"),
        eq(members.status, "active"),
      ),
    )
    .orderBy(asc(members.createdAt), asc(members.id));
  const mentionRows = await db
    .select({ memberId: answers.memberId, mentions: answers.mentions })
    .from(answers)
    .where(
      and(
        inArray(answers.memberId, pendingIds),
        gte(answers.receivedAt, new Date(now.getTime() - MENTION_DAYS * DAY_MS)),
      ),
    )
    .orderBy(desc(answers.receivedAt), desc(answers.id));
  const lastAskRows = await db
    .select({ memberId: exchanges.recipientId, type: exchanges.type, text: exchanges.text })
    .from(exchanges)
    .where(
      and(
        inArray(exchanges.recipientId, pendingIds),
        isNotNull(exchanges.askerId),
        ne(exchanges.state, "withdrawn"),
        gte(exchanges.createdAt, new Date(now.getTime() - LAST_ASK_DAYS * DAY_MS)),
      ),
    )
    .orderBy(desc(exchanges.createdAt), desc(exchanges.id));

  const organisers = new Map<string, Member>();
  for (const organiser of organiserRows) {
    if (!organisers.has(organiser.familyId)) {
      organisers.set(organiser.familyId, organiser);
    }
  }
  const lastAsks = new Map<string, { type: ExchangeType; text: string | null }>();
  for (const row of lastAskRows) {
    if (!lastAsks.has(row.memberId)) {
      lastAsks.set(row.memberId, { type: row.type, text: row.text });
    }
  }
  const mentions = new Map(
    [
      ...grouped(
        mentionRows,
        (row) => row.memberId,
        (row) => row.mentions,
      ),
    ].map(([memberId, rows]) => [memberId, mentionsOf(rows)] as const),
  );
  return { ...context, organisers, mentions, lastAsks };
}

/** Whether the day is already settled before anything is picked: written, or claimed by an ask. */
function dayState(
  context: WriterContext,
  memberId: string,
  forDate: LocalDate,
): "existing" | "claimed" | null {
  if (context.days.some((day) => day.memberId === memberId && day.localDay === forDate)) {
    return "existing";
  }
  if ((context.asks.get(memberId) ?? []).some((ask) => ask.date === forDate)) {
    return "claimed";
  }
  return null;
}

function pickFor(context: WriterContext, plan: Plan, forDate: LocalDate): AskBankItem {
  const { member, family } = plan;
  return pickBankItem({
    memberId: member.id,
    forDate,
    storyDay: family.storyDay,
    recent: context.days.filter((day) => day.memberId === member.id),
    used: context.used.get(member.id) ?? [],
    family: context.days.filter((day) => day.familyId === family.id && day.memberId !== member.id),
    recentAskTypes: (context.asks.get(member.id) ?? [])
      .filter((ask) => ask.date < forDate && ask.date >= addDays(forDate, -RECENT_ASK_DAYS))
      .map((ask) => ask.type),
  });
}

/**
 * What the model is given: written for the family's first organiser in their language, the one the
 * evening prompt names when the family has no group (`sendTurnPrompt`), since the holder is not
 * chosen until then; her name as the family calls her; the bank item's type; what she mentioned;
 * and her last ask by anyone.
 */
function suggestInput(
  context: WriterContext,
  plan: Plan,
  forDate: LocalDate,
  item: AskBankItem,
): SuggestInput {
  const { member, family } = plan;
  const organiser = context.organisers.get(family.id);
  return {
    lang: readerLang(organiser?.language ?? family.language),
    holderName: organiser?.displayName ?? family.name,
    recipientAddress: member.displayName,
    forDate,
    rotationType: item.type,
    recentMentions: [...(context.mentions.get(member.id) ?? [])],
    familyDates: [],
    holderLastAsk: context.lastAsks.get(member.id) ?? null,
  };
}

interface AcceptedDraft {
  readonly text: string;
  readonly type: AskBankType;
  readonly source: SuggestDraft["source"];
  readonly promptVersion: string;
}

/**
 * The AI draft to store, or null for the bank item: no call, a failed one, a type that needs more
 * than words, no words, or words a suggestion must never hold.
 */
function acceptedDraft(outcome: AiOutcome<SuggestDraft> | null): AcceptedDraft | null {
  if (outcome === null || !outcome.ok) {
    return null;
  }
  const { value } = outcome;
  const text = value.text.trim();
  if (text.length === 0 || !isAskBankType(value.type)) {
    return null;
  }
  if (DRAFT_GUARDS.some((guard) => guard.test(text))) {
    return null;
  }
  return {
    text,
    type: value.type,
    source: value.source,
    promptVersion: outcome.record.promptVersion,
  };
}

/**
 * One day of one member: settled days are left as they are; otherwise the bank item is picked, the
 * model asked, and the row written under her member row's lock, re-checking that she can be asked
 * and that nobody has claimed the day since it was read.
 *
 * Lock order is her family row (`for key share`, the lock the row's foreign keys take anyway), then
 * her member row (`for no key update`, which a compose's `for update` excludes), then the new row.
 * Compose locks her member row first and takes the family's key share only through its inserts'
 * foreign keys; the two key shares never conflict, so the writer and a compose queue on her member
 * row. Taking the family first also leaves no cycle with a family deletion, which locks the family
 * `for update` before it updates her member row.
 */
async function writeDay(
  deps: WriterDeps,
  context: WriterContext,
  plan: Plan,
  forDate: LocalDate,
): Promise<SuggestionOutcome> {
  const { member, family } = plan;
  const settled = dayState(context, member.id, forDate);
  if (settled !== null) {
    return settled;
  }
  const item = pickFor(context, plan, forDate);
  const input = suggestInput(context, plan, forDate, item);
  // Nothing the model does may cost her the day: a call that fails, or rejects its input, leaves
  // the bank item. AI being off is a setting, not a failure, and logs nothing.
  let outcome: AiOutcome<SuggestDraft> | null = null;
  try {
    outcome = await deps.ai.suggest(input);
  } catch (error) {
    deps.logger.warn("suggestion_ai_failed", {
      memberId: member.id,
      forDate,
      error: errorLabel(error),
    });
  }
  if (outcome !== null && !outcome.ok && !isAiOff(outcome)) {
    deps.logger.warn("suggestion_ai_failed", {
      memberId: member.id,
      forDate,
      error: outcome.error,
    });
  }
  const draft = acceptedDraft(outcome);
  const now = deps.clock.now();

  const result = await deps.db.transaction(async (tx): Promise<SuggestionOutcome> => {
    const [lockedFamily] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, family.id))
      .for("key share");
    const [locked] = await tx
      .select()
      .from(members)
      .where(eq(members.id, member.id))
      .for("no key update");
    // Every call the model answered was paid for, so it is logged whatever the day turns out to be.
    if (outcome !== null && !isAiOff(outcome)) {
      await recordAiCall(tx, {
        familyId: lockedFamily === undefined ? null : family.id,
        memberId: locked?.id ?? null,
        record: outcome.record,
        inputRef: { member_id: member.id, for_date: forDate, bank_id: item.id },
        output: outcome.value,
        at: now,
      });
    }
    if (
      lockedFamily === undefined ||
      locked === undefined ||
      !canBeAsked(locked, family.id) ||
      (await familyHasEnded(tx, family.id))
    ) {
      return "inactive";
    }
    if ((await exchangeForLocalDate(tx, locked.id, forDate)) !== null) {
      return "claimed";
    }
    const [row] = await tx
      .insert(suggestions)
      .values({
        familyId: family.id,
        forMemberId: null,
        aboutMemberId: locked.id,
        localDay: forDate,
        bankId: item.id,
        type: draft?.type ?? item.type,
        text: draft?.text ?? "",
        lang: draft === null ? null : input.lang,
        source: draft === null ? {} : { ai_source: draft.source },
        promptVersion: draft?.promptVersion ?? BANK_PROMPT_VERSION,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [suggestions.aboutMemberId, suggestions.localDay] })
      .returning({ id: suggestions.id });
    return row === undefined ? "existing" : "written";
  });
  if (result === "written") {
    context.days.push({
      memberId: member.id,
      familyId: family.id,
      localDay: forDate,
      bankId: item.id,
    });
  }
  return result;
}

/** Her next days, as the nightly run writes them: her own local tomorrow, and the days after it. */
function daysAhead(member: Member, now: Date): LocalDate[] {
  const today = localDateOf(now, member.tz);
  return SUGGESTION_DAYS_AHEAD.map((days) => addDays(today, days));
}

/**
 * One day's suggestion for one member, as the nightly run writes it (`writeSuggestions`); safe to
 * run twice and beside another writer, since the day is unique per member.
 */
export async function writeSuggestionFor(
  deps: WriterDeps,
  memberId: string,
  forDate: LocalDate,
): Promise<SuggestionOutcome> {
  const member = await memberById(deps.db, memberId);
  const family = member === null ? null : await familyById(deps.db, member.familyId);
  if (member === null || family === null || !(await isAskable(deps.db, member))) {
    return "inactive";
  }
  const plan: Plan = { member, family, dates: [forDate] };
  const context = await loadContext(deps.db, deps.clock.now(), [plan]);
  return writeDay(deps, context, plan, forDate);
}

/**
 * The nightly run (flows §3.15): every member who can be asked gets a suggestion for each of her
 * next `SUGGESTION_DAYS_AHEAD` days that has neither one nor an ask. Everything is read in a few
 * queries for all of them before anything is written. A member or a day that throws is logged and
 * counted, and the others are still written.
 */
export async function writeSuggestions(deps: WriterDeps): Promise<SuggestionsRun> {
  const now = deps.clock.now();
  const run: SuggestionsRun = { written: 0, existing: 0, claimed: 0, inactive: 0, failed: 0 };
  const rows = await deps.db
    .select({ member: members, family: families })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .where(and(isNull(families.deletedAt), eq(members.lightOn, true)))
    .orderBy(asc(members.createdAt), asc(members.id));
  const ended = new Map<string, boolean>();
  const plans: Plan[] = [];
  for (const { member, family } of rows) {
    if (!canBeAsked(member, family.id)) {
      continue;
    }
    try {
      let familyEnded = ended.get(family.id);
      if (familyEnded === undefined) {
        familyEnded = await familyHasEnded(deps.db, family.id);
        ended.set(family.id, familyEnded);
      }
      if (!familyEnded) {
        plans.push({ member, family, dates: daysAhead(member, now) });
      }
    } catch (error) {
      run.failed += 1;
      deps.logger.error("suggestion_failed", { memberId: member.id, error: errorLabel(error) });
    }
  }
  const context = await loadContext(deps.db, now, plans);
  for (const plan of plans) {
    for (const forDate of plan.dates) {
      try {
        run[await writeDay(deps, context, plan, forDate)] += 1;
      } catch (error) {
        run.failed += 1;
        deps.logger.error("suggestion_failed", {
          memberId: plan.member.id,
          forDate,
          error: errorLabel(error),
        });
      }
    }
  }
  deps.logger.info("suggestions_written", { ...run });
  return run;
}
