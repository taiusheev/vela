/**
 * The family book (spec §10, A10; ADR-39). A story she tells — her answers to a `story` exchange,
 * the words, the transcript and the voice or photo — is kept in the book, beyond the 30 days that
 * clear everything else, until she says "don't keep that one", an organiser removes it, or the
 * family leaves. Keeping is the default the privacy notice describes ("Stories the family keeps in
 * the family book … Saying 'don't keep that one' removes a story").
 *
 * What keeping changes, and nothing else: `media.kept` on her files (retention deletes no kept
 * file), and retention's clearing of the exchange's question and her answers' words skips an
 * exchange with a live entry (`jobs.ts`). A file under a prefix the bucket's 32-day rules clear (her
 * phone's recordings under `device/`) is moved to `book/`, which no rule touches (data map 21).
 */
import type { ApiMutationResponse, InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey } from "@vela/core";
import {
  type Answer,
  answers,
  type BookEntry,
  bookEntries,
  type Exchange,
  exchanges,
  media,
  members,
} from "@vela/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { extensionFor } from "./media-copy.ts";
import { type ApiBookRecipe, keptRecipes } from "./recipes.ts";
import { memberByChannelUser, type Queryable } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an exchange's answers go into the book, where the book is on (`BOOK`; off in production
 * until the privacy notice describes it): a story told in answer to a story ask, and what she says
 * about an old photo, which is kept with the photo (spec §10: "memory photos get names and stories
 * attached").
 */
export function keepsInBook(deps: Pick<Deps, "config">, exchange: Pick<Exchange, "type">): boolean {
  return deps.config.book && (exchange.type === "story" || exchange.type === "memory_photo");
}

/** The files an entry keeps: her answers' own, and the photo an old-photo ask showed her. */
function keptFiles(exchange: Pick<Exchange, "type" | "mediaIds">, answerMediaId: string | null) {
  return [
    ...(answerMediaId === null ? [] : [answerMediaId]),
    ...(exchange.type === "memory_photo" ? exchange.mediaIds : []),
  ];
}

/**
 * Keeps her answer to a story exchange in the book, after the light: the entry is made by her first
 * answer (and is never made again once removed), and each answer's file is kept with it. Returns
 * the entry, or null when it was removed before this answer, which keeps nothing.
 */
export async function keepInBook(
  deps: Pick<Deps, "db" | "clock" | "media" | "logger">,
  exchange: Exchange,
  answer: Answer,
): Promise<BookEntry | null> {
  const now = deps.clock.now();
  const entry = await deps.db.transaction(async (tx) => {
    await tx
      .insert(bookEntries)
      .values({
        familyId: exchange.familyId,
        memberId: answer.memberId,
        exchangeId: exchange.id,
        keptAt: now,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(bookEntries)
      .where(eq(bookEntries.exchangeId, exchange.id))
      .for("update");
    if (row === undefined || row.removedAt !== null) return null;
    const files = keptFiles(exchange, answer.mediaId);
    if (files.length > 0) {
      await tx.update(media).set({ kept: true }).where(inArray(media.id, files));
    }
    return row;
  });
  if (entry !== null) {
    for (const file of keptFiles(exchange, answer.mediaId)) {
      await moveOutOfExpiring(deps, file);
    }
  }
  return entry;
}

/** The bucket's prefixes a lifecycle rule clears 32 days after writing (data map 21). */
const EXPIRING = ["device/", "asks/", "replies/"] as const;

/**
 * A kept file under a prefix the bucket clears (her phone's recordings are under `device/`), moved
 * to `book/<family>/<id>.<ext>` so the bucket's 32-day rule never reaches it. The object is copied, the row pointed at the copy, and the
 * old object deleted; a failure leaves the row where it was, logged, for the next answer or the
 * founder, since the row still names an object that exists.
 */
async function moveOutOfExpiring(
  deps: Pick<Deps, "db" | "media" | "logger">,
  mediaId: string,
): Promise<void> {
  const store = deps.media;
  if (store === null) return;
  const [row] = await deps.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  const from = row?.storageKey ?? null;
  if (row === undefined || from === null || !EXPIRING.some((prefix) => from.startsWith(prefix))) {
    return;
  }
  const mime = row.mime ?? (row.kind === "image" ? "image/jpeg" : "audio/mp4");
  const key = `book/${row.familyId}/${row.id}.${extensionFor(mime)}`;
  try {
    const object = await store.get(from);
    if (object === null) return;
    await store.put(key, object.body, mime);
    await deps.db.update(media).set({ storageKey: key }).where(eq(media.id, row.id));
    await store.delete(from);
  } catch (error) {
    deps.logger.warn("book_media_move_failed", { mediaId, error: errorLabel(error) });
  }
}

/**
 * Takes an entry out of the book: what it kept follows the ordinary 30 days from when it was said
 * again, its files no longer kept. The entry's row stays, removed, so the same story is never kept
 * again by a later answer. Returns false when there was nothing kept to remove.
 */
async function removeEntry(
  tx: Queryable,
  exchangeId: string,
  removedBy: string,
  now: Date,
): Promise<BookEntry | null> {
  const [entry] = await tx
    .update(bookEntries)
    .set({ removedAt: now, removedBy })
    .where(and(eq(bookEntries.exchangeId, exchangeId), isNull(bookEntries.removedAt)))
    .returning();
  if (entry === undefined) return null;
  const files = await tx
    .select({ mediaId: answers.mediaId })
    .from(answers)
    .where(and(eq(answers.exchangeId, exchangeId), isNotNull(answers.mediaId)));
  const [exchange] = await tx
    .select({ type: exchanges.type, mediaIds: exchanges.mediaIds })
    .from(exchanges)
    .where(eq(exchanges.id, exchangeId))
    .limit(1);
  const ids = [
    ...files.flatMap((row) => (row.mediaId === null ? [] : [row.mediaId])),
    ...(exchange?.type === "memory_photo" ? exchange.mediaIds : []),
  ];
  if (ids.length > 0) {
    await tx.update(media).set({ kept: false }).where(inArray(media.id, ids));
  }
  return entry;
}

/**
 * Her "Don't keep this one" under the thanks for a story (spec §10): only the one whose story it is
 * may take it out, from her own chat. She is told it is gone.
 */
export async function handleBookDropButton(
  deps: Deps,
  event: InboundEvent,
  action: { exchangeId: string },
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (sender === null || event.conversation.kind !== "private") {
    deps.logger.warn("book_drop_ignored", { known: sender !== null });
    return;
  }
  const now = deps.clock.now();
  const removed = await deps.db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(bookEntries)
      .where(eq(bookEntries.exchangeId, action.exchangeId))
      .limit(1);
    if (entry === undefined || entry.memberId !== sender.member.id) return null;
    const gone = await removeEntry(tx, action.exchangeId, sender.member.id, now);
    if (gone !== null) {
      await recordEvent(
        tx,
        {
          name: "story_saved",
          familyId: gone.familyId,
          memberId: gone.memberId,
          exchangeId: gone.exchangeId,
          props: { kept: false, by: "her" },
        },
        now,
      );
    }
    return gone;
  });
  if (event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId);
  }
  if (removed !== null) {
    const lang = sender.member.language;
    try {
      await adapter.send({
        kind: "system",
        idempotencyKey: outboundKey("system", {
          conversationId: event.conversation.externalId,
          suffix: `book_drop:${action.exchangeId}`,
        }),
        lang,
        to: { channel: event.channel, conversationId: event.conversation.externalId },
        text: t(lang, "book.dropped"),
      });
    } catch (error) {
      deps.logger.warn("book_drop_reply_failed", { error: errorLabel(error) });
    }
  }
  deps.logger.info("book_drop", { removed: removed !== null });
}

