import { describe, expect, it } from "vitest";
import {
  configChecks,
  formatReport,
  lifecycleCheck,
  placeholderChecks,
  type WorkerBlock,
} from "./preflight-checks.ts";

const STAGING_VARS = {
  ENVIRONMENT: "staging",
  PUBLIC_BASE_URL: "https://vela-admin.vela-light-staging.workers.dev",
  TELEGRAM_BOT_USERNAME: "VelaLightstagingbot",
  PRIVACY_NOTICE_URL_EN: "https://vela.vela-light-staging.workers.dev/privacy",
  PRIVACY_NOTICE_URL_ZH_TW: "https://vela.vela-light-staging.workers.dev/privacy/zh-TW",
  REGIONS: "apac",
  AI_PROVIDER: "openai",
  MEDIA_STORAGE: "r2",
  API_V1: "off",
  PUSH_SEND: "off",
  LINE_CHANNEL: "off",
  MEMORY: "off",
  BOOK: "off",
};

function block(name: string, vars: Record<string, string>, extra: Partial<WorkerBlock> = {}) {
  return {
    name,
    vars,
    r2Buckets: [],
    hyperdriveIds: ["e9e9837d1eee47528304916a1ac2d1e9"],
    queues: [],
    crons: ["*/15 * * * *"],
    bindings: ["HYPERDRIVE", "OUTBOUND_QUEUE", "MEDIA_QUEUE", "UNDERSTAND_QUEUE"],
    ...extra,
  } satisfies WorkerBlock;
}

const pilot = block("vela", STAGING_VARS, {
  r2Buckets: [{ binding: "MEDIA_BUCKET", bucket_name: "vela-media-staging" }],
  bindings: ["HYPERDRIVE", "OUTBOUND_QUEUE", "MEDIA_QUEUE", "UNDERSTAND_QUEUE", "MEDIA_BUCKET"],
});
const admin = block("vela-admin", STAGING_VARS);
const ALL = new Set([
  "CONTENT_KEY_V1",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "ADMIN_CONVERSATION_ID",
  "OPENAI_API_KEY",
]);

describe("preflight checks", () => {
  it("names every setup placeholder left in either Worker", () => {
    const [left, right] = placeholderChecks(
      block("vela", { ...STAGING_VARS, TELEGRAM_BOT_USERNAME: "PLACEHOLDER_BOT" }),
      block("vela-admin", STAGING_VARS, { hyperdriveIds: ["PLACEHOLDER_HD"] }),
    );
    expect(left).toMatchObject({ ok: false, detail: "still a placeholder: TELEGRAM_BOT_USERNAME" });
    expect(right).toMatchObject({ ok: false, detail: "still a placeholder: hyperdrive.id" });
  });

  it("passes a configuration the Workers would run with", () => {
    const results = configChecks("staging", pilot, admin, ALL, ALL);
    expect(results.filter((result) => !result.ok)).toEqual([]);
  });

  it("names a missing secret as the Worker's own reader would", () => {
    const withoutKey = new Set([...ALL].filter((name) => name !== "CONTENT_KEY_V1"));
    const results = configChecks("staging", pilot, admin, withoutKey, ALL);
    expect(results.find((result) => result.name === "vela: configuration")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/^CONTENT_KEY_V1:/),
    });
  });

  it("refuses an AI provider whose key is missing on either Worker", () => {
    const withoutAi = new Set([...ALL].filter((name) => name !== "OPENAI_API_KEY"));
    const results = configChecks("staging", pilot, admin, ALL, withoutAi);
    expect(results.find((result) => result.name === "vela-admin: AI provider key")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/^OPENAI_API_KEY:/),
    });
  });

  it("refuses r2 media storage with no bucket bound", () => {
    const unbound = block("vela", STAGING_VARS);
    const results = configChecks("staging", unbound, admin, ALL, ALL);
    expect(results.find((result) => result.name === "vela: media storage")?.ok).toBe(false);
  });

  it("requires asks/, replies/ and device/ to expire within 32 days", () => {
    const rule = (prefix: string, days: number) => ({ prefix, enabled: true, maxAgeDays: days });
    expect(
      lifecycleCheck("b", [rule("asks/", 32), rule("replies/", 32), rule("device/", 32)]).ok,
    ).toBe(true);
    expect(lifecycleCheck("b", [rule("asks/", 32), rule("replies/", 90)])).toMatchObject({
      ok: false,
      detail: "no enabled rule deleting within 32 days for: replies/, device/",
    });
    expect(lifecycleCheck("b", null).detail).toBe("the bucket does not exist");
  });

  it("reports PASS only when every check passes", () => {
    expect(formatReport("staging", [{ name: "a", ok: true, detail: "passes" }])).toContain(
      "PASS: all 1 checks passed.",
    );
    expect(formatReport("staging", [{ name: "a", ok: false, detail: "x" }])).toContain(
      "FAIL: 1 of 1 checks need fixing",
    );
  });
});
