/**
 * The channel adapter contract (architecture §8). An adapter translates between one messaging
 * platform and these shapes. It never touches the database, the AI, or the scheduler, so a new
 * platform is a new adapter and nothing above the adapter line changes. What a platform cannot do,
 * services read from its `capabilities`, never from its name.
 */
import { z } from "zod";
import { Channel, Lang, MediaKind, OutboundKind } from "./domain.ts";

export const ConversationKind = z.enum(["private", "group"]);
export type ConversationKind = z.infer<typeof ConversationKind>;

/** What happened, normalised across platforms. */
export const INBOUND_KINDS = [
  "start",
  "text",
  "voice",
  "image",
  "sticker",
  /** Content the platform delivered that has no richer kind here (video, document, location). */
  "other",
  "button",
  "reaction",
  "read",
  "bot_added",
  "bot_removed",
  "blocked",
  "unblocked",
  /**
   * A person made the bot reachable in their private chat: added it, or unblocked it where the
   * platform cannot reliably tell the two apart (LINE `follow`). Telegram reports an unblock as
   * `unblocked` and has no such event.
   */
  "followed",
  /** A group moved to a new conversation id (Telegram: a basic group upgraded to a supergroup). */
  "migrated",
  /**
   * A person left a group or was removed from it. `subject` is the person who left; `sender` is
   * whoever acted, the same person when they left by themself, or the unknown actor where the
   * platform does not say (see `InboundEvent.sender`). The bot's own departure is `bot_removed`,
   * never this.
   */
  "member_left",
  /**
   * The sender withdrew the message `messageId` (LINE `unsend`). The platform asks that what was
   * kept of it become unusable.
   */
  "unsent",
] as const;
export const InboundKind = z.enum(INBOUND_KINDS);
export type InboundKind = z.infer<typeof InboundKind>;

/** A reference to media held by the platform (to be fetched) or by us (to be sent). */
export const MediaRef = z
  .object({
    kind: MediaKind,
    /** Platform-held file identifier, reusable only on the same channel. */
    providerFileId: z.string().min(1).optional(),
    /**
     * The platform's stable identity for the file itself. On Telegram it is `file_unique_id`: the
     * same over time and for every bot, so a file forwarded again keeps it. On LINE it is the
     * message id: stable across redelivery, not across forwards. Services deduplicate media per
     * family on it. As a field it neither fetches nor sends the file, so it does not satisfy the
     * check below.
     */
    providerUniqueId: z.string().min(1).optional(),
    /** A URL the platform can fetch, e.g. a short-lived signed R2 URL. */
    url: z.url().optional(),
    mime: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    bytes: z.number().int().nonnegative().optional(),
  })
  .refine((ref) => ref.providerFileId !== undefined || ref.url !== undefined, {
    message: "a media reference needs a providerFileId or a url",
  });
export type MediaRef = z.infer<typeof MediaRef>;

