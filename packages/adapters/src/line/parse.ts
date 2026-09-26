/**
 * Turns one LINE webhook body into normalised inbound events.
 *
 * LINE delivers everything said in a group the bot is in, and offers no way to receive less (05 §1
 * fact 1), so this is where the family's own conversation is dropped. From a group or multi-person
 * chat only these become events (05 §3.2): the bot joining or leaving, members leaving, unsends,
 * taps that name who tapped, and text from a named user that starts with `/` or quotes a message.
 * Anything else there, media included, yields nothing and is read no further than its type. In a
 * private chat every message counts, content without a richer kind as `other`. Event types not
 * handled here (edits, `memberJoined`, `accountLink`, `beacon`, `membership`, module and delivery
 * events, types LINE adds later) yield nothing, so a new LINE feature never reaches the services by
 * accident. Nothing is logged, not even that an event was dropped.
 */
import { InboundEvent, type InboundKind, type MediaRef } from "@vela/contracts";
import { GROUP_ID, MESSAGE_ID, ROOM_ID, USER_ID } from "./ids.ts";

type EventDraft = Omit<InboundEvent, "channel" | "at" | "reply">;
type Sender = InboundEvent["sender"];
type Conversation = InboundEvent["conversation"];
type Reply = NonNullable<InboundEvent["reply"]>;
type JsonObject = Record<string, unknown>;

/** The fields every webhook event shares, read before its type decides anything. */
interface Envelope {
  readonly event: JsonObject;
  readonly type: string;
  /** `line:<webhookEventId>`, which LINE keeps when it delivers the same event again. */
  readonly eventId: string;
  readonly at: string;
  readonly conversation: Conversation;
  /** The user LINE names. In a group it names one only on message events, and not always then. */
  readonly userId: string | undefined;
  readonly reply: Reply | undefined;
}

interface Content {
  readonly kind: InboundKind;
  readonly text?: string | undefined;
  readonly startParam?: string | undefined;
  readonly media?: MediaRef | undefined;
  readonly mediaGroupId?: string | undefined;
}

/**
 * `/start`, alone or followed on the same line by a parameter, as the invite link pre-fills it (05
 * §2.3). Any parameter counts, so a damaged token still reaches the invite flow, which answers
 * `consent.invalid_link`, rather than onboarding. It is matched on the text without trailing
 * whitespace, which a keyboard can add.
 */
const START_COMMAND = /^\/start(?:[^\S\r\n]+(\S[^\r\n]*))?$/;

/**
 * A reply token works once, within a minute of receipt, and on a redelivery never later than 20
 * minutes after the event (05 §1 fact 7). Each limit keeps a margin for the queue and the send.
 */
const REPLY_AFTER_RECEIPT_MS = 50_000;
const REPLY_AFTER_EVENT_MS = 19 * 60_000;

/** The largest instant a `Date` can hold. */
const MAX_DATE_MS = 8_640_000_000_000_000;

/**
 * Parses a verified webhook body. `receivedAt` starts each reply token's minute. Malformed JSON, or
 * a body without an `events` array, throws. An event that fails its own shape is skipped, so it
 * cannot sink the others LINE sent with it.
 */
export function parseLineWebhook(rawBody: string, receivedAt: Date): InboundEvent[] {
  const body: unknown = JSON.parse(rawBody);
  if (!isObject(body) || !Array.isArray(body.events)) {
    throw new TypeError("not a LINE webhook: events is missing");
  }
  const items: readonly unknown[] = body.events;
  return items.flatMap((item) => {
    const envelope = readEnvelope(item, receivedAt);
    if (envelope === undefined) return [];
    return draftEvents(envelope).flatMap((draft) => {
      const parsed = InboundEvent.safeParse(
        withoutUndefined({ channel: "line", at: envelope.at, reply: envelope.reply, ...draft }),
      );
      return parsed.success ? [parsed.data] : [];
    });
  });
}

function readEnvelope(value: unknown, receivedAt: Date): Envelope | undefined {
  const event = asObject(value);
  if (event === undefined) return undefined;
  const type = asString(event.type);
  const webhookEventId = asNonEmptyString(event.webhookEventId);
  const timestamp = asTimestamp(event.timestamp);
  if (type === undefined || webhookEventId === undefined || timestamp === undefined) {
    return undefined;
  }
  // Standby events belong to a module channel in charge of the chat; Vela uses none.
  if (event.mode === "standby") return undefined;
  const source = readSource(event.source);
  if (source === undefined) return undefined;
  const token = asNonEmptyString(event.replyToken);
  return {
    event,
    type,
    eventId: `line:${webhookEventId}`,
    at: new Date(timestamp).toISOString(),
    ...source,
    reply: token === undefined ? undefined : { token, until: replyUntil(timestamp, receivedAt) },
  };
}

