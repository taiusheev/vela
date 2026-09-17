import { describe, expect, it } from "vitest";
import { ConfigError } from "./config.ts";
import { buildAdminDeps, buildDeps } from "./deps.ts";
import type { AdminEnv, PilotEnv } from "./env.ts";
import type { PrivacyNotices } from "./notices.ts";
import { adminTestEnv, noticesFixture, testEnv } from "./testing/fakes.ts";

const chosenStaging: PilotEnv = {
  ...testEnv,
  ENVIRONMENT: "staging",
  TELEGRAM_BOT_USERNAME: "VelaStagingBot",
  ADMIN_CONVERSATION_ID: "123456789",
  PUBLIC_BASE_URL: "https://vela-admin.vela.example",
  PRIVACY_NOTICE_URL_EN: "https://vela.vela.example/privacy",
  PRIVACY_NOTICE_URL_ZH_TW: "https://vela.vela.example/privacy/zh-TW",
};

// No database runs under the tests: a refusal that came after the connection was opened would
// reject with a connection error instead of the ConfigError these expect.
describe("building deps", () => {
  it("refuses a placeholder before it opens a database connection", async () => {
    const unchosen: PilotEnv = { ...chosenStaging, PUBLIC_BASE_URL: "https://PLACEHOLDER_HOST" };

    const refusal = buildDeps(unchosen, noticesFixture());

    await expect(refusal).rejects.toBeInstanceOf(ConfigError);
    await expect(refusal).rejects.toHaveProperty("code", "PUBLIC_BASE_URL");
  });

  // Every webhook update, queue job, cron run, and alarm builds its deps here, so an unfilled
  // notice stops all of them, not only the notice page.
  it("refuses an unfilled notice before it opens a database connection", async () => {
    const notices = noticesFixture();
    const unfilled: PrivacyNotices = {
      ...notices,
      en: { ...notices.en, html: "<p>Contact: [CONTACT ADDRESS]</p>" },
    };

    const refusal = buildDeps(chosenStaging, unfilled);

    await expect(refusal).rejects.toHaveProperty("code", "privacy-notice.en.md");
  });

  it("refuses the admin Worker's placeholder before it opens a database connection", async () => {
    const unchosen: AdminEnv = {
      ...adminTestEnv,
      ENVIRONMENT: "staging",
      PUBLIC_BASE_URL: "https://PLACEHOLDER_ADMIN_HOST",
    };

    await expect(buildAdminDeps(unchosen)).rejects.toHaveProperty("code", "PUBLIC_BASE_URL");
  });

  it("refuses the admin Worker without the AI key a sent weekly read is translated with", async () => {
    const withoutKey: AdminEnv = { ...adminTestEnv, ANTHROPIC_API_KEY: undefined };

    await expect(buildAdminDeps(withoutKey)).rejects.toHaveProperty("code", "ANTHROPIC_API_KEY");
  });

  it("refuses the admin Worker without the bot a new invite's link opens", async () => {
    const withoutBot: AdminEnv = { ...adminTestEnv, TELEGRAM_BOT_USERNAME: " " };

    await expect(buildAdminDeps(withoutBot)).rejects.toHaveProperty(
      "code",
      "TELEGRAM_BOT_USERNAME",
    );
  });
});
