export { createTelegramAdapter, type TelegramAdapterOptions } from "./telegram/adapter.ts";
export type {
  TelegramApiOptions,
  TelegramBotCommand,
  TelegramBotCommandScope,
} from "./telegram/client.ts";
export {
  getMe,
  type SetMyCommandsOptions,
  type SetWebhookOptions,
  setMyCommands,
  setWebhook,
  type TelegramBotInfo,
} from "./telegram/setup.ts";
