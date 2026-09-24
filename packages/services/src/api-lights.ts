import type { LightState, MemberLight } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { awayPeriods, members, quietEvents } from "@vela/db";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { exchangeForLocalDate, keptLightMembersOfFamily, type Queryable } from "./repo.ts";

/**
 * The lights row behind Today and the widget (`GET /v1/families/:familyId/lights`, API contract
 * §5). One glyph per kept-light member, in the member's own local day: paused and away come from
 * the member's own state, lit and quiet from the day's exchange, and everything else is resting.
 * A member still invited, who has not said yes, follows with the state `none`.
 * The caller must be a live member of the family; a stranger and a missing family look the same.
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
  const lights: MemberLight[] = [];
  for (const member of keptLight) {
    const today = localDateOf(now, member.tz);
    const [away] = await db
      .select({ toDate: awayPeriods.toDate })
      .from(awayPeriods)
      .where(
        and(
          eq(awayPeriods.memberId, member.id),
          isNull(awayPeriods.endedAt),
          lte(awayPeriods.fromDate, today),
          or(isNull(awayPeriods.toDate), gte(awayPeriods.toDate, today)),
        ),
      )
      .limit(1);
    const exchange = await exchangeForLocalDate(db, member.id, today);
    const [quiet] =
      exchange === null
        ? []
        : await db
            .select({ id: quietEvents.id })
            .from(quietEvents)
            .where(and(eq(quietEvents.exchangeId, exchange.id), isNull(quietEvents.resolvedAt)))
            .limit(1);

    const answeredAt = exchange?.answeredAt ?? null;
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

    lights.push({
      member_id: member.id,
      display_name: member.displayName,
      state,
      answered_at: answeredAt?.toISOString() ?? null,
      usual_time: member.arrivalTime,
      away_until: away?.toDate ?? null,
      quiet_event_id: quiet?.id ?? null,
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
      state: "none",
      answered_at: null,
      usual_time: member.arrivalTime,
      away_until: null,
      quiet_event_id: null,
    });
  }
  return lights;
}
