import type { ApiToday, ApiTodayExchange, ApiTomorrowTurn, Lang, LocalDate } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  type Exchange,
  type Member,
  media,
  members,
  replies,
  suggestions,
  turns,
} from "@vela/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { loadApiLights } from "./api-lights.ts";
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
const answerText = sql<string | null>`coalesce(
  ${answers.transcript}, ${answers.payload} ->> 'text', ${answers.payload} ->> 'choice',
  ${answers.summary}
)`;

const Uuid = z.uuid();

/**
 * The ask's photos, in the order she was shown them (ADR-33). Only the exchange's own family's
 * images, as the arrival reads them; an id retention has cleared is gone from `media_ids` too.
 * `stored` is what the photo route would serve: a kept JPEG, or a Telegram photo copied to storage.
 */
async function photosOf(db: Queryable, exchange: Exchange): Promise<ApiTodayExchange["photos"]> {
  if (exchange.mediaIds.length === 0) return [];
  const rows = await db
    .select({
      id: media.id,
      width: media.width,
      height: media.height,
      storageKey: media.storageKey,
      mime: media.mime,
    })
    .from(media)
    .where(
      and(
        eq(media.familyId, exchange.familyId),
        inArray(media.id, exchange.mediaIds),
        eq(media.kind, "image"),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  return exchange.mediaIds.flatMap((id) => {
    const row = byId.get(id.toLowerCase());
    if (row === undefined) return [];
    return [
      {
        id: row.id,
        width: row.width !== null && row.width > 0 ? row.width : null,
        height: row.height !== null && row.height > 0 ? row.height : null,
        stored: row.storageKey !== null && (row.mime === null || row.mime === "image/jpeg"),
      },
    ];
  });
}

/**
 * The photo she picked on a photo choice: the latest pick's, whatever answer came after it, so her
 * choice still shows when she went on to say something (ADR-33).
 */
async function pickedMediaId(db: Queryable, exchange: Exchange): Promise<string | null> {
  if (exchange.type !== "photo_choice") return null;
  const [pick] = await db
    .select({ mediaId: sql<string | null>`${answers.payload} ->> 'media_id'` })
    .from(answers)
    .where(and(eq(answers.exchangeId, exchange.id), eq(answers.kind, "photo_pick")))
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(1);
  const id = pick?.mediaId;
  return typeof id === "string" && Uuid.safeParse(id).success ? id : null;
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

/** One exchange as a family reads it. Shared with the Exchanges list, which shows the same card. */
export async function exchangeRow(
  db: Queryable,
  exchange: Exchange,
  recipient: { id: string; displayName: string },
): Promise<ApiTodayExchange> {
  const [answer] = await db
    .select({
      kind: answers.kind,
      text: answerText,
      receivedAt: answers.receivedAt,
    })
    .from(answers)
    .where(eq(answers.exchangeId, exchange.id))
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(1);
  const replyRows = await db
    .select({
      from: members.displayName,
      kind: replies.kind,
      text: replies.text,
    })
    .from(replies)
    .innerJoin(members, eq(members.id, replies.memberId))
    .where(eq(replies.exchangeId, exchange.id))
    .orderBy(asc(replies.createdAt), asc(replies.id));

  return {
    id: exchange.id,
    recipient_id: recipient.id,
    recipient_name: recipient.displayName,
    asker_name: await nameOf(db, exchange.askerId),
    on_behalf_of: exchange.onBehalfOf,
    type: exchange.type,
    ask: exchange.text,
    answer:
      answer === undefined
        ? null
        : {
            kind: answer.kind,
            text: answer.text,
            at: answer.receivedAt.toISOString(),
            picked_media_id: await pickedMediaId(db, exchange),
          },
    replies: replyRows,
    seen_at: exchange.seenAt?.toISOString() ?? null,
    replies_reach_her: (await readBackExchangeId(db, recipient.id)) === exchange.id,
    photos: await photosOf(db, exchange),
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
  for (const member of keptLight) {
    const today = localDateOf(now, member.tz);
    const exchange = await exchangeForLocalDate(db, member.id, today);
    if (exchange !== null) exchanges.push(await exchangeRow(db, exchange, member));
    const turn = await turnOfTomorrow(db, familyId, member, addDays(today, 1), viewer, familyEnded);
    if (turn !== null) tomorrow.push(turn);
  }
  return { lights, exchanges, tomorrow };
}
