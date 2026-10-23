import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { ApiExchangeAudio, ApiExchangeSummary, ApiTodayAnswer } from "@vela/contracts";
import { clockTime, timeOfDay } from "./format.ts";
import type { ExchangePhoto } from "./today.ts";

/**
 * The conversation with one parent (consumer flow rows 39–52): every ask the family sent her, each
 * message she sent back, and the family's replies, in the order they happened, built from the same
 * exchanges the list reads (`GET /v1/families/:id/exchanges`). Her answers within 36 hours attach to
 * the latest message she was sent (flows §3.9), so a reply to something sent from the chat lands
 * under it and the conversation reads in order.
 */

/** Where a message sits: the reader's own on the right, hers and the family's on the left. */
export type ChatSide = "me" | "her" | "family" | "vela";

export type ChatReactionKind = "heart" | "laugh" | "hug";

export interface ChatReaction {
  kind: ChatReactionKind;
  from: string;
  mine: boolean;
}

/**
 * How far a message the reader sent has gone: "sending" until Vela has it, "sent" once Vela has it
 * and is passing it on, then "delivered", and "seen" only when her messenger said so.
 */
export type ChatStatus = "sending" | "sent" | "delivered" | "seen" | "failed";

export interface ChatMessage {
  key: string;
  exchangeId: string;
  side: ChatSide;
  /** The name the family knows them by; "Vela" for Vela's own hello. */
  from: string;
  /** For ordering. */
  at: number;
  /** Her local date (YYYY-MM-DD), which the day chips name. */
  day: string;
  /** Her clock time, as Today shows it. */
  time: string;
  /** Words, or what a wordless message was ("sent a heart"). */
  text: string;
  /** A tap with no words of its own (a heart, "I'm fine"): drawn small, never over-read. */
  tap?: true;
  /** Her own words when `text` is their translation. */
  original?: string;
  photo?: ExchangePhoto;
  /** An ask's photos, in the order she saw them. */
  photos?: ExchangePhoto[];
  picked?: string;
  audio?: ApiExchangeAudio;
  /** An ask that went into her morning, rather than one sent there and then. */
  morning?: true;
  draftedByVela?: true;
  /** Only on the reader's own asks. */
  status?: ChatStatus;
  /** Reactions the family gave her message (on her latest message of the exchange). */
  reactions: ChatReaction[];
}

const REACTIONS: readonly string[] = ["heart", "laugh", "hug"];
/** Taps she sends with no words of their own. */
const TAPS: readonly string[] = ["heart", "fine", "sticker"];

function parsed(instant: string | null | undefined): number | null {
  if (instant === null || instant === undefined) return null;
  const at = Date.parse(instant);
  return Number.isFinite(at) ? at : null;
}

/** Her local date of an instant, as YYYY-MM-DD. */
export function localDateIn(instant: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return new Date(instant).toISOString().slice(0, 10);
  }
}

/** What a message with no words was, said as hers. */
function wordless(answer: ApiTodayAnswer): string {
  switch (answer.kind) {
    case "heart":
      return "❤️";
    case "fine":
      return t`I'm fine`;
    case "photo":
      return t`A photo`;
    case "photo_pick": {
      const number = answer.picked_number;
      return number === null ? t`Picked a photo` : t`Picked photo ${number}`;
    }
    case "sticker":
      return t`A sticker`;
    case "voice":
      return t`A voice message`;
    case "vote":
      return t`Voted`;
    default:
      return t`Answered`;
  }
}

/** A family reply with no words: a voice message or a photo, as the bubble says it. */
function wordlessReply(kind: string): string {
  return kind === "voice" ? t`A voice message` : kind === "photo" ? t`A photo` : t`Replied`;
}

function statusOf(summary: ApiExchangeSummary): ChatStatus {
  if (summary.delivery_status === "failed") return "failed";
  // Vela already has it: what is left is passing it on, which the reader need not wait for.
  if (summary.delivery_status === "pending" || summary.delivered_at === null) return "sent";
  return summary.seen_at === null ? "delivered" : "seen";
}

/**
 * One parent's conversation, oldest first. `viewerId` is the reader's own member id, which puts
 * their asks and replies on the right; without it (an older response, or the demo) the reader's
 * name stands in.
 */
