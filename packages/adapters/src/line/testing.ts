/**
 * Test helpers: fixture loading and webhook signing, so no test needs a LINE account. Signatures
 * are made with Node's own HMAC, apart from the Web Crypto code under test.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WebhookInput } from "@vela/contracts";
import { LINE_SIGNATURE_HEADER } from "./verify.ts";

/** Shaped like a channel secret (32 hex digits), and distinctive so a leak is easy to find. */
export const TEST_CHANNEL_SECRET = "2e4e6837a5d6004eab062f322de9c3e5";

export function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

/** What LINE puts in `x-line-signature` for `rawBody`: Base64(HMAC-SHA256(secret, body)). */
export function signWebhook(rawBody: string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
}

/** A webhook as the route hands it to the adapter, signed as LINE signs it. */
export function signedWebhook(
  rawBody: string,
  channelSecret: string = TEST_CHANNEL_SECRET,
): WebhookInput {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    [LINE_SIGNATURE_HEADER]: signWebhook(rawBody, channelSecret),
  });
  return { headers, rawBody };
}
