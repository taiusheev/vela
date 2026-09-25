import { errorLabel } from "@vela/services";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  checkAdminConfig,
  readAiProvider,
  readApiConfig,
  readConfig,
  secret,
} from "./config.ts";
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

// Decision X (2026-09-18): AI can be off while the founder buys no Anthropic credit, but never
// where real families answer, since with it off nothing they say is checked for a flag.
describe("the AI provider", () => {
  it.each([
    ["development", "off"],
    ["development", "anthropic"],
    ["staging", "off"],
    ["staging", "anthropic"],
    ["production", "anthropic"],
  ] as const)("runs %s with %s", (environment, provider) => {
    expect(readAiProvider({ AI_PROVIDER: ` ${provider} ` }, environment, "wrangler.jsonc")).toBe(
      provider,
    );
  });

  it("refuses to start production with AI off, naming the variable and the file to fix", () => {
    const error = configErrorOf(() =>
      readAiProvider({ AI_PROVIDER: "off" }, "production", "wrangler.admin.jsonc"),
    );

    expect(error.code).toBe("AI_PROVIDER");
    expect(error.message).toContain("wrangler.admin.jsonc");
    expect(errorLabel(error)).toBe("ConfigError:AI_PROVIDER");
  });

  it.each([["gemini"], [""], [undefined]])(
    "refuses %j in every environment, naming the variable and not its value",
    (value) => {
      for (const environment of ["development", "staging", "production"] as const) {
        const error = configErrorOf(() =>
          readAiProvider({ AI_PROVIDER: value }, environment, "wrangler.jsonc"),
        );

        expect(error.code).toBe("AI_PROVIDER");
        expect(error.message).not.toContain("gemini");
      }
    },
  );
});

/** A limiter that admits everything: the configuration only asks whether one is bound. */
const boundLimiter: RateLimit = { limit: async () => ({ success: true }) };
/** The write limiter's objects, as bound: the configuration only asks whether they are. */
const boundWriteLimiters = {} as NonNullable<PilotEnv["ACCOUNT_WRITE_LIMITER"]>;

const DEV_ISSUER = "https://ideal-vulture-9262.clerk.accounts.dev";
// Shaped like Clerk's keys, and distinctive enough that a message holding one would show. Joined at
// run time: Clerk shares Stripe's sk_ prefixes, and secret scanning would take a literal for a real key.
const TEST_KEY = ["sk", "test", "StagingKeyNeverLogged42"].join("_");
const LIVE_KEY = ["sk", "live", "ProductionKeyNeverLogged42"].join("_");

/** Staging with the API on: the chosen values, Clerk's development instance, and both limits. */
const apiStaging: PilotEnv = {
  ...chosenStaging,
  API_V1: "on",
  CLERK_ISSUER: DEV_ISSUER,
  CLERK_SECRET_KEY: TEST_KEY,
  API_IP_LIMIT: boundLimiter,
  ACCOUNT_WRITE_LIMITER: boundWriteLimiters,
};

/** Production as it would be the day a new ADR turns its API on, on a host Vela owns. */
const apiProduction: PilotEnv = {
  ...apiStaging,
  ENVIRONMENT: "production",
  CLERK_ISSUER: "https://clerk.vela.example",
  CLERK_SECRET_KEY: LIVE_KEY,
};

/** Expects a refusal naming `code` in its label, with no configured Clerk value in its message. */
function expectRefused(env: PilotEnv, code: string): void {
  const error = configErrorOf(() => readApiConfig(env));

  expect(error.code).toBe(code);
  expect(errorLabel(error)).toBe(`ConfigError:${code}`);
  for (const value of [env.CLERK_SECRET_KEY?.trim(), env.CLERK_ISSUER?.trim()]) {
    if (value !== undefined && value !== "") {
      expect(error.message).not.toContain(value);
    }
  }
}

