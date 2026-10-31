/**
 * The family's photo box (ADR-58). The family adds photos once, each marked as one of today ("new")
 * or of long ago ("old"), with an optional line about it; on her free mornings, about twice a week,
 * Vela turns one or two of them into her morning: a new photo with a question about it, an old one
 * whose answer is a story (`memory_photo`), or two new ones to choose from (`photo_choice`).
 *
 * What the box changes about a photo, and nothing else: while it is in the box its `media` row has
 * no deletion date and its object lives under `book/`, the prefix no bucket rule clears (data map
 * 21). Taking it out gives it its deletion date again, now, so the next retention run deletes it
 * wherever an exchange still names it. A photo whose adder is no longer a live member of the family
 * is taken out by retention (`releaseBoxPhotosOfLeavers`). The AI never sees a box photo: the
 * morning's words are the family's line inside a fixed sentence in her language.
 */
import type {
  ApiMutationResponse,
  ApiPhotoBox,
  ApiPhotoBoxPhoto,
  ApiPhotoBoxRemoved,
  ExchangeType,
  LocalDate,
  PhotoBoxRefusal,
} from "@vela/contracts";
import {
  AddToPhotoBox,
  ChangePhotoBoxPhoto,
  PHOTO_BOX_LIMIT,
  RemovePhotoBoxPhoto,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { addDays } from "@vela/core";
import {
  type Exchange,
  exchanges,
  families,
  type Member,
  media,
  members,
  photoBox,
  photoBoxUses,
  type VelaTransaction,
} from "@vela/db";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps, Logger } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import type { Queryable } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** At most this many picture mornings in any seven of her days, and never two days running. */
export const PICTURE_MORNINGS_PER_WEEK = 2;

/** The bucket prefix the app's uploads are written under, which a 32-day rule clears (ADR-33). */
const ASKS_PREFIX = "asks/";

/** How many box photos one retention run moves out of `asks/`. */
const MOVES_PER_RUN = 25;

/** A photo box write the family is told about, by `reason` (`PHOTO_BOX_REFUSALS`). */
export class PhotoBoxRefusedError extends Error {
  override readonly name = "PhotoBoxRefusedError";
  readonly reason: PhotoBoxRefusal;

  constructor(reason: PhotoBoxRefusal) {
    super(`Photo box refused: ${reason}`);
    this.reason = reason;
  }
}

// reading ---------------------------------------------------------------------------------------

/**
 * The family's photo box (`GET /v1/families/:familyId/photo-box`), newest first, for any live
 * member; null for anyone else, which the API answers 404. Each photo says whether the caller may
 * change it (whoever added it, or an organiser) and the last of her mornings it was shown on.
 */
export async function loadApiPhotoBox(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
): Promise<ApiPhotoBox | null> {
  if (!UUID.test(familyId)) return null;
  const found = await authorizeFamilyAccess(db, identity, familyId);
  if (found.kind !== "granted") return null;
  const { access } = found;
  const rows = await db
    .select({ box: photoBox, file: media, adder: members.displayName })
    .from(photoBox)
    .innerJoin(media, eq(media.id, photoBox.mediaId))
    .leftJoin(members, eq(members.id, photoBox.addedBy))
    .where(eq(photoBox.familyId, access.familyId))
    .orderBy(desc(photoBox.createdAt), desc(photoBox.id));
  const ids = rows.map((row) => row.box.id);
  const lastUses =
    ids.length === 0
      ? []
      : await db
          .select({ boxId: photoBoxUses.boxId, last: max(photoBoxUses.localDay) })
          .from(photoBoxUses)
          .where(inArray(photoBoxUses.boxId, ids))
          .groupBy(photoBoxUses.boxId);
  const lastOf = new Map(lastUses.map((use) => [use.boxId, use.last]));
  return {
    photos: rows.map(({ box, file, adder }) => ({
      id: box.id,
      media_id: box.mediaId,
      era: box.era,
      caption: box.caption,
      width: file.width,
      height: file.height,
      added_by_name: adder,
      can_change: canChange(access, box.addedBy),
      last_used_on: (lastOf.get(box.id) ?? null) as LocalDate | null,
    })),
    limit: PHOTO_BOX_LIMIT,
  };
}

