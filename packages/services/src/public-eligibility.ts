import {
  PUBLIC_ELIGIBILITY_TERMS,
  PUBLIC_ELIGIBILITY_TEXT,
  PUBLIC_ELIGIBILITY_VERSION,
  PublicEligibilityChoice,
  PublicEligibilityRecord,
} from "@vela/contracts";
import { channelLinks, families, members, users, type VelaTransaction } from "@vela/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SessionIdentity } from "./api-access.ts";
import { lockAccount } from "./api-account-writes.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";

/** Server-trusted identity only: never construct this union from a request body or organiser input. */
export type OwnEligibilityActor =
  | { kind: "app"; identity: SessionIdentity }
  | { kind: "telegram"; externalId: string; conversationId: string; updateId: string };
/** No production caller exists. An absent switch or missing review version refuses new records. */
export interface EligibilityReviewConfig {
  enabled: boolean;
  environment: "synthetic-review";
  policyVersion: string;
}
export const PUBLIC_ELIGIBILITY_DEFAULT: Readonly<EligibilityReviewConfig> = Object.freeze({
  enabled: false,
  environment: "synthetic-review",
  policyVersion: PUBLIC_ELIGIBILITY_VERSION,
});

type EligibilityDeps = Pick<Deps, "db" | "clock"> & { eligibility?: EligibilityReviewConfig };
function identityOf(actor: OwnEligibilityActor): SessionIdentity {
  if (actor.kind === "app") return actor.identity;
  // Telegram identities must come from a verified private-chat update. Groups are never people.
  if (
    actor.conversationId !== actor.externalId ||
    !/^[1-9][0-9]{0,19}$/.test(actor.externalId) ||
    !/^[0-9]{1,20}$/.test(actor.updateId)
  ) {
    throw new ApiIdempotencyError("invalid");
  }
  return { authSubject: `eligibility:telegram:${actor.externalId}`, sessionId: actor.updateId };
}
async function ownSubject(tx: VelaTransaction, actor: OwnEligibilityActor) {
  if (actor.kind === "app") {
    const account = await lockAccount(tx, actor.identity.authSubject);
    if (!account) throw new VelaError("not_found", "Account not found");
    return { kind: "user" as const, id: account.id };
  }
  const [member] = await tx
    .select({ id: members.id })
    .from(members)
    .innerJoin(channelLinks, eq(channelLinks.memberId, members.id))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        eq(channelLinks.channel, "telegram"),
        eq(channelLinks.externalId, actor.externalId),
        isNull(channelLinks.blockedAt),
        isNull(members.leftAt),
        inArray(members.status, ["invited", "active", "paused"]),
        isNull(families.deletedAt),
      ),
    )
    .for("update", { of: members });
  if (!member) throw new VelaError("not_found", "Participant not found");
  return { kind: "member" as const, id: member.id };
}

/** Current self declaration, not an admission decision, parent consent or historic agreement ledger. */
export async function recordOwnPublicEligibility(
  deps: EligibilityDeps,
  actor: OwnEligibilityActor,
  key: string,
  input: unknown,
) {
  const config = deps.eligibility ?? PUBLIC_ELIGIBILITY_DEFAULT;
  if (
    !config.enabled ||
    config.environment !== "synthetic-review" ||
    config.policyVersion !== PUBLIC_ELIGIBILITY_VERSION
  ) {
    throw new VelaError("not_found", "Eligibility review unavailable");
  }
  const parsed = PublicEligibilityChoice.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const choice = parsed.data;
  const identity = identityOf(actor);
  return runApiMutation(
    deps,
    identity,
    { key, operation: "eligibility.review:v1", input: choice },
    {
      authorize: async (tx) => {
        await ownSubject(tx, actor);
      },
      mutate: async (tx) => {
        const subject = await ownSubject(tx, actor);
        const record = PublicEligibilityRecord.parse({
          ...choice,
          source: actor.kind === "app" ? "app_account" : "telegram_self",
          actor_sha256: await sha256Hex(`${actor.kind}:${identity.authSubject}`),
          recorded_at: deps.clock.now().toISOString(),
          notice_sha256: await sha256Hex(PUBLIC_ELIGIBILITY_TEXT[choice.language]),
          terms_sha256: await sha256Hex(PUBLIC_ELIGIBILITY_TERMS[choice.language]),
          status: "review_only",
        });
        if (subject.kind === "user")
          await tx.update(users).set({ publicEligibility: record }).where(eq(users.id, subject.id));
        else
          await tx
            .update(members)
            .set({ publicEligibility: record })
            .where(eq(members.id, subject.id));
        // Do not duplicate personal declarations in the 24-hour idempotency receipt.
        return { status: 200, body: { recorded: true, status: "review_only" } };
      },
    },
  );
}

export async function loadOwnPublicEligibility(
  deps: Pick<Deps, "db">,
  actor: OwnEligibilityActor,
): Promise<PublicEligibilityRecord | null> {
  const identity = identityOf(actor);
  if (!identity.authSubject.trim() || !identity.sessionId.trim())
    throw new ApiIdempotencyError("invalid");
  return deps.db.transaction(async (tx) => {
    const subject = await ownSubject(tx, actor);
    const [row] =
      subject.kind === "user"
        ? await tx
            .select({ record: users.publicEligibility })
            .from(users)
            .where(eq(users.id, subject.id))
        : await tx
            .select({ record: members.publicEligibility })
            .from(members)
            .where(eq(members.id, subject.id));
    if (!row?.record) return null;
    // Invalid/old data is not current proof and never becomes an eligible status by truthiness.
    const parsed = PublicEligibilityRecord.safeParse(row.record);
    return parsed.success &&
      parsed.data.actor_sha256 === (await sha256Hex(`${actor.kind}:${identity.authSubject}`))
      ? parsed.data
      : null;
  });
}

/** Clearing remains available while new collection is off. It does not change separate family permissions. */
export async function clearOwnPublicEligibility(
  deps: EligibilityDeps,
  actor: OwnEligibilityActor,
  key: string,
) {
  return runApiMutation(
    deps,
    identityOf(actor),
    { key, operation: "eligibility.clear:v1", input: {} },
    {
      authorize: async (tx) => {
        await ownSubject(tx, actor);
      },
      mutate: async (tx) => {
        const subject = await ownSubject(tx, actor);
        if (subject.kind === "user")
          await tx.update(users).set({ publicEligibility: null }).where(eq(users.id, subject.id));
        else
          await tx
            .update(members)
            .set({ publicEligibility: null })
            .where(eq(members.id, subject.id));
        return { status: 200, body: { cleared: true } };
      },
    },
  );
}
