import {
  type ApiToday,
  type ApiTodayAnswer,
  type ApiTodayExchange,
  type ApiTomorrowTurn,
  Lang,
  type LocalDate,
} from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  type Exchange,
  events,
  exchanges as exchangeRows,
  type Member,
  media,
  members,
  outbound,
  replies,
  suggestions,
  translations,
  turns,
} from "@vela/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { loadApiLights } from "./api-lights.ts";
import { sourceAudio, sourcePhoto } from "./api-media-descriptors.ts";
import { canBeAsked } from "./askable.ts";
import {
  exchangeForLocalDate,
  familyHasEnded,
  keptLightMembersOfFamily,
  type Queryable,
  readBackExchangeId,
} from "./repo.ts";
import { renderSuggestion } from "./suggestions.ts";

/** Her words, in the order the read-back uses: what she said, else wrote, else tapped. */
function answerText(answer: {
  transcript: string | null;
  payload: Record<string, unknown>;
  summary: string | null;
}): string | null {
  const payloadText = answer.payload.text;
  const choice = answer.payload.choice;
  return (
    answer.transcript ??
    (typeof payloadText === "string" ? payloadText : null) ??
    (typeof choice === "string" ? choice : null) ??
    answer.summary
  );
}

const Uuid = z.uuid();

/**
 * The ask's photos, in the order she was shown them (ADR-33). Only the exchange's own family's
 * images, as the arrival reads them. A photo retention has deleted is left out: any other ask loses
 * its id, and a photo choice keeps it in its place naming nothing (`deleteMedia`), so no empty slot
 * is listed for it. `stored` is what the photo route would serve: a kept JPEG, or a Telegram photo
 * copied to storage.
 */
async function photosOf(
  db: Queryable,
  exchange: Exchange,
  now?: Date,
): Promise<ApiTodayExchange["photos"]> {
  return photosById(db, exchange.familyId, exchange.mediaIds, now);
}

/** The family's images with these ids, in this order, as the app shows them; a gone one is left out. */
async function photosById(
  db: Queryable,
  familyId: string,
  ids: readonly string[],
  now?: Date,
): Promise<ApiTodayExchange["photos"]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: media.id,
      width: media.width,
      height: media.height,
      storageKey: media.storageKey,
      mime: media.mime,
      kept: media.kept,
      expiresAt: media.expiresAt,
    })
    .from(media)
    .where(and(eq(media.familyId, familyId), inArray(media.id, [...ids]), eq(media.kind, "image")));
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  return ids.flatMap((id) => {
    const row = byId.get(id.toLowerCase());
    if (row === undefined) return [];
    if (now !== undefined && !row.kept && row.expiresAt !== null && row.expiresAt <= now) return [];
    return [
      {
        id: row.id,
        width: row.width !== null && row.width > 0 ? row.width : null,
        height: row.height !== null && row.height > 0 ? row.height : null,
        stored: row.storageKey !== null && (row.mime === null || row.mime === "image/jpeg"),
        expires_at: row.kept ? null : (row.expiresAt?.toISOString() ?? null),
      },
    ];
  });
}

const NO_PICK = { picked_media_id: null, picked_number: null } as const;

/**
 * The photo she picked on a photo choice, and its number as her buttons showed it: the latest
 * pick's, whatever answer came after it, so her choice still shows when she went on to say
 * something (ADR-33). The number stays when the photo is deleted, so the family still reads which
 * one she chose.
 */
async function pickedPhoto(
  db: Queryable,
  exchange: Exchange,
): Promise<Pick<ApiTodayAnswer, "picked_media_id" | "picked_number">> {
  if (exchange.type !== "photo_choice") return NO_PICK;
  const [pick] = await db
    .select({ payload: answers.payload })
    .from(answers)
    .where(and(eq(answers.exchangeId, exchange.id), eq(answers.kind, "photo_pick")))
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(1);
  const id = pick?.payload.media_id;
  if (typeof id !== "string" || !Uuid.safeParse(id).success) return NO_PICK;
  const index = pick?.payload.index;
  return { picked_media_id: id, picked_number: index === 0 ? 1 : index === 1 ? 2 : null };
}

