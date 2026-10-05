import { t } from "@lingui/core/macro";
import type { ComposeAsk } from "@vela/contracts";
import { ApiError } from "../api/client.ts";
import { photoRefusal } from "../api/upload.ts";
import type { AskType } from "./ask.ts";
import type { ExchangePhoto } from "./today.ts";

/**
 * Photos in an ask (ADR-33), apart from the phone's picker and the screens: how many each kind
 * takes, the words it starts with, the state of each chosen photo, and the photos already shown,
 * kept in memory for as long as the app runs.
 */

/** The long side the phone re-encodes to, and the JPEG quality: well under the upload's 1 MiB. */
export const LONG_SIDE = 1600;
export const JPEG_QUALITY = 0.8;

/**
 * The resize that brings a photo's long side down to `longSide`, keeping its shape, or null when
 * it is already no larger. One side is given, so the other follows the photo's own proportions.
 */
export function fitWithin(
  width: number,
  height: number,
  longSide: number = LONG_SIDE,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= longSide) return null;
  return width >= height ? { width: longSide } : { height: longSide };
}

/** How many photos an ask of this kind shows her: two to pick from, one old photo, else none. */
export function photoCount(kind: AskType): 0 | 1 | 2 {
  return kind === "two_photos" ? 2 : kind === "old_photo" ? 1 : 0;
}

/**
 * The words a photo ask starts with, addressed to her as the ask itself is, and editable like any
 * other; undefined for the kinds that start empty.
 */
export function photoAskText(kind: AskType): string | undefined {
  switch (kind) {
    case "two_photos":
      return t`Which one do you like more?`;
    case "old_photo":
      return t`Do you remember this?`;
    default:
      return undefined;
  }
}

/** Why a photo did not go up, as a slot shows it. */
export type SlotError = "unusable" | "limit" | "off" | "trouble";

/**
 * One chosen photo on Ask. `uri` is the re-encoded file on the phone: a retry sends it again as it
 * is, never re-encoding. `key` is minted when the photo is chosen and kept through every retry, so
 * the API answers a repeat from its receipt instead of keeping the photo twice. A failed slot has
 * no file when the phone could not re-encode the photo at all.
 */
export type PhotoSlot =
  | { status: "empty" }
  | { status: "uploading"; uri: string; key: string; progress: number }
  | { status: "done"; uri: string; key: string; mediaId: string }
  | { status: "failed"; uri: string | null; key: string; error: SlotError };

export const EMPTY_SLOT: PhotoSlot = { status: "empty" };

/**
 * What a failed upload leaves in its slot: a photo that will never be taken, the limit for now, no
 * photos kept here at all, or trouble worth trying again, which is anything the API did not name.
 */
export function slotError(error: unknown): SlotError {
  const refusal = photoRefusal(error);
  return refusal === "unusable" || refusal === "limit" || refusal === "off" ? refusal : "trouble";
}

/** Whether trying the same file again can go differently. */
export function retryable(error: SlotError): boolean {
  return error === "trouble" || error === "limit";
}

/** Whether the first `count` slots are all up, so the ask can name them. */
export function slotsReady(slots: readonly PhotoSlot[], count: number): boolean {
  return slots.slice(0, count).every((slot) => slot.status === "done") && slots.length >= count;
}

/**
 * What an ask adds to its words for its kind: the photos' ids in the order she will see them, or
 * the vote's options, trimmed, with blank ones left out. Undefined while it cannot be sent yet.
 */
export function askExtras(
  kind: AskType,
  slots: readonly PhotoSlot[],
  options: readonly string[],
): Pick<ComposeAsk, "media_ids" | "vote_options"> | undefined {
  const count = photoCount(kind);
  if (count > 0) {
    const ids = slots
      .slice(0, count)
      .flatMap((slot) => (slot.status === "done" ? [slot.mediaId] : []));
    return ids.length === count ? { media_ids: ids } : undefined;
  }
  if (kind === "vote") {
    const kept = options.map((option) => option.trim()).filter((option) => option.length > 0);
    return kept.length >= 2 ? { vote_options: kept } : undefined;
  }
  return {};
}

/** Bind cached bytes to the identity and family that authorised them, even before cleanup runs. */
export function familyPhotoKey(
  account: { userId: string | null; sessionId?: string | null },
  familyId: string | undefined,
  mediaId: string,
): string {
  return JSON.stringify([account.userId, account.sessionId ?? null, familyId ?? null, mediaId]);
}