/**
 * The later limit can already be past, for an event redelivered long after it happened; the token
 * is still reported, and services send instead of replying.
 */
function replyUntil(eventTime: number, receivedAt: Date): string {
  const until = Math.min(
    receivedAt.getTime() + REPLY_AFTER_RECEIPT_MS,
    eventTime + REPLY_AFTER_EVENT_MS,
  );
  return new Date(until).toISOString();
}

function readSource(value: unknown): Pick<Envelope, "conversation" | "userId"> | undefined {
  const source = asObject(value);
  if (source === undefined) return undefined;
  const userId = matching(source.userId, USER_ID);
  switch (source.type) {
    case "user":
      // A private chat is the user's own, so one LINE does not name has no conversation at all.
      if (userId === undefined) return undefined;
      return { conversation: { externalId: userId, kind: "private" }, userId };
    case "group": {
      const groupId = matching(source.groupId, GROUP_ID);
      if (groupId === undefined) return undefined;
      return { conversation: { externalId: groupId, kind: "group" }, userId };
    }
    case "room": {
      // Multi-person chats predate groups and still exist. Services refuse to link one (05 §3.1).
      const roomId = matching(source.roomId, ROOM_ID);
      if (roomId === undefined) return undefined;
      return { conversation: { externalId: roomId, kind: "group" }, userId };
    }
    default:
      return undefined;
  }
}

function draftEvents(envelope: Envelope): EventDraft[] {
  switch (envelope.type) {
    case "message":
      return listOf(fromMessage(envelope));
    case "postback":
      return listOf(fromPostback(envelope));
    case "follow":
      return listOf(fromOwnChat(envelope, "followed"));
    case "unfollow":
      return listOf(fromOwnChat(envelope, "blocked"));
    case "unsend":
      return listOf(fromUnsend(envelope));
    case "join":
      return listOf(fromGroupChange(envelope, "bot_added"));
    case "leave":
      return listOf(fromGroupChange(envelope, "bot_removed"));
    case "memberLeft":
      return fromMemberLeft(envelope);
    default:
      // An edit leaves the original ask or reply standing (D5), and someone who joins is noticed
      // when they next act, as on Telegram.
      return [];
  }
}

function fromMessage(envelope: Envelope): EventDraft | undefined {
  const { event, eventId, conversation, userId } = envelope;
  const message = asObject(event.message);
  // Every message needs its author, and in a group LINE names only users of its phone apps.
  if (message === undefined || userId === undefined) return undefined;
  // Only text can matter in a group (groupContent), so any other message there is read no further
  // than its type.
  if (conversation.kind === "group" && message.type !== "text") return undefined;
  const messageId = matching(message.id, MESSAGE_ID);
  if (messageId === undefined) return undefined;
  // LINE carries a quote only on text and stickers.
  const replyToMessageId = matching(message.quotedMessageId, MESSAGE_ID);
  const content =
    conversation.kind === "group"
      ? groupContent(message, replyToMessageId !== undefined)
      : privateContent(message, messageId);
  if (content === undefined) return undefined;
  return {
    eventId,
    sender: { externalUserId: userId },
    conversation,
    messageId,
    replyToMessageId,
    ...content,
  };
}

/**
 * In a group only text can matter: a command (`/ask`, `/later`), or a quote of one of Vela's
 * messages, which services look up. Services trim a command before reading it, so leading
 * whitespace is allowed here too. Photos, voice notes and stickers are not asks or replies on LINE
 * (D3, D4); `fromMessage` drops them, with every other kind, on their type alone.
 */
function groupContent(message: JsonObject, quotes: boolean): Content | undefined {
  const text = asString(message.text);
  if (text === undefined) return undefined;
  return quotes || text.trimStart().startsWith("/") ? { kind: "text", text } : undefined;
}

function privateContent(message: JsonObject, messageId: string): Content | undefined {
  switch (message.type) {
    case "text": {
      const text = asString(message.text);
      if (text === undefined) return undefined;
      const start = START_COMMAND.exec(text.trimEnd());
      return start === null ? { kind: "text", text } : { kind: "start", startParam: start[1] };
    }
    case "image":
      // Content served from elsewhere cannot be downloaded from LINE; it still counts as a reply.
      if (!isHeldByLine(message)) return { kind: "other" };
      return {
        kind: "image",
        media: { kind: "image", ...lineFile(messageId) },
        mediaGroupId: asNonEmptyString(asObject(message.imageSet)?.id),
      };
    case "audio":
      if (!isHeldByLine(message)) return { kind: "other" };
      return {
        kind: "voice",
        media: {
          kind: "audio",
          ...lineFile(messageId),
          durationMs: asNonNegativeInteger(message.duration),
        },
      };
    case "sticker":
      // Only message stickers carry words; the rest say nothing Vela can read.
      return { kind: "sticker", text: asNonEmptyString(message.text) };
    case "video":
    case "file":
    case "location":
      // Listed rather than inferred, so a message type LINE adds later yields nothing.
      return { kind: "other" };
    default:
      return undefined;
  }
}