async function nameOf(db: Queryable, memberId: string | null): Promise<string | null> {
  if (memberId === null) return null;
  const [row] = await db
    .select({ displayName: members.displayName })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  return row?.displayName ?? null;
}

/** Her answers in the family's language, the one translation the pipeline writes for each. */
async function translationsOf(
  db: Queryable,
  answerIds: readonly string[],
): Promise<Map<string, { lang: Lang; text: string }>> {
  if (answerIds.length === 0) return new Map();
  const rows = await db
    .select({ id: translations.objectId, lang: translations.lang, text: translations.text })
    .from(translations)
    .where(
      and(eq(translations.objectType, "answer"), inArray(translations.objectId, [...answerIds])),
    );
  const found = new Map<string, { lang: Lang; text: string }>();
  for (const row of rows) {
    const lang = Lang.safeParse(row.lang);
    if (lang.success && !found.has(row.id)) found.set(row.id, { lang: lang.data, text: row.text });
  }
  return found;
}

/** The photo one pick names, and its number as her buttons showed it (`pickedPhoto`). */
function pickOf(
  payload: Record<string, unknown>,
): Pick<ApiTodayAnswer, "picked_media_id" | "picked_number"> {
  const id = payload.media_id;
  if (typeof id !== "string" || !Uuid.safeParse(id).success) return NO_PICK;
  const index = payload.index;
  return { picked_media_id: id, picked_number: index === 0 ? 1 : index === 1 ? 2 : null };
}

/** One exchange as a family reads it. Shared with the Exchanges list, which shows the same card. */
export async function exchangeRow(
  db: Queryable,
  exchange: Exchange,
  recipient: { id: string; displayName: string; tz?: string },
  now?: Date,
): Promise<ApiTodayExchange> {
  // Every answer, oldest first: a conversation shows each message she sent; Today shows the last.
  const answerRows = await db
    .select({
      id: answers.id,
      kind: answers.kind,
      payload: answers.payload,
      transcript: answers.transcript,
      summary: answers.summary,
      receivedAt: answers.receivedAt,
      mediaId: answers.mediaId,
    })
    .from(answers)
    .where(eq(answers.exchangeId, exchange.id))
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  const answer = answerRows.at(-1);
  const replyRows = await db
    .select({
      from: members.displayName,
      fromId: replies.memberId,
      at: replies.createdAt,
      kind: replies.kind,
      text: replies.text,
      mediaId: replies.mediaId,
    })
    .from(replies)
    .innerJoin(members, eq(members.id, replies.memberId))
    .where(eq(replies.exchangeId, exchange.id))
    .orderBy(asc(replies.createdAt), asc(replies.id));

  const ids = [
    ...answerRows.map((row) => row.mediaId),
    exchange.voiceHelloId,
    ...replyRows.map((reply) => reply.mediaId),
  ].filter((id): id is string => typeof id === "string");
  const files =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(media)
          .where(and(eq(media.familyId, exchange.familyId), inArray(media.id, ids)));
  const byId = new Map(files.map((file) => [file.id, file]));
  const fileOf = (id: string | null | undefined) =>
    id === null || id === undefined ? undefined : byId.get(id);

  const [conversationFailure] =
    exchange.whenRule === "now" && exchange.deliveredAt === null
      ? await db
          .select({ id: outbound.id })
          .from(outbound)
          .where(
            and(
              eq(outbound.exchangeId, exchange.id),
              eq(outbound.kind, "conversation"),
              inArray(outbound.status, ["failed", "dropped"]),
            ),
          )
          .limit(1)
      : [];
  const translated = await translationsOf(
    db,
    answerRows.filter((row) => answerText(row) !== null).map((row) => row.id),
  );
  const asWire = (row: (typeof answerRows)[number]): ApiTodayAnswer => ({
    kind: row.kind,
    text: answerText(row),
    at: row.receivedAt.toISOString(),
    ...(row.kind === "photo_pick" ? pickOf(row.payload) : NO_PICK),
    translation: translated.get(row.id) ?? null,
    audio: sourceAudio(fileOf(row.mediaId), now),
    photo: sourcePhoto(fileOf(row.mediaId), now),
  });
  const askerName = await nameOf(db, exchange.askerId);
  return {
    id: exchange.id,
    recipient_id: recipient.id,
    recipient_name: recipient.displayName,
    ...(recipient.tz === undefined ? {} : { recipient_tz: recipient.tz }),
    asker_name: askerName,
    // Null with the name, so a deleted asker's id is not handed out on its own.
    asker_id: askerName === null ? null : exchange.askerId,
    on_behalf_of: exchange.onBehalfOf,
    drafted_by_vela: exchange.draftedByVela,
    type: exchange.type,
    ask: exchange.text,
    created_at: exchange.createdAt.toISOString(),
    voice_hello: sourceAudio(fileOf(exchange.voiceHelloId), now),
    answer:
      answer === undefined
        ? null
        : {
            ...asWire(answer),
            // Her pick stays shown when she went on to say something after it (ADR-33).
            ...(await pickedPhoto(db, exchange)),
          },
    answers: answerRows.map(asWire),
    replies: await Promise.all(
      replyRows.map(async ({ mediaId, fromId, at, ...reply }) => ({
        ...reply,
        from_id: fromId,
        at: at.toISOString(),
        audio: sourceAudio(fileOf(mediaId), now),
        photo:
          reply.kind === "photo" && mediaId !== null
            ? ((await photosById(db, exchange.familyId, [mediaId], now))[0] ?? null)
            : null,
      })),
    ),
    delivery_status:
      exchange.deliveryFailedAt !== null || conversationFailure !== undefined
        ? "failed"
        : exchange.deliveredAt !== null
          ? "delivered"
          : "pending",
    seen_at: exchange.seenAt?.toISOString() ?? null,
    replies_reach_her: (await readBackExchangeId(db, recipient.id)) === exchange.id,
    photos: await photosOf(db, exchange, now),
  };
}

