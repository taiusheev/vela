/**
 * Renders an `OutboundMessage` as Bot API calls: media first, in order (runs of consecutive photos
 * as one album, each audio as a voice message), then the text with its buttons.
 *
 * Text is sent without `parse_mode`, so nothing in it is ever interpreted as markup, and with link
 * previews disabled. Telegram has no idempotency keys: if a later call fails after earlier media
 * went out, the error is thrown and the gateway decides whether to retry.
 */
import {
  type Button,
  ChannelSendError,
  type MediaRef,
  OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import type {
  TelegramChatId,
  TelegramClient,
  TelegramInlineKeyboardMarkup,
  TelegramSentMessage,
} from "./client.ts";

/** `callback_data` is limited to 1–64 bytes, not characters. */
const MAX_CALLBACK_DATA_BYTES = 64;

const encoder = new TextEncoder();

type MediaStep =
  | { readonly kind: "photo"; readonly source: string }
  | { readonly kind: "album"; readonly sources: readonly string[] }
  | { readonly kind: "voice"; readonly source: string; readonly durationMs: number | undefined };

export async function sendTelegramMessage(
  client: TelegramClient,
  message: OutboundMessage,
): Promise<SendResult> {
  const checked = OutboundMessage.safeParse(message);
  if (!checked.success) {
    const fields = checked.error.issues.map((issue) => issue.path.join(".") || "message");
    throw new ChannelSendError(
      "invalid_request",
      `outbound message is invalid: ${fields.join(", ")}`,
    );
  }
  const outbound = checked.data;
  if (outbound.to.channel !== "telegram") {
    throw new ChannelSendError(
      "invalid_request",
      `cannot send a ${outbound.to.channel} message on telegram`,
    );
  }

  // Everything that can be rejected locally is checked before the first call, so a bad message
  // never leaves half of itself delivered.
  const chatId = toChatId(outbound.to.conversationId);
  const replyToMessageId =
    outbound.replyToMessageId === undefined ? undefined : toMessageId(outbound.replyToMessageId);
  const replyMarkup = outbound.buttons === undefined ? undefined : inlineKeyboard(outbound.buttons);
  const steps = planMedia(outbound.media ?? []);

  const sent: TelegramSentMessage[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case "photo":
        sent.push(await client.sendPhoto({ chat_id: chatId, photo: step.source }));
        break;
      case "album":
        sent.push(
          ...(await client.sendMediaGroup({
            chat_id: chatId,
            media: step.sources.map((source) => ({ type: "photo", media: source })),
          })),
        );
        break;
      case "voice":
        sent.push(
          await client.sendVoice({
            chat_id: chatId,
            voice: step.source,
            duration: step.durationMs === undefined ? undefined : Math.ceil(step.durationMs / 1000),
          }),
        );
        break;
    }
  }

  const text = await client.sendMessage({
    chat_id: chatId,
    text: outbound.text,
    link_preview_options: { is_disabled: true },
    reply_parameters:
      replyToMessageId === undefined
        ? undefined
        : // The reply is context, not content: a deleted original must not lose the message.
          { message_id: replyToMessageId, allow_sending_without_reply: true },
    reply_markup: replyMarkup,
  });
  sent.push(text);

  return {
    externalMessageIds: sent.map((item) => String(item.message_id)),
    primaryMessageId: String(text.message_id),
  };
}

/** Numeric chat ids are sent as integers, as the Bot API documents; `@username` stays a string. */
export function toChatId(conversationId: string): TelegramChatId {
  if (/^-?\d+$/.test(conversationId)) {
    const id = Number(conversationId);
    if (Number.isSafeInteger(id)) return id;
  }
  if (/^@\w+$/.test(conversationId)) return conversationId;
  throw new ChannelSendError("invalid_request", "conversation id is not a Telegram chat id");
}

export function toMessageId(messageId: string): number {
  const id = /^\d+$/.test(messageId) ? Number(messageId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ChannelSendError("invalid_request", "message id is not a Telegram message id");
  }
  return id;
}

function inlineKeyboard(rows: readonly (readonly Button[])[]): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) => {
        if (encoder.encode(button.id).length > MAX_CALLBACK_DATA_BYTES) {
          throw new ChannelSendError(
            "invalid_request",
            `button id exceeds Telegram's ${MAX_CALLBACK_DATA_BYTES}-byte callback_data limit`,
          );
        }
        return { text: button.label, callback_data: button.id };
      }),
    ),
  };
}

function planMedia(media: readonly MediaRef[]): MediaStep[] {
  const steps: MediaStep[] = [];
  let photos: string[] = [];
  const flushPhotos = (): void => {
    const [first, ...rest] = photos;
    if (first !== undefined) {
      steps.push(
        rest.length === 0 ? { kind: "photo", source: first } : { kind: "album", sources: photos },
      );
    }
    photos = [];
  };

  for (const ref of media) {
    // Telegram reuses its own file_id without a size limit; a URL is fetched by Telegram.
    const source = ref.providerFileId ?? ref.url;
    if (source === undefined) {
      throw new ChannelSendError(
        "invalid_request",
        "media reference has neither a file id nor a url",
      );
    }
    if (ref.kind === "image") {
      photos.push(source);
    } else {
      flushPhotos();
      steps.push({ kind: "voice", source, durationMs: ref.durationMs });
    }
  }
  flushPhotos();
  return steps;
}
