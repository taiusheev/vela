import type { InboundEvent } from "@vela/contracts";
import { channelLinks, families, familyChannels, members, outbound, users } from "@vela/db";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { SessionIdentity } from "./api-access.ts";
import type { Queryable } from "./repo.ts";

/**
 * A founder-approved roster, supplied privately by the Worker; null means admission is off.
 *
 * Two ways in, read together. The English trial's Telegram roster (ADR-42, ADR-45): a person takes
 * part when their Telegram id is listed. The closed test's approved families (ADR-52), present
 * only when family approval is on: a family the founder approved takes part on any messenger, with
 * everyone who joined it. Either way, only in the test's languages.
 */
export interface PilotAdmission {
  readonly telegramUserIds: readonly string[];
  /** The families the founder approved (ADR-52); absent while family approval is off. */
  readonly familyIds?: readonly string[];
  /** The languages the test runs in; English alone when absent. */
  readonly languages?: readonly string[];
}

export function pilotAllowsTelegram(
  admission: PilotAdmission | null | undefined,
  id: string,
): boolean {
  return admission == null || admission.telegramUserIds.includes(id);
}

/** Whether every one of these languages is one the test runs in. */
export function pilotSpeaks(
  admission: PilotAdmission | null | undefined,
  ...languages: readonly string[]
): boolean {
  if (admission == null) return true;
  const allowed = admission.languages ?? ["en"];
  return languages.every((language) => allowed.includes(language));
}

/** Whether the founder approved this family (ADR-52). */
export function pilotApprovesFamily(
  admission: PilotAdmission | null | undefined,
  familyId: string,
): boolean {
  return admission?.familyIds?.includes(familyId) === true;
}

/**
 * The first gate on what arrives (`inbound/router.ts`). On Telegram, as before, an approved id;
 * with family approval on, also someone in an approved family. On LINE, with family approval on,
 * everyone but someone whose family is known and not approved: a newcomer may start a family or
 * use an invite, and what follows waits behind the family's approval (`pilotCanActivate`, and the
 * family and member checks on all automatic work). LINE stays refused while family approval is off.
 */
export async function pilotAdmitsInbound(
  db: Queryable,
  admission: PilotAdmission | null | undefined,
  event: InboundEvent,
): Promise<boolean> {
  if (admission == null) return true;
  if (event.channel === "telegram" && pilotAllowsTelegram(admission, event.sender.externalUserId)) {
    return true;
  }
  if (admission.familyIds === undefined) return false;
  const known = await db
    .select({ familyId: members.familyId })
    .from(channelLinks)
    .innerJoin(members, eq(members.id, channelLinks.memberId))
    .where(
      and(
        eq(channelLinks.channel, event.channel),
        eq(channelLinks.externalId, event.sender.externalUserId),
        isNull(members.leftAt),
      ),
    );
  const group =
    event.conversation.kind === "group"
      ? await db
          .select({ familyId: familyChannels.familyId })
          .from(familyChannels)
          .where(
            and(
              eq(familyChannels.channel, event.channel),
              eq(familyChannels.conversationId, event.conversation.externalId),
              isNull(familyChannels.unlinkedAt),
            ),
          )
      : [];
  const familyIds = [...known, ...group].map((row) => row.familyId);
  if (familyIds.some((familyId) => pilotApprovesFamily(admission, familyId))) return true;
  return event.channel !== "telegram" && familyIds.length === 0;
}

/** Current admission for automatic work; privacy and withdrawal confirmations bypass this guard. */
export async function pilotMemberAllowed(
  db: Queryable,
  admission: PilotAdmission | null | undefined,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  if (admission == null) return true;
  const rows = await db
    .select({
      language: members.language,
      familyLanguage: families.language,
      channel: channelLinks.channel,
      externalId: channelLinks.externalId,
    })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .innerJoin(channelLinks, eq(channelLinks.memberId, members.id))
    .where(
      and(
        eq(members.id, memberId),
        eq(members.familyId, familyId),
        isNull(members.leftAt),
        inArray(members.status, ["active", "paused"]),
        isNull(families.deletedAt),
        isNull(channelLinks.blockedAt),
      ),
    );
  return rows.some(
    (row) =>
      pilotSpeaks(admission, row.language, row.familyLanguage) &&
      (pilotApprovesFamily(admission, familyId) ||
        (row.channel === "telegram" && pilotAllowsTelegram(admission, row.externalId))),
  );
}

