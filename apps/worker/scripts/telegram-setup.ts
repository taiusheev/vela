/**
 * Registers the bot with Telegram: the webhook (with its secret and the updates the adapter
 * parses) and the command menu. The founder runs it from their own terminal, once per bot and
 * again whenever the Worker's URL changes.
 *
 *   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… WORKER_URL=https://… \
 *     pnpm --filter @vela/worker telegram:setup
 *
 * Nothing secret is ever printed: the token and the secret are read from the environment and only
 * sent to api.telegram.org. What it prints is what the founder has to check by eye — the bot's
 * username, and whether Telegram will deliver group messages that are not addressed to it.
 */
import { getMe, setMyCommands, setWebhook } from "@vela/adapters";

// Node's own `process`; this script runs under Node, not in the Worker.
declare const process: {
  readonly env: Record<string, string | undefined>;
  exitCode: number | undefined;
};

/** Telegram's rule for `secret_token`, checked here so a bad one never reaches a request. */
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * The updates the adapter parses (D17). This is `TELEGRAM_ALLOWED_UPDATES` in @vela/adapters,
 * which the package root does not re-export; it is passed explicitly so what is printed is what
 * was registered. A departure arrives inside `message` as `left_chat_member`, and
 * `message_reaction` is never delivered unless it is listed.
 */
const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "message_reaction",
  "my_chat_member",
] as const;

/** The two commands, in groups only. A private chat has no menu: she is never asked to type one. */
const GROUP_COMMANDS = [
  { command: "ask", description: "Ask something for tomorrow morning" },
  { command: "later", description: "Save an ask for another morning" },
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set in the environment`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const botToken = required("TELEGRAM_BOT_TOKEN");
  const secretToken = required("TELEGRAM_WEBHOOK_SECRET");
  const workerUrl = required("WORKER_URL");

  if (!WEBHOOK_SECRET.test(secretToken)) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET must be 1 to 256 characters of A-Z, a-z, 0-9, _ and - (the value is not shown)",
    );
  }
  const url = new URL("/webhooks/telegram", workerUrl);
  if (url.protocol !== "https:") {
    throw new Error("WORKER_URL must be https: Telegram delivers webhooks over TLS only");
  }

  const me = await getMe({ botToken });

  await setWebhook({
    botToken,
    url: url.toString(),
    secretToken,
    allowedUpdates: ALLOWED_UPDATES,
  });
  await setMyCommands({ botToken, commands: GROUP_COMMANDS, scope: { type: "all_group_chats" } });
  await setMyCommands({ botToken, commands: [], scope: { type: "all_private_chats" } });

  console.log(`Webhook set: ${url.toString()}`);
  console.log(`Allowed updates: ${ALLOWED_UPDATES.join(", ")}`);
  console.log(
    `Commands: /${GROUP_COMMANDS.map((c) => c.command).join(", /")} in groups, none in private chats`,
  );
  console.log(`Bot: @${me.username}`);
  console.log(
    me.canReadAllGroupMessages
      ? "Group privacy is off: Telegram delivers every group message."
      : "Group privacy is on: Telegram delivers only commands and replies to the bot in groups.",
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
