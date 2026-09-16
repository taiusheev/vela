import { describe, expect, it } from "vitest";
import { ConfigError } from "./config.ts";
import { buildAdminDeps, buildDeps, createHeartbeat } from "./deps.ts";
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