/** One story in the book, as the app reads it. */
export interface ApiBookEntry {
  exchange_id: string;
  member_id: string;
  member_name: string;
  asked_by: string | null;
  question: string | null;
  /** The old photo she told about, where the ask showed one and it is stored. */
  photo_ids: string[];
  kept_at: string;
  answers: {
    kind: string;
    /** Her words, or the transcript of her voice. */
    text: string | null;
    /** Her voice note or photo, read through the family's media route. */
    media_id: string | null;
    media_kind: "audio" | "image" | null;
    at: string;
  }[];
}

/**
 * The family book (`GET /v1/families/:familyId/book`): every live entry, newest first, with the
 * question, who asked it, and her answers. Any live member of the family reads it (spec §10: reading
 * never needs Vela Light); anyone else gets null.
 */
export async function loadApiBook(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
): Promise<{
  entries: ApiBookEntry[];
  coming: ApiComingStory[];
  recipes: ApiBookRecipe[];
} | null> {
  if (!UUID.test(familyId)) return null;
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") return null;
  const rows = await db
    .select({ entry: bookEntries, exchange: exchanges, her: members })
    .from(bookEntries)
    .innerJoin(exchanges, eq(exchanges.id, bookEntries.exchangeId))
    .innerJoin(members, eq(members.id, bookEntries.memberId))
    .where(and(eq(bookEntries.familyId, familyId), isNull(bookEntries.removedAt)))
    .orderBy(desc(bookEntries.keptAt));
  const entries: ApiBookEntry[] = [];
  for (const row of rows) {
    const asker =
      row.exchange.askerId === null
        ? null
        : ((
            await db
              .select({ name: members.displayName })
              .from(members)
              .where(eq(members.id, row.exchange.askerId))
              .limit(1)
          )[0]?.name ?? null);
    const said = await db
      .select({ answer: answers, file: media })
      .from(answers)
      .leftJoin(media, eq(media.id, answers.mediaId))
      .where(eq(answers.exchangeId, row.exchange.id))
      .orderBy(asc(answers.receivedAt), asc(answers.id));
    entries.push({
      exchange_id: row.exchange.id,
      member_id: row.her.id,
      member_name: row.her.displayName,
      asked_by: asker,
      question: row.exchange.text,
      photo_ids:
        row.exchange.type !== "memory_photo" || row.exchange.mediaIds.length === 0
          ? []
          : (
              await db
                .select({ id: media.id })
                .from(media)
                .where(
                  and(
                    inArray(media.id, row.exchange.mediaIds),
                    eq(media.kind, "image"),
                    isNotNull(media.storageKey),
                  ),
                )
            ).map((photo) => photo.id),
      kept_at: row.entry.keptAt.toISOString(),
      answers: said.map(({ answer, file }) => {
        const words = (answer.payload as { text?: unknown }).text;
        const kind = file === null || file.storageKey === null ? null : file.kind;
        return {
          kind: answer.kind,
          text: typeof words === "string" ? words : answer.transcript,
          media_id: kind === "audio" || kind === "image" ? (file?.id ?? null) : null,
          media_kind: kind === "audio" || kind === "image" ? kind : null,
          at: answer.receivedAt.toISOString(),
        };
      }),
    });
  }
  return {
    entries,
    coming: await comingStories(db, familyId),
    recipes: await keptRecipes(db, familyId),
  };
}

