/**
 * Registers the bot with Telegram: the webhook (with its secret and the updates the adapter
 * parses) and the command menu. The founder runs it from their own terminal, once per bot and
 * again whenever the pilot Worker's URL changes. `WORKER_URL` is the pilot Worker's origin, never
 * the admin Worker's, which Cloudflare Access closes to Telegram:
 *
 *   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… WORKER_URL=https://vela.<subdomain>.workers.dev \
 *     pnpm --filter @vela/worker telegram:setup [--drop-pending-updates]
 *
 * Pending updates are kept unless `--drop-pending-updates` is given (H6): during a live pilot they
 * are real answers.
 *
 * Nothing secret is ever printed: the token and the secret are read from the environment and only
 * sent to api.telegram.org, and a failure is printed as this script's own refusal or as the
 * error's class and code, never a message a request could have put the token into. What it prints
 * is what the founder has to check by eye: the webhook, whether pending updates were kept, the
 * bot's username, and whether Telegram will deliver group messages that are not addressed to it.
 */
import { getMe, setMyCommands, setWebhook } from "@vela/adapters";
import { errorLabel } from "@vela/services";
import { SetupError, setUpTelegram } from "./telegram-webhook.ts";

// Node's own `process`; this script runs under Node, not in the Worker.
declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: readonly string[];
  exitCode: number | undefined;
};

try {
  await setUpTelegram({
    env: process.env,
    argv: process.argv.slice(2),
    api: { getMe, setWebhook, setMyCommands },
    print: (line) => console.log(line),
  });
} catch (error) {
  console.error(error instanceof SetupError ? error.message : `Setup failed: ${errorLabel(error)}`);
  process.exitCode = 1;
}
