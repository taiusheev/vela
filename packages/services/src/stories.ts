/**
 * Her memories as the family reads them in the app, and the stories Vela gathers from them (ADR-51).
 *
 * A memory is one of her answered exchanges that a loving family would want to remember and that is
 * safe to show as one: never flagged, never naming health, never holding a sensitive word
 * (`answerKeepable`, the same rule as "Keep"). It is shown when the family kept it, when the memory
 * model found a phrase in it (`keep_suggestions`), when she sent a photo, or when she said enough to
 * be more than a greeting. Everything else she said stays in the chat, as it always has.
 *
 * A story is two to five of her memories on one subject, told across mornings. `story_weave` only
 * points: at which of her moments belong together, and at a phrase in one of them for the title.
 * Code keeps a story only when every pointer is hers and the title is found word for word, and the
 * row holds offsets, never her words, so a story fades with the answers it is made of and stays when
 * the family keeps them. Off unless `memoryStories` is on, with `memoryDiscovery` and the book.
 */
import {
  type Answer,
  answers,
  bookEntries,
  type Exchange,
  exchanges,
  keepSuggestions,
  type Member,
  media,
  members,
  memoryStories,
  memoryStoryMoments,
} from "@vela/db";
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { answerKeepable, keepingAllowed } from "./memories.ts";
import { hasSensitiveWords } from "./memory-discovery.ts";
import type { Queryable } from "./repo.ts";
import { sourceWords } from "./rich-memories.ts";

const DAY_MS = 86_400_000;
/** Her words live 30 days unless kept (privacy notice): a memory not kept fades with them. */
const FADE_DAYS = 30;
/** More than a greeting: a memory without a phrase the model found says at least this much. */
const ENOUGH_WORDS = 12;
const ENOUGH_CHARACTERS = 20;
/** The moments one weaving looks at, newest first, and the fewest worth trying. */
const WEAVE_AT_MOST = 12;
const WEAVE_AT_LEAST = 3;

export type MomentKind = "preference" | "story" | "humour" | "person" | "moment" | "follow_up";

/** One of her memories, as every live member of the family reads it. */
export interface ApiMoment {
  exchange_id: string;
  member_id: string;
  member_name: string;
  asked_by: string | null;
  question: string | null;
  /** Everything she said in answer, in her own words. */
  words: string | null;
  /** The phrase that makes it a memory, exactly as she said it, where the memory model found one. */
  quote: string | null;
  kind: MomentKind | null;
  at: string;
  photo_id: string | null;
  voice: { media_id: string; duration_ms: number | null } | null;
  kept: boolean;
  kept_by: string | null;
  story_id: string | null;
  /** When it fades with her words, unless someone keeps it; null once kept. */
  fades_at: string | null;
}

/** A story gathered from her memories, every word of it hers. */
export interface ApiMemoryStory {
  id: string;
  member_id: string;
  member_name: string;
  title: string;
  /** Its memories, oldest first: exchange ids found in `moments`. */
  moment_ids: string[];
  /** Whether the family has kept every one of its memories. */
  kept: boolean;
  from: string;
  to: string;
}

/** Whether her words say more than a greeting: a dozen words, or twenty characters of Chinese. */
export function saysEnough(text: string): boolean {
  const trimmed = text.trim();
  if (/\p{Script=Han}/u.test(trimmed)) {
    return [...trimmed.replace(/[\s\p{P}]/gu, "")].length >= ENOUGH_CHARACTERS;
  }
  return trimmed.split(/\s+/).filter((word) => word.length > 0).length >= ENOUGH_WORDS;
}

/**
 * Her memories and the stories gathered from them, newest first: from the last 30 days, and every
 * one the family kept. A member who said "memories off" has none. Read by every live member, as
 * her answers are; the caller has checked access.
 */
