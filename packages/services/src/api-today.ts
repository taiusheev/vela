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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { answerMessageTime, compareAnswerMessages } from "./answer-message-time.ts";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { loadApiLights } from "./api-lights.ts";
import { sourceAudio, sourcePhoto } from "./api-media-descriptors.ts";
import { canBeAsked } from "./askable.ts";
import { familyHasEnded, keptLightMembersOfFamily, type Queryable } from "./repo.ts";
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
    const herAnswers = answerRows
      .filter((row) => row.exchangeId === exchange.id)
      .sort(compareAnswerMessages);
    const answer = herAnswers.at(-1);
    const asWire = (row: (typeof answerRows)[number]): ApiTodayAnswer => ({
      kind: row.kind,
      text: answerText(row),
      at: answerMessageTime(row).toISOString(),
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

/** Read tomorrow's turns and drafts once, matching each parent's own local date. */
async function turnsOfTomorrow(
  db: Queryable,
  familyId: string,
  parents: readonly { member: Member; today: LocalDate }[],
  mornings: readonly Exchange[],
  viewer: Viewer,
  familyEnded: boolean,
): Promise<ApiTomorrowTurn[]> {
  if (parents.length === 0) return [];
  const turnRows = await db
    .select()
    .from(turns)
    .where(
      and(
        eq(turns.familyId, familyId),
        or(
          ...parents.map(({ member, today }) =>
            and(eq(turns.recipientId, member.id), eq(turns.localDay, addDays(today, 1))),
          ),
        ),
      ),
    );
  const eligible = parents.filter(
    ({ member, today }) =>
      viewer.memberId !== member.id &&
      canBeAsked(member, familyId) &&
      !familyEnded &&
      !mornings.some(
        (row) => row.recipientId === member.id && row.scheduledFor === addDays(today, 1),
      ),
  );
  const drafts =
    eligible.length === 0
      ? []
      : await db
          .select()
          .from(suggestions)
          .where(
            and(
              eq(suggestions.familyId, familyId),
              isNull(suggestions.usedAt),
              or(
                ...eligible.map(({ member, today }) =>
                  and(
                    eq(suggestions.aboutMemberId, member.id),
                    eq(suggestions.localDay, addDays(today, 1)),
                  ),
                ),
              ),
            ),
          );
  const tomorrowAsks = mornings.filter((row) =>
    parents.some(
      ({ member, today }) =>
        row.recipientId === member.id && row.scheduledFor === addDays(today, 1),
    ),
  );
  const nameIds = [
    ...new Set(
      [...turnRows.map((row) => row.holderId), ...tomorrowAsks.map((row) => row.askerId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const people =
    nameIds.length === 0
      ? []
      : await db
          .select({ id: members.id, name: members.displayName })
          .from(members)
          .where(and(eq(members.familyId, familyId), inArray(members.id, nameIds)));
  const names = new Map(people.map((row) => [row.id, row.name]));
  return parents.flatMap(({ member, today }) => {
    const tomorrow = addDays(today, 1);
    const turn = turnRows.find((row) => row.recipientId === member.id && row.localDay === tomorrow);
    const composed = tomorrowAsks.find(
      (row) => row.recipientId === member.id && row.scheduledFor === tomorrow,
    );
    const draft = drafts.find(
      (row) => row.aboutMemberId === member.id && row.localDay === tomorrow,
    );
    const rendered = draft === undefined ? null : renderSuggestion(draft, viewer.lang);
    const suggestion =
      rendered === null || draft === undefined
        ? null
        : {
            id: draft.id,
            text: rendered.text,
            type: rendered.type,
            from_her_words: rendered.fromHerWords,
          };
    if (turn === undefined && composed === undefined && suggestion === null) return [];
    const holderId = turn?.holderId ?? null;
    return [
      {
        local_day: tomorrow,
        recipient_id: member.id,
        recipient_name: member.displayName,
        holder_id: holderId,
        holder_name: holderId === null ? null : (names.get(holderId) ?? null),
        ask:
          composed === undefined
            ? null
            : {
                id: composed.id,
                type: composed.type,
                text: composed.text,
                asker_name:
                  composed.askerId === null ? null : (names.get(composed.askerId) ?? null),
                on_behalf_of: composed.onBehalfOf,
                drafted_by_vela: composed.draftedByVela,
                withdrawable: composed.state === "composed" && composed.askerId === viewer.memberId,
              },
        suggestion,
        turn_pending: turn === undefined,
      },
    ];
  });
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
  const parents = keptLight.map((member) => ({ member, today: localDateOf(now, member.tz) }));
  if (parents.length === 0) return { lights, exchanges: [], tomorrow: [], connection_days: [] };
  const memberIds = parents.map(({ member }) => member.id);
  const since = new Date(now.getTime() - 8 * 86_400_000);
  // Read each source once for the family; received times retain the connection-window semantics.
  const received = await db
    .select({ memberId: answers.memberId, at: answers.receivedAt, kind: answers.kind })
    .from(answers)
    .where(
      and(
        inArray(answers.memberId, memberIds),
        gte(answers.receivedAt, since),
        lte(answers.receivedAt, now),
      ),
    );
  const unattached = await db
    .select({ memberId: events.memberId, at: events.at })
    .from(events)
    .where(
      and(
        inArray(events.memberId, memberIds),
        eq(events.name, "answer_recorded"),
        gte(events.at, since),
        lte(events.at, now),
      ),
    );
  const messages = [...received, ...unattached];
  const connectionDays: NonNullable<ApiToday["connection_days"]> = parents.map(
    ({ member, today }) => {
      const dates = new Set(
        messages.flatMap((row) =>
          row.memberId !== member.id || row.at === null ? [] : [localDateOf(row.at, member.tz)],
        ),
      );
      return {
        member_id: member.id,
        days: Array.from({ length: 7 }, (_, index) => {
          const date = addDays(today, index - 6);
          return { date, has_message: dates.has(date) };
        }),
      };
    },
  );
  // The explicit check-in tap remains visible for her whole local day, including a tap on an
  // earlier ask or one followed by more words. Neither a lit window nor another message means
  // the family has checked on her. No diagnosis or resolution is inferred here.
  const notOkay = parents.flatMap(({ member, today }) => {
    const latest = received
      .filter(
        (row) =>
          row.memberId === member.id &&
          row.kind === "not_okay" &&
          localDateOf(row.at, member.tz) === today,
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return latest === undefined ? [] : [{ member_id: member.id, at: latest.at.toISOString() }];
  });
  // Exact recipient/date pairs avoid using the caller's zone or another parent's date.
  const mornings = await db
    .select()
    .from(exchangeRows)
    .where(
      and(
        eq(exchangeRows.familyId, familyId),
        ne(exchangeRows.state, "withdrawn"),
        or(
          ...parents.map(({ member, today }) =>
            and(
              eq(exchangeRows.recipientId, member.id),
              inArray(exchangeRows.scheduledFor, [today, addDays(today, 1)]),
            ),
          ),
        ),
      ),
    );
  const cards = parents.flatMap(({ member, today }) => {
    const exchange = mornings.find(
      (row) => row.recipientId === member.id && row.scheduledFor === today,
    );
    return exchange === undefined ? [] : [{ exchange, recipient: member }];
  });
  const exchanges = await renderExchangeRows(db, cards, now);
  const tomorrow = await turnsOfTomorrow(db, familyId, parents, mornings, viewer, familyEnded);
  return {
    lights,
    exchanges,
    tomorrow,
    connection_days: connectionDays,
    ...(notOkay.length === 0 ? {} : { not_okay: notOkay }),
  };
}
