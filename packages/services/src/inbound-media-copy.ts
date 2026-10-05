import { ChannelSendError, type FetchedMedia } from "@vela/contracts";
import { families, type Media, media } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { extensionFor } from "./media-copy.ts";
import { pilotFamilyAllowed } from "./pilot-admission.ts";
import { familyHasEnded } from "./repo.ts";

type CopyDeps = Pick<Deps, "db" | "media" | "channels" | "logger" | "clock" | "random" | "config">;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const COPY_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** Copy the original without holding a database lock over a provider request. */
export async function storeInboundCopy(deps: CopyDeps, mediaId: string): Promise<Media | null> {
  const store = deps.media;
  if (store === null) return null;
  const [source] = await deps.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (source === undefined) return null;
  if (await familyHasEnded(deps.db, source.familyId)) return null;
  if (!(await pilotFamilyAllowed(deps.db, deps.config.pilotAdmission, source.familyId)))
    return null;
  if (!source.kept && source.expiresAt !== null && source.expiresAt <= deps.clock.now())
    return null;
  if (source.storageKey !== null) return source;
  if (source.createdAt.getTime() + COPY_WINDOW_MS <= deps.clock.now().getTime()) return null;
  if (source.channel === null || source.providerFileId === null) return null;
  let fetched: FetchedMedia;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    fetched = await Promise.race([
      deps.channels.get(source.channel).fetchMedia(source.providerFileId),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Media copy timed out")), 15_000);
      }),
    ]);
  } catch (error) {
    deps.logger.warn("inbound_media_copy_failed", {
      mediaId,
      code: error instanceof ChannelSendError ? error.code : errorLabel(error),
    });
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (fetched.body.byteLength === 0 || fetched.body.byteLength > MAX_SOURCE_BYTES) {
    deps.logger.warn("inbound_media_copy_refused", { mediaId, reason: "size" });
    return null;
  }
  const mime = source.mime ?? fetched.mime;
  // Every attempt owns its object. A loser can safely delete it without touching the winner.
  const key = `families/${source.familyId}/media/${source.id}-${deps.random.token(16)}.${extensionFor(mime)}`;
  const discard = async () => {
    try {
      await store.delete(key);
    } catch (error) {
      deps.logger.error("inbound_media_copy_cleanup_failed", { mediaId, error: errorLabel(error) });
    }
  };
  try {
    await store.put(key, fetched.body, mime);
  } catch (error) {
    await discard();
    deps.logger.warn("inbound_media_copy_failed", { mediaId, code: errorLabel(error) });
    return null;
  }
  try {
    const result = await deps.db.transaction(async (tx) => {
      // Family deletion and media retention cannot pass these locks while the key is adopted.
      const [family] = await tx
        .select()
        .from(families)
        .where(eq(families.id, source.familyId))
        .for("share");
      if (family === undefined || family.deletedAt !== null) return null;
      if (!(await pilotFamilyAllowed(tx, deps.config.pilotAdmission, family.id))) return null;
      const [current] = await tx.select().from(media).where(eq(media.id, mediaId)).for("update");
      if (current === undefined || current.familyId !== family.id) return null;
      if (!current.kept && current.expiresAt !== null && current.expiresAt <= deps.clock.now())
        return null;
      if (current.storageKey !== null) return current;
      if (current.createdAt.getTime() + COPY_WINDOW_MS <= deps.clock.now().getTime()) return null;
      if (current.channel !== source.channel || current.providerFileId !== source.providerFileId)
        return null;
      const [updated] = await tx
        .update(media)
        .set({ storageKey: key, mime, bytes: fetched.body.byteLength })
        .where(and(eq(media.id, current.id), isNull(media.storageKey)))
        .returning();
      return updated ?? null;
    });
    if (result?.storageKey !== key) await discard();
    return result;
  } catch (error) {
    // A lost commit response may still have adopted the key: never delete a committed source.
    try {
      const [current] = await deps.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
      if (current?.storageKey === key) return current;
      await discard();
    } catch {
      deps.logger.error("inbound_media_copy_commit_unknown", { mediaId });
    }
    deps.logger.warn("inbound_media_copy_failed", { mediaId, code: errorLabel(error) });
    return null;
  }
}

/** Existing media queue job: retry a live source for one day, then expose it as unavailable. */
export async function ingestExchangeMedia(deps: CopyDeps, mediaId: string): Promise<void> {
  if ((await storeInboundCopy(deps, mediaId)) !== null || deps.media === null) return;
  const [source] = await deps.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (source === undefined || source.channel === null || source.providerFileId === null) return;
  if (!(await pilotFamilyAllowed(deps.db, deps.config.pilotAdmission, source.familyId))) return;
  const now = deps.clock.now();
  if (
    (!source.kept && source.expiresAt !== null && source.expiresAt <= now) ||
    source.createdAt.getTime() + COPY_WINDOW_MS <= now.getTime()
  )
    return;
  if (await familyHasEnded(deps.db, source.familyId)) return;
  throw new Error("Source media is not ready");
}
