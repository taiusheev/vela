import { errorLabel } from "@vela/services";
import { describe, expect, it } from "vitest";
import { ConfigError, checkAdminConfig, readConfig, secret } from "./config.ts";
import type { AdminEnv, PilotEnv } from "./env.ts";
import { PRIVACY_NOTICES } from "./notices.generated.ts";
import type { PrivacyNotices } from "./notices.ts";
import { adminTestEnv, noticesFixture, testEnv } from "./testing/fakes.ts";

/**
 * Staging once the founder has chosen its bot, chat, and hosts. The hosts are under the reserved
 * `.example` domain: a real-looking one in a test is the kind that ends up in a config file.
 */
const chosenStaging: PilotEnv = {
  ...testEnv,
  ENVIRONMENT: "staging",
  TELEGRAM_BOT_USERNAME: "VelaStagingBot",
  ADMIN_CONVERSATION_ID: "123456789",
  PUBLIC_BASE_URL: "https://vela-admin.vela.example",
  PRIVACY_NOTICE_URL_EN: "https://vela.vela.example/privacy",
  PRIVACY_NOTICE_URL_ZH_TW: "https://vela.vela.example/privacy/zh-TW",
};

const filled = noticesFixture();

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

type StringVar = "TELEGRAM_BOT_USERNAME" | "ADMIN_CONVERSATION_ID" | "REGIONS" | "DEEPGRAM_API_KEY";
type UrlVar = "PUBLIC_BASE_URL" | "PRIVACY_NOTICE_URL_EN" | "PRIVACY_NOTICE_URL_ZH_TW";

describe("the configuration a deployed pilot Worker starts with", () => {
  it("starts staging once every value is chosen, every link is https, and both notices are filled", () => {
    const config = readConfig(chosenStaging, filled);

    expect(config.environment).toBe("staging");
    expect(config.telegramBotUsername).toBe("VelaStagingBot");
    expect(config.adminConversationId).toBe("123456789");
    expect(config.publicBaseUrl).toBe("https://vela-admin.vela.example");
    expect(config.privacyNoticeUrls.en).toBe("https://vela.vela.example/privacy");
    expect(config.privacyNoticeUrls["zh-TW"]).toBe("https://vela.vela.example/privacy/zh-TW");
  });

  // An adult's tap on "I've read it" records the version of the notice this Worker serves.
  it("takes the privacy notice version from the notices it serves", () => {
    const v2: PrivacyNotices = {
      en: { ...filled.en, version: "privacy-notice.v2" },
      "zh-TW": { ...filled["zh-TW"], version: "privacy-notice.v2" },
    };

    expect(readConfig(chosenStaging, v2).privacyNoticeVersion).toBe("privacy-notice.v2");
    expect(readConfig(testEnv, PRIVACY_NOTICES).privacyNoticeVersion).toBe(
      PRIVACY_NOTICES.en.version,
    );
  });

  // The shapes a wrangler config writes: a whole value, or a URL whose host nobody has chosen.
  const placeholders: readonly (readonly [StringVar | UrlVar, string])[] = [
    ["TELEGRAM_BOT_USERNAME", "PLACEHOLDER_STAGING_BOT_USERNAME"],
    ["PUBLIC_BASE_URL", "https://PLACEHOLDER_STAGING_HOST"],
    ["PRIVACY_NOTICE_URL_EN", "PLACEHOLDER_STAGING_PRIVACY_NOTICE_URL_EN"],
    ["PRIVACY_NOTICE_URL_ZH_TW", "https://PLACEHOLDER_STAGING_HOST/privacy/zh-TW"],
    ["REGIONS", "PLACEHOLDER_REGIONS"],
    // A secret is checked the same way: nothing lists what is checked, so nothing can be missed.
    ["ADMIN_CONVERSATION_ID", "PLACEHOLDER_STAGING_ADMIN_CHAT_ID"],
    ["DEEPGRAM_API_KEY", "PLACEHOLDER_DEEPGRAM_API_KEY"],
  ];

  it.each(placeholders)(
    "refuses to start while %s still holds a placeholder, naming it and not its value",
    (name, value) => {
      const error = configErrorOf(() => readConfig({ ...chosenStaging, [name]: value }, filled));

      expect(error.code).toBe(name);
      expect(error.message).toContain(name);
      expect(error.message).not.toContain(value);
    },
  );

  const insecure: readonly (readonly [UrlVar, string])[] = [
    ["PUBLIC_BASE_URL", "http://vela-admin.vela.example"],
    ["PRIVACY_NOTICE_URL_EN", "http://vela.vela.example/privacy"],
    ["PRIVACY_NOTICE_URL_ZH_TW", "vela.vela.example/privacy/zh-TW"],
  ];

  it.each(insecure)(
    "refuses to start production while %s is %s, not an https URL",
    (name, value) => {
      const production: PilotEnv = { ...chosenStaging, ENVIRONMENT: "production", [name]: value };

      expect(configErrorOf(() => readConfig(production, filled)).code).toBe(name);
    },
  );

  // H5: the founder's chat id is a secret of the pilot Worker. Without it a deployed Worker would
  // never tell the founder of a flag or a weekly read to check.
  it("refuses to start without the founder's chat id, which is a secret", () => {
    const withoutChat: PilotEnv = { ...chosenStaging, ADMIN_CONVERSATION_ID: undefined };

    expect(configErrorOf(() => readConfig(withoutChat, filled)).code).toBe("ADMIN_CONVERSATION_ID");
  });

  // H4: no family may ever read an unfilled notice, and every notice link comes from this Worker.
  it.each([
    ["en", "privacy-notice.en.md", "<p>Run by <strong>[FOUNDER FULL NAME]</strong>.</p>"],
    ["zh-TW", "privacy-notice.zh-TW.md", "<p>聯絡方式：[聯絡信箱——首次使用前填入]</p>"],
  ] as const)(
    "refuses to start while the %s notice holds a bracketed placeholder, naming its file",
    (lang, file, html) => {
      const unfilled: PrivacyNotices = { ...filled, [lang]: { ...filled[lang], html } };

      const error = configErrorOf(() => readConfig(chosenStaging, unfilled));

      expect(error.code).toBe(file);
      expect(errorLabel(error)).toBe(`ConfigError:${file}`);
    },
  );

  // Both notices quote the message an organiser receives when she pauses, with her name as a
  // bracketed word; that is the notice's text, not a blank.
  it("starts with the pause message's [Name] and [名字], which are the notice's own words", () => {
    const quoting: PrivacyNotices = {
      en: { ...filled.en, html: "<li>&quot;[Name] asked to pause.&quot;</li>" },
      "zh-TW": { ...filled["zh-TW"], html: "<li>「[名字]想先暫停。」</li>" },
    };

    expect(readConfig(chosenStaging, quoting).environment).toBe("staging");
  });

  // Failures are logged by label, never by message, so the variable has to survive in the label.
  it("names the variable in the label a failure is logged by", () => {
    const error = configErrorOf(() =>
      readConfig(
        { ...chosenStaging, PRIVACY_NOTICE_URL_EN: "PLACEHOLDER_STAGING_PRIVACY_NOTICE_URL_EN" },
        filled,
      ),
    );

    expect(errorLabel(error)).toBe("ConfigError:PRIVACY_NOTICE_URL_EN");
  });

  it("runs development on localhost with the placeholders and the unfilled notices it ships", () => {
    const config = readConfig(testEnv, PRIVACY_NOTICES);

    expect(testEnv.TELEGRAM_BOT_USERNAME).toContain("PLACEHOLDER_");
    expect(config.environment).toBe("development");
    expect(config.adminConversationId).toBeNull();
    expect(config.publicBaseUrl).toBe("http://localhost:8787");
    expect(config.privacyNoticeUrls.en).toBe("http://localhost:8787/privacy");
    expect(config.privacyNoticeUrls["zh-TW"]).toBe("http://localhost:8787/privacy/zh-TW");
  });
});

