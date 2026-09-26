/**
 * The media LINE fetches (05 §5.10). LINE sends a voice note or a photo only as an https URL, which
 * LINE's servers and the phones in a chat open later (05 §1 fact 14), so every one Vela sends is a
 * URL to its copy in R2, served by the pilot Worker:
 *
 *   <PILOT_PUBLIC_URL>/media/<base64url of the storage key>/<signature>.<extension>
 *
 * The signature is the base64url HMAC-SHA256 of the storage key under `MEDIA_URL_SECRET`, so a URL
 * is a capability for one object and nobody can make one for another. It carries no expiry: a
 * retried push must send the very same body (05 §1 fact 8), and phones fetch it days later. It
 * stops working when retention deletes the object.
 *
 * A bad signature, a malformed key and a missing object all come back as null, which the route
 * answers with its one 404, so the answer never says which of them it was. Nothing here logs.
 */
import { ChannelSendError } from "@vela/contracts";
import type { LineConfig } from "./config.ts";

/** Where the media route answers; each URL goes on with the key and the signed file name. */
export const MEDIA_PATH_PREFIX = "/media/";

type MediaExtension = "m4a" | "mp3" | "jpg" | "png";

/**
 * The extension each type LINE plays is served under. LINE takes m4a and mp3 audio and JPEG and PNG
 * images (05 §5.5), and the adapter refuses any other type before it asks for a URL. The extension
 * is not signed: LINE and the phones read the object's own `Content-Type`.
 */
const EXTENSIONS: ReadonlyMap<string, MediaExtension> = new Map([
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/mpeg", "mp3"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);

/** A stored object as the adapter's `mediaUrl` option names one (05 §5.2). */
export interface MediaUrlRef {
  readonly storageKey: string;
  readonly mime: string;
}

/** What the LINE adapter's `mediaUrl` option takes, once photo-asks gives it one (05 §5.2). */
export type MediaUrl = (ref: MediaUrlRef) => Promise<string>;

/**
 * Signed URLs to stored objects, on this Worker's origin. The same object always gets the same URL,
 * so a retried push re-sends the same body.
 */
export function createMediaUrl(line: Pick<LineConfig, "pilotOrigin" | "mediaUrlSecret">): MediaUrl {
  return async ({ storageKey, mime }) => {
    const extension = EXTENSIONS.get(mime.split(";")[0]?.trim().toLowerCase() ?? "");
    if (extension === undefined) {
      throw new ChannelSendError("invalid_request", "LINE plays no media of this type by URL");
    }
    const keyBytes = UTF8.encode(storageKey);
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", await signingKey(line.mediaUrlSecret), keyBytes),
    );
    return `${line.pilotOrigin}${MEDIA_PATH_PREFIX}${toBase64Url(keyBytes)}/${toBase64Url(signature)}.${extension}`;
  };
}

/** `<signature>.<extension>`: 32 bytes of HMAC-SHA256 are 43 base64url characters. */
const SIGNED_FILE = /^([A-Za-z0-9_-]{43})\.(?:m4a|mp3|jpg|png)$/;

/** R2's own limit on a key. */
const MAX_STORAGE_KEY_BYTES = 1024;

/**
 * The stored object a media URL names, streamed with its stored `Content-Type`, or null when the
 * URL is not one this Worker signed or names nothing stored. A `Range` header goes to R2 as it
 * came, so a player can seek in a voice note; R2 answers the part asked for, and so 206.
 */
export async function openMedia(
  line: Pick<LineConfig, "mediaUrlSecret" | "mediaBucket">,
  encodedKey: string,
  file: string,
  headers: Headers,
): Promise<Response | null> {
  const signature = fromBase64Url(SIGNED_FILE.exec(file)?.[1] ?? "");
  const keyBytes = fromBase64Url(encodedKey);
  if (signature === null || keyBytes === null || keyBytes.byteLength > MAX_STORAGE_KEY_BYTES) {
    return null;
  }
  let storageKey: string;
  try {
    storageKey = STRICT_UTF8.decode(keyBytes);
  } catch {
    return null;
  }
  const key = await signingKey(line.mediaUrlSecret);
  // In constant time, by the runtime: a comparison that stopped early would say how much was right.
  if (!(await crypto.subtle.verify("HMAC", key, signature, keyBytes))) {
    return null;
  }
  const object = await line.mediaBucket.get(storageKey, { range: headers });
  if (object === null) {
    return null;
  }
  const answer = new Headers({
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "cache-control": "private",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    etag: object.httpEtag,
  });
  if (headers.has("range") && object.range !== undefined) {
    const { offset, length } = spanOf(object.range, object.size);
    answer.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers: answer });
  }
  return new Response(object.body, { headers: answer });
}

/**
 * The bytes R2 returned for a range, whichever of its three forms it came back in. The runtime sets
 * all three fields, those not in play undefined, so a field is read by its value, not its presence.
 */
function spanOf(range: R2Range, size: number): { offset: number; length: number } {
  const { offset, length, suffix }: { offset?: number; length?: number; suffix?: number } = range;
  if (suffix !== undefined) {
    const kept = Math.min(suffix, size);
    return { offset: size - kept, length: kept };
  }
  const start = offset ?? 0;
  return { offset: start, length: length ?? size - start };
}

const UTF8 = new TextEncoder();
/** Refuses bytes that are not UTF-8, and keeps a leading byte order mark: no two keys decode alike. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    UTF8.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The bytes a base64url string spells, or null. Only the one spelling `toBase64Url` writes is taken:
 * another, whose unused bits are set, decodes to the same bytes, and would make a second URL for
 * one object.
 */
function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text)) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}