export async function loadMemories(
  db: Queryable,
  familyId: string,
  now: Date,
): Promise<{ moments: ApiMoment[]; stories: ApiMemoryStory[] }> {
  const since = new Date(now.getTime() - FADE_DAYS * DAY_MS);
  const asker = alias(members, "moment_asker");
  const keeper = alias(members, "moment_keeper");
  const rows = await db
    .select({
      answer: answers,
      exchange: exchanges,
      her: members,
      asker: asker.displayName,
      entry: bookEntries,
      keeper: keeper.displayName,
    })
    .from(answers)
    .innerJoin(exchanges, eq(exchanges.id, answers.exchangeId))
    .innerJoin(
      members,
      and(eq(members.id, answers.memberId), eq(members.id, exchanges.recipientId)),
    )
    .leftJoin(asker, eq(asker.id, exchanges.askerId))
    .leftJoin(bookEntries, eq(bookEntries.exchangeId, exchanges.id))
    .leftJoin(keeper, eq(keeper.id, bookEntries.keptBy))
    .where(
      and(
        eq(exchanges.familyId, familyId),
        isNull(members.memoriesOffAt),
        isNull(members.leftAt),
        or(
          gt(answers.receivedAt, since),
          and(eq(bookEntries.exchangeId, exchanges.id), isNull(bookEntries.removedAt)),
        ),
        // What she took out herself ("don't keep that one", "memories off") is not offered again.
        or(isNull(bookEntries.removedBy), ne(bookEntries.removedBy, members.id)),
      ),
    )
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  const byExchange = new Map<
    string,
    {
      exchange: Exchange;
      her: Member;
      asker: string | null;
      kept: boolean;
      keptBy: string | null;
      said: Answer[];
    }
  >();
  for (const row of rows) {
    const known = byExchange.get(row.exchange.id);
    if (known === undefined) {
      byExchange.set(row.exchange.id, {
        exchange: row.exchange,
        her: row.her,
        asker: row.asker,
        kept: row.entry !== null && row.entry.removedAt === null,
        keptBy:
          row.entry === null || row.entry.removedAt !== null || row.entry.keptBy === null
            ? null
            : (row.keeper ?? null),
        said: [row.answer],
      });
    } else {
      known.said.push(row.answer);
    }
  }
  const ids = [...byExchange.keys()];
  if (ids.length === 0) return { moments: [], stories: [] };
  const found = await db
    .select()
    .from(keepSuggestions)
    .where(
      and(
        inArray(keepSuggestions.exchangeId, ids),
        isNull(keepSuggestions.dismissedAt),
        gt(keepSuggestions.expiresAt, now),
      ),
    );
  const suggestion = new Map(found.map((row) => [row.exchangeId, row]));
  const fileIds = rows.flatMap((row) => (row.answer.mediaId === null ? [] : [row.answer.mediaId]));
  const files =
    fileIds.length === 0
      ? []
      : await db
          .select()
          .from(media)
          .where(and(eq(media.familyId, familyId), inArray(media.id, fileIds)));
  const file = new Map(files.filter((row) => row.storageKey !== null).map((row) => [row.id, row]));
  const inStory = new Map(
    (
      await db
        .select({ exchangeId: memoryStoryMoments.exchangeId, storyId: memoryStoryMoments.storyId })
        .from(memoryStoryMoments)
        .where(inArray(memoryStoryMoments.exchangeId, ids))
    ).map((row) => [row.exchangeId, row.storyId]),
  );

  const moments: ApiMoment[] = [];
  for (const { exchange, her, asker: askedBy, kept, keptBy, said } of byExchange.values()) {
    // The same rule as "Keep": one answer that cannot be kept keeps the whole exchange out.
    if (!said.every(answerKeepable)) continue;
    const words = said
      .map((answer) => sourceWords(answer)?.text.trim() ?? "")
      .filter((text) => text.length > 0)
      .join("\n");
    const picked = suggestion.get(exchange.id);
    const pickedAnswer = said.find((answer) => answer.id === picked?.answerId);
    const quote =
      picked === undefined || pickedAnswer === undefined
        ? ""
        : (sourceWords(pickedAnswer)?.text.slice(picked.start, picked.end).trim() ?? "");
    const photo = said
      .map((answer) => (answer.mediaId === null ? undefined : file.get(answer.mediaId)))
      .find((row) => row?.kind === "image");
    const voice = said
      .map((answer) => (answer.mediaId === null ? undefined : file.get(answer.mediaId)))
      .find((row) => row?.kind === "audio");
    if (!kept && quote.length === 0 && photo === undefined && !saysEnough(words)) continue;
    const first = said[0];
    if (first === undefined) continue;
    moments.push({
      exchange_id: exchange.id,
      member_id: her.id,
      member_name: her.displayName,
      asked_by: askedBy,
      question: exchange.text,
      words: words.length === 0 ? null : words,
      quote: quote.length === 0 ? null : quote,
      kind: quote.length === 0 ? null : ((picked?.kind as MomentKind | null) ?? null),
      at: first.receivedAt.toISOString(),
      photo_id: photo?.id ?? null,
      voice: voice === undefined ? null : { media_id: voice.id, duration_ms: voice.durationMs },
      kept,
      kept_by: keptBy,
      story_id: inStory.get(exchange.id) ?? null,
      fades_at: kept
        ? null
        : new Date(first.receivedAt.getTime() + FADE_DAYS * DAY_MS).toISOString(),
    });
  }
  moments.reverse();
  return { moments, stories: await storiesOf(db, familyId, moments) };
}

