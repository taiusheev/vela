import { t } from "@lingui/core/macro";
import type { ComposeAsk } from "@vela/contracts";
import { ApiError } from "../api/client.ts";
import { photoRefusal } from "../api/upload.ts";
import type { AskType } from "./ask.ts";

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

/** Photos shown this session, by media id; the oldest are let go past this many. */
const KEPT_PHOTOS = 24;
const shown = new Map<string, string>();
const loading = new Map<string, Promise<string>>();

/** A photo already shown in this session, as the `data:` URI it was shown from. */
export function shownPhoto(mediaId: string): string | undefined {
  return shown.get(mediaId);
}

/**
 * A photo from memory when it has been shown this session, else loaded once however many screens
 * ask for it at the same moment. Only memory: nothing is written to the phone. A media id is the
 * same photo for everyone who may see it, and each load is authorised by the API, so the key needs
 * no account or family.
 */
export function loadPhoto(mediaId: string, load: () => Promise<string>): Promise<string> {
  const kept = shown.get(mediaId);
  if (kept !== undefined) {
    // Seen again: it moves to the back of the queue to be let go.
    shown.delete(mediaId);
    shown.set(mediaId, kept);
    return Promise.resolve(kept);
  }
  const pending = loading.get(mediaId);
  if (pending !== undefined) return pending;
  const next = load()
    .then((uri) => {
      shown.set(mediaId, uri);
      for (const oldest of shown.keys()) {
        if (shown.size <= KEPT_PHOTOS) break;
        shown.delete(oldest);
      }
      return uri;
    })
    .finally(() => loading.delete(mediaId));
  loading.set(mediaId, next);
  return next;
}

/**
 * A read made with a token fetched for it, and made once more with another if the API answers 401:
 * a session token can lapse between being fetched and being used.
 */
export async function withFreshToken<T>(
  token: () => Promise<string | null>,
  read: (token: string | null) => Promise<T>,
): Promise<T> {
  try {
    return await read(await token());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return read(await token());
    throw error;
  }
}
