/**
 * Turns one Telegram `Update` into normalised inbound events.
 *
 * Only what the product acts on is recognised: messages in private chats and groups, button taps,
 * reactions, and changes to the bot's own membership. Content a person sent that has no richer
 * kind arrives as `other`. Everything else (edits, channel posts, service messages, commands for
 * other bots) yields no events, so a new Telegram feature never reaches the services by accident.
 */
import { InboundEvent, type InboundKind, type MediaRef } from "@vela/contracts";

type EventDraft = Omit<InboundEvent, "channel" | "eventId">;
type Sender = InboundEvent["sender"];
type Conversation = InboundEvent["conversation"];
type JsonObject = Record<string, unknown>;

/** `/start`, `/start <param>`, and the group form `/start@bot_username <param>`. */
const START_COMMAND = /^\/start(?:@\w+)?(?:\s+(.*))?$/s;

/** The bot a leading command is addressed to: `VelaLightBot` in `/ask@VelaLightBot <text>`. */
const COMMAND_ADDRESS = /^\/\w+@(\w+)/;

/**
 * Message fields that carry content a person sent but no richer kind describes. They are listed
 * rather than inferred, so service messages (members joining, pins, title changes) stay unrecognised.
 */
const OTHER_CONTENT_FIELDS = [
  "video",
  "video_note",
  "animation",
  "document",
  "location",
  "venue",
  "contact",
  "poll",
  "dice",
  "story",
  "checklist",
  "paid_media",
] as const;

/**
 * Parses a webhook body. `receivedAt` dates events Telegram does not date itself (button taps);
 * `botUsername` (without the `@`) tells commands for this bot from commands for other bots in the
 * same group. Malformed JSON or a body without `update_id` throws.
 */
export function parseTelegramUpdate(
  rawBody: string,
  receivedAt: Date,
  botUsername: string,
): InboundEvent[] {
  const update: unknown = JSON.parse(rawBody);
  if (!isObject(update) || !isInteger(update.update_id)) {
    throw new TypeError("not a Telegram update: update_id is missing");
  }

  const draft = draftEvent(update, receivedAt, botUsername);
  if (draft === undefined) return [];
  return [
    InboundEvent.parse(
      withoutUndefined({ channel: "telegram", eventId: `tg:${update.update_id}`, ...draft }),
    ),
  ];
}

function draftEvent(
  update: JsonObject,
  receivedAt: Date,
  botUsername: string,
): EventDraft | undefined {
  const message = asObject(update.message);
  if (message !== undefined) return fromMessage(message, botUsername);
  const callbackQuery = asObject(update.callback_query);
  if (callbackQuery !== undefined) return fromCallbackQuery(callbackQuery, receivedAt);
  const reaction = asObject(update.message_reaction);
  if (reaction !== undefined) return fromReaction(reaction);
  const membership = asObject(update.my_chat_member);
  if (membership !== undefined) return fromMyChatMember(membership);
  return undefined;
}

function fromMessage(message: JsonObject, botUsername: string): EventDraft | undefined {
  const conversation = readConversation(message.chat);
  const from = readUser(message.from);
  const messageId = asInteger(message.message_id);
  const date = asInteger(message.date);
  // Anonymous group admins and linked channels arrive with a placeholder bot as `from`, and bots
  // with bot-to-bot mode can post in groups; none of them is a family member.
  if (conversation === undefined || from === undefined || from.isBot) return undefined;
  if (messageId === undefined || date === undefined) return undefined;
  // A family group can hold other bots; a command addressed to one of them is not for Vela, whether
  // it is typed as text or as a caption.
  const body = asString(message.text) ?? asString(message.caption);
  if (body !== undefined && isForAnotherBot(body, botUsername)) return undefined;

  const content = readContent(message);
  if (content === undefined) return undefined;

  const replyTo = asObject(message.reply_to_message);
  const replyToMessageId = replyTo === undefined ? undefined : asInteger(replyTo.message_id);
  return {
    at: fromUnixTime(date),
    kind: content.kind,
    sender: from.sender,
    conversation,
    messageId: String(messageId),
    replyToMessageId: replyToMessageId === undefined ? undefined : String(replyToMessageId),
    mediaGroupId: asString(message.media_group_id),
    text: content.text,
    startParam: content.startParam,
    media: content.media,
  };
}

