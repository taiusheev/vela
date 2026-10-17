import {
  type ApiMorningPreferences,
  type ApiMutationResponse,
  SetMorningPreferences,
} from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { type Member, members } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import { canWaitForHerYes } from "./askable.ts";
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
    (canWaitForHerYes(member, familyId) ||
      ((member.status === "active" || member.status === "paused") &&
        (member.lightOn || member.lightConsentedAt !== null)))
  );
}
/** The caller and the environment's switch, for the "send as me" part of the view. */
interface SendAsMeView {
  callerId: string;
  available: boolean;
}

/**
 * The name of the organiser whose name Vela's suggestion goes in, when that is not the caller and
 * they are still an active organiser of her family: what the caller is told instead of a switch
 * that looks off while someone else's name is used.
 */
async function otherSigner(
  db: Queryable,
  member: Member,
  callerId: string,
): Promise<string | null> {
  const signerId = member.suggestionsSignedBy;
  if (signerId === null || signerId === callerId) return null;
  const [signer] = await db
    .select({ name: members.displayName })
    .from(members)
    .where(
      and(
        eq(members.id, signerId),
        eq(members.familyId, member.familyId),
        eq(members.role, "organiser"),
        eq(members.status, "active"),
        isNull(members.leftAt),
      ),
    );
  return signer?.name ?? null;
}

function view(
  member: Member,
  now: Date,
  sendAsMe: SendAsMeView,
  sentAs: string | null,
): ApiMorningPreferences {
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
    send_as_me_available: sendAsMe.available,
    send_as_me: member.suggestionsSignedBy === sendAsMe.callerId,
    sent_as: sentAs,
  };
}
export async function loadApiMorningPreferences(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
  now: Date,
  options: { sendAsMe?: boolean } = {},
): Promise<ApiMorningPreferences | null> {
  if (!UUID.test(memberId)) return null;
  const family = familyId.toLowerCase();
  const access = await authorizeFamilyAccess(db, identity, family, "organiser");
  if (access.kind !== "granted") return null;
  const [member] = await db.select().from(members).where(eq(members.id, memberId.toLowerCase()));
  if (!editable(member, family)) return null;
  const callerId = access.access.memberId;
  return view(
    member,
    now,
    { callerId, available: options.sendAsMe === true },
    await otherSigner(db, member, callerId),
  );
}

/**
 * Her row's signer after the caller's choice: their own id when they turn it on, none when they
 * turn off what they had on, and otherwise as it was, so one organiser never stops another's choice
 * by saving a time. A choice to turn it on where the environment does not allow it is refused.
 */
function signerAfter(member: Member, callerId: string, choice: boolean | undefined): string | null {
  if (choice === true) return callerId;
  if (choice === false && member.suggestionsSignedBy === callerId) return null;
  return member.suggestionsSignedBy;
}
/** Save under the same member lock as morning preparation/enqueue. Existing delivery remains intact. */
export async function setApiMorningPreferences(
  deps: Pick<Deps, "db" | "clock"> & { sendAsMe?: boolean },
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  const parsed = SetMorningPreferences.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (parsed.data.send_as_me === true && deps.sendAsMe !== true)
    throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = memberId.toLowerCase();
  const after = nothingAfterCommit();
  let callerId = "";
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
        callerId = access.access.memberId;
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
            suggestionsSignedBy: signerAfter(member, callerId, parsed.data.send_as_me),
            ...(canWaitForHerYes(member, family)
              ? {
                  arrivalTime: parsed.data.arrival_time,
                  pendingArrivalTime: null,
                  pendingArrivalDate: null,
                }
              : timeChanged
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
        return {
          status: 200,
          body: view(
            saved,
            now,
            { callerId, available: deps.sendAsMe === true },
            await otherSigner(tx, saved, callerId),
          ),
        };
      },
    },
  );
  return { ...result, after };
}