/** Who is reading Today: suggestions are rendered in their language, and never shown about them. */
interface Viewer {
  readonly memberId: string;
  readonly lang: Lang;
}

/**
 * Her day's unused suggestion, as the viewer reads it (`renderSuggestion`). The nightly writer
 * keeps one per member per day, so the day alone finds it; once an ask was composed from it, it is
 * used and no longer offered.
 */
async function suggestionOfDay(
  db: Queryable,
  familyId: string,
  memberId: string,
  day: LocalDate,
  viewerLang: Lang,
): Promise<ApiTomorrowTurn["suggestion"]> {
  const [row] = await db
    .select({
      id: suggestions.id,
      bankId: suggestions.bankId,
      type: suggestions.type,
      text: suggestions.text,
      lang: suggestions.lang,
      source: suggestions.source,
    })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.familyId, familyId),
        eq(suggestions.aboutMemberId, memberId),
        eq(suggestions.localDay, day),
        isNull(suggestions.usedAt),
      ),
    )
    .limit(1);
  if (row === undefined) return null;
  const rendered = renderSuggestion(row, viewerLang);
  return rendered === null
    ? null
    : {
        id: row.id,
        text: rendered.text,
        type: rendered.type,
        from_her_words: rendered.fromHerWords,
      };
}

async function turnOfTomorrow(
  db: Queryable,
  familyId: string,
  member: Member,
  tomorrow: LocalDate,
  viewer: Viewer,
  familyEnded: boolean,
): Promise<ApiTomorrowTurn | null> {
  const [turn] = await db
    .select({ holderId: turns.holderId })
    .from(turns)
    .where(
      and(
        eq(turns.familyId, familyId),
        eq(turns.localDay, tomorrow),
        eq(turns.recipientId, member.id),
      ),
    )
    .limit(1);
  // An ask composed before the evening's prompt has run has no turn row behind it, and a card that
  // appeared only with a turn row would leave the asker with nothing to show for it (spec A7).
  const composed = await exchangeForLocalDate(db, member.id, tomorrow);
  // Once a morning is claimed the card carries the ask itself; a suggestion would be an invitation
  // to write a second one into a day that only holds one. It is offered only for a morning an ask
  // could take, and never to her about herself (spec §7).
  const suggestion =
    composed === null &&
    viewer.memberId !== member.id &&
    canBeAsked(member, familyId) &&
    !familyEnded
      ? await suggestionOfDay(db, familyId, member.id, tomorrow, viewer.lang)
      : null;
  if (turn === undefined && composed === null && suggestion === null) return null;

  const holderId = turn?.holderId ?? null;
  return {
    local_day: tomorrow,
    recipient_id: member.id,
    recipient_name: member.displayName,
    holder_id: holderId,
    holder_name: await nameOf(db, holderId),
    ask:
      composed === null
        ? null
        : {
            id: composed.id,
            type: composed.type,
            text: composed.text,
            asker_name: await nameOf(db, composed.askerId),
            on_behalf_of: composed.onBehalfOf,
            drafted_by_vela: composed.draftedByVela,
            // The asker may take it back until her morning is prepared (spec §19).
            withdrawable: composed.state === "composed" && composed.askerId === viewer.memberId,
          },
    suggestion,
    turn_pending: turn === undefined,
  };
}

