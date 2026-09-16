/**
 * What a send changes once it has succeeded or finally failed, by outbound kind (flows §3.4, §3.7,
 * §3.8, §3.12). The gateway calls these inside the transaction that records the send; they return
 * the notices to enqueue and the members whose scheduler must look again, and the gateway does both,
 * the wakes only after the transaction has committed, so a tick never reads state that is about to
 * appear. Nothing here imports a flow module: the effects are the gateway's own.
 */
import { LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { canApply, nextExchangeState, outboundKey } from "@vela/core";
import {
  channelLinks,
  exchanges,
  type Family,
  type Member,
  type Outbound,
  quietEvents,
  replies,
  turns,
  type VelaTransaction,
} from "@vela/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { channelLabel } from "./format.ts";
import type { OutboundRequest } from "./gateway.ts";
import { activeOrganisersWithLinks, markWakeDue } from "./repo.ts";

export const ArrivalEffect = z.object({
  exchangeId: z.uuid(),
  late: z.boolean(),
  /** The replies read back in this arrival; stamped once it is sent. */
  readBackReplyIds: z.array(z.uuid()),
  /** The exchange those replies belong to, which moves to `read_back`. */
  previousExchangeId: z.uuid().nullable(),
});
export type ArrivalEffect = z.infer<typeof ArrivalEffect>;

export const RepeatEffect = z.object({ exchangeId: z.uuid() });
export type RepeatEffect = z.infer<typeof RepeatEffect>;

export const TurnPromptEffect = z.object({
  familyId: z.uuid(),
  recipientId: z.uuid(),
  localDay: LocalDate,
});
export type TurnPromptEffect = z.infer<typeof TurnPromptEffect>;

export const QuietNoticeEffect = z.object({
  quietEventId: z.uuid(),
  /** The event's notify count once this notice is out: the round it belongs to. */
  notifyCount: z.number().int().nonnegative(),
  /** The organiser this notice tells, added to `notified_member_ids`. */
  notifiedMemberId: z.uuid(),
});
export type QuietNoticeEffect = z.infer<typeof QuietNoticeEffect>;

/** The kinds whose send changes state beyond the outbound row, and what each needs to know. */
export interface EffectByKind {
  arrival: ArrivalEffect;
  repeat: RepeatEffect;
  turn_prompt: TurnPromptEffect;
  quiet_notice: QuietNoticeEffect;
}

interface RowContext {
  row: Outbound;
  member: Member;
  family: Family;
  /** The effect stored with the row, parsed here by the row's kind. */
  effect: unknown;
}

export interface SentContext extends RowContext {
  sentAt: Date;
  primaryMessageId: string;
}

export interface FailedContext extends RowContext {
  /** The `ChannelSendError` code, or the gateway's own reason. */
  code: string;
  attempts: number;
  failedAt: Date;
}

export interface SentOutcome {
  wakeMemberIds: string[];
}

export interface FailedOutcome extends SentOutcome {
  notices: OutboundRequest[];
}

function parseEffect<T>(deps: Deps, schema: z.ZodType<T>, ctx: RowContext): T | null {
  const parsed = schema.safeParse(ctx.effect);
  if (parsed.success) {
    return parsed.data;
  }
  // The message is already out; the row keeps its send and the state change is lost, which is
  // worth an error in the logs rather than an exception that would make the queue send it again.
  deps.logger.error("gateway_effect_invalid", { outboundId: ctx.row.id, kind: ctx.row.kind });
  return null;
}

async function arrivalSent(
  deps: Deps,
  tx: VelaTransaction,
  ctx: SentContext,
): Promise<SentOutcome> {
  const effect = parseEffect(deps, ArrivalEffect, ctx);
  if (effect === null) {
    return { wakeMemberIds: [] };
  }
  const { row, member, family, sentAt } = ctx;
  const [exchange] = await tx
    .select()
    .from(exchanges)
    .where(eq(exchanges.id, effect.exchangeId))
    .for("update");
  if (exchange === undefined) {
    deps.logger.error("gateway_effect_missing_exchange", { outboundId: row.id, kind: row.kind });
    return { wakeMemberIds: [] };
  }
  const state = canApply(exchange.state, "deliver")
    ? nextExchangeState(exchange.state, "deliver")
    : exchange.state;
  if (state === exchange.state && exchange.state !== "delivered") {
    deps.logger.warn("gateway_effect_illegal_transition", {
      exchangeId: exchange.id,
      from: exchange.state,
      event: "deliver",
    });
  }
  await tx
    .update(exchanges)
    .set({
      state,
      deliveredAt: exchange.deliveredAt ?? sentAt,
      deliveryLate: effect.late,
    })
    .where(eq(exchanges.id, exchange.id));
  await recordEvent(
    tx,
    {
      name: "arrival_delivered",
      familyId: family.id,
      memberId: member.id,
      exchangeId: exchange.id,
      props: { late: effect.late, attempts: row.attempts + 1, type: exchange.type },
    },
    sentAt,
  );

  if (effect.readBackReplyIds.length > 0) {
    await tx
      .update(replies)
      .set({ readBackAt: sentAt })
      .where(and(inArray(replies.id, effect.readBackReplyIds), isNull(replies.readBackAt)));
  }
  if (effect.previousExchangeId !== null) {
    const [previous] = await tx
      .select()
      .from(exchanges)
      .where(eq(exchanges.id, effect.previousExchangeId))
      .for("update");
    if (previous !== undefined && canApply(previous.state, "read_back")) {
      await tx
        .update(exchanges)
        .set({
          state: nextExchangeState(previous.state, "read_back"),
          readBackAt: previous.readBackAt ?? sentAt,
        })
        .where(eq(exchanges.id, previous.id));
      await recordEvent(
        tx,
        {
          name: "readback_delivered",
          familyId: family.id,
          memberId: member.id,
          exchangeId: previous.id,
          props: { replies: effect.readBackReplyIds.length },
        },
        sentAt,
      );
    }
  }
  // Her ladder (the repeat, the quiet threshold) starts from the delivery, so the scheduler must
  // decide again now that delivered_at is known.
  await markWakeDue(tx, member.id, sentAt);
  return { wakeMemberIds: [member.id] };
}

async function repeatSent(deps: Deps, tx: VelaTransaction, ctx: SentContext): Promise<void> {
  const effect = parseEffect(deps, RepeatEffect, ctx);
  if (effect === null) {
    return;
  }
  await tx
    .update(exchanges)
    .set({ repeatedAt: sql`coalesce(${exchanges.repeatedAt}, ${ctx.sentAt}::timestamptz)` })
    .where(eq(exchanges.id, effect.exchangeId));
  await recordEvent(
    tx,
    {
      name: "repeat_sent",
      familyId: ctx.family.id,
      memberId: ctx.member.id,
      exchangeId: effect.exchangeId,
    },
    ctx.sentAt,
  );
}

async function turnPromptSent(deps: Deps, tx: VelaTransaction, ctx: SentContext): Promise<void> {
  const effect = parseEffect(deps, TurnPromptEffect, ctx);
  if (effect === null) {
    return;
  }
  await tx
    .update(turns)
    .set({
      promptedAt: sql`coalesce(${turns.promptedAt}, ${ctx.sentAt}::timestamptz)`,
      promptMessageId: ctx.primaryMessageId,
    })
    .where(
      and(
        eq(turns.familyId, effect.familyId),
        eq(turns.localDay, effect.localDay),
        eq(turns.recipientId, effect.recipientId),
      ),
    );
  await recordEvent(
    tx,
    {
      name: "turn_prompt_sent",
      familyId: effect.familyId,
      memberId: effect.recipientId,
      props: { date: effect.localDay, holder: ctx.row.memberId },
    },
    ctx.sentAt,
  );
}

async function quietNoticeSent(deps: Deps, tx: VelaTransaction, ctx: SentContext): Promise<void> {
  const effect = parseEffect(deps, QuietNoticeEffect, ctx);
  if (effect === null) {
    return;
  }
  const { sentAt } = ctx;
  // Retries of an earlier round can land after a later one, so the counts never move backwards.
  const [quiet] = await tx
    .update(quietEvents)
    .set({
      lastNotifiedAt: sql`greatest(${quietEvents.lastNotifiedAt}, ${sentAt}::timestamptz)`,
      notifyCount: sql`greatest(${quietEvents.notifyCount}, ${effect.notifyCount}::int)`,
      notifiedMemberIds: sql`case when ${effect.notifiedMemberId}::uuid = any(${quietEvents.notifiedMemberIds}) then ${quietEvents.notifiedMemberIds} else array_append(${quietEvents.notifiedMemberIds}, ${effect.notifiedMemberId}::uuid) end`,
    })
    .where(eq(quietEvents.id, effect.quietEventId))
    .returning({ memberId: quietEvents.memberId, exchangeId: quietEvents.exchangeId });
  if (quiet === undefined) {
    deps.logger.error("gateway_effect_missing_quiet_event", { outboundId: ctx.row.id });
    return;
  }
  await recordEvent(
    tx,
    {
      name: "quiet_notice_sent",
      familyId: ctx.family.id,
      memberId: quiet.memberId,
      exchangeId: quiet.exchangeId,
      props: { round: effect.notifyCount, reader: effect.notifiedMemberId },
    },
    sentAt,
  );
}

/** The state changes after a successful send, by the row's kind. */
export async function applySentEffects(
  deps: Deps,
  tx: VelaTransaction,
  ctx: SentContext,
): Promise<SentOutcome> {
  switch (ctx.row.kind) {
    case "arrival":
      return arrivalSent(deps, tx, ctx);
    case "repeat":
      await repeatSent(deps, tx, ctx);
      return { wakeMemberIds: [] };
    case "turn_prompt":
      await turnPromptSent(deps, tx, ctx);
      return { wakeMemberIds: [] };
    case "quiet_notice":
      await quietNoticeSent(deps, tx, ctx);
      return { wakeMemberIds: [] };
    default:
      return { wakeMemberIds: [] };
  }
}

async function arrivalFailed(
  deps: Deps,
  tx: VelaTransaction,
  ctx: FailedContext,
): Promise<FailedOutcome> {
  const effect = parseEffect(deps, ArrivalEffect, ctx);
  const exchangeId = effect?.exchangeId ?? ctx.row.exchangeId;
  const { row, member, family, failedAt } = ctx;
  if (exchangeId === null) {
    deps.logger.error("gateway_effect_missing_exchange", { outboundId: row.id, kind: row.kind });
    return { notices: [], wakeMemberIds: [] };
  }
  await tx
    .update(exchanges)
    .set({
      deliveryFailedAt: sql`coalesce(${exchanges.deliveryFailedAt}, ${failedAt}::timestamptz)`,
    })
    .where(eq(exchanges.id, exchangeId));
  await recordEvent(
    tx,
    {
      name: "arrival_delivery_failed",
      familyId: family.id,
      memberId: member.id,
      exchangeId,
      props: { code: ctx.code, attempts: ctx.attempts },
    },
    failedAt,
  );
  // Each organiser hears it once per morning: the key names the exchange, so a later failure of
  // the same arrival (it cannot be re-sent, but a replay could try) adds nothing.
  const organisers = await activeOrganisersWithLinks(tx, family.id, row.channel);
  const notices: OutboundRequest[] = organisers.map((organiser) => ({
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: organiser.link.externalId,
      suffix: `delivery_failed:${exchangeId}`,
    }),
    memberId: organiser.member.id,
    channel: organiser.link.channel,
    conversationId: organiser.link.externalId,
    exchangeId,
    lang: organiser.member.language,
    text: t(organiser.member.language, "delivery.failed", {
      name: member.displayName,
      channel: channelLabel(row.channel),
    }),
  }));
  // The day is over for the ladder: no repeat and no quiet can follow a failed delivery, and the
  // scheduler must move on to the evening.
  await markWakeDue(tx, member.id, failedAt);
  return { notices, wakeMemberIds: [member.id] };
}

/** The state changes after a send has finally failed: the block on the link, then by kind. */
export async function applyFailureEffects(
  deps: Deps,
  tx: VelaTransaction,
  ctx: FailedContext,
): Promise<FailedOutcome> {
  if (ctx.code === "blocked") {
    await tx
      .update(channelLinks)
      .set({ blockedAt: ctx.failedAt })
      .where(
        and(
          eq(channelLinks.channel, ctx.row.channel),
          eq(channelLinks.externalId, ctx.row.conversationId),
          isNull(channelLinks.blockedAt),
        ),
      );
  }
  if (ctx.row.kind === "arrival") {
    return arrivalFailed(deps, tx, ctx);
  }
  return { notices: [], wakeMemberIds: [] };
}