/**
 * The stories whose memories are still shown, two at least: a story whose memories have faded, or
 * whose title's words are gone, is no longer told.
 */
async function storiesOf(
  db: Queryable,
  familyId: string,
  moments: ApiMoment[],
): Promise<ApiMemoryStory[]> {
  const shown = new Map(moments.map((moment) => [moment.exchange_id, moment]));
  const rows = await db
    .select({ story: memoryStories, title: answers, her: members })
    .from(memoryStories)
    .innerJoin(answers, eq(answers.id, memoryStories.titleAnswerId))
    .innerJoin(members, eq(members.id, memoryStories.memberId))
    .where(and(eq(memoryStories.familyId, familyId), isNull(members.memoriesOffAt)));
  if (rows.length === 0) return [];
  const links = await db
    .select()
    .from(memoryStoryMoments)
    .where(
      inArray(
        memoryStoryMoments.storyId,
        rows.map((row) => row.story.id),
      ),
    );
  const stories: ApiMemoryStory[] = [];
  for (const { story, title, her } of rows) {
    const told = links
      .filter((link) => link.storyId === story.id)
      .flatMap((link) => {
        const moment = shown.get(link.exchangeId);
        return moment === undefined ? [] : [moment];
      })
      .sort((a, b) => a.at.localeCompare(b.at));
    const words = sourceWords(title)?.text.slice(story.titleStart, story.titleEnd).trim() ?? "";
    const first = told[0];
    const last = told.at(-1);
    if (told.length < 2 || words.length === 0 || first === undefined || last === undefined) {
      continue;
    }
    stories.push({
      id: story.id,
      member_id: her.id,
      member_name: her.displayName,
      title: words,
      moment_ids: told.map((moment) => moment.exchange_id),
      kept: told.every((moment) => moment.kept),
      from: first.at,
      to: last.at,
    });
  }
  return stories.sort((a, b) => b.to.localeCompare(a.to));
}

/** Whether a title is a short phrase of hers: two to eight words, or two to twenty characters. */
function titleFits(title: string): boolean {
  if (/\p{Script=Han}/u.test(title)) {
    const length = [...title.replace(/\s/g, "")].length;
    return length >= 2 && length <= 20;
  }
  const words = title.split(/\s+/).filter((word) => word.length > 0).length;
  return words >= 2 && words <= 8;
}

/**
 * Gathers her newest memories not yet in a story into stories, after a new one is found. Only her
 * screened phrases go to `story_weave`, with what she was asked; code keeps a story only when each
 * moment is one of those sent, none is used twice, and the title is found word for word in its
 * moment's phrase with no sensitive word. A moment is in one story at most, which the database
 * holds too, so two weavings at once never share one. Never throws, and logs only counts.
 */