export function toChat(
  summaries: readonly ApiExchangeSummary[],
  recipientId: string,
  viewer: { id?: string; name?: string },
  fallbackZone?: string,
): ChatMessage[] {
  const mine = (id: string | null | undefined, name: string | null | undefined) =>
    viewer.id !== undefined && id !== undefined && id !== null
      ? id === viewer.id
      : viewer.name !== undefined && name === viewer.name;
  const out: ChatMessage[] = [];
  for (const summary of summaries) {
    if (summary.recipient_id !== recipientId) continue;
    const zone = summary.recipient_tz ?? fallbackZone;
    const stamp = (at: number) => ({
      at,
      day: localDateIn(at, zone),
      time: timeOfDay(new Date(at).toISOString(), zone),
    });
    const askedAt =
      parsed(summary.delivered_at) ??
      parsed(summary.created_at) ??
      parsed(summary.scheduled_for === null ? null : `${summary.scheduled_for}T00:00:00Z`) ??
      0;
    const asker = summary.on_behalf_of ?? summary.asker_name;
    const own = summary.asker_name !== null && mine(summary.asker_id, summary.asker_name);
    const hello = summary.asker_name === null;
    out.push({
      key: `${summary.id}:ask`,
      exchangeId: summary.id,
      side: own ? "me" : hello ? "vela" : "family",
      from: asker ?? "Vela",
      ...stamp(askedAt),
      text: summary.ask?.trim() || (hello ? t`Good morning from Vela` : ""),
      ...(summary.scheduled_for === null ? {} : { morning: true as const }),
      ...(summary.drafted_by_vela === true ? { draftedByVela: true as const } : {}),
      ...(own ? { status: statusOf(summary) } : {}),
      ...(summary.photos.length === 0 ? {} : { photos: summary.photos }),
      ...(summary.voice_hello == null ? {} : { audio: summary.voice_hello }),
      reactions: [],
    });

    const answers = summary.answers ?? (summary.answer === null ? [] : [summary.answer]);
    let lastHers: ChatMessage | undefined;
    let lastAt = askedAt;
    answers.forEach((answer, index) => {
      const at = parsed(answer.at) ?? lastAt + 1;
      lastAt = at;
      const translated =
        answer.translation != null &&
        answer.text !== null &&
        answer.translation.lang === i18n.locale
          ? answer.translation.text
          : undefined;
      const words = translated ?? answer.text ?? undefined;
      const message: ChatMessage = {
        key: `${summary.id}:answer:${index}`,
        exchangeId: summary.id,
        side: "her",
        from: summary.recipient_name,
        ...stamp(at),
        text: words?.trim() || wordless(answer),
        ...((words?.trim() ?? "") === "" && TAPS.includes(answer.kind)
          ? { tap: true as const }
          : {}),
        ...(translated === undefined || answer.text === null ? {} : { original: answer.text }),
        ...(answer.photo == null ? {} : { photo: answer.photo }),
        ...(answer.audio == null ? {} : { audio: answer.audio }),
        ...(answer.picked_media_id == null ? {} : { picked: answer.picked_media_id }),
        reactions: [],
      };
      out.push(message);
      lastHers = message;
    });

    summary.replies.forEach((reply, index) => {
      const own = mine(reply.from_id, reply.from);
      if (REACTIONS.includes(reply.kind)) {
        // A reaction belongs under what she said; with nothing of hers yet, under the ask.
        const target = lastHers ?? out.find((message) => message.key === `${summary.id}:ask`);
        target?.reactions.push({
          kind: reply.kind as ChatReactionKind,
          from: reply.from,
          mine: own,
        });
        return;
      }
      const at = parsed(reply.at) ?? lastAt + index + 1;
      out.push({
        key: `${summary.id}:reply:${index}`,
        exchangeId: summary.id,
        side: own ? "me" : "family",
        from: reply.from,
        ...stamp(at),
        text: reply.text?.trim() || wordlessReply(reply.kind),
        ...(reply.photo == null ? {} : { photo: reply.photo }),
        ...(reply.audio == null ? {} : { audio: reply.audio }),
        reactions: [],
      });
    });
  }
  // Stable: an ask and the answer that share a second keep the order they were built in.
  return out
    .map((message, index) => ({ message, index }))
    .sort((a, b) => a.message.at - b.message.at || a.index - b.index)
    .map(({ message }) => message);
}

