/**
 * Vela's own copy of a file a platform holds (ADR-35): her phone on the parent surface opens only
 * files Vela keeps, so a photo or voice note the family sent on Telegram is copied into the media
 * store before her morning names it. The copy lives under the row's own id, so copying twice, or
 * twice at once, writes the same object and sets the same key once; retention deletes it with its
 * row, as it deletes any stored file.
 */
import { ChannelSendError, type FetchedMedia } from "@vela/contracts";
import { type Media, media } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";

/** R2 keys are named by the file's type, which Telegram voice notes and photos leave to the MIME type. */
const EXTENSION_BY_MIME: ReadonlyMap<string, string> = new Map([
  ["audio/ogg", "ogg"],
  ["audio/opus", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function extensionFor(mime: string): string {
  const type = (mime.split(";")[0] ?? "").trim().toLowerCase();
  return EXTENSION_BY_MIME.get(type) ?? "bin";
}

/**
 * The row with a stored copy: as it is when it has one, else after fetching the file from the
 * platform that holds it and keeping it. Null when nothing can be copied — storage is off, the row
 * names no platform file, or the platform no longer has it or cannot be reached — which is logged
 * by the row's id alone, and her morning leaves the file out rather than waiting on Telegram.
 */
export async function storedCopyOf(
  deps: Pick<Deps, "db" | "media" | "channels" | "logger">,
  row: Media,
): Promise<Media | null> {
  if (row.storageKey !== null) return row;
  const store = deps.media;
  if (store === null || row.providerFileId === null || row.channel === null) return null;
  let fetched: FetchedMedia;
  try {
    fetched = await deps.channels.get(row.channel).fetchMedia(row.providerFileId);
  } catch (error) {
    deps.logger.warn("media_copy_fetch_failed", {
      mediaId: row.id,
      code: error instanceof ChannelSendError ? error.code : errorLabel(error),
    });
    return null;
  }
  // Telegram gives a voice note's own type (audio/ogg) on the message, which is more exact than the
  // download's; a photo has none, and is a JPEG.
  const mime = row.mime ?? fetched.mime;
  const key = `families/${row.familyId}/media/${row.id}.${extensionFor(mime)}`;
  try {
    await store.put(key, fetched.body, mime);
  } catch (error) {
    deps.logger.warn("media_copy_store_failed", { mediaId: row.id, error: errorLabel(error) });
    return null;
  }
  await deps.db
    .update(media)
    .set({ storageKey: key, mime, bytes: fetched.body.byteLength })
    .where(and(eq(media.id, row.id), isNull(media.storageKey)));
  const [copied] = await deps.db.select().from(media).where(eq(media.id, row.id)).limit(1);
  if (copied === undefined) {
    // Retention deleted the row while it was copied: the copy goes with it.
    await store.delete(key).catch(() => {});
    return null;
  }
  return copied;
}
