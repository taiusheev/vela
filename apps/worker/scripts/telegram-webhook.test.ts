import type { SetWebhookOptions } from "@vela/adapters";
import { describe, expect, it } from "vitest";
import {
  DROP_PENDING_UPDATES,
  SetupError,
  setUpTelegram,
  type TelegramSetupApi,
} from "./telegram-webhook.ts";

const ENV = {
  TELEGRAM_BOT_TOKEN: "12345:test-token",
  TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret",
  WORKER_URL: "https://vela.worker.test",
};

interface FakeTelegram {
  readonly api: TelegramSetupApi;
  readonly webhooks: SetWebhookOptions[];
  /** Every Telegram call, by name, in order. */
  readonly calls: string[];
}

function fakeTelegram(): FakeTelegram {
  const webhooks: SetWebhookOptions[] = [];
  const calls: string[] = [];
  return {
    webhooks,
    calls,
    api: {
      getMe: async () => {
        calls.push("getMe");
        return {
          id: "1",
          username: "VelaStagingBot",
          firstName: "Vela Light staging",
          canJoinGroups: true,
          canReadAllGroupMessages: false,
        };
      },
      setWebhook: async (options) => {
        calls.push("setWebhook");
        webhooks.push(options);
      },
      setMyCommands: async () => {
        calls.push("setMyCommands");
      },
    },
  };
}

async function run(
  telegram: FakeTelegram,
  argv: readonly string[],
  env: Record<string, string> = ENV,
): Promise<string[]> {
  const printed: string[] = [];
  await setUpTelegram({ env, argv, api: telegram.api, print: (line) => printed.push(line) });
  return printed;
}

describe("the Telegram setup script", () => {
  // H6: in a live pilot the updates Telegram holds are her answers; losing them must be asked for.
  it("keeps pending updates unless --drop-pending-updates is given", async () => {
    const telegram = fakeTelegram();

    const printed = await run(telegram, []);

    expect(telegram.webhooks.map((webhook) => webhook.dropPendingUpdates)).toEqual([false]);
    expect(printed).toContain(`Pending updates: kept (pass ${DROP_PENDING_UPDATES} to drop them)`);
  });

  it("drops pending updates when --drop-pending-updates is given", async () => {
    const telegram = fakeTelegram();

    const printed = await run(telegram, [DROP_PENDING_UPDATES]);

    expect(telegram.webhooks.map((webhook) => webhook.dropPendingUpdates)).toEqual([true]);
    expect(printed).toContain("Pending updates: dropped");
  });

  it("refuses an argument it does not know before it calls Telegram", async () => {
    const telegram = fakeTelegram();

    await expect(run(telegram, ["--drop-pending-update"])).rejects.toBeInstanceOf(SetupError);
    expect(telegram.calls).toEqual([]);
  });

  it("registers the pilot Worker's origin plus /webhooks/telegram", async () => {
    const telegram = fakeTelegram();

    await run(telegram, [], { ...ENV, WORKER_URL: `${ENV.WORKER_URL}/privacy` });

    expect(telegram.webhooks.map((webhook) => webhook.url)).toEqual([
      "https://vela.worker.test/webhooks/telegram",
    ]);
  });

  it("refuses a WORKER_URL that is not https before it calls Telegram", async () => {
    const telegram = fakeTelegram();

    await expect(
      run(telegram, [], { ...ENV, WORKER_URL: "http://localhost:8787" }),
    ).rejects.toThrow("WORKER_URL must be https");
    expect(telegram.calls).toEqual([]);
  });
});
