/**
 * Webhook authentication. Telegram signs nothing; it echoes the `secret_token` given to
 * `setWebhook` in a header on every delivery, so the header is compared with the configured secret.
 */

export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

/** The Bot API accepts 1–256 characters from A–Z, a–z, 0–9, `_`, and `-`. */
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

const encoder = new TextEncoder();

export function isValidWebhookSecret(secret: string): boolean {
  return WEBHOOK_SECRET_PATTERN.test(secret);
}

/** True only when the secret header is present and equal to `expectedSecret`. Never throws. */
export function verifyTelegramSecret(headers: Headers, expectedSecret: string): boolean {
  const received = headers.get(TELEGRAM_SECRET_HEADER);
  return received !== null && constantTimeEqual(received, expectedSecret);
}

/**
 * Compares two strings in time that depends only on the length of `expected`. There is no early
 * return on a length mismatch or on the first differing byte: every byte of `expected` is visited,
 * and a length difference is folded into the same accumulator as the byte differences.
 */
export function constantTimeEqual(received: string, expected: string): boolean {
  const receivedBytes = encoder.encode(received);
  const expectedBytes = encoder.encode(expected);
  let difference = receivedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  // An empty configured secret would accept an empty header; treat it as matching nothing.
  return difference === 0 && expectedBytes.length > 0;
}