export const InboundEvent = z.object({
  channel: Channel,
  /** Unique per platform event; the idempotency key for webhook redelivery. */
  eventId: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
  kind: InboundKind,
  /**
   * Who acted. Where the platform does not say (LINE's `join`, `leave` and `memberLeft`, and an
   * `unsend` in a group that names no one), `externalUserId` is the conversation's own id, which
   * services read as an unknown actor. That reading holds only in a group: a group id is never a
   * user id (Telegram's are negative, LINE's start with C or R), while a private chat's id is the
   * user's own on both platforms.
   */
  sender: z.object({
    externalUserId: z.string().min(1),
    displayName: z.string().optional(),
    /** The platform's language hint for the sender, e.g. Telegram `language_code`. */
    languageCode: z.string().optional(),
  }),
  conversation: z.object({
    externalId: z.string().min(1),
    kind: ConversationKind,
    title: z.string().optional(),
  }),
  /** The message the event is about; for `unsent`, the message withdrawn. */
  messageId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  /** Messages the platform delivers as one album share this id. */
  mediaGroupId: z.string().optional(),
  text: z.string().optional(),
  /** Payload of a tapped button (the `Button.id` we sent). */
  buttonData: z.string().optional(),
  /** Needed to acknowledge a button tap on platforms that require it. */
  callbackId: z.string().optional(),
  /** For `reaction`: the reactions now present from this sender on `messageId`, as emoji. */
  reactions: z.array(z.string()).optional(),
  /** For `start`: the deep-link parameter, e.g. an invite token. */
  startParam: z.string().optional(),
  /** For `migrated`: the conversation id the group now has; `conversation.externalId` is the old one. */
  migratedToConversationId: z.string().min(1).optional(),
  /** For `member_left`: the person who left. */
  subject: z
    .object({
      externalUserId: z.string().min(1),
      displayName: z.string().optional(),
    })
    .optional(),
  media: MediaRef.optional(),
  /**
   * A free reply to this event (LINE's reply token) and the instant after which it must not be
   * used. A reply lands in the conversation the event came from, whatever it is addressed to.
   */
  reply: z.object({ token: z.string().min(1), until: z.iso.datetime({ offset: true }) }).optional(),
});
export type InboundEvent = z.infer<typeof InboundEvent>;

export const Button = z.object({
  /**
   * Opaque payload returned in `InboundEvent.buttonData`. Telegram allows 1–64 bytes and LINE's
   * postback data 300 characters, so 64 fits both.
   */
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
});
export type Button = z.infer<typeof Button>;

export const OutboundMessage = z.object({
  kind: OutboundKind,
  /**
   * Stable across retries. Adapters pass it to platforms that support idempotency; where a platform
   * does not, the gateway guarantees a message is only retried after a recorded failure.
   */
  idempotencyKey: z.string().min(1).max(200),
  lang: Lang,
  to: z.object({ channel: Channel, conversationId: z.string().min(1) }),
  /** Plain text. Adapters escape it; no markup is ever interpreted. */
  text: z.string().min(1).max(4000),
  /** Rows of buttons. */
  buttons: z.array(z.array(Button).min(1).max(4)).max(8).optional(),
  /** Sent before the text, in order: photos as an album where supported, audio as voice. */
  media: z.array(MediaRef).max(10).optional(),
  replyToMessageId: z.string().optional(),
  /**
   * The `reply.token` of the event this message answers. A reply always lands in the conversation
   * the token came from, and neither the adapter nor the platform can catch a mismatch, so it is
   * set only when that conversation is `to.conversationId`. The adapter replies with it when it
   * can and sends as usual when the platform refuses it; adapters without free replies ignore it.
   */
  replyToken: z.string().min(1).optional(),
});
export type OutboundMessage = z.infer<typeof OutboundMessage>;

export interface SendResult {
  /** Every platform message created, in order (media first, then the text message). */
  readonly externalMessageIds: readonly string[];
  /**
   * The text message, even where the platform puts the buttons in a message after it (LINE's
   * Flex bubble). Replies, and taps on platforms that say which message was tapped, refer to it.
   */
  readonly primaryMessageId: string;
}

export interface AdapterCapabilities {
  readonly buttons: boolean;
  readonly voiceIn: boolean;
  readonly voiceOut: boolean;
  readonly readReceipts: boolean;
  readonly reactions: boolean;
  readonly albums: boolean;
  /** `closeButtons` really edits the sent message; when false it resolves doing nothing. */
  readonly editMessages: boolean;
  /** A `providerFileId` received on this channel can be sent again on it. */
  readonly resendsProviderFiles: boolean;
  /**
   * The adapter turns a stored object's key into an HTTPS URL of its own and never needs the
   * object's bytes, so the gateway loads none for it. Passing on a `MediaRef.url` for the platform
   * to fetch, as Telegram does, is not this.
   */
  readonly mediaByUrl: boolean;
  /**
   * An inbound voice note or image can carry `replyToMessageId`. LINE quotes only text and
   * stickers, so a photo or a voice note there never says which message it answers.
   */
  readonly mediaReplies: boolean;
}

