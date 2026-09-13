/**
 * One-off Bot API calls used by setup scripts, not by the running worker.
 */
import { ChannelSendError } from "@vela/contracts";
import {
  createTelegramClient,
  type TelegramApiOptions,
  type TelegramBotCommand,
  type TelegramBotCommandScope,
} from "./client.ts";
import { isValidWebhookSecret } from "./verify.ts";

/**
 * The updates the adapter parses. `message_reaction` is never delivered unless listed explicitly,
 * and leaving out edits and channel posts spares the worker requests it would ignore.
 */
export const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "message_reaction",
  "my_chat_member",
] as const;

export interface SetWebhookOptions extends TelegramApiOptions {
  /** HTTPS URL of the webhook route. */
  readonly url: string;
  /** Echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token`; the adapter's `webhookSecret`. */
  readonly secretToken: string;
  /** Defaults to `TELEGRAM_ALLOWED_UPDATES`. */
  readonly allowedUpdates?: readonly string[];
  readonly dropPendingUpdates?: boolean;
  /** 1–100; Telegram defaults to 40. */
  readonly maxConnections?: number;
}

export interface SetMyCommandsOptions extends TelegramApiOptions {
  readonly commands: readonly TelegramBotCommand[];
  readonly scope?: TelegramBotCommandScope;
  /** Two-letter ISO 639-1 code; omitted for users whose language has no dedicated list. */
  readonly languageCode?: string;
}

export interface TelegramBotInfo {
  readonly id: string;
  readonly username: string;
  readonly firstName: string;
  readonly canJoinGroups: boolean;
  /** False while privacy mode is on, in which case group messages that are not replies to the bot or commands are not delivered. */
  readonly canReadAllGroupMessages: boolean;
}

export async function setWebhook(options: SetWebhookOptions): Promise<void> {
  if (!isValidWebhookSecret(options.secretToken)) {
    throw new Error("Telegram webhook secret must be 1-256 characters of A-Z, a-z, 0-9, _ and -");
  }
  await createTelegramClient(options).setWebhook({
    url: options.url,
    secret_token: options.secretToken,
    allowed_updates: options.allowedUpdates ?? TELEGRAM_ALLOWED_UPDATES,
    drop_pending_updates: options.dropPendingUpdates,
    max_connections: options.maxConnections,
  });
}

export async function setMyCommands(options: SetMyCommandsOptions): Promise<void> {
  await createTelegramClient(options).setMyCommands({
    commands: options.commands,
    scope: options.scope,
    language_code: options.languageCode,
  });
}

export async function getMe(options: TelegramApiOptions): Promise<TelegramBotInfo> {
  const user = await createTelegramClient(options).getMe();
  if (user.username === undefined) {
    throw new ChannelSendError("unknown", "telegram getMe returned a bot without a username");
  }
  return {
    id: String(user.id),
    username: user.username,
    firstName: user.first_name,
    canJoinGroups: user.can_join_groups ?? false,
    canReadAllGroupMessages: user.can_read_all_group_messages ?? false,
  };
}