function canChange(access: { memberId: string; role: string }, addedBy: string | null): boolean {
  return access.role === "organiser" || addedBy === access.memberId;
}

function toApiPhoto(
  box: typeof photoBox.$inferSelect,
  file: { width: number | null; height: number | null },
  adder: string | null,
  lastUsedOn: LocalDate | null,
): ApiPhotoBoxPhoto {
  return {
    id: box.id,
    media_id: box.mediaId,
    era: box.era,
    caption: box.caption,
    width: file.width,
    height: file.height,
    added_by_name: adder,
    can_change: true,
    last_used_on: lastUsedOn,
  };
}

// writing ---------------------------------------------------------------------------------------

/**
 * Put a photo the caller uploaded into the family's box (`POST /v1/families/:familyId/photo-box`,
 * 201 `ApiPhotoBoxPhoto`). The family's photo lock (`vela-media:<family>`, taken by every upload)
 * orders two additions, so a box at its limit takes neither; the photo's own row is then taken
 * `for update`, as retention takes it before deleting, so a photo cannot be deleted for its age
 * while it goes into the box. The photo must be an image the caller uploaded from the app, still
 * stored, and not past its deletion date; else 404 `photo_missing`. Already in the box is 409
 * `in_box`; a full box 409 `box_full`.
 *
 * The object still lies under `asks/`, which the bucket clears 32 days after the upload: the route
 * moves it after the commit (`keepBoxPhotoStored`), and retention moves any it missed.
 */
