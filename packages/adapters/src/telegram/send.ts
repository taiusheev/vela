/**
 * Renders an `OutboundMessage` as Bot API calls: media first, in order (runs of consecutive photos
 * as one album, each audio as a voice message), then the text with its buttons. A photo Telegram
 * holds, or can fetch by URL, is named in JSON; a photo or voice Vela keeps (ADR-33, ADR-35) is
 * uploaded from the bytes the gateway loaded, as multipart/form-data, a photo mixed into an album by
 * `attach://`.
 *
 * Text is sent without `parse_mode`, so nothing in it is ever interpreted as markup, and with link
 * previews disabled. Telegram has no idempotency keys: if a later call fails after earlier media
 * went out, the error names those media items' messages (`sentMediaMessageIds`), so the gateway's
 * retry sends only what is missing, and the gateway decides whether to retry.
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
  | {
      readonly kind: "voice";
      readonly source: string | TelegramUpload;
      readonly durationMs: number | undefined;
    };

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

  // One message per media item, in order: an album returns one per photo.
  const sent: TelegramSentMessage[] = [];
  let text: TelegramSentMessage;
  try {
    for (const step of steps) {
      sent.push(...(await sendMediaStep(client, chatId, step)));
    }
    text = await client.sendMessage({
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
  } catch (error) {
    throw withSentMedia(error, sent);
  }

  return {
    externalMessageIds: [...sent, text].map((item) => String(item.message_id)),
    primaryMessageId: String(text.message_id),
  };
}

async function sendMediaStep(
  client: TelegramClient,
  chatId: TelegramChatId,
  step: MediaStep,
): Promise<TelegramSentMessage[]> {
  switch (step.kind) {
    case "photo":
      return [
        "remote" in step.source
          ? await client.sendPhoto({ chat_id: chatId, photo: step.source.remote })
          : await client.sendPhotoUpload({ chat_id: chatId, photo: step.source.upload }),
      ];
    case "album":
      return sendAlbum(client, chatId, step.sources);
    case "voice": {
      const duration =
        step.durationMs === undefined ? undefined : Math.ceil(step.durationMs / 1000);
      return [
        typeof step.source === "string"
          ? await client.sendVoice({ chat_id: chatId, voice: step.source, duration })
          : await client.sendVoiceUpload({ chat_id: chatId, voice: step.source, duration }),
      ];
    }
  }
}

/** The failed call's error, naming the media that had already reached the chat. */
function withSentMedia(error: unknown, sent: readonly TelegramSentMessage[]): unknown {
  if (!(error instanceof ChannelSendError) || sent.length === 0) {
    return error;
  }
  return new ChannelSendError(error.code, error.message, {
    retryAfterSeconds: error.retryAfterSeconds,
    migratedToConversationId: error.migratedToConversationId,
    sentMediaMessageIds: sent.map((item) => String(item.message_id)),
    cause: error.cause,
  });
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
 * than sent short of a photo its buttons count. A stored voice (her phone's recording, a voice reply
 * from the app) is uploaded the same way, as a voice message.
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
    if (source === undefined && ref.kind === "image") {
      photos.push({ upload: storedFile(ref, files) });
    } else if (source === undefined) {
      flushPhotos();
      steps.push({ kind: "voice", source: storedFile(ref, files), durationMs: ref.durationMs });
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

/** Telegram plays a voice from OGG/Opus, MP3 or M4A, and reads which by the part's name. */
const VOICE_NAMES: ReadonlyMap<string, string> = new Map([
  ["audio/ogg", "voice.ogg"],
  ["audio/mpeg", "voice.mp3"],
  ["audio/mp4", "voice.m4a"],
]);

function storedFile(
  ref: OutboundMediaRef,
  files: ReadonlyMap<string, FetchedMedia> | undefined,
): TelegramUpload {
  if (ref.storageKey === undefined) {
    throw new ChannelSendError(
      "invalid_request",
      "media reference has neither a file id, a url nor a storage key",
    );
  }
  const file = files?.get(ref.storageKey);
  if (file === undefined) {
    throw new ChannelSendError("invalid_request", "a stored file was not loaded for the send");
  }
  if (ref.kind === "image") {
    return { body: file.body, mime: file.mime, name: "photo.jpg" };
  }
  const name = VOICE_NAMES.get((file.mime.split(";")[0] ?? "").trim().toLowerCase());
  if (name === undefined) {
    throw new ChannelSendError("invalid_request", "a stored voice is not OGG, MP3 or M4A");
  }
  return { body: file.body, mime: file.mime, name };
}
