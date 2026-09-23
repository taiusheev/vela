import { ApiAccountProfile, type ApiFamilyPlan, type ApiMe, type ApiUser } from "@vela/contracts";
import { families, members, subscriptions, users } from "@vela/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { SessionIdentity } from "./api-access.ts";
import { VelaError } from "./errors.ts";
import type { Queryable } from "./repo.ts";

const Uuid = z.uuid();
const userProjection = {
  id: users.id,
  display_name: users.displayName,
  language: users.language,
  tz: users.tz,
};

function hasIdentity(identity: SessionIdentity): boolean {
  return identity.authSubject.trim().length > 0 && identity.sessionId.trim().length > 0;
}

export async function provisionApiUser(
  db: Queryable,
  identity: SessionIdentity,
  profile: unknown,
): Promise<ApiUser> {
  if (!hasIdentity(identity)) {
    throw new VelaError("not_found", "Account not found");
  }
  const parsed = ApiAccountProfile.safeParse(profile);
  if (!parsed.success) {
    throw new VelaError("invalid_payload", "Invalid account profile");
  }

  const [created] = await db
    .insert(users)
    .values({
      authSubject: identity.authSubject,
      displayName: parsed.data.display_name,
      language: parsed.data.language,
      tz: parsed.data.tz,
    })
    .onConflictDoNothing({ target: users.authSubject })
    .returning(userProjection);
  if (created !== undefined) {
    return created;
  }

  const [existing] = await db
    .select(userProjection)
    .from(users)
    .where(and(eq(users.authSubject, identity.authSubject), isNull(users.deletedAt)))
    .limit(1);
  if (existing === undefined) {
    throw new VelaError("not_found", "Account not found");
  }
  return existing;
}

export async function loadApiMe(db: Queryable, identity: SessionIdentity): Promise<ApiMe | null> {
  if (!hasIdentity(identity)) {
    return null;
  }

  const rows = await db
    .select({
      user: userProjection,
      membership: { member_id: members.id, role: members.role, status: members.status },
      family: {
        id: families.id,
        name: families.name,
        region: families.region,
        plan: families.plan,
      },
    })
    .from(users)
    .leftJoin(
      members,
      and(
        eq(members.userId, users.id),
        inArray(members.status, ["active", "paused"]),
        isNull(members.leftAt),
      ),
    )
    .leftJoin(families, and(eq(families.id, members.familyId), isNull(families.deletedAt)))
    .where(and(eq(users.authSubject, identity.authSubject), isNull(users.deletedAt)))
    .orderBy(asc(members.createdAt), asc(members.id));
  const first = rows[0];
  if (first === undefined) {
    return null;
  }

  const memberships: ApiMe["memberships"] = [];
  for (const { membership, family } of rows) {
    if (
      membership !== null &&
      family !== null &&
      (membership.status === "active" || membership.status === "paused")
    ) {
      memberships.push({
        member_id: membership.member_id,
        role: membership.role,
        status: membership.status,
        family,
      });
    }
  }
  return { user: first.user, memberships };
}

export async function loadApiFamilyPlan(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
): Promise<ApiFamilyPlan | null> {
  if (!hasIdentity(identity) || !Uuid.safeParse(familyId).success) {
    return null;
  }

  const viewer = alias(members, "viewer");
  const covered = alias(members, "covered");
  const rows = await db
    .select({
      family_id: families.id,
      plan: families.plan,
      coveredMemberId: covered.id,
      subscription: {
        member_id: subscriptions.memberId,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        graceUntil: subscriptions.graceUntil,
      },
    })
    .from(users)
    .innerJoin(
      viewer,
      and(
        eq(viewer.userId, users.id),
        eq(viewer.familyId, familyId),
        inArray(viewer.status, ["active", "paused"]),
        isNull(viewer.leftAt),
      ),
    )
    .innerJoin(families, and(eq(families.id, viewer.familyId), isNull(families.deletedAt)))
    .leftJoin(
      subscriptions,
      and(eq(subscriptions.familyId, families.id), eq(subscriptions.familyId, familyId)),
    )
    .leftJoin(
      covered,
      and(
        eq(covered.id, subscriptions.memberId),
        eq(covered.familyId, families.id),
        inArray(covered.status, ["active", "paused"]),
        isNull(covered.leftAt),
      ),
    )
    .where(and(eq(users.authSubject, identity.authSubject), isNull(users.deletedAt)))
    .orderBy(asc(covered.createdAt), asc(covered.id));
  const first = rows[0];
  if (first === undefined) {
    return null;
  }

  const visible: ApiFamilyPlan["subscriptions"] = [];
  for (const { coveredMemberId, subscription } of rows) {
    if (coveredMemberId !== null && subscription !== null) {
      visible.push({
        member_id: subscription.member_id,
        status: subscription.status,
        trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
        current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
        grace_until: subscription.graceUntil?.toISOString() ?? null,
      });
    }
  }
  return { family_id: first.family_id, plan: first.plan, subscriptions: visible };
}
