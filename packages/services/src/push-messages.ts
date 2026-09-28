/**
 * What the app's pushes say, to whom, and in what form (ADR-34): the outbound rows on the `app`
 * channel that the quiet ladder, her answer and the evening's turn write, the rules an app row must
 * keep, and the message each becomes at Expo. A leaf, importing no flow and the gateway's types
 * only, so the gateway, the quiet flows and the closings all build from it without an import cycle.
 *
 * An app row is one per reader, addressed to their account (`conversation_id` is `users.id`), and
 * fanned out to the account's phones when it is sent (`push.ts`); the budget and the idempotency
 * key stay per member. Its text passes through Expo, Apple and Google and shows on a lock screen,
 * so it is names and times only — never her words, an answer, a nearby contact, or anything about
 * health — and the data it carries is ids only (`PushData`).
 */
import {
  type Channel,
  type LocalDate,
  ORDINARY_PUSH_KINDS,
  type OrdinaryPushKind,
  type OutboundKind,
  PUSH_KINDS,
  type PushData,
  type PushKind,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { localTimeOf, outboundKey } from "@vela/core";
import { type Member, pushDevices, type QuietEvent, users } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import type { PushMessage } from "./deps.ts";
import type { OutboundRequest } from "./gateway.ts";
import { memberById, type Queryable } from "./repo.ts";

/** The channel of every push row. */
export const PUSH_CHANNEL: Channel = "app";

/**
 * The front of `outbound.error` on a sent quiet notice on the app that, by its receipts, reached
 * no phone (S2): Expo took it, so the row stays `sent`, but it carried nothing to its reader. The
 * receipts check writes it with the refusal's label after it (`push_unheard:DeviceNotRegistered`),
 * and the founder's alerts about the round read such a row as neither sent nor on its way.
 */
export const PUSH_UNHEARD = "push_unheard";

/** `outbound.error` for a sent app quiet notice its receipts say no phone took. */
export function pushUnheardError(reason: string): string {
  return `${PUSH_UNHEARD}:${reason}`.slice(0, 500);
}

/** Whether a row is an app quiet notice its receipts say no phone took (`PUSH_UNHEARD`). */
export function isUnheardPush(row: { channel: Channel; error: string | null }): boolean {
  return row.channel === PUSH_CHANNEL && (row.error?.startsWith(`${PUSH_UNHEARD}:`) ?? false);
}

/**
 * The Android notification channels the app creates before it asks for permission, by id, which is
 * never renamed: on Android 8 and later the channel, not the message, decides sound and importance.
 * `quiet` is loud (high importance, sound) and carries the quiet notice and its close; `daily` is
 * silent and carries everything else.
 */
export const ANDROID_QUIET_CHANNEL = "quiet";
export const ANDROID_DAILY_CHANNEL = "daily";

/**
 * How long Apple or Google keep trying to deliver: a quiet notice is stale after four hours, when
 * the next round or its close has taken over; a close or an ordinary push after twelve, so neither
 * can arrive a day late.
 */
const QUIET_NOTICE_TTL_SECONDS = 4 * 60 * 60;
const OTHER_PUSH_TTL_SECONDS = 12 * 60 * 60;

/**
 * The reader's own waking hours, in their member time zone (D2): an ordinary push due outside them
 * is dropped `quiet_hours`, since what it says is in the app anyway. The quiet notice and its close
 * are exempt: they are why the family has Vela Light.
 */
export const WAKING_HOURS = { from: "08:00", until: "21:00" } as const;

const PUSH_KIND_SET: ReadonlySet<OutboundKind> = new Set<OutboundKind>(PUSH_KINDS);
const ORDINARY_PUSH_KIND_SET: ReadonlySet<OutboundKind> = new Set<OutboundKind>(
  ORDINARY_PUSH_KINDS,
);

export function isPushKind(kind: OutboundKind): kind is PushKind {
  return PUSH_KIND_SET.has(kind);
}

/** The ordinary pushes: one of each per member per day, stopped by "One moment a day" (D1). */
export function isOrdinaryPush(kind: OutboundKind): kind is OrdinaryPushKind {
  return ORDINARY_PUSH_KIND_SET.has(kind);
}

/** Whether `now` falls within the reader's waking hours, 08:00 up to 21:00 where they are. */
export function withinWakingHours(now: Date, timeZone: string): boolean {
  const time = localTimeOf(now, timeZone);
  return time >= WAKING_HOURS.from && time < WAKING_HOURS.until;
}

/**
 * Why a request cannot be an app row, or null when it can: a push is of a push kind (a flag is not,
 * yet: its words must not travel through Apple or Google), and has no buttons, no files, nothing to
 * reply to and no message a reply could quote (`ref`), none of which a notification carries.
 */
export function appRowProblem(
  request: Pick<OutboundRequest, "kind" | "buttons" | "media" | "replyToMessageId" | "ref">,
): string | null {
  if (!isPushKind(request.kind)) {
    return `${request.kind} is not a push kind`;
  }
  if ((request.buttons?.length ?? 0) > 0 || (request.media?.length ?? 0) > 0) {
    return "a push carries no buttons or files";
  }
  if (request.replyToMessageId !== undefined) {
    return "a push replies to nothing";
  }
  if (request.ref !== undefined) {
    return "a push is no message a reply can quote";
  }
  return null;
}

/**
 * The message Expo sends one phone for a row of `kind`. The quiet notice breaks through Focus
 * (time-sensitive) and sounds on the loud channel; its close sounds too, without breaking through;
 * an ordinary push is silent and may wait for the phone. Never a title (the app's name shows),
 * never a badge.
 */
export function pushMessageFor(
  kind: PushKind,
  token: string,
  body: string,
  data: PushData,
): PushMessage {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(data)) {
    if (typeof value === "string") fields[name] = value;
  }
  switch (kind) {
    case "quiet_notice":
      return {
        to: token,
        body,
        data: fields,
        channelId: ANDROID_QUIET_CHANNEL,
        priority: "high",
        interruptionLevel: "time-sensitive",
        sound: "default",
        ttl: QUIET_NOTICE_TTL_SECONDS,
      };
    case "quiet_resolved":
      return {
        to: token,
        body,
        data: fields,
        channelId: ANDROID_QUIET_CHANNEL,
        priority: "high",
        interruptionLevel: "active",
        sound: "default",
        ttl: OTHER_PUSH_TTL_SECONDS,
      };
    default:
      return {
        to: token,
        body,
        data: fields,
        channelId: ANDROID_DAILY_CHANNEL,
        priority: "normal",
        interruptionLevel: "active",
        ttl: OTHER_PUSH_TTL_SECONDS,
      };
  }
}