interface Content {
  readonly kind: InboundKind;
  readonly text?: string | undefined;
  readonly startParam?: string | undefined;
  readonly media?: MediaRef | undefined;
}

function readContent(message: JsonObject): Content | undefined {
  const text = asString(message.text);
  if (text !== undefined) {
    const start = START_COMMAND.exec(text);
    if (start === null) return { kind: "text", text };
    const param = start[1]?.trim();
    return { kind: "start", startParam: param === "" ? undefined : param };
  }

  const caption = asString(message.caption);
  // Audio files (a recording shared from another app) count as voice: she spoke, whatever the format.
  const audio = asObject(message.voice) ?? asObject(message.audio);
  if (audio !== undefined) {
    const media = readAudio(audio);
    return media === undefined ? undefined : { kind: "voice", text: caption, media };
  }

  const photo = largestPhoto(message.photo);
  if (photo !== undefined) return { kind: "image", text: caption, media: photo };

  const sticker = asObject(message.sticker);
  if (sticker !== undefined) return { kind: "sticker", text: asString(sticker.emoji) };

  // No media reference: media kinds are only audio and image, so what counts is that she replied
  // and what she wrote alongside it.
  if (OTHER_CONTENT_FIELDS.some((field) => isObject(message[field]))) {
    return { kind: "other", text: caption };
  }

  return undefined;
}

/** Telegram usernames are case-insensitive, so `/ask@velalightbot` is addressed to `VelaLightBot`. */
function isForAnotherBot(body: string, botUsername: string): boolean {
  const address = COMMAND_ADDRESS.exec(body)?.[1];
  return address !== undefined && address.toLowerCase() !== botUsername.toLowerCase();
}

function readAudio(audio: JsonObject): MediaRef | undefined {
  const fileId = asString(audio.file_id);
  if (fileId === undefined) return undefined;
  const duration = asInteger(audio.duration);
  return {
    kind: "audio",
    providerFileId: fileId,
    mime: asString(audio.mime_type),
    durationMs: duration === undefined ? undefined : duration * 1000,
    bytes: asInteger(audio.file_size),
  };
}

function largestPhoto(value: unknown): MediaRef | undefined {
  if (!Array.isArray(value)) return undefined;
  const sizes: readonly unknown[] = value;
  let best: { fileId: string; area: number; bytes: number | undefined } | undefined;
  for (const item of sizes) {
    const size = asObject(item);
    const fileId = size === undefined ? undefined : asString(size.file_id);
    if (size === undefined || fileId === undefined) continue;
    const area = (asInteger(size.width) ?? 0) * (asInteger(size.height) ?? 0);
    if (best === undefined || area > best.area) {
      best = { fileId, area, bytes: asInteger(size.file_size) };
    }
  }
  return best === undefined
    ? undefined
    : { kind: "image", providerFileId: best.fileId, bytes: best.bytes };
}

function fromCallbackQuery(query: JsonObject, receivedAt: Date): EventDraft | undefined {
  const callbackId = asString(query.id);
  const data = asString(query.data);
  const from = readUser(query.from);
  // Present for buttons on messages the bot sent; inline-mode and game buttons are not used.
  const message = asObject(query.message);
  const conversation = message === undefined ? undefined : readConversation(message.chat);
  const messageId = message === undefined ? undefined : asInteger(message.message_id);
  if (callbackId === undefined || data === undefined || from === undefined) return undefined;
  if (conversation === undefined || messageId === undefined) return undefined;
  return {
    // CallbackQuery carries no date; the tap is dated when it reaches us.
    at: receivedAt.toISOString(),
    kind: "button",
    sender: from.sender,
    conversation,
    messageId: String(messageId),
    buttonData: data,
    callbackId,
  };
}

