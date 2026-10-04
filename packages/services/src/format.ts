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
  type LocalTime,
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
  // A tap that names no message (a LINE postback, 05 §4) is keyed by what it carries, so the same
  // button tapped twice, or delivered twice, is one answer.
  if (event.kind === "button" && event.messageId === undefined && event.buttonData !== undefined) {
    return `${event.conversation.externalId}:button:${event.buttonData}`;
  }
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

const MINUTES_PER_DAY = 24 * 60;
const HALF_DAY_MINUTES = MINUTES_PER_DAY / 2;

function minutesOfTime(time: LocalTime): number {
  const [hour, minute] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

/**
 * Minutes from `from` to `to` on the clock, the short way round, in [-720, 720): 00:05 is ten
 * minutes after 23:55, not 1430 minutes before it.
 */
export function clockMinutesBetween(from: LocalTime, to: LocalTime): number {
  const ahead = (minutesOfTime(to) - minutesOfTime(from) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return ahead >= HALF_DAY_MINUTES ? ahead - MINUTES_PER_DAY : ahead;
}

/**
 * `{usual}`, and the weekly read's usual time: the median wall-clock time of `instants` in the
 * zone, or null for none. Each time is placed by its distance from `around`, her arrival time,
 * within twelve hours either side, not by its minutes from midnight: her answers gather around her
 * morning, and when it comes late in the evening they fall on both sides of midnight, where 23:50
 * is 1430 minutes and 00:10 is 10, and a middle pair of those two made "usually answers by 12:00".
 */
export function medianTimeAround(
  instants: readonly Date[],
  timeZone: string,
  around: LocalTime,
): LocalTime | null {
  const offsets = instants
    .map((instant) => clockMinutesBetween(around, formatLocalTime(instant, timeZone)))
    .sort((a, b) => a - b);
  if (offsets.length === 0) {
    return null;
  }
  const middle = Math.floor(offsets.length / 2);
  const upper = offsets[middle] ?? 0;
  const median =
    offsets.length % 2 === 1 ? upper : Math.round(((offsets[middle - 1] ?? upper) + upper) / 2);
  const minutes =
    (((minutesOfTime(around) + median) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hour}:${String(minutes % 60).padStart(2, "0")}`;
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
  device: "Vela",
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
