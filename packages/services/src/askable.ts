/**
 * Who can be asked something for a morning: the one rule composing an ask and writing tomorrow's
 * suggestion share, so a suggestion is only ever written for a morning an ask could take.
 */
import type { Member } from "@vela/db";
import { familyHasEnded, type Queryable } from "./repo.ts";

/** A kept-light member who can be asked today: the light is hers, and she is here to answer. */
export function canBeAsked(member: Member, familyId: string): boolean {
  return (
    member.familyId === familyId &&
    member.leftAt === null &&
    member.status === "active" &&
    member.lightOn &&
    member.lightConsentedAt !== null
  );
}

/**
 * `canBeAsked`, in a family that has not ended: nothing is composed for a family whose deletion was
 * requested or whose kept-light member is left or deceased (flows §3.7).
 */
export async function isAskable(db: Queryable, member: Member): Promise<boolean> {
  return canBeAsked(member, member.familyId) && !(await familyHasEnded(db, member.familyId));
}
