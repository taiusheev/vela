import {
  type ApiMutationResponse,
  ApiReply,
  ComposeReply,
  EXCHANGE_LIST_DAYS,
  type ReplyRefusal,
} from "@vela/contracts";
import { canApply, nextExchangeState } from "@vela/core";
import { type Exchange, exchanges, media, members, replies, type VelaTransaction } from "@vela/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
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
 * read her own words back to her tomorrow; `voice_missing` or `photo_missing` (404) when the voice or
 * photo it names is not the replier's own upload in her family, or is gone. The Telegram path keeps such a reply and logs
 * a warning; this one has no logger to warn with, so it says no instead.
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
 * Words or a reaction, `to_recipient` true, channel `app`. A reaction is one row of its kind per
 * member and exchange (`replies_one_reaction_idx`): a second tap on the same kind answers 200 with
 * the row already there, changing nothing and recording nothing. The mutation sends nothing and wakes nothing: a
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
      input:
        "text" in reply
          ? { exchange_id: exchangeId.toLowerCase(), text: reply.text }
          : "voice" in reply
            ? { exchange_id: exchangeId.toLowerCase(), voice: reply.voice.toLowerCase() }
            : "photo" in reply
              ? { exchange_id: exchangeId.toLowerCase(), photo: reply.photo.toLowerCase() }
              : { exchange_id: exchangeId.toLowerCase(), reaction: reply.reaction },
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

        const kind =
          "text" in reply
            ? "text"
            : "voice" in reply
              ? "voice"
              : "photo" in reply
                ? "photo"
                : reply.reaction;
        let mediaId: string | null = null;
        if ("voice" in reply || "photo" in reply) {
          // Only the replier's own upload from the app, kept in this family and not yet deleted.
          const voice = "voice" in reply;
          const [file] = await tx
            .select({ id: media.id })
            .from(media)
            .where(
              and(
                eq(media.id, voice ? reply.voice : reply.photo),
                eq(media.familyId, exchange.familyId),
                eq(media.uploadedBy, replierId),
                eq(media.kind, voice ? "audio" : "image"),
                isNull(media.channel),
                isNotNull(media.storageKey),
              ),
            )
            .limit(1);
          if (file === undefined) {
            throw new ReplyRefusedError(voice ? "voice_missing" : "photo_missing");
          }
          mediaId = file.id;
        }
        const [inserted] = await tx
          .insert(replies)
          .values({
            exchangeId: exchange.id,
            memberId: replierId,
            kind,
            mediaId,
            text: "text" in reply ? reply.text : null,
            channel: "app",
            toRecipient: true,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning();
        const reaches = async () =>
          (await readBackExchangeId(tx, exchange.recipientId)) === exchange.id;
        const [replier] = await tx
          .select({ displayName: members.displayName })
          .from(members)
          .where(eq(members.id, replierId))
          .limit(1);
        if (inserted === undefined) {
          // Only a reaction can meet its own row: this member already gave this kind here.
          const [held] = await tx
            .select()
            .from(replies)
            .where(
              and(
                eq(replies.exchangeId, exchange.id),
                eq(replies.memberId, replierId),
                eq(replies.kind, kind),
              ),
            )
            .limit(1);
          if (held === undefined) throw new Error("reply insert returned no row");
          return {
            status: 200,
            body: ApiReply.parse({
              id: held.id,
              exchange_id: exchange.id,
              from: replier?.displayName ?? "",
              kind: held.kind,
              text: held.text,
              created_at: held.createdAt.toISOString(),
              reaches_her: await reaches(),
            }),
          };
        }
        const row = inserted;

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
            props: {
              kind: kind === "text" || kind === "voice" || kind === "photo" ? kind : "reaction",
              by: replierId,
            },
          },
          now,
        );

        return {
          status: 201,
          body: ApiReply.parse({
            id: row.id,
            exchange_id: exchange.id,
            from: replier?.displayName ?? "",
            kind: row.kind,
            text: row.text,
            created_at: row.createdAt.toISOString(),
            reaches_her: await reaches(),
          }),
        };
      },
    },
  );
}
