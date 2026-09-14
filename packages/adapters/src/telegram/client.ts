/**
 * A small typed client for the Telegram Bot API.
 *
 * Built against Telegram Bot API 10.3 (2026-08-24), https://core.telegram.org/bots/api. Method
 * names, parameters, and result fields below were checked against that version.
 *
 * Every failure becomes a `ChannelSendError`. The bot token is part of every request URL, so error
 * text is never built from a URL, and anything that could echo one (a runtime's network error, a
 * description) is redacted before it reaches an error.
 */
import { ChannelSendError, type ChannelSendErrorCode } from "@vela/contracts";

export const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

// Tokens are `<bot id>:<secret>`; checking the shape also keeps a stray `/` or `?` out of the URL.
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

export interface TelegramApiOptions {
  readonly botToken: string;
  readonly fetch?: typeof fetch;
  /** Defaults to https://api.telegram.org; a local Bot API server or a test double otherwise. */
  readonly apiBaseUrl?: string;
}

export type TelegramChatId = number | string;

export interface TelegramInlineKeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

export interface TelegramInlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly TelegramInlineKeyboardButton[])[];
}

export interface TelegramLinkPreviewOptions {
  readonly is_disabled: boolean;
}

export interface TelegramReplyParameters {
  readonly message_id: number;
  readonly allow_sending_without_reply?: boolean;
}

