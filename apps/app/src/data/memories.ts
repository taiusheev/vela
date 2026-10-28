import { t } from "@lingui/core/macro";
import type {
  ApiBook,
  ApiBookEntry,
  ApiExchangeAudio,
  ApiMemoryStory,
  ApiMoment,
  FamilyMemoryKind,
} from "@vela/contracts";
import type { Exchange } from "./exchanges.ts";
import type { ExchangePhoto } from "./today.ts";

/**
 * Her memories as Memories shows them (ADR-51): the answers worth remembering, never every message,
 * which the chat already holds. With a server that sends `moments` they are its own, screened there
 * for health and other private subjects; with an older one, her longer answers stand in; in the
 * example family, a few mornings of a garden and a kitchen.
 */
export interface Memory {
  id: string;
  memberId: string;
  memberName: string;
  askedBy: string | null;
  question: string | null;
  /** Everything she said in answer. */
  words: string | null;
  /** The phrase that makes it a memory, exactly as she said it. */
  quote: string | null;
  kind: FamilyMemoryKind | null;
  at: string;
  photo: ExchangePhoto | null;
  voice: { mediaId: string; durationMs: number | null; audio?: ApiExchangeAudio } | null;
  kept: boolean;
  keptBy: string | null;
  storyId: string | null;
  fadesAt: string | null;
  /** Whether the exchange can be opened in the chat (the example's extra mornings cannot). */
  opens: boolean;
}

export interface MemoryStory {
  id: string;
  memberId: string;
  memberName: string;
  title: string;
  memories: Memory[];
  kept: boolean;
  from: string;
  to: string;
}

export type MemoryFilter = "all" | "open" | "kept" | "photos" | "voice";

/** What a memory says first: her phrase when one was found, else all her words. */
export function memoryText(memory: Pick<Memory, "quote" | "words">): string {
  return memory.quote ?? memory.words ?? "";
}

/** Whether there is more of her answer than the phrase shown. */
export function hasMoreWords(memory: Pick<Memory, "quote" | "words">): boolean {
  return memory.quote !== null && memory.words !== null && memory.words.trim() !== memory.quote;
}

export function fromApiMoment(moment: ApiMoment, exchangeIds: ReadonlySet<string>): Memory {
  return {
    id: moment.exchange_id,
    memberId: moment.member_id,
    memberName: moment.member_name,
    askedBy: moment.asked_by,
    question: moment.question,
    words: moment.words,
    quote: moment.quote,
    kind: moment.kind,
    at: moment.at,
    photo:
      moment.photo_id === null
        ? null
        : { id: moment.photo_id, width: null, height: null, stored: true },
    voice:
      moment.voice === null
        ? null
        : { mediaId: moment.voice.media_id, durationMs: moment.voice.duration_ms },
    kept: moment.kept,
    keptBy: moment.kept_by,
    storyId: moment.story_id,
    fadesAt: moment.fades_at,
    opens: exchangeIds.has(moment.exchange_id),
  };
}

export function fromApiStories(stories: ApiMemoryStory[], memories: Memory[]): MemoryStory[] {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  return stories.flatMap((story) => {
    const told = story.moment_ids.flatMap((id) => {
      const memory = byId.get(id);
      return memory === undefined ? [] : [memory];
    });
    return told.length < 2
      ? []
      : [
          {
            id: story.id,
            memberId: story.member_id,
            memberName: story.member_name,
            title: story.title,
            memories: told,
            kept: told.every((memory) => memory.kept),
            from: story.from,
            to: story.to,
          },
        ];
  });
}

/** More than a greeting: a dozen words, or twenty characters of Chinese (the server's rule). */
export function saysEnough(text: string): boolean {
  const trimmed = text.trim();
  if (/\p{Script=Han}/u.test(trimmed)) {
    return [...trimmed.replace(/[\s\p{P}]/gu, "")].length >= 20;
  }
  return trimmed.split(/\s+/).filter((word) => word.length > 0).length >= 12;
}

/**
 * Before a server sends `moments`: her answers that say more than a greeting, or bring a photo or
 * her voice. That server has screened nothing for memories, so nothing here is offered to keep
 * that "Keep" itself would not check.
 */
