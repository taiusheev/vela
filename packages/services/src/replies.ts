/**
 * Family replies and reactions in the group (spec §6, flows §3.11): a reply to an answer post is a
 * `replies` row read back to her in her next arrival; a reaction on it is a state, the member's
 * whole set at once, so re-tapping the same emoji never counts twice. Anything else in the group is
 * not this module's, and nothing about it is stored or logged.
 */
import { type InboundEvent, REACTION_KINDS, type ReplyKind } from "@vela/contracts";
import { canApply, nextExchangeState } from "@vela/core";
import { type Exchange, exchanges, type MessageRef, replies, type VelaTransaction } from "@vela/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { inboundExternalId, reactionKindsOf } from "./format.ts";
import { familyHasEnded, recordInboundMedia } from "./repo.ts";

/** A reply the family sees: text, a voice note, or a photo; a sticker or a video is not one. */
const REPLY_KIND_BY_INBOUND: ReadonlyMap<InboundEvent["kind"], ReplyKind> = new Map([
  ["text", "text"],
  ["voice", "voice"],
  ["image", "photo"],
]);

/** The exchange the answer post is about, when the ref names one of this family's. */
function exchangeIdOf(familyId: string, ref: MessageRef): string | null {
  return ref.purpose === "answer_post" && ref.familyId === familyId ? ref.exchangeId : null;
}

/** The exchange under its row lock, so two replies at once cannot both set `replied_at`. */
async function lockExchange(
  deps: Deps,
  tx: VelaTransaction,
  familyId: string,
  exchangeId: string,
): Promise<Exchange | null> {
  const [exchange] = await tx
    .select()
    .from(exchanges)
    .where(eq(exchanges.id, exchangeId))
    .for("update");
  if (exchange === undefined || exchange.familyId !== familyId) {
    deps.logger.warn("reply_exchange_missing", { familyId, exchangeId });
    return null;
  }
  return exchange;
}

/**
 * The first reply or reaction moves the exchange to `replied`; a later state keeps itself. An
 * exchange that cannot take a reply (never answered) keeps its state with a warning: the reply is
 * still worth reading back.
 */
async function markReplied(
  deps: Deps,
  tx: VelaTransaction,
  exchange: Exchange,
  now: Date,
): Promise<void> {
  if (!canApply(exchange.state, "reply")) {
    deps.logger.warn("reply_illegal_transition", {
      exchangeId: exchange.id,
      from: exchange.state,
    });
    return;
  }
  await tx
    .update(exchanges)
    .set({
      state: nextExchangeState(exchange.state, "reply"),
      repliedAt: exchange.repliedAt ?? now,
    })
    .where(eq(exchanges.id, exchange.id));
}

/**
 * A reply to an `answer_post` message (flows §3.11): one `replies` row, deduplicated on the platform
 * message, the exchange to `replied`, event `reply_posted`. Ignored once the family has ended.
 */
export async function handleGroupReply(
  deps: Deps,
  familyId: string,
  senderId: string,
  event: InboundEvent,
  ref: MessageRef,
): Promise<void> {
  const exchangeId = exchangeIdOf(familyId, ref);
  const kind = REPLY_KIND_BY_INBOUND.get(event.kind);
  if (exchangeId === null || kind === undefined) {
    return;
  }
  if (await familyHasEnded(deps.db, familyId)) {
    deps.logger.info("reply_ignored", { familyId, reason: "family_ended" });
    return;
  }
  const now = deps.clock.now();
  const text = event.text?.trim() ?? "";
  await deps.db.transaction(async (tx) => {
    const exchange = await lockExchange(deps, tx, familyId, exchangeId);
    if (exchange === null) {
      return;
    }
    const file =
      event.media === undefined
        ? null
        : await recordInboundMedia(tx, event.channel, {
            familyId,
            uploadedBy: senderId,
            ref: event.media,
            now,
          });
    const [reply] = await tx
      .insert(replies)
      .values({
        exchangeId,
        memberId: senderId,
        kind,
        text: text.length > 0 ? text : null,
        mediaId: file?.id ?? null,
        channel: event.channel,
        externalId: inboundExternalId(event),
        toRecipient: true,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: replies.id });
    if (reply === undefined) {
      deps.logger.info("reply_duplicate", { familyId, exchangeId });
      return;
    }
    await markReplied(deps, tx, exchange, now);
    await recordEvent(
      tx,
      {
        name: "reply_posted",
        familyId,
        memberId: senderId,
        exchangeId,
        surface: event.channel,
        props: { kind, by: senderId },
      },
      now,
    );
  });
}

/**
 * A member's reactions on an `answer_post` message (flows §3.11). The platform sends the member's
 * full set, so their reaction rows for the exchange are made equal to the mapped set in one
 * transaction: kinds added, kinds removed, and unmapped emoji ignored. A repeated update changes
 * nothing and records nothing.
 */
export async function handleReaction(
  deps: Deps,
  familyId: string,
  senderId: string,
  event: InboundEvent,
  ref: MessageRef,
): Promise<void> {
  const exchangeId = exchangeIdOf(familyId, ref);
  if (exchangeId === null || event.kind !== "reaction") {
    return;
  }
  if (await familyHasEnded(deps.db, familyId)) {
    deps.logger.info("reaction_ignored", { familyId, reason: "family_ended" });
    return;
  }
  const kinds = reactionKindsOf(event.reactions ?? []);
  const wanted: ReadonlySet<ReplyKind> = new Set(kinds);
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const exchange = await lockExchange(deps, tx, familyId, exchangeId);
    if (exchange === null) {
      return;
    }
    const current = await tx
      .select({ id: replies.id, kind: replies.kind })
      .from(replies)
      .where(
        and(
          eq(replies.exchangeId, exchangeId),
          eq(replies.memberId, senderId),
          inArray(replies.kind, [...REACTION_KINDS]),
        ),
      );
    const have = new Set(current.map((row) => row.kind));
    const removed = current.filter((row) => !wanted.has(row.kind));
    const added = kinds.filter((kind) => !have.has(kind));
    if (removed.length > 0) {
      await tx.delete(replies).where(
        inArray(
          replies.id,
          removed.map((row) => row.id),
        ),
      );
    }
    if (added.length === 0) {
      return;
    }
    await tx
      .insert(replies)
      .values(
        added.map((kind) => ({
          exchangeId,
          memberId: senderId,
          kind,
          channel: event.channel,
          toRecipient: true,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
    await markReplied(deps, tx, exchange, now);
    await recordEvent(
      tx,
      {
        name: "reply_posted",
        familyId,
        memberId: senderId,
        exchangeId,
        surface: event.channel,
        props: { kind: "reaction", added: added.length, removed: removed.length, by: senderId },
      },
      now,
    );
  });
}