// ADR-29: the API under /v1 checks its own settings, and a Clerk key or instance of the wrong kind
// for the environment is refused before anything is built with it.
describe("the API's configuration", () => {
  it("starts staging with Clerk's development instance, a development key, and both limiters", () => {
    expect(readApiConfig(apiStaging)).toEqual({
      environment: "staging",
      issuer: DEV_ISSUER,
      secretKey: TEST_KEY,
      telegramBotUsername: "VelaStagingBot",
      regions: ["apac"],
    });
  });

  it("runs development as wrangler.jsonc ships it: the API on, reads only without a key", () => {
    const config = readApiConfig(testEnv);

    expect(testEnv.API_V1).toBe("on");
    expect(config?.environment).toBe("development");
    expect(config?.issuer).toBe(DEV_ISSUER);
    expect(config?.secretKey).toBeNull();
  });

  // Production needs no Clerk var or secret while its API is off, so its launch never waits on it.
  it.each(["development", "staging", "production"] as const)(
    "reads nothing else in %s while API_V1 is off",
    (environment) => {
      const off: PilotEnv = {
        ...apiStaging,
        ENVIRONMENT: environment,
        API_V1: "off",
        TELEGRAM_BOT_USERNAME: "PLACEHOLDER_BOT_USERNAME",
        CLERK_ISSUER: undefined,
        CLERK_SECRET_KEY: undefined,
        API_IP_LIMIT: undefined,
        ACCOUNT_WRITE_LIMITER: undefined,
      };

      expect(readApiConfig(off)).toBeNull();
    },
  );

  it.each([["maybe"], ["ON"], [""]])(
    "refuses API_V1 %j in every environment, naming the variable",
    (value) => {
      for (const environment of ["development", "staging", "production"] as const) {
        expectRefused({ ...apiProduction, ENVIRONMENT: environment, API_V1: value }, "API_V1");
      }
    },
  );

  it.each([
    ["an http issuer", { CLERK_ISSUER: "http://ideal-vulture-9262.clerk.accounts.dev" }],
    ["a placeholder issuer", { CLERK_ISSUER: "https://PLACEHOLDER_STAGING_CLERK_HOST" }],
    [
      "an issuer that is not a development instance",
      { CLERK_ISSUER: "https://clerk.vela.example" },
    ],
    ["a look-alike host", { CLERK_ISSUER: `${DEV_ISSUER}.vela.example` }],
    ["an issuer with a path", { CLERK_ISSUER: `${DEV_ISSUER}/v1` }],
    ["an issuer with two trailing slashes", { CLERK_ISSUER: `${DEV_ISSUER}//` }],
    ["no issuer", { CLERK_ISSUER: undefined }],
  ] as const)("refuses staging with %s, naming CLERK_ISSUER", (_, overrides) => {
    expectRefused({ ...apiStaging, ...overrides }, "CLERK_ISSUER");
  });

  // A live key on staging would reach real people's accounts from an environment the co-founder
  // deploys from a laptop.
  it.each([
    ["no key", { CLERK_SECRET_KEY: undefined }],
    ["a blank key", { CLERK_SECRET_KEY: "   " }],
    ["a production key", { CLERK_SECRET_KEY: LIVE_KEY }],
    ["a publishable key", { CLERK_SECRET_KEY: "pk_test_PublishableNotSecret42" }],
    ["a key with a space in it", { CLERK_SECRET_KEY: "sk_test_Staging KeyNeverLogged42" }],
    [
      "a key longer than the session check takes",
      { CLERK_SECRET_KEY: `sk_test_${"k".repeat(4096)}` },
    ],
  ] as const)(
    "refuses staging with %s, naming CLERK_SECRET_KEY and never the key",
    (_, overrides) => {
      expectRefused({ ...apiStaging, ...overrides }, "CLERK_SECRET_KEY");
    },
  );

  it.each(["API_IP_LIMIT", "ACCOUNT_WRITE_LIMITER"] as const)(
    "refuses staging without the %s binding",
    (name) => {
      expectRefused({ ...apiStaging, [name]: undefined }, name);
    },
  );

  it("takes the issuer with one trailing slash as its origin", () => {
    expect(readApiConfig({ ...apiStaging, CLERK_ISSUER: `${DEV_ISSUER}/` })?.issuer).toBe(
      DEV_ISSUER,
    );
  });

  // The one refusal /v1 shares with the pilot's routes: a placeholder in any value means nobody has
  // finished setting this environment up.
  it("refuses staging while a value only the pilot's routes read still holds a placeholder", () => {
    expectRefused(
      { ...apiStaging, PUBLIC_BASE_URL: "https://PLACEHOLDER_STAGING_HOST" },
      "PUBLIC_BASE_URL",
    );
  });

  it("starts staging without what only the pilot's routes need: the founder's chat and Telegram's secrets", () => {
    const pilotless: PilotEnv = {
      ...apiStaging,
      ADMIN_CONVERSATION_ID: undefined,
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_WEBHOOK_SECRET: undefined,
      DEEPGRAM_API_KEY: undefined,
    };

    expect(readApiConfig(pilotless)?.environment).toBe("staging");
  });

  it("starts production, once it is turned on, with its own instance and a production key", () => {
    expect(readApiConfig(apiProduction)).toMatchObject({
      environment: "production",
      issuer: "https://clerk.vela.example",
      secretKey: LIVE_KEY,
    });
  });

  it.each([
    ["a development instance", { CLERK_ISSUER: DEV_ISSUER }, "CLERK_ISSUER"],
    ["a development key", { CLERK_SECRET_KEY: TEST_KEY }, "CLERK_SECRET_KEY"],
    ["no key", { CLERK_SECRET_KEY: undefined }, "CLERK_SECRET_KEY"],
    ["no address limiter", { API_IP_LIMIT: undefined }, "API_IP_LIMIT"],
    ["no write limiter", { ACCOUNT_WRITE_LIMITER: undefined }, "ACCOUNT_WRITE_LIMITER"],
  ] as const)("refuses production with %s", (_, overrides, code) => {
    expectRefused({ ...apiProduction, ...overrides }, code);
  });

  it("serves reads only in development without a key, and needs no limiter there", () => {
    const laptop: PilotEnv = {
      ...testEnv,
      CLERK_SECRET_KEY: "  ",
      API_IP_LIMIT: undefined,
      ACCOUNT_WRITE_LIMITER: undefined,
    };

    expect(readApiConfig(laptop)?.secretKey).toBeNull();
  });

  it("holds development to a development instance and key as well", () => {
    expectRefused({ ...testEnv, CLERK_SECRET_KEY: LIVE_KEY }, "CLERK_SECRET_KEY");
    expectRefused({ ...testEnv, CLERK_ISSUER: "https://clerk.vela.example" }, "CLERK_ISSUER");
    expect(readApiConfig({ ...testEnv, CLERK_SECRET_KEY: TEST_KEY })?.secretKey).toBe(TEST_KEY);
  });
});

describe("a secret", () => {
  it("is refused by name when it is missing or blank", () => {
    const missing = configErrorOf(() => secret({}, "ANTHROPIC_API_KEY"));
    const blank = configErrorOf(() => secret({ ACCESS_AUD: "  " }, "ACCESS_AUD"));

    expect([missing.code, blank.code]).toEqual(["ANTHROPIC_API_KEY", "ACCESS_AUD"]);
  });
});
