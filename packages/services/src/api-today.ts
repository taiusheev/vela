import type { ApiToday, ApiTodayExchange, ApiTomorrowTurn } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  type Exchange,
  type Member,
  members,
  replies,
  suggestions,
  turns,
} from "@vela/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { loadApiLights } from "./api-lights.ts";
import { exchangeForLocalDate, keptLightMembersOfFamily, type Queryable } from "./repo.ts";

/** Her words, in the order the read-back uses: what she said, else wrote, else tapped. */
const answerText = sql<string | null>`coalesce(
  ${answers.transcript}, ${answers.payload} ->> 'text', ${answers.payload} ->> 'choice',
  ${answers.summary}
)`;

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
        : { kind: answer.kind, text: answer.text, at: answer.receivedAt.toISOString() },
    replies: replyRows,
    seen_at: exchange.seenAt?.toISOString() ?? null,
  };
}

async function turnOfTomorrow(
  db: Queryable,
  familyId: string,
  member: Member,
  tomorrow: string,
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
  if (turn === undefined && composed === null) return null;

  const holderId = turn?.holderId ?? null;
  const [suggestion] =
    holderId === null
      ? []
      : await db
          .select({ id: suggestions.id, text: suggestions.text })
          .from(suggestions)
          .where(
            and(
              eq(suggestions.familyId, familyId),
              eq(suggestions.forMemberId, holderId),
              eq(suggestions.aboutMemberId, member.id),
              isNull(suggestions.usedAt),
            ),
          )
          .orderBy(desc(suggestions.createdAt), desc(suggestions.id))
          .limit(1);

  return {
    local_day: tomorrow,
    recipient_id: member.id,
    recipient_name: member.displayName,
    holder_id: holderId,
    holder_name: await nameOf(db, holderId),
    // Once a morning is claimed the card carries the ask itself; a suggestion would be an invitation
    // to write a second one into a day that only holds one.
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
    suggestion: composed === null ? (suggestion ?? null) : null,
  };
}

/**
 * The Today screen (`GET /v1/families/:familyId/today`, API contract §4, spec §14.1 A6): the lights
 * row, today's exchange for each kept-light member with her answer and the family's replies, and
 * tomorrow's turn with its suggestion. Every day is the member's own local day, so a family spread
 * across time zones sees each person's day and not the caller's. The caller must be a live member
 * of the family; a stranger and a missing family look the same.
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

  const keptLight = await keptLightMembersOfFamily(db, familyId);
  const exchanges: ApiTodayExchange[] = [];
  const tomorrow: ApiTomorrowTurn[] = [];
  for (const member of keptLight) {
    const today = localDateOf(now, member.tz);
    const exchange = await exchangeForLocalDate(db, member.id, today);
    if (exchange !== null) exchanges.push(await exchangeRow(db, exchange, member));
    const turn = await turnOfTomorrow(db, familyId, member, addDays(today, 1));
    if (turn !== null) tomorrow.push(turn);
  }
  return { lights, exchanges, tomorrow };
}