describe("the configuration a deployed admin Worker starts with", () => {
  const chosenAdmin: AdminEnv = {
    ...adminTestEnv,
    ENVIRONMENT: "production",
    PUBLIC_BASE_URL: "https://vela-admin.vela.example",
    TELEGRAM_BOT_USERNAME: "VelaLightBot",
  };

  it("starts once its origin is https and nothing holds a placeholder", () => {
    expect(() => checkAdminConfig(chosenAdmin)).not.toThrow();
  });

  // create_invite's link opens this bot; a link to a placeholder or to no bot reaches nobody.
  it.each([
    ["TELEGRAM_BOT_USERNAME", "PLACEHOLDER_PRODUCTION_BOT_USERNAME"],
    ["TELEGRAM_BOT_USERNAME", ""],
    ["PUBLIC_BASE_URL", "https://PLACEHOLDER_PRODUCTION_ADMIN_HOST"],
    ["PUBLIC_BASE_URL", "http://vela-admin.vela.example"],
    ["ACCESS_AUD", "PLACEHOLDER_ACCESS_AUD"],
  ] as const)("refuses to start while %s is %s", (name, value) => {
    expect(configErrorOf(() => checkAdminConfig({ ...chosenAdmin, [name]: value })).code).toBe(
      name,
    );
  });
});

describe("a secret", () => {
  it("is refused by name when it is missing or blank", () => {
    const missing = configErrorOf(() => secret({}, "ANTHROPIC_API_KEY"));
    const blank = configErrorOf(() => secret({ ACCESS_AUD: "  " }, "ACCESS_AUD"));

    expect([missing.code, blank.code]).toEqual(["ANTHROPIC_API_KEY", "ACCESS_AUD"]);
  });
});