export function memoriesFromExchanges(
  exchanges: Exchange[],
  keptIds: ReadonlySet<string>,
): Memory[] {
  return exchanges.flatMap((exchange) => {
    const answer = exchange.answer;
    if (answer === undefined) return [];
    const kept = keptIds.has(exchange.id);
    const photo = answer.photo ?? null;
    const audio = answer.audio;
    if (!kept && photo === null && audio === undefined && !saysEnough(answer.text)) return [];
    const memory: Memory = {
      id: exchange.id,
      memberId: exchange.recipientId ?? "",
      memberName: exchange.recipient,
      askedBy: exchange.asker,
      question: exchange.ask,
      words: answer.text.trim().length === 0 ? null : answer.text,
      quote: null,
      kind: exchange.type === "story" ? "story" : null,
      at: exchange.date === undefined ? new Date().toISOString() : `${exchange.date}T12:00:00Z`,
      photo,
      voice:
        audio === undefined
          ? null
          : { mediaId: audio.id, durationMs: audio.duration_ms ?? null, audio },
      kept,
      keptBy: null,
      storyId: null,
      fadesAt: null,
      opens: true,
    };
    return [memory];
  });
}

/** Her memories narrowed by a parent, a filter and a search; newest first, as they come. */
export function narrowMemories(
  memories: Memory[],
  { filter, query, parent }: { filter: MemoryFilter; query: string; parent: string | undefined },
): Memory[] {
  const words = query.trim().toLocaleLowerCase();
  return memories.filter((memory) => {
    if (parent !== undefined && memory.memberId !== parent) return false;
    if (filter === "open" && memory.kept) return false;
    if (filter === "kept" && !memory.kept) return false;
    if (filter === "photos" && memory.photo === null) return false;
    if (filter === "voice" && memory.voice === null) return false;
    return (
      words.length === 0 ||
      [memory.question ?? "", memory.words ?? "", memory.quote ?? ""].some((text) =>
        text.toLocaleLowerCase().includes(words),
      )
    );
  });
}

/** How many memories each filter would show, so a filter with nothing in it is not offered. */
export function filterCounts(memories: Memory[]): Record<MemoryFilter, number> {
  return {
    all: memories.length,
    open: memories.filter((memory) => !memory.kept).length,
    kept: memories.filter((memory) => memory.kept).length,
    photos: memories.filter((memory) => memory.photo !== null).length,
    voice: memories.filter((memory) => memory.voice !== null).length,
  };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of a date's week, on the calendar. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** Memories a week at a time, newest week first, each keyed by its Monday. */
export function byWeek<T extends { at: string }>(
  items: T[],
  localDate: (at: string) => string,
): { monday: string; items: T[] }[] {
  const weeks: { monday: string; items: T[] }[] = [];
  for (const item of items) {
    const monday = mondayOf(localDate(item.at));
    const last = weeks.at(-1);
    if (last?.monday === monday) last.items.push(item);
    else weeks.push({ monday, items: [item] });
  }
  return weeks;
}

/** Her kept pages a month at a time, oldest month first, as a book is read. */
export function byMonth<T>(
  items: T[],
  monthOf: (item: T) => string,
): { month: string; items: T[] }[] {
  const months = new Map<string, T[]>();
  for (const item of items) {
    const month = monthOf(item);
    months.set(month, [...(months.get(month) ?? []), item]);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, kept]) => ({ month, items: kept }));
}

/** When she said it: her first answer's time, or when it was kept. */
export function saidAt(entry: ApiBookEntry): string {
  return entry.answers[0]?.at ?? entry.kept_at;
}

/**
 * The example family's memories: three of the example mornings and a few more, five of them about
 * the garden's tomatoes and the kitchen, and one story the tomatoes tell across three mornings.
 * Every story title is a phrase of hers, as a server's must be.
 */