/** A removed participant pauses automatic family content until their membership has ended. */
export async function pilotFamilyAllowed(
  db: Queryable,
  admission: PilotAdmission | null | undefined,
  familyId: string,
): Promise<boolean> {
  if (admission == null) return true;
  const rows = await db
    .select({
      language: members.language,
      familyLanguage: families.language,
      externalId: channelLinks.externalId,
      blockedAt: channelLinks.blockedAt,
    })
    .from(families)
    .innerJoin(
      members,
      and(
        eq(members.familyId, families.id),
        isNull(members.leftAt),
        inArray(members.status, ["active", "paused"]),
      ),
    )
    .leftJoin(
      channelLinks,
      and(eq(channelLinks.memberId, members.id), eq(channelLinks.channel, "telegram")),
    )
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)));
  // An approved family takes part with everyone who joined it, on whichever messenger.
  if (pilotApprovesFamily(admission, familyId)) {
    return (
      rows.length > 0 &&
      rows.every((row) => pilotSpeaks(admission, row.language, row.familyLanguage))
    );
  }
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        pilotSpeaks(admission, row.language, row.familyLanguage) &&
        row.externalId !== null &&
        row.blockedAt === null &&
        pilotAllowsTelegram(admission, row.externalId),
    )
  );
}

/** No membership is needed to provision or prove an account. Existing memberships must be approved. */
export async function pilotApiAccountAllowed(
  db: Queryable,
  identity: SessionIdentity,
  admission: PilotAdmission,
): Promise<boolean> {
  const rows = await db
    .select({
      familyId: members.familyId,
      language: members.language,
      familyLanguage: families.language,
      externalId: channelLinks.externalId,
      blockedAt: channelLinks.blockedAt,
    })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .innerJoin(families, eq(families.id, members.familyId))
    .leftJoin(
      channelLinks,
      and(eq(channelLinks.memberId, members.id), eq(channelLinks.channel, "telegram")),
    )
    .where(
      and(
        eq(users.authSubject, identity.authSubject),
        isNull(users.deletedAt),
        isNull(members.leftAt),
        isNull(families.deletedAt),
      ),
    );
  return rows.every(
    (row) =>
      pilotSpeaks(admission, row.language, row.familyLanguage) &&
      (pilotApprovesFamily(admission, row.familyId) ||
        (row.externalId !== null &&
          row.blockedAt === null &&
          pilotAllowsTelegram(admission, row.externalId))),
  );
}

/**
 * Starting a parent's light requires an approved, reachable organiser as well: on the Telegram
 * roster, or in a family the founder approved, on whichever messenger they linked. Reachable means
 * a message to them on that messenger was delivered after they linked it.
 */
export async function pilotCanActivate(
  db: Queryable,
  admission: PilotAdmission | null | undefined,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  if (admission == null) return true;
  const familyApproved = pilotApprovesFamily(admission, familyId);
  const rows = await db
    .select({
      id: members.id,
      role: members.role,
      status: members.status,
      language: members.language,
      familyLanguage: families.language,
      channel: channelLinks.channel,
      externalId: channelLinks.externalId,
      linkedAt: channelLinks.linkedAt,
    })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .innerJoin(
      channelLinks,
      and(eq(channelLinks.memberId, members.id), isNull(channelLinks.blockedAt)),
    )
    .where(and(eq(members.familyId, familyId), isNull(members.leftAt), isNull(families.deletedAt)));
  const approved = rows.filter(
    (row) =>
      pilotSpeaks(admission, row.language, row.familyLanguage) &&
      (familyApproved ||
        (row.channel === "telegram" && pilotAllowsTelegram(admission, row.externalId))),
  );
  if (!approved.some((row) => row.id === memberId)) return false;
  for (const organiser of approved.filter(
    (row) => row.role === "organiser" && row.status === "active",
  )) {
    const [delivered] = await db
      .select({ id: outbound.id })
      .from(outbound)
      .where(
        and(
          eq(outbound.memberId, organiser.id),
          eq(outbound.channel, organiser.channel),
          eq(outbound.conversationId, organiser.externalId),
          eq(outbound.status, "sent"),
          gte(outbound.sentAt, organiser.linkedAt),
        ),
      )
      .limit(1);
    if (delivered !== undefined) return true;
  }
  return false;
}