/** One story ask set for a coming morning. */
export interface ApiComingStory {
  exchange_id: string;
  member_id: string;
  member_name: string;
  question: string | null;
  asked_by: string | null;
  date: string;
}

/**
 * The family's story asks still waiting for their morning, soonest first (spec A10): what story day
 * shows as chosen, and by whom, so the family does not choose a second one for the same Sunday.
 */
async function comingStories(db: Queryable, familyId: string): Promise<ApiComingStory[]> {
  const asker = alias(members, "asker");
  const rows = await db
    .select({ exchange: exchanges, her: members, asker: asker.displayName })
    .from(exchanges)
    .innerJoin(members, eq(members.id, exchanges.recipientId))
    .leftJoin(asker, eq(asker.id, exchanges.askerId))
    .where(
      and(
        eq(exchanges.familyId, familyId),
        eq(exchanges.type, "story"),
        inArray(exchanges.state, ["composed", "scheduled"]),
        isNotNull(exchanges.scheduledFor),
      ),
    )
    .orderBy(asc(exchanges.scheduledFor), asc(exchanges.id));
  return rows.flatMap(({ exchange, her, asker: askedBy }) =>
    exchange.scheduledFor === null
      ? []
      : [
          {
            exchange_id: exchange.id,
            member_id: her.id,
            member_name: her.displayName,
            question: exchange.text,
            asked_by: askedBy,
            date: exchange.scheduledFor,
          },
        ],
  );
}

/**
 * An organiser takes a story out of the book (`POST /v1/book/:exchangeId/remove`), through
 * `runApiMutation` under the entry's row: a second remove, or one of a story already removed,
 * answers as it stands. Organisers of her family only; anything else is 404.
 */
export async function removeApiBookEntry(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  exchangeId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!UUID.test(exchangeId)) throw new VelaError("not_found", "Not found");
  const id = exchangeId.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: bookEntries.familyId, memberId: bookEntries.memberId })
    .from(bookEntries)
    .where(eq(bookEntries.exchangeId, id))
    .limit(1);
  const now = deps.clock.now();
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "book.remove:v1",
      input: { exchange_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.memberId }),
    },
    {
      authorize: async (tx) => {
        if (found === undefined) throw new VelaError("not_found", "Not found");
        const access = await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (access.kind !== "granted") throw new VelaError("not_found", "Not found");
      },
      mutate: async (tx) => {
        const access =
          found === undefined
            ? null
            : await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (found === undefined || access === null || access.kind !== "granted") {
          throw new VelaError("not_found", "Not found");
        }
        const removed = await removeEntry(tx, id, access.access.memberId, now);
        if (removed !== null) {
          await recordEvent(
            tx,
            {
              name: "story_saved",
              familyId: removed.familyId,
              memberId: removed.memberId,
              exchangeId: removed.exchangeId,
              surface: "app",
              props: { kept: false, by: "organiser" },
            },
            now,
          );
        }
        return { status: 200, body: { exchange_id: id, removed: true } };
      },
    },
  );
}
