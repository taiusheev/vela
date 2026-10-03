/**
 * Photos from the app (ADR-33; API contract, "Photos for an ask"): the upload a photo ask names
 * and the read the app shows it through.
 *
 * An upload is kept as an object before its row exists: the service cleans the JPEG
 * (`media-jpeg.ts`), stores it under a key minted for this one attempt,
 * `asks/<familyId>/<token>.jpg`, and only then writes the `media` row through `runApiMutation`.
 * Nothing but that row can ever name the key, so whatever stops the row from being written leaves
 * an object that is this attempt's alone, and deleting it is always safe; the one exception is an
 * error that says nothing about whether the commit happened, where the row is looked for first.
 * An isolate that dies between the put and the commit leaves an orphan, which the bucket's
 * lifecycle rule on `asks/` deletes (data map, gaps).
 *
 * Two volume limits hold inside the transaction, where no concurrent upload can slip past them: an
 * account uploads at most 20 photos in 24 hours (its actor lock orders its own uploads), and a
 * family holds at most 60 app photos that are neither kept nor expired (a transaction-scoped
 * advisory lock on the family orders its members' uploads). The Workers Rate Limiting binding
 * does not act on workers.dev, so these are the real caps.
 *
 * The lines this file logs carry the family id and an error label, never the key, the bytes, or
 * what the photo shows: `media_orphan_delete_failed` (an attempt's own object could not be
 * deleted) and `media_upload_commit_unknown` (a failure left the commit unknown, and the object was
 * kept because its row exists or could not be looked for).
 */
import { type ApiMutationResponse, ApiUploadedMedia, type MediaRefusal } from "@vela/contracts";
import { answers, exchanges, media, members, replies, type VelaTransaction } from "@vela/db";
import {
  and,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type FamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps, Logger, MediaStore } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import { cleanJpeg } from "./media-jpeg.ts";
import { familyHasEnded, MEDIA_RETENTION_DAYS, type Queryable } from "./repo.ts";

/** An account's photos in any 24 hours (ADR-33). */
export const MAX_PHOTOS_PER_ACCOUNT_DAY = 20;
/** A family's app photos that are neither kept nor past their deletion date (ADR-33). */
export const MAX_LIVE_PHOTOS_PER_FAMILY = 60;

const DAY_MS = 24 * 60 * 60 * 1_000;
const JPEG = "image/jpeg";
/** The voice types a family member may listen to: her phone's M4A, and stored Ogg or MP3 copies. */
const VOICE_TYPES = ["audio/mp4", "audio/ogg", "audio/mpeg"] as const;
const Uuid = z.uuid();

/**
 * A photo the service will not keep, with the reason the API answers in `details.reason`:
 * `jpeg_only` (415), `malformed` and `dimensions` (400), and `photo_limit` (429).
 */
export class MediaRefusedError extends Error {
  override readonly name = "MediaRefusedError";
  readonly reason: MediaRefusal;

  constructor(reason: MediaRefusal) {
    super(`Photo refused: ${reason}`);
    this.reason = reason;
  }
}

export interface UploadApiMediaDeps extends Pick<Deps, "db" | "clock" | "random"> {
  /** Where the photo is kept: the Worker's R2 bucket, or api-dev's memory. */
  store: MediaStore;
  logger: Pick<Logger, "error">;
}

export async function sha256HexOfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Deletes an object only this attempt ever named; a failure is logged and never thrown. */
async function discard(deps: UploadApiMediaDeps, key: string, familyId: string): Promise<void> {
  try {
    await deps.store.delete(key);
  } catch (error) {
    deps.logger.error("media_orphan_delete_failed", { familyId, error: errorLabel(error) });
  }
}

/**
 * After a failure that says nothing about the commit (a lost connection, say), deletes the object
 * only once its row is seen to be absent. The query runs on `deps.db` outside the failed
 * transaction, where the driver opens a new connection if the old one is gone. A row that exists,
 * or a query that fails too, keeps the object: an orphan costs storage until the lifecycle rule,
 * and a row without its object is a photo lost from an ask.
 */
async function discardUnlessCommitted(
  deps: UploadApiMediaDeps,
  key: string,
  familyId: string,
): Promise<void> {
  let absent = false;
  try {
    const rows = await deps.db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.storageKey, key))
      .limit(1);
    absent = rows.length === 0;
  } catch {
    absent = false;
  }
  if (absent) {
    await discard(deps, key, familyId);
  } else {
    deps.logger.error("media_upload_commit_unknown", { familyId });
  }
}

/** A refusal the service or `runApiMutation` decided on: the transaction rolled back, surely. */
function isKnownRefusal(error: unknown): boolean {
  return (
    error instanceof ApiIdempotencyError ||
    error instanceof VelaError ||
    error instanceof MediaRefusedError
  );
}

