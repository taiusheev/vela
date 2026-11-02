import type { LightState, MemberLight } from "@vela/contracts";
import { addDays, localDateOf, zonedInstant } from "@vela/core";
import { answers, awayPeriods, channelLinks, exchanges, members, quietEvents } from "@vela/db";
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { arrivalChannelOf } from "./arrivals.ts";
import { morningTimeOn } from "./morning-time.ts";
import { dayAnsweredAt, keptLightMembersOfFamily, type Queryable } from "./repo.ts";

/**
 * The lights row behind Today and the widget (`GET /v1/families/:familyId/lights`, API contract
 * §5). One glyph per kept-light member, in the member's own local day: paused and away come from
 * the member's own state, lit from her answers that day, quiet from the day's exchange, and
 * everything else is resting. A member still invited, who has not said yes, follows with the state
 * `none`. The caller must be a live member of the family; a stranger and a missing family look the
 * same.
 */
export async function loadApiLights(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  now: Date,
): Promise<MemberLight[] | null> {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") return null;

  const keptLight = await keptLightMembersOfFamily(db, familyId);
  // Keep each parent's local date in the predicate: the family can span calendar dates and DST.
  const parents = keptLight
    .filter((member) => member.status !== "deceased")
    .map((member) => ({
      member,
      today: localDateOf(now, member.tz),
    }));
  const awayRows =
    parents.length === 0
      ? []
      : await db
          .select({
            id: awayPeriods.id,
            memberId: awayPeriods.memberId,
            toDate: awayPeriods.toDate,
          })
          .from(awayPeriods)
          .where(
            and(
              isNull(awayPeriods.endedAt),
              or(
                ...parents.map(({ member, today }) =>
                  and(
                    eq(awayPeriods.memberId, member.id),
                    lte(awayPeriods.fromDate, today),
                    or(isNull(awayPeriods.toDate), gte(awayPeriods.toDate, today)),
                  ),
                ),
              ),
            ),
          );
  const mornings =
    parents.length === 0
      ? []
      : await db
          .select({
            id: exchanges.id,
            recipientId: exchanges.recipientId,
            answeredAt: exchanges.answeredAt,
          })
          .from(exchanges)
          .where(
            and(
              eq(exchanges.familyId, familyId),
              ne(exchanges.state, "withdrawn"),
              or(
                ...parents.map(({ member, today }) =>
                  and(eq(exchanges.recipientId, member.id), eq(exchanges.scheduledFor, today)),
                ),
              ),
            ),
          );
  const quietRows =
    mornings.length === 0
      ? []
      : await db
          .select({
            id: quietEvents.id,
            exchangeId: quietEvents.exchangeId,
          })
          .from(quietEvents)
          .where(
            and(
              inArray(
                quietEvents.exchangeId,
                mornings.map((row) => row.id),
              ),
              isNull(quietEvents.resolvedAt),
            ),
          );
  // Receipt time counts an answer on its local day, including taps on older arrivals. Use the
  // next local midnight, not a fixed 24 hours, on daylight-saving changes (firstAnswersByDate).
  const received =
    parents.length === 0
      ? []
      : await db
          .select({
            memberId: answers.memberId,
            at: answers.receivedAt,
          })
          .from(answers)
          .where(
            or(
              ...parents.map(({ member, today }) =>
                and(
                  eq(answers.memberId, member.id),
                  gte(answers.receivedAt, zonedInstant(today, "00:00", member.tz)),
                  lt(answers.receivedAt, zonedInstant(addDays(today, 1), "00:00", member.tz)),
                ),
              ),
            ),
          )
          .orderBy(asc(answers.receivedAt));
  const messengerParents = parents.filter(({ member }) => arrivalChannelOf(member) !== "device");
  const links =
    messengerParents.length === 0
      ? []
      : await db
          .select({
            memberId: channelLinks.memberId,
            channel: channelLinks.channel,
            blockedAt: channelLinks.blockedAt,
          })
          .from(channelLinks)
          .where(
            or(
              ...messengerParents.map(({ member }) =>
                and(
                  eq(channelLinks.memberId, member.id),
                  eq(channelLinks.channel, arrivalChannelOf(member)),
                ),
              ),
            ),
          );
  const lights: MemberLight[] = [];
  for (const { member, today } of parents) {
    const away = awayRows.find((row) => row.memberId === member.id);
    const exchange = mornings.find((row) => row.recipientId === member.id);
    const quiet = quietRows.find((row) => row.exchangeId === exchange?.id);
    const firstAnswer = received.find((row) => row.memberId === member.id)?.at ?? null;
    const answeredAt = dayAnsweredAt(exchange?.answeredAt ?? null, firstAnswer);
    const state: LightState =
      member.status === "paused"
        ? "paused"
        : away !== undefined
          ? "away"
          : answeredAt !== null
            ? "lit"
            : quiet !== undefined
              ? "quiet"
              : "resting";

    // Her phone (ADR-35) has no block to lose; a messenger link can be blocked or gone.
    const channel = arrivalChannelOf(member);
    const link = links.find((row) => row.memberId === member.id && row.channel === channel);
    lights.push({
      member_id: member.id,
      display_name: member.displayName,
      tz: member.tz,
      local_date: today,
      state,
      answered_at: answeredAt?.toISOString() ?? null,
      usual_time: morningTimeOn(member, today),
      away_until: away?.toDate ?? null,
      away_id: away?.id ?? null,
      unreachable_on: link !== undefined && link.blockedAt !== null ? channel : null,
      quiet_event_id: quiet?.id ?? null,
      ...(member.interests === null ? {} : { interests: member.interests }),
    });
  }

  // Invited and not yet answered: her light does not exist until she says yes, so she has no glyph
  // state of her own. She is shown all the same, so the organiser who just set her up does not find
  // an empty Today; nothing is asked of her and nothing is scheduled.
  const invited = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        eq(members.role, "member"),
        eq(members.status, "invited"),
        isNull(members.leftAt),
      ),
    )
    .orderBy(members.createdAt, members.id);
  for (const member of invited) {
    lights.push({
      member_id: member.id,
      display_name: member.displayName,
      tz: member.tz,
      local_date: localDateOf(now, member.tz),
      state: "none",
      answered_at: null,
      usual_time: morningTimeOn(member, localDateOf(now, member.tz)),
      away_until: null,
      away_id: null,
      unreachable_on: null,
      quiet_event_id: null,
      ...(member.interests === null ? {} : { interests: member.interests }),
    });
  }
  return lights;
}
