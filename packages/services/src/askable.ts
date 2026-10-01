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
 * A kept-light member invited and not yet answered (spec A2): the organiser's first ask can wait for
 * her, as a "whenever" ask in words, which her first morning after a yes takes (`chooseAsk` in
 * core). A No deletes her and, with her, the ask (flows §3.2); a light she once said yes to and is
 * off now is `canBeAsked`'s to refuse, not this.
 */
export function canWaitForHerYes(member: Member, familyId: string): boolean {
  return (
    member.familyId === familyId &&
    member.leftAt === null &&
    member.role === "member" &&
    member.status === "invited" &&
    member.lightConsentedAt === null
  );
}

/**
 * `canBeAsked`, in a family that has not ended: nothing is composed for a family whose deletion was
 * requested or whose kept-light member is left or deceased (flows §3.7).
 */
export async function isAskable(db: Queryable, member: Member): Promise<boolean> {
  return canBeAsked(member, member.familyId) && !(await familyHasEnded(db, member.familyId));
}
