import { errorLabel } from "@vela/services";
import { describe, expect, it } from "vitest";
import { buildDeps, ConfigError, createHeartbeat, readConfig } from "./deps.ts";
import type { Env } from "./env.ts";
import { type LogLine, recordingLogger, testEnv } from "./testing/fakes.ts";

/**
 * Staging once the founder has chosen its bot, chat, and hosts. The hosts are under the reserved
 * `.example` domain: a real-looking one in a test is the kind that ends up in a config file.
 */
const chosenStaging: Env = {
  ...testEnv,
  ENVIRONMENT: "staging",
  TELEGRAM_BOT_USERNAME: "VelaStagingBot",
  ADMIN_CONVERSATION_ID: "123456789",
  PUBLIC_BASE_URL: "https://admin.vela.example",
  PRIVACY_NOTICE_URL_EN: "https://www.vela.example/privacy",
  PRIVACY_NOTICE_URL_ZH_TW: "https://www.vela.example/zh-TW/privacy",
};

/** The `ConfigError` `run` throws; anything else, or nothing, fails the test. */
function configErrorOf(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a ConfigError, and nothing was thrown");
}

type StringVar = "TELEGRAM_BOT_USERNAME" | "ADMIN_CONVERSATION_ID" | "REGIONS" | "ACCESS_AUD";
type UrlVar = "PUBLIC_BASE_URL" | "PRIVACY_NOTICE_URL_EN" | "PRIVACY_NOTICE_URL_ZH_TW";

describe("the configuration a deployed Worker starts with", () => {
  it("starts staging once every value is chosen and every link is https", () => {
    const config = readConfig(chosenStaging);

    expect(config.environment).toBe("staging");
    expect(config.telegramBotUsername).toBe("VelaStagingBot");
    expect(config.publicBaseUrl).toBe("https://admin.vela.example");
    expect(config.privacyNoticeUrls.en).toBe("https://www.vela.example/privacy");
    expect(config.privacyNoticeUrls["zh-TW"]).toBe("https://www.vela.example/zh-TW/privacy");
  });

  // The shapes wrangler.jsonc writes: a whole value, or a URL whose host nobody has chosen.
  const placeholders: readonly (readonly [StringVar | UrlVar, string])[] = [
    ["TELEGRAM_BOT_USERNAME", "PLACEHOLDER_STAGING_BOT_USERNAME"],
    ["ADMIN_CONVERSATION_ID", "PLACEHOLDER_STAGING_ADMIN_CHAT_ID"],
    ["PUBLIC_BASE_URL", "https://PLACEHOLDER_STAGING_HOST"],
    ["PRIVACY_NOTICE_URL_EN", "PLACEHOLDER_STAGING_PRIVACY_NOTICE_URL_EN"],
    ["PRIVACY_NOTICE_URL_ZH_TW", "https://PLACEHOLDER_STAGING_HOST/zh-TW/privacy"],
    ["REGIONS", "PLACEHOLDER_REGIONS"],
    // A secret is checked the same way: nothing lists what is checked, so nothing can be missed.
    ["ACCESS_AUD", "PLACEHOLDER_ACCESS_AUD"],
  ];

  it.each(placeholders)(
    "refuses to start while %s still holds a placeholder, naming it and not its value",
    (name, value) => {
      const error = configErrorOf(() => readConfig({ ...chosenStaging, [name]: value }));

      expect(error.code).toBe(name);
      expect(error.message).toContain(name);
      expect(error.message).not.toContain(value);
    },
  );

  const insecure: readonly (readonly [UrlVar, string])[] = [
    ["PUBLIC_BASE_URL", "http://admin.vela.example"],
    ["PRIVACY_NOTICE_URL_EN", "http://www.vela.example/privacy"],
    ["PRIVACY_NOTICE_URL_ZH_TW", "www.vela.example/zh-TW/privacy"],
  ];

  it.each(insecure)(
    "refuses to start production while %s is %s, not an https URL",
    (name, value) => {
      const production: Env = { ...chosenStaging, ENVIRONMENT: "production", [name]: value };

      expect(configErrorOf(() => readConfig(production)).code).toBe(name);
    },
  );

  it("refuses before it opens a database connection", async () => {
    const unchosen: Env = { ...chosenStaging, PUBLIC_BASE_URL: "https://PLACEHOLDER_STAGING_HOST" };

    const refusal = buildDeps(unchosen);

    await expect(refusal).rejects.toBeInstanceOf(ConfigError);
    await expect(refusal).rejects.toHaveProperty("code", "PUBLIC_BASE_URL");
  });

  // Failures are logged by label, never by message, so the variable has to survive in the label.
  it("names the variable in the label a failure is logged by", () => {
    const error = configErrorOf(() =>
      readConfig({
        ...chosenStaging,
        PRIVACY_NOTICE_URL_EN: "PLACEHOLDER_STAGING_PRIVACY_NOTICE_URL_EN",
      }),
    );

    expect(errorLabel(error)).toBe("ConfigError:PRIVACY_NOTICE_URL_EN");
  });

  it("runs development on localhost with the placeholders wrangler.jsonc ships", () => {
    const config = readConfig(testEnv);

    expect(testEnv.TELEGRAM_BOT_USERNAME).toContain("PLACEHOLDER_");
    expect(config.environment).toBe("development");
    expect(config.publicBaseUrl).toBe("http://localhost:8787");
    expect(config.privacyNoticeUrls.en).toBe("http://localhost:8787/privacy");
    expect(config.privacyNoticeUrls["zh-TW"]).toBe("http://localhost:8787/zh-TW/privacy");
  });
});

/**
 * A Healthchecks ping URL as the founder pastes it: the uuid in it is the whole credential, so
 * whoever reads it out of a log can silence or fake the monitor.
 */
const PING_URL = "https://hc-ping.com/6f1a0f8e-0000-4000-8000-2f1b0e4d9c77";

describe("the heartbeat", () => {
  it("pings the monitor and says nothing while it answers", async () => {
    const lines: LogLine[] = [];
    const sent: string[] = [];
    const heartbeat = createHeartbeat(PING_URL, recordingLogger(lines), {
      fetch: async (resource, init) => {
        sent.push(`${init?.method ?? "GET"} ${String(resource)}`);
        return new Response("OK");
      },
    });

    await heartbeat.ping();

    expect(sent).toEqual([`POST ${PING_URL}`]);
    expect(lines).toEqual([]);
  });

  it("keeps the ping URL out of the log line when the fetch fails", async () => {
    const lines: LogLine[] = [];
    const heartbeat = createHeartbeat(PING_URL, recordingLogger(lines), {
      // What workerd throws for a URL it cannot load: the message carries the URL it was given,
      // which for a mistyped or scheme-less ping URL is the secret itself.
      fetch: async (resource) => {
        throw new TypeError(`Fetch API cannot load: ${String(resource)}`);
      },
    });

    await heartbeat.ping();

    expect(lines).toEqual([
      { level: "warn", event: "heartbeat_failed", fields: { reason: "network" } },
    ]);
    expect(JSON.stringify(lines)).not.toContain("hc-ping.com");
  });

  it("says the status the monitor answered with, which carries nothing secret", async () => {
    const lines: LogLine[] = [];
    const heartbeat = createHeartbeat(PING_URL, recordingLogger(lines), {
      fetch: async () => new Response("no", { status: 502 }),
    });

    await heartbeat.ping();

    expect(lines).toEqual([{ level: "warn", event: "heartbeat_failed", fields: { status: 502 } }]);
  });
});