export interface WebhookInput {
  readonly headers: Headers;
  /** The exact bytes received, before any parsing; signatures are computed over this. */
  readonly rawBody: string;
}

export interface FetchedMedia {
  readonly body: ArrayBuffer;
  readonly mime: string;
}

/** What a platform tells about a person. A picture or a status line is never part of it. */
export interface ChannelProfile {
  readonly displayName?: string;
  /** The platform's language hint, as `InboundEvent.sender.languageCode`. */
  readonly languageCode?: string;
}

/** A platform's monthly message allowance, for platforms that bill per message sent. */
export interface ChannelQuota {
  /** Messages allowed this month; null when the plan sets no limit. */
  readonly limit: number | null;
  /** Messages counted this month so far, as the platform reports them (LINE: approximate). */
  readonly used: number;
  /** When the two were read, ISO 8601 with an offset. */
  readonly readAt: string;
}

export interface ChannelAdapter {
  readonly id: Channel;
  readonly capabilities: AdapterCapabilities;
  /** Constant-time verification of the platform's signature or secret. Never throws. */
  verify(input: WebhookInput): Promise<boolean>;
  /** Parse a verified webhook body. Unknown update types yield no events; malformed JSON throws. */
  parse(input: WebhookInput): InboundEvent[];
  /** Throws `ChannelSendError` on failure. */
  send(message: OutboundMessage): Promise<SendResult>;
  /**
   * Acknowledge a button tap (stops the client spinner). Safe to call once per tap. A platform
   * with nothing to acknowledge resolves for any event; Telegram's refuses an event that is not
   * one of its taps.
   */
  acknowledgeButton(event: InboundEvent, text?: string): Promise<void>;
  /**
   * Remove the buttons from a sent message, optionally replacing its text to show the choice.
   * Adapters whose `capabilities.editMessages` is false resolve without doing anything.
   */
  closeButtons(conversationId: string, messageId: string, replacementText?: string): Promise<void>;
  /** Download media the platform holds. */
  fetchMedia(providerFileId: string): Promise<FetchedMedia>;
  /** Download a smaller copy of an image the platform holds, where it keeps one. */
  fetchPreview?(providerFileId: string): Promise<FetchedMedia>;
  /**
   * What the platform tells about a person, looked up in `conversationId` when given, since some
   * platforms answer about a group's members only through the group. Null when the platform does
   * not know them there; any other failure throws `ChannelSendError`.
   */
  profile?(externalUserId: string, conversationId?: string): Promise<ChannelProfile | null>;
  /** Leave a group. One the bot is no longer in counts as left. */
  leaveConversation?(conversationId: string): Promise<void>;
  /** This month's allowance and use, for platforms that bill per message sent. */
  quota?(): Promise<ChannelQuota>;
}

export const CHANNEL_SEND_ERROR_CODES = [
  "blocked",
  "not_found",
  "rate_limited",
  /**
   * The month's message allowance is spent (LINE's 429 "You have reached your monthly limit.").
   * Retryable: LINE says it can be temporary, while a delivery in progress holds part of the quota.
   */
  "quota_exhausted",
  "invalid_request",
  "unavailable",
  "unknown",
] as const;
export type ChannelSendErrorCode = (typeof CHANNEL_SEND_ERROR_CODES)[number];

export class ChannelSendError extends Error {
  override readonly name = "ChannelSendError";
  readonly code: ChannelSendErrorCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;
  /**
   * Set when the platform refused the send because the group now has a new conversation id
   * (Telegram: a basic group upgraded to a supergroup). The send can never succeed as addressed, so
   * `retryable` stays false; the gateway re-points the family group to this id and sends again.
   */
  readonly migratedToConversationId: string | undefined;

  constructor(
    code: ChannelSendErrorCode,
    message: string,
    options: {
      retryAfterSeconds?: number;
      migratedToConversationId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.code = code;
    this.retryable =
      code === "rate_limited" || code === "quota_exhausted" || code === "unavailable";
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.migratedToConversationId = options.migratedToConversationId;
  }
}