function fromReaction(reaction: JsonObject): EventDraft | undefined {
  const conversation = readConversation(reaction.chat);
  // Anonymous reactions come with `actor_chat` instead of `user` and cannot be attributed.
  const user = readUser(reaction.user);
  const messageId = asInteger(reaction.message_id);
  const date = asInteger(reaction.date);
  if (conversation === undefined || user === undefined) return undefined;
  if (messageId === undefined || date === undefined) return undefined;
  const reactions: readonly unknown[] = Array.isArray(reaction.new_reaction)
    ? reaction.new_reaction
    : [];
  return {
    at: fromUnixTime(date),
    kind: "reaction",
    sender: user.sender,
    conversation,
    messageId: String(messageId),
    // Custom-emoji and paid reactions have no plain emoji to summarise, so they are left out.
    reactions: reactions.flatMap((item) => {
      const type = asObject(item);
      const emoji = type === undefined ? undefined : asString(type.emoji);
      return type?.type === "emoji" && emoji !== undefined ? [emoji] : [];
    }),
  };
}

function fromMyChatMember(change: JsonObject): EventDraft | undefined {
  const conversation = readConversation(change.chat);
  const from = readUser(change.from);
  const date = asInteger(change.date);
  if (conversation === undefined || from === undefined || date === undefined) return undefined;

  const before = asObject(change.old_chat_member);
  const after = asObject(change.new_chat_member);
  const kind =
    conversation.kind === "private"
      ? privateMembershipKind(after)
      : groupMembershipKind(before, after);
  if (kind === undefined) return undefined;
  return { at: fromUnixTime(date), kind, sender: from.sender, conversation };
}

/** In private chats Telegram sends this update only when the user blocks or unblocks the bot. */
function privateMembershipKind(after: JsonObject | undefined): InboundKind | undefined {
  const status = after === undefined ? undefined : asString(after.status);
  if (status === "kicked") return "blocked";
  if (status === "member") return "unblocked";
  return undefined;
}

/**
 * Only transitions into or out of the group count, so a promotion from member to administrator
 * (also a `my_chat_member` update) is not reported as the bot being added again.
 */
function groupMembershipKind(
  before: JsonObject | undefined,
  after: JsonObject | undefined,
): InboundKind | undefined {
  const wasIn = isInChat(before);
  const isIn = isInChat(after);
  if (!wasIn && isIn) return "bot_added";
  if (wasIn && !isIn) return "bot_removed";
  return undefined;
}

function isInChat(member: JsonObject | undefined): boolean {
  if (member === undefined) return false;
  switch (member.status) {
    case "creator":
    case "administrator":
    case "member":
      return true;
    case "restricted":
      return member.is_member === true;
    default:
      return false;
  }
}

function readUser(value: unknown): { sender: Sender; isBot: boolean } | undefined {
  const user = asObject(value);
  const id = user === undefined ? undefined : asInteger(user.id);
  if (user === undefined || id === undefined) return undefined;
  const name = [asString(user.first_name), asString(user.last_name)]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  return {
    sender: {
      externalUserId: String(id),
      displayName: name === "" ? undefined : name,
      languageCode: asString(user.language_code),
    },
    isBot: user.is_bot === true,
  };
}

function readConversation(value: unknown): Conversation | undefined {
  const chat = asObject(value);
  const id = chat === undefined ? undefined : asInteger(chat.id);
  if (chat === undefined || id === undefined) return undefined;
  switch (chat.type) {
    case "private":
      return { externalId: String(id), kind: "private" };
    case "group":
    case "supergroup":
      return { externalId: String(id), kind: "group", title: asString(chat.title) };
    default:
      return undefined;
  }
}

function fromUnixTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
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

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function asInteger(value: unknown): number | undefined {
  return isInteger(value) ? value : undefined;
}
