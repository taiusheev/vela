import {
  type ApiLeft,
  type ApiMemberPause,
  type ApiMutationResponse,
  LeaveFamily,
  type MemberChangeRefusal,
  PauseMember,
} from "@vela/contracts";
import { families, type Member, members, users, type VelaTransaction } from "@vela/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MemberChangeRefusedError extends Error {
  override readonly name = "MemberChangeRefusedError";
  readonly reason: MemberChangeRefusal;

  constructor(reason: MemberChangeRefusal) {
    super(`Member change refused: ${reason}`);
    this.reason = reason;
  }
}

function notFound(): VelaError {
  return new VelaError("not_found", "Member not found");
}

function isKeptLight(member: Member): boolean {
  return member.lightOn || member.lightConsentedAt !== null;
}

/**
 * The caller's own row under its lock, after the family's organiser rows when the caller is one of
 * them. Every writer here takes the organisers in id order before anything else, so two organisers
 * pausing or leaving at once queue rather than deadlock, and the second reads the first's change.
 */
async function lockSelf(tx: VelaTransaction, memberId: string): Promise<Member> {
  const [row] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (row === undefined) throw notFound();
  if (row.role === "organiser") {
    await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.familyId, row.familyId), eq(members.role, "organiser")))
      .orderBy(asc(members.id))
      .for("update");
  }
  const [locked] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (locked === undefined) throw notFound();
  return locked;
}

/** Another organiser of the family who is active and has not left: someone who is still told. */
async function anotherActiveOrganiser(tx: VelaTransaction, self: Member): Promise<boolean> {
  const others = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.familyId, self.familyId),
        eq(members.role, "organiser"),
        eq(members.status, "active"),
        isNull(members.leftAt),
      ),
    );
  return others.some((other) => other.id !== self.id);
}

/**
 * Pause or resume oneself (`POST /v1/families/:familyId/members/:memberId/pause`, API contract §2,
 * spec A12). Only one's own membership: a member id that is not the caller's answers 404 like any
 * other. A paused member holds no turns and, as an organiser, is not told when her light goes
 * quiet, so the last active organiser may not pause (`last_organiser`); and a kept-light member
 * pauses in her own chat, where her arrivals, her words and her yes are handled together
 * (`kept_light`). Asking for the state one is already in answers it as it stands. It writes no
 * event: the events table names no pause yet, and adding one is a migration.
 */
export async function pauseApiMember(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = PauseMember.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const wanted = parsed.data.paused ? "paused" : "active";
  const self = memberId.toLowerCase();

  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "member.pause:v1",
      input: parsed.data,
      familyId: familyId.toLowerCase(),
      memberId: self,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, familyId);
        if (access.kind !== "granted" || access.access.memberId !== self) throw notFound();
      },
      mutate: async (tx) => {
        const member = await lockSelf(tx, self);
        if (member.status !== wanted) {
          if (isKeptLight(member)) throw new MemberChangeRefusedError("kept_light");
          if (
            wanted === "paused" &&
            member.role === "organiser" &&
            !(await anotherActiveOrganiser(tx, member))
          ) {
            throw new MemberChangeRefusedError("last_organiser");
          }
          await tx.update(members).set({ status: wanted }).where(eq(members.id, member.id));
        }
        const body: ApiMemberPause = { member_id: member.id, status: wanted };
        return { status: 200, body };
      },
    },
  );
}

/**
 * Leave the family (`POST /v1/families/:familyId/members/:memberId/left`, API contract §2, spec
 * A12): one's own membership becomes `left`, out of the turn rotation, and retention deletes it
 * thirty days on, as when the founder marks someone left. The same two refusals as pausing hold.
 *
 * Authorization is the service's own, not the family check's: once the caller has left they are no
 * longer a live member, and the family check would refuse the replay of the very request that made
 * them leave. So `authorize` accepts the caller's own row in a family that still exists, live or
 * already left, and `mutate` answers a member who has left as it stands.
 */
export async function leaveApiFamily(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!LeaveFamily.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const self = memberId.toLowerCase();
  const family = familyId.toLowerCase();
  const now = deps.clock.now();

  return runApiMutation(
    deps,
    identity,
    { key, operation: "member.leave:v1", input: {}, familyId: family, memberId: self },
    {
      authorize: async (tx) => {
        const [own] = await tx
          .select({ id: members.id })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .innerJoin(families, eq(families.id, members.familyId))
          .where(
            and(
              eq(members.id, self),
              eq(members.familyId, family),
              inArray(members.status, ["active", "paused", "left"]),
              eq(users.authSubject, identity.authSubject),
              isNull(users.deletedAt),
              isNull(families.deletedAt),
            ),
          )
          .limit(1);
        if (own === undefined) throw notFound();
      },
      mutate: async (tx) => {
        const member = await lockSelf(tx, self);
        let leftAt = member.leftAt;
        if (member.status !== "left" || leftAt === null) {
          if (member.status !== "active" && member.status !== "paused") throw notFound();
          if (isKeptLight(member)) throw new MemberChangeRefusedError("kept_light");
          if (member.role === "organiser" && !(await anotherActiveOrganiser(tx, member))) {
            throw new MemberChangeRefusedError("last_organiser");
          }
          await tx
            .update(members)
            .set({ status: "left", leftAt: now, turnsIn: false })
            .where(eq(members.id, member.id));
          await recordEvent(
            tx,
            {
              name: "member_left",
              familyId: member.familyId,
              memberId: member.id,
              surface: "app",
              props: { source: "app", role: member.role, kept_light: false },
            },
            now,
          );
          leftAt = now;
        }
        const body: ApiLeft = { member_id: member.id, left_at: leftAt.toISOString() };
        return { status: 200, body };
      },
    },
  );
}
