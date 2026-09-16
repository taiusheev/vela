/**
 * What `telegram-setup.ts` does, apart from the process it runs in, so a test can run it against a
 * fake Telegram: read the arguments and the environment, refuse what Telegram would refuse, then
 * register the webhook and the command menu and say what was registered.
 */
import type { getMe, setMyCommands, setWebhook } from "@vela/adapters";
import { TELEGRAM_ALLOWED_UPDATES } from "@vela/adapters";

/**
 * Drops the updates Telegram is still holding for the bot. Off unless given (H6): during a live
 * pilot those updates are her answers and the family's asks, and dropping them loses them.
 */
export const DROP_PENDING_UPDATES = "--drop-pending-updates";

/** A refusal this script wrote itself: its message names no secret and is safe to print. */
export class SetupError extends Error {
  override readonly name = "SetupError";
}

export interface SetupArguments {
  readonly dropPendingUpdates: boolean;
}

/** The flags, and nothing else: a mistyped flag must not quietly keep or drop updates. */
export function parseSetupArguments(argv: readonly string[]): SetupArguments {
  let dropPendingUpdates = false;
  for (const argument of argv) {
    if (argument === DROP_PENDING_UPDATES) {
      dropPendingUpdates = true;
    } else {
      throw new SetupError(
        `Unknown argument "${argument}": the only flag is ${DROP_PENDING_UPDATES}`,
      );
    }
  }
  return { dropPendingUpdates };
}

/** Telegram's rule for `secret_token`, checked here so a bad one never reaches a request. */
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{1,256}$/;

/** The two commands, in groups only. A private chat has no menu: she is never asked to type one. */
const GROUP_COMMANDS = [
  { command: "ask", description: "Ask something for tomorrow morning" },
  { command: "later", description: "Save an ask for another morning" },
] as const;

/** The Telegram calls the setup makes; the script passes the real ones from `@vela/adapters`. */
export interface TelegramSetupApi {
  readonly getMe: typeof getMe;
  readonly setWebhook: typeof setWebhook;
  readonly setMyCommands: typeof setMyCommands;
}

export interface TelegramSetupInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: readonly string[];
  readonly api: TelegramSetupApi;
  readonly print: (line: string) => void;
}

function required(env: TelegramSetupInput["env"], name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new SetupError(`${name} is not set in the environment`);
  }
  return value.trim();
}

/**
 * The webhook is the pilot Worker's origin plus `/webhooks/telegram`. Any path given with the
 * origin is replaced, so a pasted notice or admin link still registers the webhook itself.
 */
export function webhookUrl(workerUrl: string): URL {
  let url: URL;
  try {
    url = new URL("/webhooks/telegram", workerUrl);
  } catch {
    throw new SetupError("WORKER_URL is not a URL: give the pilot Worker's https origin");
  }
  if (url.protocol !== "https:") {
    throw new SetupError("WORKER_URL must be https: Telegram delivers webhooks over TLS only");
  }
  return url;
}

export async function setUpTelegram({ env, argv, api, print }: TelegramSetupInput): Promise<void> {
  const { dropPendingUpdates } = parseSetupArguments(argv);
  const botToken = required(env, "TELEGRAM_BOT_TOKEN");
  const secretToken = required(env, "TELEGRAM_WEBHOOK_SECRET");
  const url = webhookUrl(required(env, "WORKER_URL"));

  if (!WEBHOOK_SECRET.test(secretToken)) {
    throw new SetupError(
      "TELEGRAM_WEBHOOK_SECRET must be 1 to 256 characters of A-Z, a-z, 0-9, _ and - (the value is not shown)",
    );
  }

  const me = await api.getMe({ botToken });

  // The updates the adapter parses (D17), passed explicitly rather than left to setWebhook's
  // default so the line printed below is what was registered.
  await api.setWebhook({
    botToken,
    url: url.toString(),
    secretToken,
    allowedUpdates: TELEGRAM_ALLOWED_UPDATES,
    dropPendingUpdates,
  });
  await api.setMyCommands({
    botToken,
    commands: GROUP_COMMANDS,
    scope: { type: "all_group_chats" },
  });
  await api.setMyCommands({ botToken, commands: [], scope: { type: "all_private_chats" } });

  print(`Webhook set: ${url.toString()}`);
  print(
    dropPendingUpdates
      ? "Pending updates: dropped"
      : `Pending updates: kept (pass ${DROP_PENDING_UPDATES} to drop them)`,
  );
  print(`Allowed updates: ${TELEGRAM_ALLOWED_UPDATES.join(", ")}`);
  print(
    `Commands: /${GROUP_COMMANDS.map((c) => c.command).join(", /")} in groups, none in private chats`,
  );
  print(`Bot: @${me.username}`);
  print(
    me.canReadAllGroupMessages
      ? "Group privacy is off: Telegram delivers every group message."
      : "Group privacy is on: Telegram delivers only commands and replies to the bot in groups.",
  );
}
