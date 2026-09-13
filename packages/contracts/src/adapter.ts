/**
 * The channel adapter contract (architecture §8). An adapter translates between one messaging
 * platform and these shapes. It never touches the database, the AI, or the scheduler, so a new
 * platform is a new adapter and nothing above the adapter line changes.
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
] as const;
export const InboundKind = z.enum(INBOUND_KINDS);
export type InboundKind = z.infer<typeof InboundKind>;

/** A reference to media held by the platform (to be fetched) or by us (to be sent). */
export const MediaRef = z
  .object({
    kind: MediaKind,
    /** Platform-held file identifier, reusable only on the same channel. */
    providerFileId: z.string().min(1).optional(),
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
  media: MediaRef.optional(),
});
export type InboundEvent = z.infer<typeof InboundEvent>;

export const Button = z.object({
  /** Opaque payload returned in `InboundEvent.buttonData`. Telegram allows 1–64 bytes. */
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
});
export type OutboundMessage = z.infer<typeof OutboundMessage>;

export interface SendResult {
  /** Every platform message created, in order (media first, then the text message). */
  readonly externalMessageIds: readonly string[];
  /** The message that carries the text and buttons; replies and button taps refer to it. */
  readonly primaryMessageId: string;
}

export interface AdapterCapabilities {
  readonly buttons: boolean;
  readonly voiceIn: boolean;
  readonly voiceOut: boolean;
  readonly readReceipts: boolean;
  readonly reactions: boolean;
  readonly albums: boolean;
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

export interface ChannelAdapter {
  readonly id: Channel;
  readonly capabilities: AdapterCapabilities;
  /** Constant-time verification of the platform's signature or secret. Never throws. */
  verify(input: WebhookInput): Promise<boolean>;
  /** Parse a verified webhook body. Unknown update types yield no events; malformed JSON throws. */
  parse(input: WebhookInput): InboundEvent[];
  /** Throws `ChannelSendError` on failure. */
  send(message: OutboundMessage): Promise<SendResult>;
  /** Acknowledge a button tap (stops the client spinner). Safe to call once per tap. */
  acknowledgeButton(event: InboundEvent, text?: string): Promise<void>;
  /** Remove the buttons from a sent message, optionally replacing its text to show the choice. */
  closeButtons(conversationId: string, messageId: string, replacementText?: string): Promise<void>;
  /** Download media the platform holds. */
  fetchMedia(providerFileId: string): Promise<FetchedMedia>;
}

export const CHANNEL_SEND_ERROR_CODES = [
  "blocked",
  "not_found",
  "rate_limited",
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

  constructor(
    code: ChannelSendErrorCode,
    message: string,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.code = code;
    this.retryable = code === "rate_limited" || code === "unavailable";
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
