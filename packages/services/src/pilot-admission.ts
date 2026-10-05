import type { InboundEvent } from "@vela/contracts";
import { channelLinks, families, members, outbound, users } from "@vela/db";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { SessionIdentity } from "./api-access.ts";
import type { Queryable } from "./repo.ts";

/** A founder-approved roster, supplied privately by the Worker; null means admission is off. */
export interface PilotAdmission {
  readonly telegramUserIds: readonly string[];
}

export function pilotAllowsTelegram(
  admission: PilotAdmission | null | undefined,
  id: string,
): boolean {
  return admission == null || admission.telegramUserIds.includes(id);
}

export function pilotAllowsInbound(
  admission: PilotAdmission | null | undefined,
  event: InboundEvent,
): boolean {
  return (
    admission == null ||
    (event.channel === "telegram" && pilotAllowsTelegram(admission, event.sender.externalUserId))
  );
}

/** Current admission for automatic work; privacy and withdrawal confirmations bypass this guard. */
export async function pilotMemberAllowed(
  db: Queryable,
  admission: PilotAdmission | null | undefined,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  if (admission == null) return true;
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .innerJoin(channelLinks, eq(channelLinks.memberId, members.id))
    .where(
      and(
        eq(members.id, memberId),
        eq(members.familyId, familyId),
        isNull(members.leftAt),
        inArray(members.status, ["active", "paused"]),
        eq(members.language, "en"),
        isNull(families.deletedAt),
        eq(families.language, "en"),
        eq(channelLinks.channel, "telegram"),
        isNull(channelLinks.blockedAt),
        inArray(channelLinks.externalId, [...admission.telegramUserIds]),
      ),
    )
    .limit(1);
  return member !== undefined;
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
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.language === "en" &&
        row.familyLanguage === "en" &&
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
      row.language === "en" &&
      row.familyLanguage === "en" &&
      row.externalId !== null &&
      row.blockedAt === null &&
      pilotAllowsTelegram(admission, row.externalId),
  );
}

/** Starting a parent's light requires an approved, reachable Telegram organiser as well. */
export async function pilotCanActivate(
  db: Queryable,
  admission: PilotAdmission | null | undefined,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  if (admission == null) return true;
  const rows = await db
    .select({
      id: members.id,
      role: members.role,
      status: members.status,
      language: members.language,
      familyLanguage: families.language,
      externalId: channelLinks.externalId,
      linkedAt: channelLinks.linkedAt,
    })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .innerJoin(
      channelLinks,
      and(
        eq(channelLinks.memberId, members.id),
        eq(channelLinks.channel, "telegram"),
        isNull(channelLinks.blockedAt),
      ),
    )
    .where(and(eq(members.familyId, familyId), isNull(members.leftAt), isNull(families.deletedAt)));
  const approved = rows.filter(
    (row) =>
      row.language === "en" &&
      row.familyLanguage === "en" &&
      pilotAllowsTelegram(admission, row.externalId),
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
          eq(outbound.channel, "telegram"),
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
