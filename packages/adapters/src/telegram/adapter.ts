import {
  type AdapterCapabilities,
  type ChannelAdapter,
  ChannelSendError,
  type InboundEvent,
} from "@vela/contracts";
import { createTelegramClient, type TelegramApiOptions } from "./client.ts";
import { fetchTelegramMedia } from "./media.ts";
import { parseTelegramUpdate } from "./parse.ts";
import { sendTelegramMessage, toChatId, toMessageId } from "./send.ts";
import { isValidWebhookSecret, verifyTelegramSecret } from "./verify.ts";

export interface TelegramAdapterOptions extends TelegramApiOptions {
  /** The `secret_token` registered with `setWebhook`. */
  readonly webhookSecret: string;
  /** The bot's username without the `@`; commands addressed to any other bot are ignored. */
  readonly botUsername: string;
  /**
   * Dates events Telegram sends without a date (button taps). Defaults to the system clock; tests
   * pass a fixed one.
   */
  readonly now?: () => Date;
}

const TELEGRAM_CAPABILITIES: AdapterCapabilities = {
  buttons: true,
  voiceIn: true,
  voiceOut: true,
  readReceipts: false,
  reactions: true,
  albums: true,
};

// Editing a message into the state it is already in is Telegram's 400 "message is not modified";
// closing buttons twice has reached the intended state, so it is not a failure.
const NOT_MODIFIED = /message is not modified/i;

// A username given as `@VelaLightBot` would match no command and silently drop every addressed
// one, so the shape is checked up front.
const BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

export function createTelegramAdapter(options: TelegramAdapterOptions): ChannelAdapter {
  if (!isValidWebhookSecret(options.webhookSecret)) {
    throw new Error("Telegram webhook secret must be 1-256 characters of A-Z, a-z, 0-9, _ and -");
  }
  if (!BOT_USERNAME_PATTERN.test(options.botUsername)) {
    throw new Error("Telegram bot username must be 1-32 characters of A-Z, a-z, 0-9 and _, no @");
  }
  const client = createTelegramClient(options);
  const now = options.now ?? (() => new Date());

  return {
    id: "telegram",
    capabilities: TELEGRAM_CAPABILITIES,

    async verify(input) {
      return verifyTelegramSecret(input.headers, options.webhookSecret);
    },

    parse(input) {
      return parseTelegramUpdate(input.rawBody, now(), options.botUsername);
    },

    send(message) {
      return sendTelegramMessage(client, message);
    },

    async acknowledgeButton(event: InboundEvent, text?: string) {
      if (event.channel !== "telegram" || event.callbackId === undefined) {
        throw new ChannelSendError("invalid_request", "event is not a Telegram button tap");
      }
      await client.answerCallbackQuery({ callback_query_id: event.callbackId, text });
    },

    async closeButtons(conversationId, messageId, replacementText) {
      const chatId = toChatId(conversationId);
      const id = toMessageId(messageId);
      try {
        if (replacementText === undefined) {
          await client.editMessageReplyMarkup({ chat_id: chatId, message_id: id });
        } else {
          await client.editMessageText({
            chat_id: chatId,
            message_id: id,
            text: replacementText,
            link_preview_options: { is_disabled: true },
          });
        }
      } catch (error) {
        if (error instanceof ChannelSendError && NOT_MODIFIED.test(error.message)) return;
        throw error;
      }
    },

    fetchMedia(providerFileId) {
      return fetchTelegramMedia(client, providerFileId);
    },
  };
}