export async function addToApiPhotoBox(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = AddToPhotoBox.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId)) throw new VelaError("not_found", "Family not found");
  const add = { ...parsed.data, media_id: parsed.data.media_id.toLowerCase() };
  const now = deps.clock.now();
  return runApiMutation(
    deps,
    identity,
    { key, operation: "photo_box.add:v1", input: { family_id: familyId, ...add }, familyId },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Family not found");
      },
      mutate: async (tx) => {
        const found = await authorizeFamilyAccess(tx, identity, familyId);
        if (found.kind !== "granted") throw new VelaError("not_found", "Family not found");
        const { access } = found;
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`vela-media:${access.familyId}`}, 0))`,
        );
        const [file] = await tx
          .select()
          .from(media)
          .where(and(eq(media.id, add.media_id), eq(media.familyId, access.familyId)))
          .for("update");
        if (
          file === undefined ||
          file.kind !== "image" ||
          file.channel !== null ||
          file.uploadedBy !== access.memberId ||
          file.storageKey === null ||
          !(file.kept || file.expiresAt === null || file.expiresAt > now)
        ) {
          throw new PhotoBoxRefusedError("photo_missing");
        }
        const [already] = await tx
          .select({ id: photoBox.id })
          .from(photoBox)
          .where(eq(photoBox.mediaId, file.id))
          .limit(1);
        if (already !== undefined) throw new PhotoBoxRefusedError("in_box");
        const [held] = await tx
          .select({ total: count() })
          .from(photoBox)
          .where(eq(photoBox.familyId, access.familyId));
        if (held === undefined || held.total >= PHOTO_BOX_LIMIT) {
          throw new PhotoBoxRefusedError("box_full");
        }
        const [box] = await tx
          .insert(photoBox)
          .values({
            familyId: access.familyId,
            mediaId: file.id,
            era: add.era,
            caption: add.caption ?? null,
            addedBy: access.memberId,
            createdAt: now,
          })
          .returning();
        if (box === undefined) throw new Error("photo box row vanished after its insert");
        await tx.update(media).set({ expiresAt: null }).where(eq(media.id, file.id));
        const [adder] = await tx
          .select({ name: members.displayName })
          .from(members)
          .where(eq(members.id, access.memberId));
        return { status: 201, body: toApiPhoto(box, file, adder?.name ?? null, null) };
      },
    },
  );
}

/**
 * The box row `boxId` names, with its photo's row taken `for update` first (media before the box,
 * as retention and `addToApiPhotoBox` take them), for a caller who may change it; else 404.
 */
async function lockBoxPhoto(
  tx: VelaTransaction,
  identity: SessionIdentity,
  boxId: string,
): Promise<{
  box: typeof photoBox.$inferSelect;
  file: typeof media.$inferSelect;
}> {
  const notFound = () => new VelaError("not_found", "Photo not found");
  if (!UUID.test(boxId)) throw notFound();
  const [seen] = await tx
    .select({ mediaId: photoBox.mediaId, familyId: photoBox.familyId })
    .from(photoBox)
    .where(eq(photoBox.id, boxId))
    .limit(1);
  if (seen === undefined) throw notFound();
  const found = await authorizeFamilyAccess(tx, identity, seen.familyId);
  if (found.kind !== "granted") throw notFound();
  const [file] = await tx.select().from(media).where(eq(media.id, seen.mediaId)).for("update");
  const [box] = await tx.select().from(photoBox).where(eq(photoBox.id, boxId)).for("update");
  if (file === undefined || box === undefined || !canChange(found.access, box.addedBy)) {
    throw notFound();
  }
  return { box, file };
}

/** Change a box photo's era or line (`POST /v1/photo-box/:boxId`, 200 `ApiPhotoBoxPhoto`). */
export async function changeApiPhotoBoxPhoto(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  boxId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = ChangePhotoBoxPhoto.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const change = parsed.data;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "photo_box.change:v1", input: { box_id: boxId, ...change } },
    {
      authorize: async (tx) => {
        await lockBoxPhoto(tx, identity, boxId);
      },
      mutate: async (tx) => {
        const { box, file } = await lockBoxPhoto(tx, identity, boxId);
        const [changed] = await tx
          .update(photoBox)
          .set({
            ...(change.era === undefined ? {} : { era: change.era }),
            ...(change.caption === undefined ? {} : { caption: change.caption }),
          })
          .where(eq(photoBox.id, box.id))
          .returning();
        if (changed === undefined) throw new Error("photo box row vanished while changing");
        const [adder] =
          changed.addedBy === null
            ? []
            : await tx
                .select({ name: members.displayName })
                .from(members)
                .where(eq(members.id, changed.addedBy));
        const [last] = await tx
          .select({ last: max(photoBoxUses.localDay) })
          .from(photoBoxUses)
          .where(eq(photoBoxUses.boxId, box.id));
        return {
          status: 200,
          body: toApiPhoto(
            changed,
            file,
            adder?.name ?? null,
            (last?.last ?? null) as LocalDate | null,
          ),
        };
      },
    },
  );
}

/**
 * Take a photo out of the box (`POST /v1/photo-box/:boxId/remove`, 200 `ApiPhotoBoxRemoved`): the
 * row goes, and the photo is given its deletion date now, so the next retention run deletes it. A
 * photo the family book keeps (`media.kept`) stays for the book. Removing one already gone is 404.
 */
export async function removeFromApiPhotoBox(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  boxId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!RemovePhotoBoxPhoto.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  const now = deps.clock.now();
  return runApiMutation(
    deps,
    identity,
    { key, operation: "photo_box.remove:v1", input: { box_id: boxId } },
    {
      authorize: async (tx) => {
        await lockBoxPhoto(tx, identity, boxId);
      },
      mutate: async (tx) => {
        const { box, file } = await lockBoxPhoto(tx, identity, boxId);
        await takeOutOfBox(tx, box.id, file.id, now);
        const body: ApiPhotoBoxRemoved = { id: box.id, removed: true };
        return { status: 200, body };
      },
    },
  );
}

/** Deletes the box row and gives its photo its deletion date, `now`. The photo's row is held. */
async function takeOutOfBox(
  tx: VelaTransaction,
  boxId: string,
  mediaId: string,
  now: Date,
): Promise<void> {
  await tx.delete(photoBox).where(eq(photoBox.id, boxId));
  await tx
    .update(media)
    .set({ expiresAt: now })
    .where(and(eq(media.id, mediaId), isNull(media.expiresAt)));
}

// keeping ---------------------------------------------------------------------------------------

/**
 * A box photo's object moved out of `asks/`, which the bucket clears 32 days after the upload, to
 * a unique attempt under `book/<family>/`, which no rule touches, as the family book moves a kept
 * file (`moveOutOfExpiring`). The copy is adopted only while the photo is still in the box with the
 * same key; a losing attempt deletes only its own object, and the winner then deletes the old one.
 * A failed copy leaves the original for retention's next run (`keepBoxPhotosStored`). Returns
 * whether the photo now lies outside `asks/`.
 */
export async function keepBoxPhotoStored(
  deps: Pick<Deps, "db" | "clock" | "media" | "random"> & { logger: Pick<Logger, "warn"> },
  mediaId: string,
): Promise<boolean> {
  const store = deps.media;
  if (store === null) return false;
  const [row] = await deps.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  const from = row?.storageKey ?? null;
  if (row === undefined || from === null) return false;
  if (!from.startsWith(ASKS_PREFIX)) return true;
  const startedAt = deps.clock.now();
  const key = `book/${row.familyId}/${row.id}-${deps.random.token(16)}.jpg`;
  const discard = async () => {
    try {
      await store.delete(key);
    } catch (error) {
      deps.logger.warn("photo_box_move_cleanup_failed", { mediaId, error: errorLabel(error) });
    }
  };
  try {
    const object = await store.get(from);
    if (object === null) return false;
    await store.put(key, object.body, "image/jpeg");
  } catch (error) {
    await discard();
    deps.logger.warn("photo_box_move_failed", { mediaId, error: errorLabel(error) });
    return false;
  }
  let adopted = false;
  try {
    adopted = await deps.db.transaction(async (tx) => {
      const [family] = await tx
        .select({ deletedAt: families.deletedAt })
        .from(families)
        .where(eq(families.id, row.familyId))
        .for("share");
      if (family === undefined || family.deletedAt !== null) return false;
      const [current] = await tx.select().from(media).where(eq(media.id, mediaId)).for("update");
      const [inBox] = await tx
        .select({ id: photoBox.id })
        .from(photoBox)
        .where(eq(photoBox.mediaId, mediaId))
        .limit(1);
      if (
        current === undefined ||
        inBox === undefined ||
        current.storageKey !== from ||
        current.expiresAt !== null ||
        startedAt.getTime() + DAY_MS <= deps.clock.now().getTime()
      ) {
        return false;
      }
      const [updated] = await tx
        .update(media)
        .set({ storageKey: key })
        .where(and(eq(media.id, mediaId), eq(media.storageKey, from)))
        .returning({ id: media.id });
      return updated !== undefined;
    });
  } catch (error) {
    // An ambiguous commit may have adopted the copy: keep it if its row names it, as the book does.
    try {
      const [current] = await deps.db
        .select({ storageKey: media.storageKey })
        .from(media)
        .where(eq(media.id, mediaId))
        .limit(1);
      adopted = current?.storageKey === key;
      if (!adopted) await discard();
    } catch {
      deps.logger.warn("photo_box_move_commit_unknown", { mediaId });
      return false;
    }
    deps.logger.warn("photo_box_move_failed", { mediaId, error: errorLabel(error) });
    if (!adopted) return false;
  }
  if (!adopted) {
    await discard();
    return false;
  }
  try {
    await store.delete(from);
  } catch (error) {
    // Nothing names the old object any more; the bucket's rule on `asks/` clears it.
    deps.logger.warn("photo_box_move_source_delete_failed", { mediaId, error: errorLabel(error) });
  }
  return true;
}

/** Retention's step: box photos still under `asks/` moved out, a bounded number a run. */
export async function keepBoxPhotosStored(
  deps: Pick<Deps, "db" | "clock" | "media" | "logger" | "random">,
): Promise<number> {
  if (deps.media === null) return 0;
  const waiting = await deps.db
    .select({ mediaId: photoBox.mediaId })
    .from(photoBox)
    .innerJoin(media, eq(media.id, photoBox.mediaId))
    .where(like(media.storageKey, `${ASKS_PREFIX}%`))
    .orderBy(asc(photoBox.createdAt))
    .limit(MOVES_PER_RUN);
  let moved = 0;
  for (const { mediaId } of waiting) {
    if (await keepBoxPhotoStored(deps, mediaId)) moved += 1;
  }
  return moved;
}

/**
 * Retention's step: a photo whose adder is no longer a live member of the family (left, deleted,
 * or gone with their account) is taken out of the box and given its deletion date now, so the same
 * run deletes it. Each photo's row is taken first, as everywhere else.
 */
export async function releaseBoxPhotosOfLeavers(
  deps: Pick<Deps, "db">,
  now: Date,
): Promise<number> {
  const orphaned = await deps.db
    .select({ id: photoBox.id, mediaId: photoBox.mediaId })
    .from(photoBox)
    .leftJoin(members, eq(members.id, photoBox.addedBy))
    .where(
      or(
        isNull(photoBox.addedBy),
        isNull(members.id),
        isNotNull(members.leftAt),
        inArray(members.status, ["left", "deceased"]),
      ),
    );
  let released = 0;
  for (const row of orphaned) {
    await deps.db.transaction(async (tx) => {
      const [file] = await tx.select().from(media).where(eq(media.id, row.mediaId)).for("update");
      const [box] = await tx.select().from(photoBox).where(eq(photoBox.id, row.id)).for("update");
      if (file === undefined || box === undefined) return;
      await takeOutOfBox(tx, box.id, file.id, now);
      released += 1;
    });
  }
  return released;
}

// her mornings ----------------------------------------------------------------------------------

type PictureKind = "look" | "story" | "choice";
const KIND_ORDER: readonly PictureKind[] = ["look", "story", "choice"];

interface Candidate {
  boxId: string;
  mediaId: string;
  era: "new" | "old";
  caption: string | null;
}

/**
 * Whether `date` may be one of her picture mornings: fewer than `PICTURE_MORNINGS_PER_WEEK` in the
 * six days before it, and none the day before.
 */
async function pictureMorningDue(
  tx: VelaTransaction,
  memberId: string,
  date: LocalDate,
): Promise<boolean> {
  const [recent] = await tx
    .select({
      mornings: countDistinct(photoBoxUses.exchangeId),
      yesterday: sql<number>`count(*) filter (where ${photoBoxUses.localDay} = ${addDays(date, -1)})`,
    })
    .from(photoBoxUses)
    .where(
      and(
        eq(photoBoxUses.memberId, memberId),
        gte(photoBoxUses.localDay, addDays(date, -6)),
        lt(photoBoxUses.localDay, date),
      ),
    );
  return (
    recent !== undefined &&
    recent.mornings < PICTURE_MORNINGS_PER_WEEK &&
    Number(recent.yesterday) === 0
  );
}

/**
 * The box photos she may be shown, the ones she has seen least recently first (never-shown first),
 * then the newest added: each still in the box, stored, an image, and with no deletion date.
 */
async function candidatesFor(tx: VelaTransaction, member: Member): Promise<Candidate[]> {
  const lastShown = tx
    .select({ boxId: photoBoxUses.boxId, last: max(photoBoxUses.localDay).as("last") })
    .from(photoBoxUses)
    .where(and(eq(photoBoxUses.memberId, member.id), isNotNull(photoBoxUses.boxId)))
    .groupBy(photoBoxUses.boxId)
    .as("last_shown");
  const rows = await tx
    .select({
      boxId: photoBox.id,
      mediaId: photoBox.mediaId,
      era: photoBox.era,
      caption: photoBox.caption,
      last: lastShown.last,
    })
    .from(photoBox)
    .innerJoin(media, eq(media.id, photoBox.mediaId))
    .leftJoin(lastShown, eq(lastShown.boxId, photoBox.id))
    .where(
      and(
        eq(photoBox.familyId, member.familyId),
        eq(media.familyId, member.familyId),
        eq(media.kind, "image"),
        isNotNull(media.storageKey),
        isNull(media.expiresAt),
      ),
    )
    .orderBy(sql`${lastShown.last} asc nulls first`, desc(photoBox.createdAt), desc(photoBox.id));
  return rows.map(({ last: _last, ...row }) => row);
}

/** The kind of her `n`th picture morning, walked forward to one the box can make. */
function kindFor(n: number, candidates: readonly Candidate[]): PictureKind | null {
  const fresh = candidates.filter((c) => c.era === "new").length;
  const old = candidates.length - fresh;
  const possible: Record<PictureKind, boolean> = {
    look: fresh >= 1,
    story: old >= 1,
    choice: fresh >= 2,
  };
  for (let step = 0; step < KIND_ORDER.length; step += 1) {
    const kind = KIND_ORDER[(n + step) % KIND_ORDER.length];
    if (kind !== undefined && possible[kind]) return kind;
  }
  return null;
}

/** The morning's words in her language: the family's line, when there is one, in a fixed sentence. */
function pictureText(lang: Member["language"], kind: PictureKind, caption: string | null): string {
  if (kind === "choice") return t(lang, "photo_box.choice");
  if (kind === "look") {
    return caption === null
      ? t(lang, "photo_box.look")
      : t(lang, "photo_box.look_caption", { caption });
  }
  return caption === null
    ? t(lang, "photo_box.story")
    : t(lang, "photo_box.story_caption", { caption });
}

/**
 * Her free morning of `date` made from the photo box, when it is one of her picture mornings and
 * the box has a photo for it: the exchange, scheduled, asked by nobody and drafted by Vela, so it
 * is signed by Vela; and a use of each photo it shows. Null leaves the morning to the question
 * bank. Called by `prepareDay` inside its transaction, holding her member row; the chosen photos'
 * rows are taken `for share` before her exchange (media before exchanges, as compose and retention
 * take them), and one taken out of the box meanwhile is passed over.
 */
export async function takePictureMorning(
  tx: VelaTransaction,
  member: Member,
  date: LocalDate,
  now: Date,
): Promise<Exchange | null> {
  if (!(await pictureMorningDue(tx, member.id, date))) return null;
  const listed = await candidatesFor(tx, member);
  if (listed.length === 0) return null;
  const held = await tx
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        inArray(
          media.id,
          listed.map((c) => c.mediaId),
        ),
        isNull(media.expiresAt),
        isNotNull(media.storageKey),
      ),
    )
    .for("share");
  const live = new Set(held.map((row) => row.id));
  const candidates = listed.filter((c) => live.has(c.mediaId));
  const [shown] = await tx
    .select({ mornings: countDistinct(photoBoxUses.exchangeId) })
    .from(photoBoxUses)
    .where(eq(photoBoxUses.memberId, member.id));
  const kind = kindFor(shown?.mornings ?? 0, candidates);
  if (kind === null) return null;
  const chosen =
    kind === "story"
      ? candidates.filter((c) => c.era === "old").slice(0, 1)
      : candidates.filter((c) => c.era === "new").slice(0, kind === "choice" ? 2 : 1);
  const first = chosen[0];
  if (first === undefined) return null;
  const type: ExchangeType =
    kind === "story" ? "memory_photo" : kind === "choice" ? "photo_choice" : "question";
  const [exchange] = await tx
    .insert(exchanges)
    .values({
      familyId: member.familyId,
      recipientId: member.id,
      askerId: null,
      type,
      state: "scheduled",
      text: pictureText(member.language, kind, kind === "choice" ? null : first.caption),
      textLang: member.language,
      whenRule: "date",
      scheduledFor: date,
      mediaIds: chosen.map((c) => c.mediaId),
      draftedByVela: true,
      createdAt: now,
    })
    .returning();
  if (exchange === undefined) {
    throw new VelaError("illegal_state", `no picture morning could be created for ${date}`);
  }
  await tx.insert(photoBoxUses).values(
    chosen.map((c) => ({
      exchangeId: exchange.id,
      memberId: member.id,
      boxId: c.boxId,
      localDay: date,
      createdAt: now,
    })),
  );
  return exchange;
}

/** Whether an exchange is one of Vela's picture mornings: asked by nobody, with photos. */
export function isVelaPictureMorning(
  exchange: Pick<Exchange, "askerId" | "draftedByVela">,
): boolean {
  return exchange.askerId === null && exchange.draftedByVela;
}