export function demoMemories(exchanges: Exchange[]): Pick<ApiBook, "moments" | "stories"> {
  const mom = t`Mom`;
  const ago = (days: number) =>
    new Date(Date.now() - days * 86_400_000 - 20 * 60_000).toISOString();
  const fades = (days: number) => new Date(Date.now() + (30 - days) * 86_400_000).toISOString();
  const of = (id: string) => exchanges.find((exchange) => exchange.id === id);
  const seeds = t`I saved the seeds from last summer's tomatoes in an envelope by the radio.`;
  const moment = (
    id: string,
    days: number,
    fields: Pick<ApiMoment, "asked_by" | "question" | "words" | "quote" | "kind"> &
      Partial<ApiMoment>,
  ): ApiMoment => ({
    exchange_id: id,
    member_id: "m1",
    member_name: mom,
    at: ago(days),
    photo_id: null,
    voice: null,
    kept: false,
    kept_by: null,
    story_id: null,
    fades_at: fades(days),
    ...fields,
  });
  const today = of("x1");
  const pies = of("x2");
  const bakery = of("x3");
  const moments: ApiMoment[] = [
    moment("x1", 0, {
      asked_by: today?.asker ?? "Mia",
      question: today?.ask ?? null,
      words: today?.answer?.text ?? null,
      quote: t`The tomatoes finally turned.`,
      kind: "moment",
      story_id: "s1",
    }),
    moment("x2", 1, {
      asked_by: pies?.asker ?? "Mia",
      question: pies?.ask ?? null,
      words: pies?.answer?.text ?? null,
      quote: pies?.answer?.text ?? null,
      kind: "humour",
    }),
    moment("d4", 3, {
      asked_by: "Anna",
      question: t`What is the kitchen like in the morning?`,
      words: t`I like the radio on in the kitchen, even when nobody is listening. It keeps the kettle company.`,
      quote: t`I like the radio on in the kitchen, even when nobody is listening.`,
      kind: "preference",
    }),
    moment("d3", 6, {
      asked_by: "Mia",
      question: t`How are the seedlings doing?`,
      words: t`The little tomato plants are as tall as my hand now. I talk to them before the news.`,
      quote: t`The little tomato plants are as tall as my hand now.`,
      kind: "moment",
      story_id: "s1",
    }),
    moment("d2", 8, {
      asked_by: "Mia",
      question: t`Who came by this week?`,
      words: t`Mrs Lee next door brought dumplings and stayed to show me her grandson's school photos.`,
      quote: t`Mrs Lee next door brought dumplings and stayed to show me her grandson's school photos.`,
      kind: "person",
    }),
    moment("x3", 9, {
      asked_by: bakery?.asker ?? "Mia",
      question: bakery?.ask ?? null,
      words: bakery?.answer?.text ?? null,
      quote: bakery?.answer?.text ?? null,
      kind: "story",
    }),
    moment("d1", 12, {
      asked_by: "Anna",
      question: t`What are you planting this year?`,
      words: seeds,
      quote: seeds,
      kind: "story",
      story_id: "s1",
    }),
  ];
  const story = moments.filter((item) => item.story_id === "s1").reverse();
  return {
    moments,
    stories: [
      {
        id: "s1",
        member_id: "m1",
        member_name: mom,
        title: t`last summer's tomatoes`,
        moment_ids: story.map((item) => item.exchange_id),
        kept: false,
        from: story[0]?.at ?? ago(12),
        to: story.at(-1)?.at ?? ago(0),
      },
    ],
  };
}

/** One of the example's memories as the book keeps it once someone keeps it there. */
export function demoBookEntry(moment: ApiMoment, keptBy: string): ApiBookEntry {
  return {
    exchange_id: moment.exchange_id,
    member_id: moment.member_id,
    member_name: moment.member_name,
    asked_by: moment.asked_by,
    question: moment.question,
    photo_ids: [],
    kept_at: new Date().toISOString(),
    kept_by: keptBy,
    answers: [
      { kind: "text", text: moment.words, media_id: null, media_kind: null, at: moment.at },
    ],
  };
}

/**
 * The memories and stories a screen shows: the server's where it sends them, else her longer
 * answers from the exchanges, with no stories.
 */
export function memoriesOf(
  book: {
    moments: ApiMoment[] | undefined;
    stories: ApiMemoryStory[];
    keptIds: ReadonlySet<string>;
  },
  exchanges: Exchange[],
): { memories: Memory[]; stories: MemoryStory[] } {
  if (book.moments === undefined) {
    return { memories: memoriesFromExchanges(exchanges, book.keptIds), stories: [] };
  }
  const opens = new Set(exchanges.map((exchange) => exchange.id));
  const memories = book.moments.map((moment) => fromApiMoment(moment, opens));
  return { memories, stories: fromApiStories(book.stories, memories) };
}