/**
 * The volume limits, counted under locks that order every upload that could pass them together:
 * the account's own uploads are already ordered by its actor lock, and the family's by the advisory
 * lock taken here, which nothing else takes, and which is taken after the actor lock and before any
 * row lock, so it closes no cycle. App photos are the family's `image` rows with no channel.
 */
async function checkPhotoLimits(
  tx: VelaTransaction,
  access: FamilyAccess,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`vela-media:${access.familyId}`}, 0))`,
  );
  const [account] = await tx
    .select({ total: count() })
    .from(media)
    .innerJoin(members, eq(members.id, media.uploadedBy))
    .where(
      and(
        eq(members.userId, access.userId),
        eq(media.kind, "image"),
        isNull(media.channel),
        gt(media.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  if (account === undefined || account.total >= MAX_PHOTOS_PER_ACCOUNT_DAY) {
    throw new MediaRefusedError("photo_limit");
  }
  const [family] = await tx
    .select({ total: count() })
    .from(media)
    .where(
      and(
        eq(media.familyId, access.familyId),
        eq(media.kind, "image"),
        isNull(media.channel),
        eq(media.kept, false),
        gt(media.expiresAt, now),
      ),
    );
  if (family === undefined || family.total >= MAX_LIVE_PHOTOS_PER_FAMILY) {
    throw new MediaRefusedError("photo_limit");
  }
}

/**
 * Keep a photo for an ask (`POST /v1/families/:familyId/media`, 201 `ApiUploadedMedia`). `body` is
 * the JPEG as it arrived; what is kept is `cleanJpeg`'s output, and the replay fingerprint is that
 * output's SHA-256 with its size, never the bytes: the same key with the same photo answers the
 * first upload's row again, and with another photo 409. A replay deletes the object this attempt
 * stored, since the row it answers with names the first attempt's.
 *
 * Any member of the family may upload, as any member may compose. The membership is decided again
 * inside the transaction (`authorize`), whose member becomes `uploaded_by`; a family that has ended
 * is 404, and the volume limits are 429 `photo_limit`.
 */
export async function uploadApiMedia(
  deps: UploadApiMediaDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  body: Uint8Array,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (typeof familyId !== "string" || !Uuid.safeParse(familyId).success) {
    throw new VelaError("not_found", "Family not found");
  }
  const cleaned = cleanJpeg(body);
  if (!cleaned.ok) throw new MediaRefusedError(cleaned.reason);
  const { bytes, width, height } = cleaned;
  const sha256 = await sha256HexOfBytes(bytes);
  return keepUpload(deps, identity, key, familyId, {
    bytes,
    mime: JPEG,
    storageKey: `asks/${familyId.toLowerCase()}/${deps.random.token(16)}.jpg`,
    operation: "media.upload:v1",
    input: { sha256, bytes: bytes.length, width, height },
    checkLimits: checkPhotoLimits,
    row: { kind: "image", width, height, durationMs: null },
    body: (row) =>
      ApiUploadedMedia.parse({
        id: row.id,
        kind: "image",
        width,
        height,
        bytes: bytes.length,
        expires_at: row.expiresAt.toISOString(),
      }),
  });
}

/** One upload as `keepUpload` keeps it: its bytes, where, its fingerprint, limits and row. */
export interface PreparedUpload {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** Minted for this attempt alone, so deleting it is always this attempt's to do. */
  storageKey: string;
  operation: string;
  input: Record<string, unknown>;
  checkLimits: (tx: VelaTransaction, access: FamilyAccess, now: Date) => Promise<void>;
  row: {
    kind: "image" | "audio";
    width: number | null;
    height: number | null;
    durationMs: number | null;
  };
  body: (row: { id: string; expiresAt: Date }) => ApiMutationResponse["body"];
}

/**
 * The upload's object, then its row through `runApiMutation` (the module's comment): shared by a
 * photo for an ask and a voice for a reply, so both have one idempotency, one ordering under the
 * account's actor lock, and one rule for deleting an attempt's own object.
 */
export async function keepUpload(
  deps: UploadApiMediaDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  upload: PreparedUpload,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const scope = familyId.toLowerCase();
  const { bytes, storageKey } = upload;

  try {
    await deps.store.put(storageKey, bytes.buffer, upload.mime);
  } catch (error) {
    // Whether a failed put left anything is unknown; nothing can name the key yet, so it goes.
    await discard(deps, storageKey, scope);
    throw error;
  }

  let access: FamilyAccess | undefined;
  let result: { response: ApiMutationResponse; replayed: boolean };
  try {
    result = await runApiMutation(
      deps,
      identity,
      { key, operation: upload.operation, input: upload.input, familyId: scope },
      {
        authorize: async (tx) => {
          const found = await authorizeFamilyAccess(tx, identity, scope);
          if (found.kind !== "granted") throw new VelaError("not_found", "Family not found");
          access = found.access;
        },
        mutate: async (tx) => {
          const uploader = access;
          if (uploader === undefined) throw new Error("upload mutated before it was authorized");
          if (await familyHasEnded(tx, scope)) {
            throw new VelaError("not_found", "Family not found");
          }
          const now = deps.clock.now();
          await upload.checkLimits(tx, uploader, now);
          const expiresAt = new Date(now.getTime() + MEDIA_RETENTION_DAYS * DAY_MS);
          const [row] = await tx
            .insert(media)
            .values({
              familyId: scope,
              uploadedBy: uploader.memberId,
              kind: upload.row.kind,
              storageKey,
              channel: null,
              providerFileId: null,
              providerUniqueId: null,
              mime: upload.mime,
              bytes: bytes.length,
              width: upload.row.width,
              height: upload.row.height,
              durationMs: upload.row.durationMs,
              kept: false,
              createdAt: now,
              expiresAt,
            })
            .returning({ id: media.id });
          if (row === undefined) throw new Error("media insert returned no row");
          return { status: 201, body: upload.body({ id: row.id, expiresAt }) };
        },
      },
    );
  } catch (error) {
    if (isKnownRefusal(error)) {
      await discard(deps, storageKey, scope);
    } else {
      await discardUnlessCommitted(deps, storageKey, scope);
    }
    throw error;
  }
  if (result.replayed) await discard(deps, storageKey, scope);
  return result;
}

/**
 * The photos a member of the family may see and ask with (ADR-33): the ones they uploaded, and any
 * one the family already shares, named by one of its exchanges (a photo ask) or carried by an
 * answer or a reply in it. An upload nobody has asked with yet is its uploader's alone. A condition
 * on `media`, for a query that also scopes it to the family.
 */
export function sharedWith(db: Queryable, familyId: string, memberId: string): SQL | undefined {
  return or(
    eq(media.uploadedBy, memberId),
    exists(
      db
        .select({ one: sql`1` })
        .from(exchanges)
        .where(
          and(eq(exchanges.familyId, familyId), sql`${media.id} = any(${exchanges.mediaIds})`),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(answers)
        .innerJoin(exchanges, eq(exchanges.id, answers.exchangeId))
        .where(and(eq(answers.mediaId, media.id), eq(exchanges.familyId, familyId))),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(replies)
        .innerJoin(exchanges, eq(exchanges.id, replies.exchangeId))
        .where(and(eq(replies.mediaId, media.id), eq(exchanges.familyId, familyId))),
    ),
  );
}

/**
 * A photo of this family the caller may see (`GET /v1/families/:familyId/media/:mediaId`): its
 * bytes, always a JPEG, or null for anything else, which the API answers 404. A caller who is not a
 * live member of the family is null, as the family reads are. Of the family's stored images, a
 * member sees the ones they uploaded, and any one the family already shares: named by one of its
 * exchanges (a photo ask), or carried by an answer or a reply in it. So an upload nobody has asked
 * with yet is its uploader's alone. A row whose object is gone, or one Telegram alone holds (no
 * storage key), is null, and the app shows its placeholder.
 *
 * A stored voice note shared the same way is served too, in its own audio type, so the family book
 * (ADR-39) and a reply can be listened to; Telegram's own voices are not stored and stay null.
 */
export async function readApiMedia(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  mediaId: string,
  store: MediaStore,
): Promise<{ body: ArrayBuffer; mime: string } | null> {
  if (typeof mediaId !== "string" || !Uuid.safeParse(mediaId).success) return null;
  const found = await authorizeFamilyAccess(db, identity, familyId);
  if (found.kind !== "granted") return null;
  const { access } = found;
  const shared = sharedWith(db, access.familyId, access.memberId);
  const [row] = await db
    .select({ storageKey: media.storageKey, kind: media.kind, mime: media.mime })
    .from(media)
    .where(
      and(
        eq(media.id, mediaId),
        eq(media.familyId, access.familyId),
        isNotNull(media.storageKey),
        or(
          and(
            eq(media.kind, "image"),
            // Telegram's photos carry no MIME type; anything that says it is not a JPEG is not
            // served as one.
            or(isNull(media.mime), eq(media.mime, JPEG)),
          ),
          and(eq(media.kind, "audio"), inArray(media.mime, [...VOICE_TYPES])),
        ),
        shared,
      ),
    )
    .limit(1);
  if (row === undefined || row.storageKey === null) return null;
  const object = await store.get(row.storageKey);
  if (object === null) return null;
  return { body: object.body, mime: row.kind === "image" ? JPEG : (row.mime ?? JPEG) };
}