export interface TelegramSendMessageParams {
  readonly chat_id: TelegramChatId;
  readonly text: string;
  readonly link_preview_options?: TelegramLinkPreviewOptions;
  readonly reply_parameters?: TelegramReplyParameters;
  readonly reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramSendPhotoParams {
  readonly chat_id: TelegramChatId;
  /** A file_id or an HTTP URL. */
  readonly photo: string;
}

export interface TelegramSendVoiceParams {
  readonly chat_id: TelegramChatId;
  /** A file_id or an HTTP URL. */
  readonly voice: string;
  /** Seconds. */
  readonly duration?: number;
}

export interface TelegramInputMediaPhoto {
  readonly type: "photo";
  readonly media: string;
}

export interface TelegramSendMediaGroupParams {
  readonly chat_id: TelegramChatId;
  /** 2–10 items. */
  readonly media: readonly TelegramInputMediaPhoto[];
}

export interface TelegramEditMessageTextParams {
  readonly chat_id: TelegramChatId;
  readonly message_id: number;
  readonly text: string;
  readonly link_preview_options?: TelegramLinkPreviewOptions;
  /** Omitted to remove the inline keyboard. */
  readonly reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramEditMessageReplyMarkupParams {
  readonly chat_id: TelegramChatId;
  readonly message_id: number;
  /** Omitted to remove the inline keyboard. */
  readonly reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramAnswerCallbackQueryParams {
  readonly callback_query_id: string;
  readonly text?: string;
}

export interface TelegramGetFileParams {
  readonly file_id: string;
}

export interface TelegramSetWebhookParams {
  readonly url: string;
  readonly secret_token?: string;
  readonly allowed_updates?: readonly string[];
  readonly drop_pending_updates?: boolean;
  readonly max_connections?: number;
}

export interface TelegramBotCommand {
  /** 1–32 characters: lowercase English letters, digits, and underscores. */
  readonly command: string;
  /** 1–256 characters. */
  readonly description: string;
}

/** The Bot API's `BotCommandScope` object. */
export type TelegramBotCommandScope =
  | { readonly type: "default" }
  | { readonly type: "all_private_chats" }
  | { readonly type: "all_group_chats" }
  | { readonly type: "all_chat_administrators" }
  | { readonly type: "chat"; readonly chat_id: TelegramChatId }
  | { readonly type: "chat_administrators"; readonly chat_id: TelegramChatId }
  | { readonly type: "chat_member"; readonly chat_id: TelegramChatId; readonly user_id: number };

export interface TelegramSetMyCommandsParams {
  readonly commands: readonly TelegramBotCommand[];
  readonly scope?: TelegramBotCommandScope;
  readonly language_code?: string;
}

export interface TelegramSentMessage {
  readonly message_id: number;
}

export interface TelegramFile {
  readonly file_id: string;
  readonly file_size?: number;
  readonly file_path?: string;
}

export interface TelegramBotUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly username?: string;
  readonly can_join_groups?: boolean;
  readonly can_read_all_group_messages?: boolean;
}

export interface TelegramDownload {
  readonly body: ArrayBuffer;
  readonly contentType: string | null;
}

export interface TelegramClient {
  sendMessage(params: TelegramSendMessageParams): Promise<TelegramSentMessage>;
  sendPhoto(params: TelegramSendPhotoParams): Promise<TelegramSentMessage>;
  sendVoice(params: TelegramSendVoiceParams): Promise<TelegramSentMessage>;
  sendMediaGroup(params: TelegramSendMediaGroupParams): Promise<TelegramSentMessage[]>;
  editMessageText(params: TelegramEditMessageTextParams): Promise<void>;
  editMessageReplyMarkup(params: TelegramEditMessageReplyMarkupParams): Promise<void>;
  answerCallbackQuery(params: TelegramAnswerCallbackQueryParams): Promise<void>;
  getFile(params: TelegramGetFileParams): Promise<TelegramFile>;
  getMe(): Promise<TelegramBotUser>;
  setWebhook(params: TelegramSetWebhookParams): Promise<void>;
  setMyCommands(params: TelegramSetMyCommandsParams): Promise<void>;
  /** Downloads `file_path` from a `getFile` result; rejects bodies larger than `maxBytes`. */
  downloadFile(filePath: string, maxBytes: number): Promise<TelegramDownload>;
}

/**
 * Maps a failed Bot API call to an error code. Telegram's descriptions are the only way to tell
 * "chat not found" apart from other bad requests.
 */
export function telegramErrorCode(status: number, description: string): ChannelSendErrorCode {
  if (status === 403) return "blocked";
  if (status === 400) return /chat not found/i.test(description) ? "not_found" : "invalid_request";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

export function createTelegramClient(options: TelegramApiOptions): TelegramClient {
  const token = options.botToken;
  if (!BOT_TOKEN_PATTERN.test(token)) {
    throw new Error("Telegram bot token is malformed; expected <bot id>:<secret>");
  }
  const baseUrl = (options.apiBaseUrl ?? TELEGRAM_API_BASE_URL).replace(/\/+$/, "");
  // Invoked unbound: Workers reject the platform fetch when it is called as a method of an object.
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  const redact = (text: string): string =>
    text.replaceAll(token, "[token]").replaceAll(encodeURIComponent(token), "[token]");

  const networkError = (what: string, error: unknown): ChannelSendError =>
    new ChannelSendError(
      "unavailable",
      `telegram ${what} failed: network error (${redact(describe(error))})`,
    );

  async function call(method: string, params: object): Promise<unknown> {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
      text = await response.text();
    } catch (error) {
      throw networkError(method, error);
    }

    const body = parseJson(text);
    if (isRecord(body) && body.ok === true && "result" in body) {
      return body.result;
    }

    const status = isRecord(body) && isInteger(body.error_code) ? body.error_code : response.status;
    const description = redact(
      isRecord(body) && typeof body.description === "string"
        ? body.description
        : response.statusText,
    );
    const parameters = isRecord(body) && isRecord(body.parameters) ? body.parameters : undefined;
    const retryAfterSeconds =
      parameters !== undefined && isInteger(parameters.retry_after)
        ? parameters.retry_after
        : undefined;
    // A basic group upgraded to a supergroup refuses sends to its old id with a 400 naming the new
    // one; ids have up to 52 significant bits, so they are safe integers.
    const migratedToConversationId =
      parameters !== undefined && isInteger(parameters.migrate_to_chat_id)
        ? String(parameters.migrate_to_chat_id)
        : undefined;
    const message = `telegram ${method} failed: ${status}${description ? ` ${description}` : ""}`;
    throw new ChannelSendError(telegramErrorCode(status, description), message, {
      retryAfterSeconds,
      migratedToConversationId,
    });
  }

  async function sentMessage(method: string, params: object): Promise<TelegramSentMessage> {
    return readSentMessage(method, await call(method, params));
  }

  return {
    sendMessage: (params) => sentMessage("sendMessage", params),
    sendPhoto: (params) => sentMessage("sendPhoto", params),
    sendVoice: (params) => sentMessage("sendVoice", params),
    async sendMediaGroup(params) {
      const result = await call("sendMediaGroup", params);
      if (!Array.isArray(result)) throw unexpectedResult("sendMediaGroup");
      return result.map((item) => readSentMessage("sendMediaGroup", item));
    },
    async editMessageText(params) {
      await call("editMessageText", params);
    },
    async editMessageReplyMarkup(params) {
      await call("editMessageReplyMarkup", params);
    },
    async answerCallbackQuery(params) {
      await call("answerCallbackQuery", params);
    },
    async getFile(params) {
      const result = await call("getFile", params);
      if (!isRecord(result) || typeof result.file_id !== "string") {
        throw unexpectedResult("getFile");
      }
      return {
        file_id: result.file_id,
        ...(isInteger(result.file_size) && { file_size: result.file_size }),
        ...(typeof result.file_path === "string" && { file_path: result.file_path }),
      };
    },
    async getMe() {
      const result = await call("getMe", {});
      if (
        !isRecord(result) ||
        !isInteger(result.id) ||
        typeof result.first_name !== "string" ||
        typeof result.is_bot !== "boolean"
      ) {
        throw unexpectedResult("getMe");
      }
      return {
        id: result.id,
        is_bot: result.is_bot,
        first_name: result.first_name,
        ...(typeof result.username === "string" && { username: result.username }),
        ...(typeof result.can_join_groups === "boolean" && {
          can_join_groups: result.can_join_groups,
        }),
        ...(typeof result.can_read_all_group_messages === "boolean" && {
          can_read_all_group_messages: result.can_read_all_group_messages,
        }),
      };
    },
    async setWebhook(params) {
      await call("setWebhook", params);
    },
    async setMyCommands(params) {
      await call("setMyCommands", params);
    },
    async downloadFile(filePath, maxBytes) {
      const path = filePath.split("/").map(encodeURIComponent).join("/");
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/file/bot${token}/${path}`, { method: "GET" });
      } catch (error) {
        throw networkError("file download", error);
      }
      if (!response.ok) {
        throw new ChannelSendError(
          downloadErrorCode(response.status),
          `telegram file download failed: ${response.status}`,
        );
      }
      const declaredBytes = Number(response.headers.get("content-length") ?? "0");
      if (declaredBytes > maxBytes) throw tooLarge(maxBytes);
      let body: ArrayBuffer;
      try {
        body = await response.arrayBuffer();
      } catch (error) {
        throw networkError("file download", error);
      }
      if (body.byteLength > maxBytes) throw tooLarge(maxBytes);
      return { body, contentType: response.headers.get("content-type") };
    },
  };
}

function downloadErrorCode(status: number): ChannelSendErrorCode {
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

function tooLarge(maxBytes: number): ChannelSendError {
  return new ChannelSendError(
    "invalid_request",
    `telegram file exceeds the ${maxBytes}-byte download limit`,
  );
}

function readSentMessage(method: string, value: unknown): TelegramSentMessage {
  if (!isRecord(value) || !isInteger(value.message_id)) throw unexpectedResult(method);
  return { message_id: value.message_id };
}

// A 2xx without the documented result may still have been acted on, so it is not retryable.
function unexpectedResult(method: string): ChannelSendError {
  return new ChannelSendError("unknown", `telegram ${method} returned an unexpected result`);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// Proxies in front of the Bot API answer outages with HTML; such bodies fall back to the HTTP status.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}
