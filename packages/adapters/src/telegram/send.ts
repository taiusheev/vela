/**
 * Renders an `OutboundMessage` as Bot API calls: media first, in order (runs of consecutive photos
 * as one album, each audio as a voice message), then the text with its buttons. A photo Telegram
 * holds, or can fetch by URL, is named in JSON; a photo Vela keeps (ADR-33) is uploaded from the
 * bytes the gateway loaded, as multipart/form-data, mixed into an album by `attach://`.
 *
 * Text is sent without `parse_mode`, so nothing in it is ever interpreted as markup, and with link
 * previews disabled. Telegram has no idempotency keys: if a later call fails after earlier media
 * went out, the error is thrown and the gateway decides whether to retry.
 */
import {
  type Button,
  ChannelSendError,
  type FetchedMedia,
  type OutboundMediaRef,
  OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import type {
  TelegramChatId,
  TelegramClient,
  TelegramInlineKeyboardMarkup,
  TelegramInputMediaPhoto,
  TelegramSentMessage,
  TelegramUpload,
} from "./client.ts";

/** `callback_data` is limited to 1–64 bytes, not characters. */
const MAX_CALLBACK_DATA_BYTES = 64;

const encoder = new TextEncoder();

/** A photo as Telegram is given it: a file id or URL it resolves itself, or bytes to upload. */
type PhotoSource = { readonly remote: string } | { readonly upload: TelegramUpload };

type MediaStep =
  | { readonly kind: "photo"; readonly source: PhotoSource }
  | { readonly kind: "album"; readonly sources: readonly PhotoSource[] }
  | { readonly kind: "voice"; readonly source: string; readonly durationMs: number | undefined };

export async function sendTelegramMessage(
  client: TelegramClient,
  message: OutboundMessage,
  files?: ReadonlyMap<string, FetchedMedia>,
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
  const steps = planMedia(outbound.media ?? [], files);

  const sent: TelegramSentMessage[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case "photo":
        sent.push(
          "remote" in step.source
            ? await client.sendPhoto({ chat_id: chatId, photo: step.source.remote })
            : await client.sendPhotoUpload({ chat_id: chatId, photo: step.source.upload }),
        );
        break;
      case "album":
        sent.push(...(await sendAlbum(client, chatId, step.sources)));
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

/**
 * An album in one call: named in JSON when Telegram holds every photo, else as a form whose `media`
 * names each uploaded photo `attach://p<index>` beside the file ids, in the album's order.
 */
function sendAlbum(
  client: TelegramClient,
  chatId: TelegramChatId,
  sources: readonly PhotoSource[],
): Promise<TelegramSentMessage[]> {
  const files: Record<string, TelegramUpload> = {};
  const media = sources.map((source, index): TelegramInputMediaPhoto => {
    if ("remote" in source) {
      return { type: "photo", media: source.remote };
    }
    const name = `p${index}`;
    files[name] = source.upload;
    return { type: "photo", media: `attach://${name}` };
  });
  return Object.keys(files).length === 0
    ? client.sendMediaGroup({ chat_id: chatId, media })
    : client.sendMediaGroupUpload({ chat_id: chatId, media, files });
}

/**
 * The calls the media takes, checked before any is made. A photo Vela keeps must have its bytes in
 * `files`: the gateway loads them for each attempt, and a message missing one is refused rather
 * than sent short of a photo its buttons count. Only photos are uploaded this way.
 */
function planMedia(
  media: readonly OutboundMediaRef[],
  files: ReadonlyMap<string, FetchedMedia> | undefined,
): MediaStep[] {
  const steps: MediaStep[] = [];
  let photos: PhotoSource[] = [];
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
      photos.push({ upload: storedPhoto(ref, files) });
    } else if (ref.kind === "image") {
      photos.push({ remote: source });
    } else {
      flushPhotos();
      steps.push({ kind: "voice", source, durationMs: ref.durationMs });
    }
  }
  flushPhotos();
  return steps;
}

function storedPhoto(
  ref: OutboundMediaRef,
  files: ReadonlyMap<string, FetchedMedia> | undefined,
): TelegramUpload {
  if (ref.storageKey === undefined) {
    throw new ChannelSendError(
      "invalid_request",
      "media reference has neither a file id, a url nor a storage key",
    );
  }
  if (ref.kind !== "image") {
    throw new ChannelSendError("invalid_request", "only a photo is uploaded from storage");
  }
  const file = files?.get(ref.storageKey);
  if (file === undefined) {
    throw new ChannelSendError("invalid_request", "a stored photo was not loaded for the send");
  }
  return { body: file.body, mime: file.mime, name: "photo.jpg" };
}
