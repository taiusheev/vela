import { type FlagInput, isAiOff } from "@vela/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "./config.ts";
import { buildAdminDeps, buildDeps, createAiPort } from "./deps.ts";
import type { AdminEnv, PilotEnv } from "./env.ts";
import type { PrivacyNotices } from "./notices.ts";
import {
  adminTestEnv,
  type LogLine,
  noticesFixture,
  recordingLogger,
  testEnv,
} from "./testing/fakes.ts";

const chosenStaging: PilotEnv = {
  ...testEnv,
  ENVIRONMENT: "staging",
  TELEGRAM_BOT_USERNAME: "VelaStagingBot",
  ADMIN_CONVERSATION_ID: "123456789",
  PUBLIC_BASE_URL: "https://vela-admin.vela.example",
  PRIVACY_NOTICE_URL_EN: "https://vela.vela.example/privacy",
  PRIVACY_NOTICE_URL_ZH_TW: "https://vela.vela.example/privacy/zh-TW",
};

const chosenAdminProduction: AdminEnv = {
  ...adminTestEnv,
  ENVIRONMENT: "production",
  PUBLIC_BASE_URL: "https://vela-admin.vela.example",
  TELEGRAM_BOT_USERNAME: "VelaLightBot",
};

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("refuses the admin Worker without the bot a new invite's link opens", async () => {
    const withoutBot: AdminEnv = { ...adminTestEnv, TELEGRAM_BOT_USERNAME: " " };

    await expect(buildAdminDeps(withoutBot)).rejects.toHaveProperty(
      "code",
      "TELEGRAM_BOT_USERNAME",
    );
  });

  // Decision X: real families' answers need the flag check, so neither production Worker starts
  // with AI off.
  it("refuses production with AI off in either Worker before it opens a database connection", async () => {
    const pilot: PilotEnv = { ...chosenStaging, ENVIRONMENT: "production", AI_PROVIDER: "off" };
    const admin: AdminEnv = { ...chosenAdminProduction, AI_PROVIDER: "off" };

    await expect(buildDeps(pilot, noticesFixture())).rejects.toHaveProperty("code", "AI_PROVIDER");
    await expect(buildAdminDeps(admin)).rejects.toHaveProperty("code", "AI_PROVIDER");
  });

  it("refuses either Worker without the Anthropic key while AI is anthropic", async () => {
    const pilot: PilotEnv = {
      ...chosenStaging,
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: undefined,
    };
    const admin: AdminEnv = {
      ...adminTestEnv,
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: undefined,
    };

    await expect(buildDeps(pilot, noticesFixture())).rejects.toHaveProperty(
      "code",
      "ANTHROPIC_API_KEY",
    );
    await expect(buildAdminDeps(admin)).rejects.toHaveProperty("code", "ANTHROPIC_API_KEY");
  });

  // Deps are built for every invocation, so the record that the line was written lives at module
  // scope: one made per build would write `ai_off` on every request instead of once per start.
  it("says AI is off at most once however many invocations build deps", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    // Without the speech-to-text key each build is refused after its AI port, before a connection.
    const aiOffWithoutStt: PilotEnv = {
      ...testEnv,
      AI_PROVIDER: "off",
      DEEPGRAM_API_KEY: undefined,
    };

    await expect(buildDeps(aiOffWithoutStt, noticesFixture())).rejects.toHaveProperty(
      "code",
      "DEEPGRAM_API_KEY",
    );
    await expect(buildDeps(aiOffWithoutStt, noticesFixture())).rejects.toHaveProperty(
      "code",
      "DEEPGRAM_API_KEY",
    );

    const aiOffLines = consoleLog.mock.calls.filter(([line]) =>
      String(line).includes('"event":"ai_off"'),
    );
    // At most, not exactly: another test's build in this isolate may already have written it.
    expect(aiOffLines.length).toBeLessThanOrEqual(1);
  });
});

describe("the AI port", () => {
  const flagInput: FlagInput = {
    lang: "en",
    addressForm: "Mom",
    ask: null,
    answer: { kind: "text", text: "I fell in the kitchen" },
    recentSummaries: [],
  };

  it("needs no Anthropic key while AI is off, and sends nothing to a provider", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ai = createAiPort(
      { AI_PROVIDER: "off" },
      "staging",
      "wrangler.jsonc",
      recordingLogger([]),
      { said: false },
    );

    const outcome = await ai.flag(flagInput);

    expect(isAiOff(outcome)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says once per Worker start that AI is off, and nothing while it is on", () => {
    const logs: LogLine[] = [];
    const logger = recordingLogger(logs);
    const notice = { said: false };

    createAiPort({ AI_PROVIDER: "off" }, "development", "wrangler.jsonc", logger, notice);
    createAiPort({ AI_PROVIDER: "off" }, "development", "wrangler.jsonc", logger, notice);
    createAiPort(
      { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-anthropic-key" },
      "staging",
      "wrangler.jsonc",
      logger,
      { said: false },
    );

    expect(logs.map((line) => [line.level, line.event])).toEqual([["warn", "ai_off"]]);
    expect(String(logs[0]?.fields?.detail)).toMatch(
      /^AI_PROVIDER is off: no AI provider is called/,
    );
  });
});
