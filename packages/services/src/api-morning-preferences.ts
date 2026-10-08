import {
  type ApiMorningPreferences,
  type ApiMutationResponse,
  SetMorningPreferences,
} from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { type Member, members } from "@vela/db";
import { eq } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { morningTimeOn } from "./morning-time.ts";
import { markWakeDue, type Queryable } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function notFound() {
  return new VelaError("not_found", "Member not found");
}
function editable(member: Member | undefined, familyId: string): member is Member {
  return (
    member !== undefined &&
    member.familyId === familyId &&
    member.leftAt === null &&
    (member.status === "active" || member.status === "paused") &&
    (member.lightOn || member.lightConsentedAt !== null)
  );
}
function view(member: Member, now: Date): ApiMorningPreferences {
  const today = localDateOf(now, member.tz);
  return {
    member_id: member.id,
    display_name: member.displayName,
    time_zone: member.tz,
    arrival_time: member.pendingArrivalTime ?? member.arrivalTime,
    today_arrival_time: morningTimeOn(member, today),
    effective_from:
      member.pendingArrivalDate !== null && member.pendingArrivalDate > today
        ? member.pendingArrivalDate
        : null,
    language: member.language,
  };
}
export async function loadApiMorningPreferences(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
  now: Date,
): Promise<ApiMorningPreferences | null> {
  if (!UUID.test(memberId)) return null;
  const family = familyId.toLowerCase();
  const access = await authorizeFamilyAccess(db, identity, family, "organiser");
  if (access.kind !== "granted") return null;
  const [member] = await db.select().from(members).where(eq(members.id, memberId.toLowerCase()));
  return editable(member, family) ? view(member, now) : null;
}
/** Save under the same member lock as morning preparation/enqueue. Existing delivery remains intact. */
export async function setApiMorningPreferences(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  const parsed = SetMorningPreferences.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = memberId.toLowerCase();
  const after = nothingAfterCommit();
  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "morning.preferences:v1",
      input: parsed.data,
      familyId: family,
      memberId: herId,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
      },
      mutate: async (tx) => {
        const [member] = await tx.select().from(members).where(eq(members.id, herId)).for("update");
        if (!editable(member, family)) throw notFound();
        // Read time after acquiring the lock: a writer waiting across local midnight edits tomorrow.
        const now = deps.clock.now();
        const today = localDateOf(now, member.tz);
        const currentTime = morningTimeOn(member, today);
        const tomorrowTime = morningTimeOn(member, addDays(today, 1));
        const timeChanged = parsed.data.arrival_time !== tomorrowTime;
        const [saved] = await tx
          .update(members)
          .set({
            language: parsed.data.language,
            ...(timeChanged
              ? {
                  arrivalTime: currentTime,
                  pendingArrivalTime: parsed.data.arrival_time,
                  pendingArrivalDate: addDays(today, 1),
                }
              : {}),
          })
          .where(eq(members.id, herId))
          .returning();
        if (saved === undefined) throw notFound();
        if (member.status === "active" && timeChanged) {
          await markWakeDue(tx, herId, now);
          after.wakeMemberIds.push(herId);
        }
        return { status: 200, body: view(saved, now) };
      },
    },
  );
  return { ...result, after };
}
