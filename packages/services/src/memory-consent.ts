/** Privacy withdrawal only. No acceptance, activation or caller yet. */
import { consents, memoryCandidates, memoryKeeps } from "@vela/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { lockMemoryOwner } from "./memory-keeps.ts";

/**
 * Stop only the authenticated author's rich memories, regardless of payment/configuration.
 * The member lock serialises with proposals, keeps and new purpose-consent records.
 * Replays confirm the original operation, not current consent; clients must refresh state.
 */
export async function withdrawOwnMemoryConsent(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
) {
  if (!z.uuid().safeParse(familyId).success) throw new ApiIdempotencyError("invalid");
  let memberId = "";
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.withdraw:v1", familyId, input: {} },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Memory not found");
        memberId = access.access.memberId;
        await lockMemoryOwner(tx, identity, familyId, memberId, "update");
      },
      mutate: async (tx) => {
        // No new consent is invented, including when no purpose proof exists yet.
        await tx
          .update(consents)
          .set({ withdrawnAt: deps.clock.now() })
          .where(
            and(
              eq(consents.memberId, memberId),
              inArray(consents.kind, ["rich_memories", "memory_keep"]),
              eq(consents.answer, "yes"),
              isNull(consents.withdrawnAt),
            ),
          );
        // The proof trigger clears active keeps too. Explicit deletion covers removed tombstones
        // and pending selections; neither can be revived by an old client choice after withdrawal.
        await tx.delete(memoryKeeps).where(eq(memoryKeeps.memberId, memberId));
        await tx.delete(memoryCandidates).where(eq(memoryCandidates.memberId, memberId));
        return { status: 200, body: { withdrawn: true } };
      },
    },
  );
}
