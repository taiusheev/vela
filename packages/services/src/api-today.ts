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

const NO_PICK = { picked_media_id: null, picked_number: null } as const;

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

/** One card uses the same batched renderer as a page, preserving the wire contract. */
export async function exchangeRow(
  db: Queryable,
  exchange: Exchange,
  recipient: { id: string; displayName: string; tz?: string },
  now?: Date,
): Promise<ApiTodayExchange> {
  const [row] = await renderExchangeRows(db, [{ exchange, recipient }], now);
  if (row === undefined) throw new Error("Missing exchange card");
  return row;
}

/** Read one page together: history size must not multiply database round trips. */
export async function renderExchangeRows(
  db: Queryable,
  rows: readonly {
    exchange: Exchange;
    recipient: { id: string; displayName: string; tz?: string };
  }[],
  now?: Date,
): Promise<ApiTodayExchange[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.exchange.id);
  const familyIds = [...new Set(rows.map((row) => row.exchange.familyId))];
  const recipientIds = [...new Set(rows.map((row) => row.recipient.id))];
  const answerRows = await db
    .select()
    .from(answers)
    .where(inArray(answers.exchangeId, ids))
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  const replyRows = await db
    .select({
      exchangeId: replies.exchangeId,
      from: members.displayName,
      fromId: replies.memberId,
      at: replies.createdAt,
      kind: replies.kind,
      text: replies.text,
      mediaId: replies.mediaId,
    })
    .from(replies)
    .innerJoin(members, eq(members.id, replies.memberId))
    .where(inArray(replies.exchangeId, ids))
    .orderBy(asc(replies.createdAt), asc(replies.id));
  const mediaIds = [
    ...new Set(
      [
        ...answerRows.map((row) => row.mediaId),
        ...replyRows.map((row) => row.mediaId),
        ...rows.flatMap((row) => [row.exchange.voiceHelloId, ...row.exchange.mediaIds]),
      ].filter((id): id is string => typeof id === "string"),
    ),
  ];
  const files =
    mediaIds.length === 0
      ? []
      : await db
          .select()
          .from(media)
          .where(and(inArray(media.familyId, familyIds), inArray(media.id, mediaIds)));
  const translated = await translationsOf(
    db,
    answerRows.filter((row) => answerText(row) !== null).map((row) => row.id),
  );
  const askerIds = [
    ...new Set(
      rows.flatMap((row) => (row.exchange.askerId === null ? [] : [row.exchange.askerId])),
    ),
  ];
  const askers =
    askerIds.length === 0
      ? []
      : await db
          .select({ id: members.id, name: members.displayName })
          .from(members)
          .where(inArray(members.id, askerIds));
  const names = new Map(askers.map((row) => [row.id, row.name]));
  const delivered = await db
    .selectDistinctOn([exchangeRows.recipientId], {
      id: exchangeRows.id,
      recipientId: exchangeRows.recipientId,
    })
    .from(exchangeRows)
    .where(
      and(
        inArray(exchangeRows.recipientId, recipientIds),
        isNotNull(exchangeRows.scheduledFor),
        isNotNull(exchangeRows.deliveredAt),
        ne(exchangeRows.state, "withdrawn"),
      ),
    )
    .orderBy(exchangeRows.recipientId, desc(exchangeRows.scheduledFor));
  const readBack = new Map<string, string>();
  for (const row of delivered)
    if (!readBack.has(row.recipientId)) readBack.set(row.recipientId, row.id);
  const pendingIds = rows
    .filter((row) => row.exchange.whenRule === "now" && row.exchange.deliveredAt === null)
    .map((row) => row.exchange.id);
  const failures =
    pendingIds.length === 0
      ? []
      : await db
          .select({ exchangeId: outbound.exchangeId })
          .from(outbound)
          .where(
            and(
              inArray(outbound.exchangeId, pendingIds),
              eq(outbound.kind, "conversation"),
              inArray(outbound.status, ["failed", "dropped"]),
            ),
          );
  const failed = new Set(failures.map((row) => row.exchangeId));
  return rows.map(({ exchange, recipient }) => {
    const familyFiles = files.filter((file) => file.familyId === exchange.familyId);
    const byId = new Map(familyFiles.map((file) => [file.id.toLowerCase(), file]));
    const fileOf = (id: string | null | undefined) =>
      id == null ? undefined : byId.get(id.toLowerCase());
    const photoList = (photoIds: readonly string[]): ApiTodayExchange["photos"] =>
      photoIds.flatMap((id) => {
        const file = fileOf(id);
        if (
          file?.kind !== "image" ||
          (now !== undefined && !file.kept && file.expiresAt !== null && file.expiresAt <= now)
        )
          return [];
        return [
          {
            id: file.id,
            width: file.width !== null && file.width > 0 ? file.width : null,
            height: file.height !== null && file.height > 0 ? file.height : null,
            stored: file.storageKey !== null && (file.mime === null || file.mime === "image/jpeg"),
            expires_at: file.kept ? null : (file.expiresAt?.toISOString() ?? null),
          },
        ];
      });
    const herAnswers = answerRows.filter((row) => row.exchangeId === exchange.id);
    const answer = herAnswers.at(-1);
    const asWire = (row: (typeof answerRows)[number]): ApiTodayAnswer => ({
      kind: row.kind,
      text: answerText(row),
      at: row.receivedAt.toISOString(),
      ...(row.kind === "photo_pick" ? pickOf(row.payload) : NO_PICK),
      translation: translated.get(row.id) ?? null,
      audio: sourceAudio(fileOf(row.mediaId), now),
      photo: sourcePhoto(fileOf(row.mediaId), now),
    });
    const picked =
      exchange.type === "photo_choice"
        ? herAnswers.findLast((row) => row.kind === "photo_pick")
        : undefined;
    const askerName = exchange.askerId === null ? null : (names.get(exchange.askerId) ?? null);
    return {
      id: exchange.id,
      recipient_id: recipient.id,
      recipient_name: recipient.displayName,
      ...(recipient.tz === undefined ? {} : { recipient_tz: recipient.tz }),
      asker_name: askerName,
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
          : { ...asWire(answer), ...(picked === undefined ? NO_PICK : pickOf(picked.payload)) },
      answers: herAnswers.map(asWire),
      replies: replyRows
        .filter((row) => row.exchangeId === exchange.id)
        .map((row) => ({
          from: row.from,
          from_id: row.fromId,
          at: row.at.toISOString(),
          kind: row.kind,
          text: row.text,
          audio: sourceAudio(fileOf(row.mediaId), now),
          photo:
            row.kind === "photo" && row.mediaId !== null
              ? (photoList([row.mediaId])[0] ?? null)
              : null,
        })),
      delivery_status:
        exchange.deliveryFailedAt !== null || failed.has(exchange.id)
          ? "failed"
          : exchange.deliveredAt !== null
            ? "delivered"
            : "pending",
      seen_at: exchange.seenAt?.toISOString() ?? null,
      replies_reach_her: readBack.get(recipient.id) === exchange.id,
      photos: photoList(exchange.mediaIds),
    };
  });
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
