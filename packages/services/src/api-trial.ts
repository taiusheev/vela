import {
  type ApiMutationResponse,
  type ApiTrial,
  StartTrial,
  TRIAL_DAYS,
  type TrialRefusal,
} from "@vela/contracts";
import { answers, members, type Subscription, subscriptions } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1_000;

export class TrialRefusedError extends Error {
  override readonly name = "TrialRefusedError";
  readonly reason: TrialRefusal;

  constructor(reason: TrialRefusal) {
    super(`Trial refused: ${reason}`);
    this.reason = reason;
  }
}

function notFound(): VelaError {
  return new VelaError("not_found", "Member not found");
}

function trialOf(subscription: Subscription): ApiTrial {
  return {
    member_id: subscription.memberId,
    status: subscription.status,
    trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
  };
}

/**
 * "Start the 30 days" (`POST /v1/families/:familyId/plan/trial`, API contract §7, spec A13 and
 * §16): a trial of Vela Light for one kept-light member, with no card, from her first answer on.
 * Organisers only, as the one who pays is an organiser. Her member row is locked first — the lock
 * her arrivals and asks take — so two organisers starting at once make one trial, and the second
 * is answered with it. A member who already has a subscription, in any state, is answered as it
 * stands: there is one trial per kept-light member, never a second.
 *
 * Nothing is charged and nothing is gated yet: the pilot is free (spec Appendix A), no plan check
 * exists in the services, and `families.plan` is left as it is, since nothing would turn it back
 * when the trial ends. The subscription row carries the trial, and You shows it.
 */
export async function startApiTrial(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = StartTrial.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = parsed.data.member_id.toLowerCase();
  const now = deps.clock.now();

  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "plan.trial:v1",
      input: { member_id: herId },
      familyId: family,
      memberId: herId,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
        // Before the scope check, whose own refusal of a member outside the family is not a 404.
        const [inFamily] = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.id, herId), eq(members.familyId, family)))
          .limit(1);
        if (inFamily === undefined) throw notFound();
      },
      mutate: async (tx) => {
        const [her] = await tx
          .select()
          .from(members)
          .where(and(eq(members.id, herId), eq(members.familyId, family)))
          .for("update");
        if (
          her === undefined ||
          her.leftAt !== null ||
          (her.status !== "active" && her.status !== "paused")
        ) {
          throw notFound();
        }
        const [existing] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.memberId, her.id))
          .limit(1);
        if (existing !== undefined) return { status: 200, body: trialOf(existing) };
        if (!her.lightOn) throw new TrialRefusedError("light_off");
        const [answered] = await tx
          .select({ id: answers.id })
          .from(answers)
          .where(eq(answers.memberId, her.id))
          .limit(1);
        if (answered === undefined) throw new TrialRefusedError("not_answered_yet");

        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
        const [created] = await tx
          .insert(subscriptions)
          .values({
            familyId: family,
            memberId: her.id,
            payerUserId: access.access.userId,
            provider: "trial",
            status: "trial",
            trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
            createdAt: now,
          })
          .returning();
        if (created === undefined) throw new Error("trial not written");
        await recordEvent(
          tx,
          {
            name: "trial_started",
            familyId: family,
            memberId: her.id,
            surface: "app",
            props: { source: "app", days: TRIAL_DAYS },
          },
          now,
        );
        return { status: 200, body: trialOf(created) };
      },
    },
  );
}
