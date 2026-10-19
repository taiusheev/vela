/**
 * What onboarding offers (spec §14.1 A1). The places match the Telegram onboarding's list
 * (`packages/services/src/onboarding.ts`), so a family starts from the same choices on either path.
 * Their names are message descriptors, shown in the app's language (build plan 3.1).
 */

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { InterestTopic, KeptLightRelationship, ReplyWay } from "@vela/contracts";
import { ASK_BANK, type AskBankItem, type AskBankLang } from "@vela/copy";

export interface ZoneChoice {
  label: MessageDescriptor;
  zone: string;
}

export interface CountryChoice {
  code: string;
  label: MessageDescriptor;
  /** The country's zones; a country with one needs no second choice. */
  zones: ZoneChoice[];
}

export const countries: CountryChoice[] = [
  { code: "VN", label: msg`Vietnam`, zones: [{ label: msg`Vietnam`, zone: "Asia/Ho_Chi_Minh" }] },
  { code: "TW", label: msg`Taiwan`, zones: [{ label: msg`Taiwan`, zone: "Asia/Taipei" }] },
  {
    code: "US",
    label: msg`United States`,
    zones: [
      { label: msg({ comment: "a time zone", message: "Eastern" }), zone: "America/New_York" },
      { label: msg({ comment: "a time zone", message: "Central" }), zone: "America/Chicago" },
      { label: msg({ comment: "a time zone", message: "Mountain" }), zone: "America/Denver" },
      { label: msg({ comment: "a time zone", message: "Pacific" }), zone: "America/Los_Angeles" },
      { label: msg`Alaska`, zone: "America/Anchorage" },
      { label: msg`Hawaii`, zone: "Pacific/Honolulu" },
    ],
  },
  { code: "GB", label: msg`United Kingdom`, zones: [{ label: msg`UK`, zone: "Europe/London" }] },
  {
    code: "CA",
    label: msg`Canada`,
    zones: [
      { label: msg({ comment: "a time zone", message: "Atlantic" }), zone: "America/Halifax" },
      { label: msg({ comment: "a time zone", message: "Eastern" }), zone: "America/Toronto" },
      { label: msg({ comment: "a time zone", message: "Central" }), zone: "America/Winnipeg" },
      { label: msg({ comment: "a time zone", message: "Mountain" }), zone: "America/Edmonton" },
      { label: msg({ comment: "a time zone", message: "Pacific" }), zone: "America/Vancouver" },
    ],
  },
  {
    code: "AU",
    label: msg`Australia`,
    zones: [
      { label: msg`Sydney`, zone: "Australia/Sydney" },
      { label: msg`Brisbane`, zone: "Australia/Brisbane" },
      { label: msg`Adelaide`, zone: "Australia/Adelaide" },
      { label: msg`Darwin`, zone: "Australia/Darwin" },
      { label: msg`Perth`, zone: "Australia/Perth" },
    ],
  },
  {
    code: "SG",
    label: msg`Singapore`,
    zones: [{ label: msg`Singapore`, zone: "Asia/Singapore" }],
  },
  { code: "JP", label: msg`Japan`, zones: [{ label: msg`Japan`, zone: "Asia/Tokyo" }] },
  { code: "DE", label: msg`Germany`, zones: [{ label: msg`Germany`, zone: "Europe/Berlin" }] },
  { code: "IN", label: msg`India`, zones: [{ label: msg`India`, zone: "Asia/Kolkata" }] },
];

/**
 * The languages with complete copy; she reads her mornings in one of them. Each is written in its
 * own language, the same whatever language the app is in.
 */
