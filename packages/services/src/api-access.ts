import type { Role } from "@vela/contracts";
import { families, members, users } from "@vela/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Queryable } from "./repo.ts";

export interface SessionIdentity {
  readonly authSubject: string;
  readonly sessionId: string;
}

export interface FamilyAccess {
  readonly userId: string;
  readonly memberId: string;
  readonly familyId: string;
  readonly role: Role;
}

export type FamilyAccessResult =
  | { kind: "granted"; access: FamilyAccess }
  | { kind: "not_found" }
  | { kind: "forbidden" };

const Uuid = z.uuid();

export async function authorizeFamilyAccess(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  requiredRole?: "organiser",
): Promise<FamilyAccessResult> {
  if (
    !Uuid.safeParse(familyId).success ||
    identity.authSubject.trim().length === 0 ||
    identity.sessionId.trim().length === 0
  ) {
    return { kind: "not_found" };
  }

  const [access] = await db
    .select({
      userId: users.id,
      memberId: members.id,
      familyId: families.id,
      role: members.role,
    })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        eq(users.authSubject, identity.authSubject),
        isNull(users.deletedAt),
        eq(members.familyId, familyId),
        isNull(families.deletedAt),
        inArray(members.status, ["active", "paused"]),
        isNull(members.leftAt),
      ),
    )
    .limit(1);

  if (access === undefined) {
    return { kind: "not_found" };
  }
  if (requiredRole === "organiser" && access.role !== "organiser") {
    return { kind: "forbidden" };
  }
  return { kind: "granted", access };
}
