/**
 * Values the copy catalog does not format itself (code design §4): times and dates in the reader's
 * language, the nearby contacts line, the channel's name, the group reaction emoji that count as a
 * reply kind (flows §3.11), and the two shapes every flow needs for a platform message: the id a
 * received message is deduplicated by, and text cut to what the platform accepts.
 */
import {
  type Channel,
  type InboundEvent,
  type Lang,
  LocalDate,
  type ReactionKind,
} from "@vela/contracts";
import { formatLocalTime, weekdayOf } from "@vela/core";

/** `OutboundMessage.text` allows at most 4000 characters. */
const MESSAGE_TEXT_MAX_LENGTH = 4000;

/**
 * `answers.external_id` and `replies.external_id`: message ids are unique only within one Telegram
 * chat. A platform event without a message id (a tap on a message Telegram no longer shows) keys
 * on the event id, so a redelivery of that update still finds its row.
 */
export function inboundExternalId(event: InboundEvent): string {
  return `${event.conversation.externalId}:${event.messageId ?? event.eventId}`;
}

/**
 * A message within the platform's limit. Words are cut rather than the message refused, since one
 * that never goes out would leave the family without what was said.
 */
export function fitMessageText(text: string): string {
  if (text.length <= MESSAGE_TEXT_MAX_LENGTH) {
    return text;
  }
  let kept = text.slice(0, MESSAGE_TEXT_MAX_LENGTH - 1);
  const last = kept.charCodeAt(kept.length - 1);
  // A high surrogate at the cut would be half a character, such as half an emoji.
  if (last >= 0xd800 && last <= 0xdbff) {
    kept = kept.slice(0, -1);
  }
  return `${kept}…`;
}

/** `{time}`, `{sent}`, `{usual}`: the wall clock in the zone the reader thinks in, `HH:MM`. */
export function formatTime(instant: Date, timeZone: string): string {
  return formatLocalTime(instant, timeZone);
}

const WEEKDAYS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const WEEKDAYS_ZH_TW = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
] as const;

/**
 * `{date}` in `away.confirmed`: "Sunday 21 September" in English and "9月21日（星期日）" in
 * Traditional Chinese, which the sentence carries with no spaces around it. Languages without their
 * own catalog read English copy, so they get the English date.
 */
export function formatAwayDate(date: LocalDate, lang: Lang): string {
  const parsed = LocalDate.parse(date);
  const [, monthText, dayText] = parsed.split("-");
  const month = Number(monthText);
  const day = Number(dayText);
  const weekday = weekdayOf(parsed);
  if (lang === "zh-TW") {
    return `${month}月${day}日（${WEEKDAYS_ZH_TW[weekday] ?? ""}）`;
  }
  return `${WEEKDAYS_EN[weekday] ?? ""} ${day} ${MONTHS_EN[month - 1] ?? ""}`;
}

export interface NearbyContactLine {
  name: string;
  phone: string;
}

/**
 * `{contacts}` in `quiet.nearby`: each contact's name and number as plain text, in the list style of
 * the sentence's language. Callers pass only contacts who said yes (flows §3.12).
 */
export function formatNearbyContacts(lang: Lang, contacts: readonly NearbyContactLine[]): string {
  const separator = lang === "zh-TW" ? "、" : ", ";
  return contacts
    .map((contact) => `${contact.name.trim()} ${contact.phone.trim()}`)
    .join(separator);
}

const CHANNEL_LABELS: Readonly<Record<Channel, string>> = {
  telegram: "Telegram",
  line: "LINE",
  whatsapp: "WhatsApp",
  voice: "Voice",
  app: "Vela",
};

/** `{channel}` in `delivery.failed`: the platform's own name, the same in every language. */
export function channelLabel(channel: Channel): string {
  return CHANNEL_LABELS[channel];
}

/**
 * The group reaction emoji that count, by reply kind (flows §3.11). Telegram sends a member's full
 * reaction set; emoji outside this table are ignored.
 */
export const REACTION_EMOJI_BY_KIND: Readonly<Record<ReactionKind, readonly string[]>> = {
  heart: ["❤️", "❤", "🥰", "😍", "👍", "🙏"],
  laugh: ["😂", "🤣", "😄", "😆"],
  hug: ["🤗", "🫂"],
};

const VARIATION_SELECTOR = /️/g;

const KIND_BY_EMOJI: ReadonlyMap<string, ReactionKind> = new Map(
  (Object.entries(REACTION_EMOJI_BY_KIND) as [ReactionKind, readonly string[]][]).flatMap(
    ([kind, emojis]) => emojis.map((emoji) => [emoji.replace(VARIATION_SELECTOR, ""), kind]),
  ),
);

/** The reply kind an emoji maps to, or null for one that does not count. */
export function reactionKindOf(emoji: string): ReactionKind | null {
  return KIND_BY_EMOJI.get(emoji.replace(VARIATION_SELECTOR, "")) ?? null;
}

/** The distinct kinds a member's reaction set maps to, in the order the kinds are listed. */
export function reactionKindsOf(emojis: readonly string[]): ReactionKind[] {
  const kinds = new Set<ReactionKind>();
  for (const emoji of emojis) {
    const kind = reactionKindOf(emoji);
    if (kind !== null) {
      kinds.add(kind);
    }
  }
  return (Object.keys(REACTION_EMOJI_BY_KIND) as ReactionKind[]).filter((kind) => kinds.has(kind));
}
