/**
 * Webhook authentication. Telegram signs nothing; it echoes the `secret_token` given to
 * `setWebhook` in a header on every delivery, so the header is compared with the configured secret.
 */
import { constantTimeEqual } from "../constant-time.ts";

export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

/** The Bot API accepts 1–256 characters from A–Z, a–z, 0–9, `_`, and `-`. */
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isValidWebhookSecret(secret: string): boolean {
  return WEBHOOK_SECRET_PATTERN.test(secret);
}

/** True only when the secret header is present and equal to `expectedSecret`. Never throws. */
export function verifyTelegramSecret(headers: Headers, expectedSecret: string): boolean {
  const received = headers.get(TELEGRAM_SECRET_HEADER);
  return received !== null && constantTimeEqual(received, expectedSecret);
}