/**
 * The message id is LINE's only handle on what was sent: it downloads the content, and, being the
 * same when LINE delivers the event again, it keeps services from storing the file twice.
 */
function lineFile(messageId: string): Pick<MediaRef, "providerFileId" | "providerUniqueId"> {
  return { providerFileId: messageId, providerUniqueId: messageId };
}

function isHeldByLine(message: JsonObject): boolean {
  return asObject(message.contentProvider)?.type === "line";
}

/**
 * A postback does not say which message held the button, so the event has no `messageId`; the
 * date and time pickers' `params` are not used. A tap in a group counts only when LINE names who
 * tapped (05 §3.1).
 */
function fromPostback({ event, eventId, conversation, userId }: Envelope): EventDraft | undefined {
  const data = asNonEmptyString(asObject(event.postback)?.data);
  if (data === undefined || userId === undefined) return undefined;
  return {
    eventId,
    kind: "button",
    sender: { externalUserId: userId },
    conversation,
    buttonData: data,
  };
}

/**
 * `follow` and `unfollow` come only from a person's own chat. `follow.isUnblocked` is not read:
 * LINE says it may be wrong, which is why a follow is `followed`, whether new or an unblock.
 */
function fromOwnChat(
  { eventId, conversation, userId }: Envelope,
  kind: "followed" | "blocked",
): EventDraft | undefined {
  if (conversation.kind !== "private" || userId === undefined) return undefined;
  return { eventId, kind, sender: { externalUserId: userId }, conversation };
}

/**
 * An unsend names the withdrawn message and, in a group, usually no one. Its message id is unique
 * across LINE, so no user is needed: without one the sender is the unknown actor, and the unsend
 * is still reported so what Vela kept of the message can be made unusable, as LINE asks.
 */
function fromUnsend({ event, eventId, conversation, userId }: Envelope): EventDraft | undefined {
  const messageId = matching(asObject(event.unsend)?.messageId, MESSAGE_ID);
  if (messageId === undefined) return undefined;
  const sender = userId === undefined ? unknownActor(conversation) : { externalUserId: userId };
  return { eventId, kind: "unsent", sender, conversation, messageId };
}

/** `join` and `leave` name no one who acted, whoever it was. */
function fromGroupChange(
  { eventId, conversation }: Envelope,
  kind: "bot_added" | "bot_removed",
): EventDraft | undefined {
  if (conversation.kind !== "group") return undefined;
  return { eventId, kind, sender: unknownActor(conversation), conversation };
}

/**
 * `memberLeft` lists everyone who left and no one who acted, so each person becomes an event of
 * their own, its id the webhook event's plus theirs, and each person only once, so no two events
 * share an id. A member LINE does not name cannot be matched to anyone and is left out.
 */
function fromMemberLeft({ event, eventId, conversation }: Envelope): EventDraft[] {
  if (conversation.kind !== "group") return [];
  const members = asObject(event.left)?.members;
  const listed: readonly unknown[] = Array.isArray(members) ? members : [];
  const userIds = new Set(
    listed.flatMap((item) => {
      const member = asObject(item);
      const userId = member?.type === "user" ? matching(member.userId, USER_ID) : undefined;
      return userId === undefined ? [] : [userId];
    }),
  );
  return [...userIds].map((userId) => ({
    eventId: `${eventId}:${userId}`,
    kind: "member_left",
    sender: unknownActor(conversation),
    conversation,
    subject: { externalUserId: userId },
  }));
}

/** The contract's mark of an actor the platform does not name: the group's own id. */
function unknownActor(conversation: Conversation): Sender {
  return { externalUserId: conversation.externalId };
}

function listOf(draft: EventDraft | undefined): EventDraft[] {
  return draft === undefined ? [] : [draft];
}

/** Optional fields are left out rather than present as `undefined`, so events compare exactly. */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, withoutUndefined(field)]),
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

/** Milliseconds since the epoch, as LINE dates events, within what a `Date` can hold. */
function asTimestamp(value: unknown): number | undefined {
  const milliseconds = asNonNegativeInteger(value);
  return milliseconds !== undefined && milliseconds <= MAX_DATE_MS ? milliseconds : undefined;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