export const languages: { value: "en" | "zh-TW"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

/** When she usually wakes; her morning comes half an hour later (flows §3.1). */
export const wakeTimes = [
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
] as const;

/** The same arithmetic as the service's `addMinutesToLocalTime`: her morning follows her waking. */
export function arrivalAfter(wake: string): string {
  const [hour, minute] = wake.split(":").map(Number);
  const total = ((hour ?? 0) * 60 + (minute ?? 0) + 30) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The organiser's own zone, for their account; the country's first zone if the device has none. */
export function deviceZone(fallback: string): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Who the light is for (See It First onboarding, founder 19 October 2026). The label is also what
 * the organiser's "you call them" field starts with, which they change to their own word for her.
 */
export const relationships: { value: KeptLightRelationship; label: MessageDescriptor }[] = [
  { value: "mother", label: msg({ comment: "who the light is for", message: "Mom" }) },
  { value: "father", label: msg({ comment: "who the light is for", message: "Dad" }) },
  { value: "grandmother", label: msg({ comment: "who the light is for", message: "Grandma" }) },
  { value: "grandfather", label: msg({ comment: "who the light is for", message: "Grandpa" }) },
  { value: "other", label: msg({ comment: "who the light is for", message: "Someone else" }) },
];

/**
 * What she loves to talk about, and the question bank's topics each one draws from. Every bank
 * topic belongs to at least one interest, so whatever is chosen, her questions stay in the bank
 * (`ask-bank.ts`): about her life, her knowledge and her opinions, never how she is.
 */
export const interestTopics: {
  value: InterestTopic;
  label: MessageDescriptor;
  bankTopics: readonly string[];
}[] = [
  {
    value: "cooking",
    label: msg`Cooking & food`,
    bankTopics: [
      "cooking",
      "family_meals",
      "seasonal_food",
      "snacks",
      "preserving",
      "desserts",
      "drinks",
      "street_food",
      "staples",
      "kitchen",
      "market",
    ],
  },
  { value: "garden", label: msg`Garden & plants`, bankTopics: ["garden", "weather"] },
  {
    value: "family",
    label: msg`Family & children`,
    bankTopics: ["family", "family_words", "nicknames"],
  },
  {
    value: "old_days",
    label: msg`The old days`,
    bankTopics: ["childhood", "school", "change", "hometown", "home_life", "place"],
  },
  { value: "music", label: msg`Music & songs`, bankTopics: ["music", "games"] },
  { value: "festivals", label: msg`Festivals`, bankTopics: ["festivals", "celebrations"] },
  { value: "films_books", label: msg`Films, TV & books`, bankTopics: ["taste"] },
  {
    value: "friends",
    label: msg`Friends & neighbours`,
    bankTopics: ["friends", "kindness", "neighbourhood"],
  },
  { value: "travel", label: msg`Places & travel`, bankTopics: ["travel", "places", "transport"] },
  { value: "making", label: msg`Making & mending`, bankTopics: ["craft", "home"] },
  { value: "work", label: msg`Work & advice`, bankTopics: ["work", "advice", "money"] },
  {
    value: "sayings",
    label: msg`Words & sayings`,
    bankTopics: ["sayings", "words", "dialect", "humour"],
  },
];

/** How she likes to answer; none chosen is "not sure yet". */
export const replyWays: { value: ReplyWay; label: MessageDescriptor }[] = [
  { value: "text", label: msg`Typing a few words` },
  { value: "voice", label: msg`Voice notes` },
  { value: "photo", label: msg`Photos` },
  { value: "tap", label: msg`A quick tap, like a heart` },
];

/** Topics to draw from when none were chosen, as when an example is shown before any choice. */
const FALLBACK_INTERESTS: readonly InterestTopic[] = ["old_days", "cooking", "family"];

/**
 * The bank's asks for these interests, one interest at a time in turn so the list mixes them, and
 * never two from one group (`AskBankItem.group`: asks too close to put side by side).
 */
export function questionsFor(
  interests: readonly InterestTopic[],
  count: number,
): readonly AskBankItem[] {
  const chosen = interests.length > 0 ? interests : FALLBACK_INTERESTS;
  const pools = chosen.map((interest) => {
    const topics = interestTopics.find((choice) => choice.value === interest)?.bankTopics ?? [];
    return ASK_BANK.filter((item) => topics.includes(item.topic));
  });
  const picked: AskBankItem[] = [];
  const groups = new Set<string>();
  const longest = Math.max(0, ...pools.map((pool) => pool.length));
  for (let round = 0; round < longest && picked.length < count; round += 1) {
    for (const pool of pools) {
      const item = pool[round];
      if (item === undefined || groups.has(item.group) || picked.length >= count) continue;
      picked.push(item);
      groups.add(item.group);
    }
  }
  return picked;
}

/** The asks offered as her first question: the bank's family wording, in her language. */
export function firstQuestionChoices(
  interests: readonly InterestTopic[],
  language: AskBankLang,
): string[] {
  return questionsFor(interests, 3).map((item) => item.child[language]);
}

/**
 * Her first week (See It First): the first question the organiser chose, then six more from her
 * interests, in the family's wording and her language, never two neighbouring mornings on one bank
 * topic. Short of six, the rest of the bank fills in, by the same rule.
 */
export function firstWeek(
  interests: readonly InterestTopic[],
  first: string,
  language: AskBankLang,
): string[] {
  const week = [first];
  let lastTopic = ASK_BANK.find((item) => item.child[language] === first)?.topic ?? null;
  const groups = new Set<string>();
  const take = (items: readonly AskBankItem[]) => {
    for (const item of items) {
      if (week.length >= 7) return;
      const text = item.child[language];
      if (text === first || groups.has(item.group) || item.topic === lastTopic) continue;
      week.push(text);
      groups.add(item.group);
      lastTopic = item.topic;
    }
  };
  take(questionsFor(interests, ASK_BANK.length));
  take(ASK_BANK);
  return week;
}

/** Minutes east of UTC that a zone keeps at an instant; 0 where the zone cannot be read. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
    const part = (kind: string) => Number(parts.find((each) => each.type === kind)?.value ?? 0);
    const wall = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
    );
    return Math.round((wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * Her next morning as an instant: tomorrow at `time` in her zone, as seen from `now`. The organiser
 * reads it in their own zone ("That's 9:00 for you").
 */
export function nextMorningAt(time: string, timeZone: string, now: Date = new Date()): string {
  const [hour, minute] = time.split(":").map(Number);
  const offset = zoneOffsetMinutes(timeZone, now);
  const herNow = new Date(now.getTime() + offset * 60_000);
  const wall = Date.UTC(
    herNow.getUTCFullYear(),
    herNow.getUTCMonth(),
    herNow.getUTCDate() + 1,
    hour ?? 0,
    minute ?? 0,
  );
  return new Date(wall - offset * 60_000).toISOString();
}