/** "Today", "Yesterday", or "Monday 14 Oct" for a day chip, from her local date. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return t`Today`;
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (day === yesterday) return t`Yesterday`;
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString(i18n.locale === "zh-TW" ? "zh-TW" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Messages within five minutes from the same person read as one group, named once. */
export const GROUP_MS = 5 * 60_000;

export function startsGroup(previous: ChatMessage | undefined, message: ChatMessage): boolean {
  return (
    previous === undefined ||
    previous.day !== message.day ||
    previous.side !== message.side ||
    previous.from !== message.from ||
    message.at - previous.at > GROUP_MS ||
    previous.morning === true ||
    message.morning === true
  );
}

/**
 * A time shows only where the conversation pauses, as messengers do: after the last message, at a
 * new day, and after half an hour of quiet. Every bubble still says its time to VoiceOver.
 */
export const GAP_MS = 30 * 60_000;

export function showsTime(message: ChatMessage, next: ChatMessage | undefined): boolean {
  return next === undefined || next.day !== message.day || next.at - message.at >= GAP_MS;
}

/** The reader's newest message, the one place "Seen" or "Delivered" is said. */
export function newestMine(messages: readonly ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.side === "me") return message.key;
  }
  return undefined;
}

/** "Sending…" and "Not delivered" always show; "Sent", "Delivered" and "Seen" only at the newest. */
export function showsStatus(message: ChatMessage, newest: string | undefined): boolean {
  if (message.status === "sending" || message.status === "failed") return true;
  return message.status !== undefined && message.key === newest;
}

/**
 * The example conversation for the demo, in the language active when called: yesterday's morning
 * and its replies, today's morning, and a message Mia sent afterwards that Mom answered.
 */
export function chatFixture(name: string): ChatMessage[] {
  const now = Date.now();
  const today = localDateIn(now);
  const yesterday = localDateIn(now - 86_400_000);
  const at = (day: string, hour: number, minute: number) =>
    Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  const base = (
    key: string,
    side: ChatSide,
    from: string,
    day: string,
    hour: number,
    minute: number,
    text: string,
  ): ChatMessage => ({
    key,
    exchangeId: key.split(":")[0] ?? key,
    side,
    from,
    at: at(day, hour, minute),
    day,
    time: clockTime(hour, minute),
    text,
    reactions: [],
  });
  return [
    {
      ...base(
        "x2:ask",
        "family",
        "Anna",
        yesterday,
        8,
        0,
        t`Which one of us did you teach to make the pies?`,
      ),
      morning: true,
    },
    {
      ...base(
        "x2:answer:0",
        "her",
        name,
        yesterday,
        9,
        5,
        t`Both of you, but only Mia listened about the butter.`,
      ),
      reactions: [{ kind: "laugh", from: "Mia", mine: true }],
    },
    base("x2:reply:0", "family", "Anna", yesterday, 9, 20, t`She is never letting that go`),
    {
      ...base("x1:ask", "me", "Mia", today, 8, 0, t`What did the garden look like this morning?`),
      morning: true,
      status: "seen",
    },
    {
      ...base(
        "x1:answer:0",
        "her",
        name,
        today,
        8,
        12,
        t`The tomatoes finally turned. I picked three before breakfast and left them on the sill.`,
      ),
      reactions: [{ kind: "heart", from: "Mia", mine: true }],
    },
    base(
      "x1:reply:0",
      "family",
      "Anna",
      today,
      8,
      30,
      t`Those are the ones from the seeds you saved`,
    ),
    { ...base("x4:ask", "me", "Mia", today, 9, 2, t`Save me two for Sunday?`), status: "seen" },
    base("x4:answer:0", "her", name, today, 9, 14, t`Already in a bag by the door.`),
    base("x4:answer:1", "her", name, today, 9, 15, t`And a jar of the plum jam.`),
  ];
}

/** A local send remains visible until its exact server exchange arrives. */
export interface PendingChatMessage {
  localId: string;
  text: string;
  status: "sending" | "sent";
  since: number;
  existingIds: string[];
  exchangeId?: string;
}
export function pendingHasArrived(
  pending: PendingChatMessage,
  messages: readonly ChatMessage[],
): boolean {
  return messages.some(
    (message) =>
      message.side === "me" &&
      (pending.exchangeId !== undefined
        ? message.exchangeId === pending.exchangeId
        : !pending.existingIds.includes(message.exchangeId) &&
          message.text === pending.text &&
          message.at >= pending.since - 60_000),
  );
}