/** A member who can be sent an app row, with the account the row is addressed to. */
export interface PushReader {
  member: Member;
  userId: string;
}

/**
 * `memberId` as the reader of an ordinary push, when enqueueing it (D1, S5, S6): an active member
 * whose live account has "One moment a day" on and holds a phone whose notifications are allowed.
 * The send checks the switch and the phones again. Null otherwise.
 */
export async function ordinaryPushReader(
  db: Queryable,
  memberId: string,
): Promise<PushReader | null> {
  const member = await memberById(db, memberId);
  if (member === null || member.status !== "active" || member.userId === null) {
    return null;
  }
  const [phone] = await db
    .select({ id: pushDevices.id })
    .from(users)
    .innerJoin(pushDevices, eq(pushDevices.userId, users.id))
    .where(
      and(
        eq(users.id, member.userId),
        isNull(users.deletedAt),
        eq(users.oneMomentADay, true),
        eq(pushDevices.permission, "granted"),
      ),
    )
    .limit(1);
  return phone === undefined ? null : { member, userId: member.userId };
}

/**
 * Her quiet notice for one organiser's phones (flows §3.12): her name and when her morning arrived,
 * and what the reader can do. No usual time, no nearby contacts, no buttons: the app shows those
 * when the tap opens it. Keyed as the Telegram notice of the same round with `:app` after the
 * round, so each channel's notice is sent once; its send counts the reader as told, as Telegram's
 * does.
 */
export function quietPushNotice(input: {
  quiet: QuietEvent;
  reader: PushReader;
  herName: string;
  sent: string;
}): OutboundRequest {
  const { quiet, reader } = input;
  const lang = reader.member.language;
  return {
    kind: "quiet_notice",
    idempotencyKey: outboundKey("quiet_notice", {
      quietEventId: quiet.id,
      memberId: reader.member.id,
      suffix: `${quiet.notifyCount}:${PUSH_CHANNEL}`,
    }),
    memberId: reader.member.id,
    channel: PUSH_CHANNEL,
    conversationId: reader.userId,
    exchangeId: quiet.exchangeId,
    lang,
    text: t(lang, "push.quiet_notice", { name: input.herName, sent: input.sent }),
    effect: {
      quietEventId: quiet.id,
      notifyCount: quiet.notifyCount + 1,
      notifiedMemberId: reader.member.id,
    },
  };
}

/**
 * "{name} answered you." to whoever asked the exchange she answered (S5): once per exchange, and at
 * most one a day for the reader (the budget index); its local day is the reader's today.
 */
export function answerReceiptPush(input: {
  reader: PushReader;
  exchangeId: string;
  herName: string;
}): OutboundRequest {
  const { reader } = input;
  const lang = reader.member.language;
  return {
    kind: "answer_receipt",
    idempotencyKey: outboundKey("answer_receipt", { exchangeId: input.exchangeId }),
    memberId: reader.member.id,
    channel: PUSH_CHANNEL,
    conversationId: reader.userId,
    exchangeId: input.exchangeId,
    lang,
    text: t(lang, "push.answer_receipt", { name: input.herName }),
  };
}

/**
 * The evening's turn for a family with no group (S6): the holder's phones hear that tomorrow morning
 * is theirs, under the key the group's prompt would have used. Its local day is the holder's today,
 * the day it is sent, so it never takes the next day's place in the budget.
 */
export function turnPromptPush(input: {
  holder: PushReader;
  familyId: string;
  recipientId: string;
  herName: string;
  forDate: LocalDate;
}): OutboundRequest {
  const { holder } = input;
  const lang = holder.member.language;
  return {
    kind: "turn_prompt",
    idempotencyKey: outboundKey("turn_prompt", {
      memberId: input.recipientId,
      date: input.forDate,
    }),
    memberId: holder.member.id,
    channel: PUSH_CHANNEL,
    conversationId: holder.userId,
    lang,
    text: t(lang, "push.turn_prompt", { name: input.herName }),
    effect: { familyId: input.familyId, recipientId: input.recipientId, localDay: input.forDate },
  };
}
