import {
  type ApiMutationResponse,
  ApiReply,
  ComposeReply,
  EXCHANGE_LIST_DAYS,
  type ReplyRefusal,
} from "@vela/contracts";
import { canApply, nextExchangeState } from "@vela/core";
import { type Exchange, exchanges, members, replies, type VelaTransaction } from "@vela/db";
import { eq } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { familyHasEnded, readBackExchangeId } from "./repo.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A reply that cannot be written, and why: `not_answered` (409) when she has not answered yet, so
 * there is nothing to reply to; `her_own` (403) when she replies to her own exchange, which would
 * read her own words back to her tomorrow. The Telegram path keeps such a reply and logs a warning;
 * this one has no logger to warn with, so it says no instead.
 */
export class ReplyRefusedError extends Error {
  override readonly name = "ReplyRefusedError";
  readonly reason: ReplyRefusal;

  constructor(reason: ReplyRefusal) {
    super(`Reply refused: ${reason}`);
    this.reason = reason;
  }
}

/** The exchange under its row lock, so two replies at once cannot both stamp `replied_at`. */
async function lockExchange(tx: VelaTransaction, exchangeId: string): Promise<Exchange | null> {
  const [exchange] = await tx
    .select()
    .from(exchanges)
    .where(eq(exchanges.id, exchangeId))
    .for("update");
  return exchange ?? null;
}

/**
 * Reply to an exchange (`POST /v1/exchanges/:exchangeId/replies`, API contract §4, spec §14.1 A8):
 * one `replies` row in the family's words, the exchange moved to `replied`, event `reply_posted`.
 *
 * The path names an exchange, not a family, so the family is read from the exchange — under its
 * row lock, in `authorize`, which `runApiMutation` runs on every attempt including a replay. Every
 * refusal a stranger might see is made there: an exchange that does not exist, belongs to a family
 * the caller is not live in, never reached her, was withdrawn, or has aged out of the list all
 * answer 404 alike. The lock is also what makes the state change safe: two members replying at
 * once are not serialised by the actor lock `runApiMutation` takes, only by this row.
 *
 * Words only, `to_recipient` true, channel `app`. The mutation sends nothing and wakes nothing: a
 * reply reaches her through the next arrival's read-back, which reads the database, and the
 * callback could not reach the gateway or her scheduler if it tried (code design §8).
 */
export async function replyToApiExchange(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  exchangeId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = ComposeReply.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(exchangeId)) throw new VelaError("not_found", "Exchange not found");
  const reply = parsed.data;
  const now = deps.clock.now();
  const floor = new Date(now.getTime() - EXCHANGE_LIST_DAYS * DAY_MS);
  let replierId = "";

  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "exchange.reply:v1",
      // The exchange is in the fingerprint, so one key cannot be spent on two exchanges.
      input: { exchange_id: exchangeId.toLowerCase(), text: reply.text },
    },
    {
      authorize: async (tx) => {
        const exchange = await lockExchange(tx, exchangeId);
        if (
          exchange === null ||
          exchange.state === "withdrawn" ||
          exchange.deliveredAt === null ||
          exchange.deliveredAt.getTime() < floor.getTime()
        ) {
          throw new VelaError("not_found", "Exchange not found");
        }
        if (await familyHasEnded(tx, exchange.familyId)) {
          throw new VelaError("not_found", "Exchange not found");
        }
        const access = await authorizeFamilyAccess(tx, identity, exchange.familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Exchange not found");
        if (access.access.memberId === exchange.recipientId) {
          throw new ReplyRefusedError("her_own");
        }
        replierId = access.access.memberId;
      },
      mutate: async (tx) => {
        // Already locked in `authorize`; read again so the state is the one under the lock.
        const exchange = await lockExchange(tx, exchangeId);
        if (exchange === null) throw new VelaError("not_found", "Exchange not found");
        if (!canApply(exchange.state, "reply")) throw new ReplyRefusedError("not_answered");

        const [row] = await tx
          .insert(replies)
          .values({
            exchangeId: exchange.id,
            memberId: replierId,
            kind: "text",
            text: reply.text,
            channel: "app",
            toRecipient: true,
            createdAt: now,
          })
          .returning();
        if (row === undefined) throw new Error("reply insert returned no row");

        await tx
          .update(exchanges)
          .set({
            state: nextExchangeState(exchange.state, "reply"),
            repliedAt: exchange.repliedAt ?? now,
          })
          .where(eq(exchanges.id, exchange.id));

        await recordEvent(
          tx,
          {
            name: "reply_posted",
            familyId: exchange.familyId,
            memberId: replierId,
            exchangeId: exchange.id,
            surface: "app",
            props: { kind: "text", by: replierId },
          },
          now,
        );

        const [replier] = await tx
          .select({ displayName: members.displayName })
          .from(members)
          .where(eq(members.id, replierId))
          .limit(1);

        return {
          status: 201,
          body: ApiReply.parse({
            id: row.id,
            exchange_id: exchange.id,
            from: replier?.displayName ?? "",
            kind: row.kind,
            text: row.text,
            created_at: row.createdAt.toISOString(),
            reaches_her: (await readBackExchangeId(tx, exchange.recipientId)) === exchange.id,
          }),
        };
      },
    },
  );
}
