import { ApiFamily, type NearbyConsent } from "@vela/contracts";
import {
  channelLinks,
  type Member,
  members,
  type NearbyContact,
  nearbyContacts,
  subscriptions,
} from "@vela/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { accountCanBeToldByPush } from "./push-devices.ts";
import { NOTICE_CHANNEL } from "./quiet-closing.ts";
import { familyById, type Queryable } from "./repo.ts";

type Light = ApiFamily["members"][number]["light"];

/**
 * On while her light is on; waiting while she is invited and has not said yes, which is how
 * onboarding leaves a kept-light member (the lights row reads her the same way); off for everyone
 * else, whose part is asking and replying.
 */
function lightOf(member: Member): Light {
  if (member.lightOn) return "on";
  return member.status === "invited" && member.role === "member" ? "waiting" : "off";
}

function consentOf(contact: NearbyContact): NearbyConsent {
  if (contact.declinedAt !== null) return "no";
  return contact.consentedAt === null ? "waiting" : "yes";
}

/**
 * How an organiser would be told of a quiet morning (ADR-34, D4), by the rule the quiet ladder
 * uses: a notice-channel link they have not blocked, or, while this API sends pushes (`pushOn`), a
 * phone on their account that can be told.
 */
async function toldIfQuiet(
  db: Queryable,
  memberId: string,
  userId: string,
  pushOn: boolean,
): Promise<NonNullable<ApiFamily["told_if_quiet"]>> {
  const [link] = await db
    .select({ id: channelLinks.id })
    .from(channelLinks)
    .where(
      and(
        eq(channelLinks.memberId, memberId),
        eq(channelLinks.channel, NOTICE_CHANNEL),
        isNull(channelLinks.blockedAt),
      ),
    )
    .limit(1);
  return {
    telegram: link !== undefined,
    app: pushOn && (await accountCanBeToldByPush(db, userId)),
  };
}

/**
 * The family behind You (`GET /v1/families/:familyId`, API contract §2, spec A12): its live members
 * in the order they joined, each with their light and, where one covers them, their Vela Light
 * subscription; and for the organisers only, the people nearby with where their yes stands. No
 * phone number is in it: a number is for the quiet notice, to the people the notice is for.
 * A stranger, a family that is not the caller's and an unknown family all answer null. An
 * organiser also learns how they would be told if her morning went quiet; `pushOn` is whether this
 * API sends pushes (`PUSH_SEND` "expo"), without which a phone is told nothing.
 */
export async function loadApiFamily(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  pushOn = false,
): Promise<ApiFamily | null> {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") return null;
  const family = await familyById(db, familyId);
  if (family === null) return null;

  const live = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        inArray(members.status, ["invited", "active", "paused"]),
        isNull(members.leftAt),
      ),
    )
    .orderBy(members.createdAt, members.id);
  const liveIds = new Set(live.map((member) => member.id));
  const covering = new Map(
    (await db.select().from(subscriptions).where(eq(subscriptions.familyId, familyId))).map(
      (subscription) => [subscription.memberId, subscription],
    ),
  );

  const nearby =
    access.access.role !== "organiser"
      ? null
      : (
          await db
            .select()
            .from(nearbyContacts)
            .where(eq(nearbyContacts.familyId, familyId))
            .orderBy(nearbyContacts.createdAt, nearbyContacts.id)
        )
          .filter((contact) => liveIds.has(contact.memberId))
          .map((contact) => ({
            id: contact.id,
            near_member_id: contact.memberId,
            name: contact.name,
            relation: contact.relation,
            consent: consentOf(contact),
          }));

  // Parsed, not cast: the query admits only listed statuses, and the parse holds it to that.
  return ApiFamily.parse({
    family: { id: family.id, name: family.name, plan: family.plan },
    me: { member_id: access.access.memberId, role: access.access.role },
    members: live.map((member) => {
      const subscription = covering.get(member.id);
      return {
        member_id: member.id,
        display_name: member.displayName,
        role: member.role,
        status: member.status,
        light: lightOf(member),
        subscription:
          subscription === undefined
            ? null
            : {
                status: subscription.status,
                trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
                current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
              },
      };
    }),
    nearby,
    told_if_quiet:
      access.access.role === "organiser"
        ? await toldIfQuiet(db, access.access.memberId, access.access.userId, pushOn)
        : null,
  });
}