/**
 * The Today screen (`GET /v1/families/:familyId/today`, API contract §4, spec §14.1 A6): the lights
 * row, today's exchange for each kept-light member with her answer and the family's replies, and
 * tomorrow's turn with its suggestion. Every day is the member's own local day, so a family spread
 * across time zones sees each person's day and not the caller's. The caller must be a live member
 * of the family; a stranger and a missing family look the same. A suggestion is written in the
 * caller's own language where Vela has one (`members.language`), and in English otherwise.
 */
export async function loadApiToday(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  now: Date,
): Promise<ApiToday | null> {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") return null;
  const lights = await loadApiLights(db, identity, familyId, now);
  if (lights === null) return null;

  const [reader] = await db
    .select({ language: members.language })
    .from(members)
    .where(eq(members.id, access.access.memberId))
    .limit(1);
  const viewer: Viewer = { memberId: access.access.memberId, lang: reader?.language ?? "en" };
  const familyEnded = await familyHasEnded(db, familyId);
  const keptLight = await keptLightMembersOfFamily(db, familyId);
  const exchanges: ApiTodayExchange[] = [];
  const tomorrow: ApiTomorrowTurn[] = [];
  const connectionDays: NonNullable<ApiToday["connection_days"]> = [];
  for (const member of keptLight) {
    const today = localDateOf(now, member.tz);
    // Actual received/sent messages, on the parent's local day. Scheduling and automated bank
    // questions do not light a window. This record never resets because a day was quiet.
    const since = new Date(now.getTime() - 8 * 86_400_000);
    const received = await db
      .select({ at: answers.receivedAt })
      .from(answers)
      .where(and(eq(answers.memberId, member.id), gte(answers.receivedAt, since)));
    const sent = await db
      .select({ at: exchangeRows.deliveredAt })
      .from(exchangeRows)
      .where(
        and(
          eq(exchangeRows.recipientId, member.id),
          isNotNull(exchangeRows.askerId),
          gte(exchangeRows.deliveredAt, since),
          ne(exchangeRows.state, "withdrawn"),
        ),
      );
    const deliveredReplies = await db
      .select({ at: replies.readBackAt })
      .from(replies)
      .innerJoin(exchangeRows, eq(replies.exchangeId, exchangeRows.id))
      .where(and(eq(exchangeRows.recipientId, member.id), gte(replies.readBackAt, since)));
    const unattached = await db
      .select({ at: events.at })
      .from(events)
      .where(
        and(
          eq(events.memberId, member.id),
          eq(events.name, "answer_recorded"),
          gte(events.at, since),
        ),
      );
    const dates = new Set(
      [...received, ...sent, ...deliveredReplies, ...unattached].flatMap((row) =>
        row.at === null ? [] : [localDateOf(row.at, member.tz)],
      ),
    );
    connectionDays.push({
      member_id: member.id,
      days: Array.from({ length: 7 }, (_, index) => {
        const date = addDays(today, index - 6);
        return { date, has_message: dates.has(date) };
      }),
    });
    const exchange = await exchangeForLocalDate(db, member.id, today);
    if (exchange !== null) exchanges.push(await exchangeRow(db, exchange, member, now));
    const turn = await turnOfTomorrow(db, familyId, member, addDays(today, 1), viewer, familyEnded);
    if (turn !== null) tomorrow.push(turn);
  }
  return { lights, exchanges, tomorrow, connection_days: connectionDays };
}
