/**
 * Webhook authentication. LINE signs every delivery: `x-line-signature` is the Base64 of the
 * HMAC-SHA256 of the request body exactly as received, keyed with the channel secret (05 §1
 * fact 5). LINE publishes no source addresses, so the signature is the only check there is.
 */
import { constantTimeEqual } from "../constant-time.ts";

/** Read through `Headers`, which ignores letter case: LINE says the name's case may change. */
export const LINE_SIGNATURE_HEADER = "x-line-signature";

/**
 * The only canonical Base64 form of 32 bytes: 43 characters and one `=`. `atob` would also accept
 * whitespace and missing padding, so the header's form is checked instead of decoded, and the
 * computed signature is compared as text.
 */
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

const encoder = new TextEncoder();

/** Web Crypto's key, named through `crypto.subtle`: the package's libs have no global `CryptoKey`. */
type SigningKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** Checks one webhook against the channel secret. Never throws: any failure is `false`. */
export type LineSignatureVerifier = (headers: Headers, rawBody: string) => Promise<boolean>;

/**
 * A verifier for one channel. The HMAC key is imported on the first webhook and kept, because the
 * adapter is built synchronously and the import is not; a failed import is forgotten, so the next
 * webhook tries again rather than every one failing until the Worker restarts.
 */
export function createLineSignatureVerifier(channelSecret: string): LineSignatureVerifier {
  if (channelSecret === "") throw new Error("LINE channel secret is empty");
  let key: Promise<SigningKey> | undefined;

  return async (headers, rawBody) => {
    let pending: Promise<SigningKey> | undefined;
    try {
      const received = headers.get(LINE_SIGNATURE_HEADER);
      if (received === null || !SIGNATURE_PATTERN.test(received)) return false;
      key ??= importSigningKey(channelSecret);
      pending = key;
      // UTF-8, as LINE sends it: a body that was not valid UTF-8 re-encodes differently and fails.
      const digest = await crypto.subtle.sign("HMAC", await pending, encoder.encode(rawBody));
      return constantTimeEqual(received, toBase64(digest));
    } catch {
      // The contract forbids throwing here, and a webhook that cannot be checked is refused: the
      // route answers 401 and logs the status, so nothing more is lost by not rethrowing.
      if (pending !== undefined && key === pending) key = undefined;
      return false;
    }
  };
}

function importSigningKey(channelSecret: string): Promise<SigningKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
