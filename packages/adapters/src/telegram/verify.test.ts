import { describe, expect, it } from "vitest";
import { createTelegramAdapter } from "./adapter.ts";
import { readFixture, TEST_BOT_TOKEN, TEST_BOT_USERNAME, TEST_WEBHOOK_SECRET } from "./testing.ts";
import { isValidWebhookSecret, verifyTelegramSecret } from "./verify.ts";

const adapter = createTelegramAdapter({
  botToken: TEST_BOT_TOKEN,
  webhookSecret: TEST_WEBHOOK_SECRET,
  botUsername: TEST_BOT_USERNAME,
  fetch: () => Promise.reject(new Error("verification must not call the Bot API")),
});

function webhook(secret: string | undefined): { headers: Headers; rawBody: string } {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== undefined) headers.set("X-Telegram-Bot-Api-Secret-Token", secret);
  return { headers, rawBody: readFixture("private-text.json") };
}

describe("adapter.verify", () => {
  it("accepts the configured secret", async () => {
    await expect(adapter.verify(webhook(TEST_WEBHOOK_SECRET))).resolves.toBe(true);
  });

  it("finds the header whatever its case", async () => {
    const headers = new Headers({ "x-telegram-bot-api-secret-token": TEST_WEBHOOK_SECRET });
    await expect(adapter.verify({ headers, rawBody: "{}" })).resolves.toBe(true);
  });

  it("rejects a wrong secret of the same length", async () => {
    const wrong = `${TEST_WEBHOOK_SECRET.slice(0, -1)}X`;
    expect(wrong).toHaveLength(TEST_WEBHOOK_SECRET.length);
    await expect(adapter.verify(webhook(wrong))).resolves.toBe(false);
  });

  it("rejects a missing header", async () => {
    await expect(adapter.verify(webhook(undefined))).resolves.toBe(false);
  });

  it("rejects an empty header", async () => {
    await expect(adapter.verify(webhook(""))).resolves.toBe(false);
  });

  it("rejects a shorter prefix of the secret", async () => {
    await expect(adapter.verify(webhook(TEST_WEBHOOK_SECRET.slice(0, 8)))).resolves.toBe(false);
  });

  it("rejects the secret with extra characters appended", async () => {
    await expect(adapter.verify(webhook(`${TEST_WEBHOOK_SECRET}0`))).resolves.toBe(false);
  });
});

describe("verifyTelegramSecret", () => {
  it("rejects every request when the configured secret is empty", () => {
    expect(verifyTelegramSecret(new Headers({ "X-Telegram-Bot-Api-Secret-Token": "" }), "")).toBe(
      false,
    );
  });
});

describe("isValidWebhookSecret", () => {
  it("accepts what setWebhook accepts and nothing else", () => {
    expect(isValidWebhookSecret("A-z_09")).toBe(true);
    expect(isValidWebhookSecret("x".repeat(256))).toBe(true);
    expect(isValidWebhookSecret("")).toBe(false);
    expect(isValidWebhookSecret("x".repeat(257))).toBe(false);
    expect(isValidWebhookSecret("has space")).toBe(false);
    expect(isValidWebhookSecret("sl/ash")).toBe(false);
  });
});