export async function weaveStories(deps: Deps, member: Member): Promise<number> {
  try {
    if (
      deps.config.memoryStories !== true ||
      deps.config.memoryDiscovery !== true ||
      !keepingAllowed(deps, member)
    ) {
      return 0;
    }
    const now = deps.clock.now();
    const storied = deps.db
      .select({ exchangeId: memoryStoryMoments.exchangeId })
      .from(memoryStoryMoments);
    const rows = await deps.db
      .select({ suggestion: keepSuggestions, answer: answers, exchange: exchanges })
      .from(keepSuggestions)
      .innerJoin(answers, eq(answers.id, keepSuggestions.answerId))
      .innerJoin(exchanges, eq(exchanges.id, keepSuggestions.exchangeId))
      .where(
        and(
          eq(keepSuggestions.memberId, member.id),
          isNull(keepSuggestions.dismissedAt),
          gt(keepSuggestions.expiresAt, now),
          notInArray(keepSuggestions.exchangeId, storied),
        ),
      );
    const candidates = rows
      .filter(({ answer }) => answerKeepable(answer))
      .flatMap(({ suggestion, answer, exchange }) => {
        const words = sourceWords(answer);
        const quote = words?.text.slice(suggestion.start, suggestion.end).trim() ?? "";
        return words === null || quote.length === 0 || hasSensitiveWords(quote)
          ? []
          : [{ suggestion, answer, exchange, words: words.text, quote }];
      })
      .sort((a, b) => a.answer.receivedAt.getTime() - b.answer.receivedAt.getTime())
      .slice(-WEAVE_AT_MOST);
    if (candidates.length < WEAVE_AT_LEAST) return 0;
    const labelled = new Map(candidates.map((candidate, index) => [`m${index + 1}`, candidate]));
    const woven = await deps.ai.storyWeave({
      lang: member.language,
      addressForm: member.addressForm ?? member.displayName,
      moments: [...labelled].map(([id, candidate]) => ({
        id,
        ask: candidate.exchange.text,
        quote: candidate.quote,
        date: candidate.answer.receivedAt.toISOString().slice(0, 10),
      })),
    });
    if (!woven.ok) {
      deps.logger.warn("story_weave_failed", { memberId: member.id });
      return 0;
    }
    const used = new Set<string>();
    let made = 0;
    for (const story of woven.value.stories) {
      const ids = [...new Set(story.moments)];
      const told = ids.flatMap((id) => {
        const candidate = labelled.get(id);
        return candidate === undefined || used.has(id) ? [] : [candidate];
      });
      const titled = labelled.get(story.title_from);
      const title = story.title.trim();
      // Code, not the model, decides what her words are: the title is a phrase of her own.
      if (
        told.length < 2 ||
        told.length !== ids.length ||
        titled === undefined ||
        !ids.includes(story.title_from) ||
        !titleFits(title) ||
        hasSensitiveWords(title)
      ) {
        continue;
      }
      const start = titled.words.indexOf(title, titled.suggestion.start);
      if (start === -1 || start + title.length > titled.suggestion.end) continue;
      try {
        await deps.db.transaction(async (tx) => {
          // Her row first, shared, as "memories off" updates it: a story is never woven after it.
          const [still] = await tx
            .select({ off: members.memoriesOffAt })
            .from(members)
            .where(eq(members.id, member.id))
            .for("share");
          if (still === undefined || still.off !== null) throw new StoryTaken();
          const [row] = await tx
            .insert(memoryStories)
            .values({
              familyId: member.familyId,
              memberId: member.id,
              titleAnswerId: titled.answer.id,
              titleStart: start,
              titleEnd: start + title.length,
              createdAt: now,
            })
            .returning({ id: memoryStories.id });
          if (row === undefined) throw new StoryTaken();
          const linked = await tx
            .insert(memoryStoryMoments)
            .values(told.map(({ exchange }) => ({ storyId: row.id, exchangeId: exchange.id })))
            .onConflictDoNothing()
            .returning({ exchangeId: memoryStoryMoments.exchangeId });
          // Another weaving took one of these moments first: this story is not told.
          if (linked.length !== told.length) throw new StoryTaken();
        });
      } catch (error) {
        if (error instanceof StoryTaken) continue;
        throw error;
      }
      for (const id of ids) used.add(id);
      made += 1;
    }
    deps.logger.info("story_weave", { memberId: member.id, made });
    return made;
  } catch (error) {
    deps.logger.error("story_weave_error", { memberId: member.id, error: errorLabel(error) });
    return 0;
  }
}

class StoryTaken extends Error {}