function expiryTime(expiresAt: string | null | undefined): number | null {
  if (expiresAt == null) return null;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function photoAvailable(photo: Pick<ExchangePhoto, "stored" | "expires_at">): boolean {
  const expiry = expiryTime(photo.expires_at);
  return photo.stored && (expiry === null || expiry > Date.now());
}

export interface PhotoSnapshot {
  selection: string;
  uri?: string;
  failed: boolean;
}

/** A changed selection must hide the previous URI in the render before its effect runs. */
export function selectedPhoto(
  selection: string,
  photo: Pick<ExchangePhoto, "stored" | "expires_at">,
  snapshot: PhotoSnapshot,
): string | undefined {
  return snapshot.selection === selection && !snapshot.failed && photoAvailable(photo)
    ? snapshot.uri
    : undefined;
}

/** Photos shown this session, by scoped selection; the oldest are let go past this many. */
const KEPT_PHOTOS = 24;
const MAX_TIMER_MS = 2_147_483_647;
interface CachedPhoto {
  uri: string;
  expiresAt: number | null;
  timer?: ReturnType<typeof setTimeout>;
}
const shown = new Map<string, CachedPhoto>();
const loading = new Map<string, Promise<string>>();
let generation = 0;

/** Also invalidates an in-flight load, so expiry cannot put the bytes back into memory. */
export function forgetPhoto(key: string): void {
  const kept = shown.get(key);
  if (kept?.timer !== undefined) clearTimeout(kept.timer);
  shown.delete(key);
  loading.delete(key);
}

/** A departed account's files and late requests never populate the next account's cache. */
export function clearPhotoCache(): void {
  generation += 1;
  for (const key of shown.keys()) forgetPhoto(key);
  loading.clear();
}

/** A photo already shown in this session, as the `data:` URI it was shown from. */
export function shownPhoto(key: string): string | undefined {
  const kept = shown.get(key);
  if (kept !== undefined && kept.expiresAt !== null && kept.expiresAt <= Date.now()) {
    forgetPhoto(key);
    return undefined;
  }
  return kept?.uri;
}

function expirePhoto(key: string, kept: CachedPhoto): void {
  if (kept.expiresAt === null || shown.get(key) !== kept) return;
  const remaining = kept.expiresAt - Date.now();
  if (remaining <= 0) {
    forgetPhoto(key);
    return;
  }
  // Ordinary retention can exceed setTimeout's 32-bit maximum; check again in a bounded chunk.
  kept.timer = setTimeout(() => expirePhoto(key, kept), Math.min(remaining, MAX_TIMER_MS));
}

/**
 * A photo from memory when it has been shown this session, else loaded once however many screens
 * ask for it at the same moment. Only memory: nothing is written to the phone. The cache is purged on every account/session boundary, including in-flight loads. Each fetch is
 * authorised again by the family media route.
 */
export function loadPhoto(
  key: string,
  load: () => Promise<string>,
  expiresAt?: string | null,
): Promise<string> {
  const started = generation;
  const expiry = expiryTime(expiresAt);
  if (expiry !== null && expiry <= Date.now()) {
    forgetPhoto(key);
    return Promise.reject(new Error("The photo expired"));
  }
  const kept = shownPhoto(key);
  if (kept !== undefined) {
    // Seen again: it moves to the back of the queue to be let go.
    const cached = shown.get(key);
    if (cached !== undefined) {
      shown.delete(key);
      shown.set(key, cached);
      if (expiry !== null && (cached.expiresAt === null || expiry < cached.expiresAt)) {
        if (cached.timer !== undefined) clearTimeout(cached.timer);
        cached.expiresAt = expiry;
        expirePhoto(key, cached);
      }
    }
    return Promise.resolve(kept);
  }
  const pending = loading.get(key);
  if (pending !== undefined) return pending;
  const next = load()
    .then((uri) => {
      if (started !== generation) throw new Error("The photo's session ended");
      if (loading.get(key) !== next) throw new Error("The photo was forgotten");
      if (expiry !== null && expiry <= Date.now()) throw new Error("The photo expired");
      const cached: CachedPhoto = { uri, expiresAt: expiry };
      shown.set(key, cached);
      expirePhoto(key, cached);
      for (const oldest of shown.keys()) {
        if (shown.size <= KEPT_PHOTOS) break;
        forgetPhoto(oldest);
      }
      return uri;
    })
    .finally(() => {
      if (loading.get(key) === next) loading.delete(key);
    });
  loading.set(key, next);
  return next;
}

/**
 * A read made with a token fetched for it, and made once more with a fresh one if the API answers
 * 401: a session token can lapse between being fetched and being used, and the retry asks Clerk for
 * a new token rather than the one it holds, which may be the one just refused.
 */
export async function withFreshToken<T>(
  token: (options?: { fresh?: boolean }) => Promise<string | null>,
  read: (token: string | null) => Promise<T>,
): Promise<T> {
  try {
    return await read(await token());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return read(await token({ fresh: true }));
    }
    throw error;
  }
}
