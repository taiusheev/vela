/**
 * Withdrawing an ask (spec §19: "The asker withdraws after delivery: not possible; before
 * delivery, the composer picks the next item"). The one who asked takes it back while her morning
 * is not prepared yet, under her member row's lock, the lock `prepareDay` takes, so an ask is never
 * both withdrawn and on its way. Once her morning is prepared it is too late, and the API says so.
 */
import type { ApiMutationResponse } from "@vela/contracts";
import { exchanges, members } from "@vela/db";
import { eq } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Her morning is already prepared with this ask, or it was sent: it can no longer be withdrawn. */
export class WithdrawTooLateError extends Error {
  override readonly name = "WithdrawTooLateError";
  readonly reason = "too_late" as const;

  constructor() {
    super("Withdraw refused: too_late");
  }
}

function notFound(): VelaError {
  return new VelaError("not_found", "Exchange not found");
}

/**
 * `POST /v1/exchanges/:exchangeId/withdraw`: the asker, a live member of the family, withdraws
 * their ask while it is `composed`. Withdrawn already answers as it stands; anyone else's ask, or
 * one of another family, is 404; a prepared or sent one is `WithdrawTooLateError`.
 */
export async function withdrawApiAsk(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  exchangeId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!UUID.test(exchangeId)) throw notFound();
  const id = exchangeId.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: exchanges.familyId, recipientId: exchanges.recipientId })
    .from(exchanges)
    .where(eq(exchanges.id, id))
    .limit(1);
  const now = deps.clock.now();
  const askerOf = async (tx: Parameters<typeof authorizeFamilyAccess>[0]) => {
    if (found === undefined) throw notFound();
    const access = await authorizeFamilyAccess(tx, identity, found.familyId);
    if (access.kind !== "granted") throw notFound();
    return access.access.memberId;
  };
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "ask.withdraw:v1",
      input: { exchange_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.recipientId }),
    },
    {
      authorize: async (tx) => {
        await askerOf(tx);
      },
      mutate: async (tx) => {
        const caller = await askerOf(tx);
        if (found === undefined) throw notFound();
        // Her row first, as preparing her morning takes it, then the ask as it stands under it.
        await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.id, found.recipientId))
          .for("update");
        const [ask] = await tx.select().from(exchanges).where(eq(exchanges.id, id)).limit(1);
        if (ask === undefined || ask.askerId !== caller) throw notFound();
        if (ask.state !== "withdrawn") {
          if (ask.state !== "composed") throw new WithdrawTooLateError();
          await tx.update(exchanges).set({ state: "withdrawn" }).where(eq(exchanges.id, id));
          await recordEvent(
            tx,
            {
              name: "ask_withdrawn",
              familyId: ask.familyId,
              memberId: caller,
              exchangeId: id,
              surface: "app",
            },
            now,
          );
        }
        return { status: 200, body: { id, state: "withdrawn" } };
      },
    },
  );
}
