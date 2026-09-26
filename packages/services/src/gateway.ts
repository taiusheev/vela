/**
 * The outbound gateway: the only code that calls `ChannelAdapter.send` (code design §8, flows §3.7).
 *
 * A flow enqueues a message as a row whose idempotency key names it, so the same message computed
 * twice is inserted once, and the budget index refuses a second message of a budgeted kind for the
 * same member and local day. The queue delivers rows one at a time: a send that fails for a reason
 * that can pass is tried again at 5, 15, and 30 minutes; one that cannot, or one whose last retry
 * fails, is marked failed and its consequences applied; a row for a family that has ended is dropped
 * unsent. Telegram has no idempotency keys, so a redelivered job finds the row already sent and
 * stops, and only failures are ever retried.
 *
 * A queued row's `queued_at` is when its pending delivery is due: set by the insert, moved to the
 * end of a retry's delay, and to the moment of a re-send to a migrated group or a re-drive. A
 * delivery job can be lost (the queue send failed after the insert committed, or the consumer threw
 * until the dead-letter queue took the job), and the idempotency key then stops every flow from
 * enqueueing the message again. So `reconcile` re-drives a row still queued well past its due time,
 * counting the lost delivery as a failed attempt, and a row that can never be delivered ends failed
 * like any other.
 */
import {
  type Button,
  type Channel,
  ChannelSendError,
  type Lang,
  LocalDate,
  type MediaRef,
  type OutboundKind,
  OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import { localDateOf } from "@vela/core";
import {
  type Family,
  families,
  MESSAGE_REF_PURPOSES,
  type Member,
  members,
  messageRefs,
  type Outbound,
  outbound,
  quietEvents,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Deps, OutboundJob } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import {
  applyFailureEffects,
  applySentEffects,
  type EffectByKind,
  type FailedOutcome,
  QuietNoticeEffect,
} from "./gateway-effects.ts";
import { familyHasEnded, memberById, type Queryable, repointFamilyGroup } from "./repo.ts";

/** Minutes before each retry of a send that failed for a passing reason: the first send, then these. */
export const RETRY_DELAY_MINUTES = [5, 15, 30] as const;

/** How long a sent row may wait for its effects before `reconcile` applies them (D-B1). */
const EFFECTS_LATE_MINUTES = 2;

/**
 * How long past its due time a queued row may wait for its delivery before `reconcile` counts the
 * job as lost: longer than the queue takes to retry a job that threw (five retries, 30 seconds
 * apart) and to hand it to the dead-letter queue.
 */
export const STRANDED_AFTER_MINUTES = 10;

/** The code in `outbound.error`, and of the failure, for a row whose delivery job was lost. */
const STRANDED_CODE = "stranded";

const MessageRefIntent = z.object({
  purpose: z.enum(MESSAGE_REF_PURPOSES),
  exchangeId: z.uuid().optional(),
  quietEventId: z.uuid().optional(),
  memberId: z.uuid().optional(),
  localDate: LocalDate.optional(),
});
/** What the sent message will be about, recorded in `message_refs` once its platform id is known. */
export type MessageRefIntent = z.infer<typeof MessageRefIntent>;

const StoredMessage = OutboundMessage.pick({
  lang: true,
  text: true,
  buttons: true,
  media: true,
  replyToMessageId: true,
});

/** `outbound.payload`: the message as it will be sent, what it is about, and what its send changes. */
const OutboundPayload = z.object({
  message: StoredMessage,
  ref: MessageRefIntent.optional(),
  effect: z.unknown().optional(),
});
type OutboundPayload = z.infer<typeof OutboundPayload>;

export interface OutboundRequestBase {
  /** From `outboundKey`: names this one message, so a repeat of the same request is a no-op. */
  idempotencyKey: string;
  /** Whose row it is: the reader of a private message, the poster's subject in a group. */
  memberId: string;
  channel: Channel;
  conversationId: string;
  /**
   * The date the message is about (an arrival and its repeat use the exchange's date); the member's
   * local today when left out. It is the budget's key with the member and the kind.
   */
  localDay?: LocalDate;
  exchangeId?: string | null;
  /** The person whose tap sends it; required for `nearby_ask`. */
  actorId?: string | null;
  lang: Lang;
  text: string;
  buttons?: Button[][];
  media?: MediaRef[];
  replyToMessageId?: string;
  ref?: MessageRefIntent;
  /**
   * Whole seconds, 1 to 60, before the row is due and its delivery runs. Cloudflare Queues promise no
   * order between two jobs sent one after the other, so a message that must follow another in the
   * same chat (the health-words question after `consent.accepted`, flows §3.2) waits a little. The
   * row's `queued_at` is the due time, so `redriveStrandedOutbound` counts from it too.
   */
  delaySeconds?: number;
}

/** The longest delay a request may ask for: long enough to follow a message, short enough to feel prompt. */
const MAX_REQUEST_DELAY_SECONDS = 60;

/**
 * One message to send. Kinds whose send changes state (`EffectByKind`) carry what the effect needs;
 * the others carry no effect.
 */
export type OutboundRequest = {
  [K in OutboundKind]: OutboundRequestBase & { kind: K } & (K extends keyof EffectByKind
      ? { effect: EffectByKind[K] }
      : { effect?: undefined });
}[OutboundKind];

export type EnqueueResult = { outboundId: string } | { duplicate: true };

/** A row written but not yet handed to the queue, with the delay its delivery job must carry. */
export type InsertResult = { outboundId: string; delaySeconds?: number } | { duplicate: true };

/**
 * Inserts the row alone, inside the caller's transaction when given one, and sends nothing. For a
 * caller that may not send before it commits — an API mutation, whose transaction can still roll
 * back and whose callback a replay skips — which hands the row to the queue after its commit. A row
 * nobody hands over is still delivered: `redriveStrandedOutbound` finds it `queued` and past due.
 * A row refused by the idempotency key or by the budget index is reported as a duplicate. A request
 * that cannot be a valid platform message is a programming error and throws.
 */
export async function insertOutbound(
  deps: Pick<Deps, "clock">,
  db: Queryable,
  request: OutboundRequest,
): Promise<InsertResult> {
  const message = OutboundMessage.safeParse({
    kind: request.kind,
    idempotencyKey: request.idempotencyKey,
    lang: request.lang,
    to: { channel: request.channel, conversationId: request.conversationId },
    text: request.text,
    buttons: request.buttons,
    media: request.media,
    replyToMessageId: request.replyToMessageId,
  });
  if (!message.success) {
    throw new VelaError("invalid_outbound", `${request.kind} request is not a valid message`, {
      cause: message.error,
    });
  }
  const delaySeconds = request.delaySeconds;
  if (
    delaySeconds !== undefined &&
    !(
      Number.isInteger(delaySeconds) &&
      delaySeconds >= 1 &&
      delaySeconds <= MAX_REQUEST_DELAY_SECONDS
    )
  ) {
    throw new VelaError(
      "invalid_outbound",
      `${request.kind} request delay is not a whole number of seconds from 1 to ${MAX_REQUEST_DELAY_SECONDS}`,
    );
  }
  const localDay = request.localDay ?? (await localTodayOf(deps, db, request.memberId));
  const payload: OutboundPayload = {
    message: {
      lang: message.data.lang,
      text: message.data.text,
      buttons: message.data.buttons,
      media: message.data.media,
      replyToMessageId: message.data.replyToMessageId,
    },
    ref: request.ref,
    effect: request.effect,
  };
  const inserted = await db
    .insert(outbound)
    .values({
      memberId: request.memberId,
      exchangeId: request.exchangeId ?? null,
      kind: request.kind,
      channel: request.channel,
      conversationId: request.conversationId,
      localDay,
      idempotencyKey: request.idempotencyKey,
      actorId: request.actorId ?? null,
      payload,
      queuedAt: new Date(deps.clock.now().getTime() + (delaySeconds ?? 0) * 1000),
    })
    .onConflictDoNothing()
    .returning({ id: outbound.id });
  const row = inserted[0];
  if (row === undefined) return { duplicate: true };
  return delaySeconds === undefined ? { outboundId: row.id } : { outboundId: row.id, delaySeconds };
}

/**
 * Inserts the row and enqueues its delivery, inside the caller's transaction when given one. A row
 * refused by the idempotency key or by the budget index is reported as a duplicate and nothing is
 * enqueued. A request that cannot be a valid platform message is a programming error and throws.
 */
export async function enqueueOutbound(
  deps: Deps,
  db: Queryable,
  request: OutboundRequest,
): Promise<EnqueueResult> {
  const result = await insertOutbound(deps, db, request);
  if ("duplicate" in result) {
    deps.logger.info("outbound_duplicate", { kind: request.kind, memberId: request.memberId });
    return result;
  }
  const job: OutboundJob = { type: "deliver", outboundId: result.outboundId };
  await (result.delaySeconds === undefined
    ? deps.queues.outbound.send(job)
    : deps.queues.outbound.send(job, { delaySeconds: result.delaySeconds }));
  return { outboundId: result.outboundId };
}

async function localTodayOf(
  deps: Pick<Deps, "clock">,
  db: Queryable,
  memberId: string,
): Promise<LocalDate> {
  const member = await memberById(db, memberId);
  if (member === null) {
    throw new VelaError("not_found", `member ${memberId} does not exist`);
  }
  return localDateOf(deps.clock.now(), member.tz);
}

export type DeliveryResult = "sent" | "retry" | "failed" | "skipped";

interface LoadedOutbound {
  row: Outbound;
  member: Member;
  family: Family;
}

/**
 * A quiet notice whose event has closed before it went out: she answered, or someone said she is
 * fine, in the seconds or the retries between queueing and sending. Sent, it would tell an organiser
 * she is quiet after she was not, and nothing would follow it, since the close told only those it
 * already counted and an unsent notice counts no one. So it is not sent. One already on its way when
 * the event closes is followed by the close instead (`quietNoticeSent`). A payload that does not
 * parse is left to the send path, which fails it as it fails any other.
 */
async function quietNoticeIsMoot(db: Queryable, row: Outbound): Promise<boolean> {
  if (row.kind !== "quiet_notice") {
    return false;
  }
  const payload = OutboundPayload.safeParse(row.payload);
  const effect = payload.success ? QuietNoticeEffect.safeParse(payload.data.effect) : null;
  if (effect === null || !effect.success) {
    return false;
  }
  const [quiet] = await db
    .select({ resolvedAt: quietEvents.resolvedAt })
    .from(quietEvents)
    .where(eq(quietEvents.id, effect.data.quietEventId))
    .limit(1);
  return quiet !== undefined && quiet.resolvedAt !== null;
}

async function loadOutbound(db: Queryable, outboundId: string): Promise<LoadedOutbound | null> {
  const rows = await db
    .select({ row: outbound, member: members, family: families })
    .from(outbound)
    .innerJoin(members, eq(members.id, outbound.memberId))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(eq(outbound.id, outboundId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Sends one queued row. Throws `VelaError("not_found")` for a row that does not exist, so a queue
 * consumer that runs before the enqueuing transaction has committed retries instead of dropping the
 * message; the queue's own retry limit ends the attempts for a row that was rolled back.
 *
 * A row already `sent` whose effects were never stamped is finished rather than sent again (D-B1),
 * so a retry after a failed effect cannot produce a second message.
 */
export async function deliverOutbound(deps: Deps, outboundId: string): Promise<DeliveryResult> {
  const loaded = await loadOutbound(deps.db, outboundId);
  if (loaded === null) {
    throw new VelaError("not_found", `outbound row ${outboundId} does not exist`);
  }
  const { row, member, family } = loaded;
  if (row.status === "sent" && row.effectsAt === null) {
    await applyEffects(deps, loaded, effectOf(deps, row), row.sentAt ?? deps.clock.now());
    return "sent";
  }
  if (row.status !== "queued") {
    deps.logger.info("outbound_skipped", { outboundId, kind: row.kind, status: row.status });
    return "skipped";
  }
  if (member.status === "left" || member.status === "deceased") {
    return drop(deps, loaded, `member_${member.status}`);
  }
  if (await familyHasEnded(deps.db, family.id)) {
    return drop(deps, loaded, "family_ended");
  }
  if (await quietNoticeIsMoot(deps.db, row)) {
    return drop(deps, loaded, "quiet_resolved");
  }

  const payload = OutboundPayload.safeParse(row.payload);
  if (!payload.success) {
    return fail(
      deps,
      loaded,
      undefined,
      row.attempts + 1,
      "invalid_payload",
      "stored payload does not parse",
    );
  }
  if (row.attempts > RETRY_DELAY_MINUTES.length) {
    // Every try the retry policy allows has been spent, the last on a delivery that was lost and
    // re-driven: the row fails as it would on its last failed send, without sending.
    return fail(
      deps,
      loaded,
      payload.data.effect,
      row.attempts,
      STRANDED_CODE,
      "no delivery ran by its due time",
    );
  }
  const message = OutboundMessage.safeParse({
    kind: row.kind,
    idempotencyKey: row.idempotencyKey,
    lang: payload.data.message.lang,
    to: { channel: row.channel, conversationId: row.conversationId },
    text: payload.data.message.text,
    buttons: payload.data.message.buttons,
    media: payload.data.message.media,
    replyToMessageId: payload.data.message.replyToMessageId,
  });
  if (!message.success) {
    return fail(
      deps,
      loaded,
      payload.data.effect,
      row.attempts + 1,
      "invalid_outbound",
      "row is not a valid message",
    );
  }

  let result: SendResult;
  try {
    result = await deps.channels.get(row.channel).send(message.data);
  } catch (error) {
    if (error instanceof ChannelSendError) {
      return handleSendError(deps, loaded, payload.data, error);
    }
    throw error;
  }

  // The send is committed alone (D-B1): the message is out, and no later failure may undo the row
  // that proves it. The effects follow in their own transaction.
  const sentAt = deps.clock.now();
  const attempts = row.attempts + 1;
  await deps.db.transaction(async (tx) => {
    await tx
      .update(outbound)
      .set({ status: "sent", sentAt, attempts, externalId: result.primaryMessageId, error: null })
      .where(eq(outbound.id, row.id));
    await recordRefs(tx, loaded, payload.data.ref, result);
  });
  deps.logger.info("outbound_sent", { outboundId, kind: row.kind, attempts });
  await applyEffects(deps, loaded, payload.data.effect, sentAt, result.primaryMessageId);
  return "sent";
}

/** The effect stored with a row, for a retry that has only the effects left to apply. */
function effectOf(deps: Deps, row: Outbound): unknown {
  const payload = OutboundPayload.safeParse(row.payload);
  if (!payload.success) {
    deps.logger.error("outbound_payload_invalid", { outboundId: row.id, kind: row.kind });
    return undefined;
  }
  return payload.data.effect;
}

/**
 * What the send changes, in a transaction of its own, stamped with `effects_at` (D-B1). The stamp
 * is claimed in the same transaction, so two runs cannot both apply the effects and a run that
 * throws leaves the row sent without the stamp, for the next delivery or `reconcile` to finish.
 */
async function applyEffects(
  deps: Deps,
  loaded: LoadedOutbound,
  effect: unknown,
  sentAt: Date,
  primaryMessageId?: string,
): Promise<void> {
  const { row, member, family } = loaded;
  const outcome = await deps.db.transaction(async (tx) => {
    const claimed = await tx
      .update(outbound)
      .set({ effectsAt: deps.clock.now() })
      .where(and(eq(outbound.id, row.id), isNull(outbound.effectsAt)))
      .returning({ id: outbound.id });
    if (claimed.length === 0) {
      return { wakeMemberIds: [], notices: [] };
    }
    const effects = await applySentEffects(deps, tx, {
      row,
      member,
      family,
      effect,
      sentAt,
      primaryMessageId: primaryMessageId ?? row.externalId ?? "",
    });
    for (const notice of effects.notices) {
      await enqueueOutbound(deps, tx, notice);
    }
    return effects;
  });
  for (const memberId of outcome.wakeMemberIds) {
    await deps.scheduler.wakeAt(memberId, sentAt);
  }
}

/**
 * The rows whose send was committed but whose effects never were, older than two minutes: the
 * arrival whose exchange is still `scheduled`, the turn prompt without its `prompted_at`. Each is
 * finished through `deliverOutbound`, which applies the effects and never sends again (D-B1).
 */
export async function applyPendingEffects(deps: Deps): Promise<number> {
  const before = new Date(deps.clock.now().getTime() - EFFECTS_LATE_MINUTES * 60_000);
  const rows = await deps.db
    .select({ id: outbound.id, kind: outbound.kind })
    .from(outbound)
    .where(
      and(eq(outbound.status, "sent"), isNull(outbound.effectsAt), lt(outbound.sentAt, before)),
    )
    .orderBy(outbound.sentAt);
  for (const row of rows) {
    deps.logger.warn("outbound_effects_late", { outboundId: row.id, kind: row.kind });
    await deliverOutbound(deps, row.id);
  }
  return rows.length;
}

/**
 * Her arrivals that are out but whose effects have not landed (D-B1), finished now through
 * `deliverOutbound`, which applies the effects and never sends again; with `exchangeId`, only that
 * exchange's. Her answer calls it first (flows §3.9): the morning is on her phone, and her tap or
 * reply must find it delivered rather than wait for the queue's retry or `reconcile`. Throws what
 * the effects throw, so the answer fails and the platform delivers it again.
 */
export async function finishArrivalEffects(
  deps: Deps,
  memberId: string,
  exchangeId?: string,
): Promise<void> {
  const rows = await deps.db
    .select({ id: outbound.id, kind: outbound.kind })
    .from(outbound)
    .where(
      and(
        eq(outbound.memberId, memberId),
        eq(outbound.kind, "arrival"),
        eq(outbound.status, "sent"),
        isNull(outbound.effectsAt),
        exchangeId === undefined ? undefined : eq(outbound.exchangeId, exchangeId),
      ),
    )
    .orderBy(outbound.sentAt);
  for (const row of rows) {
    deps.logger.warn("outbound_effects_late", { outboundId: row.id, kind: row.kind, by: "answer" });
    await deliverOutbound(deps, row.id);
  }
}

/**
 * The queued rows whose delivery is more than `STRANDED_AFTER_MINUTES` past due, so no job for them
 * is still coming. Each is claimed by counting the lost delivery as a failed attempt and moving its
 * due time to now, so a reconciliation running beside this one does not drive it twice; then a
 * delivery is enqueued again, or, once the attempts are spent, the row is failed at once, unsent.
 * Should a late job turn up after all, whichever delivery runs first sends and the other finds the
 * row sent. A row that has ended meanwhile is dropped as usual. A row that throws is logged and left
 * for the next sweep, so one broken row never holds the others back.
 */
export async function redriveStrandedOutbound(deps: Deps): Promise<void> {
  const now = deps.clock.now();
  const dueBefore = new Date(now.getTime() - STRANDED_AFTER_MINUTES * 60_000);
  const stranded = await deps.db
    .select({ id: outbound.id, kind: outbound.kind, attempts: outbound.attempts })
    .from(outbound)
    .where(and(eq(outbound.status, "queued"), lt(outbound.queuedAt, dueBefore)))
    .orderBy(asc(outbound.queuedAt), asc(outbound.id));
  for (const row of stranded) {
    const attempts = row.attempts + 1;
    const [claimed] = await deps.db
      .update(outbound)
      .set({
        attempts,
        queuedAt: now,
        error: describe(STRANDED_CODE, "no delivery ran by its due time"),
      })
      .where(
        and(
          eq(outbound.id, row.id),
          eq(outbound.status, "queued"),
          eq(outbound.attempts, row.attempts),
          lt(outbound.queuedAt, dueBefore),
        ),
      )
      .returning({ id: outbound.id });
    if (claimed === undefined) {
      continue;
    }
    deps.logger.warn("outbound_stranded", { outboundId: row.id, kind: row.kind, attempts });
    try {
      if (attempts > RETRY_DELAY_MINUTES.length) {
        await deliverOutbound(deps, row.id);
      } else {
        await deps.queues.outbound.send({ type: "deliver", outboundId: row.id });
      }
    } catch (error) {
      deps.logger.error("outbound_redrive_failed", {
        outboundId: row.id,
        kind: row.kind,
        error: errorLabel(error),
      });
    }
  }
}

/**
 * Every platform message the send created is mapped to what it was about: a family member may
 * reply to the photo or the voice note rather than to the text, and the reply must still resolve.
 */
async function recordRefs(
  tx: VelaTransaction,
  loaded: LoadedOutbound,
  ref: MessageRefIntent | undefined,
  result: SendResult,
): Promise<void> {
  if (ref === undefined) {
    return;
  }
  const ids = new Set([...result.externalMessageIds, result.primaryMessageId]);
  await tx
    .insert(messageRefs)
    .values(
      [...ids].map((messageId) => ({
        channel: loaded.row.channel,
        conversationId: loaded.row.conversationId,
        messageId,
        familyId: loaded.family.id,
        exchangeId: ref.exchangeId ?? null,
        quietEventId: ref.quietEventId ?? null,
        memberId: ref.memberId ?? null,
        localDate: ref.localDate ?? null,
        purpose: ref.purpose,
      })),
    )
    .onConflictDoNothing();
}

async function handleSendError(
  deps: Deps,
  loaded: LoadedOutbound,
  payload: OutboundPayload,
  error: ChannelSendError,
): Promise<DeliveryResult> {
  const { row } = loaded;
  const migratedTo = error.migratedToConversationId;
  if (migratedTo !== undefined && migratedTo !== row.conversationId) {
    // The group became a supergroup: the family group follows it, as it does on the inbound
    // notice, and the send goes again at once to the new id. The row's own conversation id moves
    // with the group's other queued rows. A row already addressed to the id the error names falls
    // through to a permanent failure, so a send cannot loop.
    await deps.db.transaction(async (tx) => {
      await repointFamilyGroup(tx, row.channel, row.conversationId, migratedTo);
      await tx.update(outbound).set({ queuedAt: deps.clock.now() }).where(eq(outbound.id, row.id));
    });
    deps.logger.info("outbound_group_migrated", { outboundId: row.id, kind: row.kind });
    await deps.queues.outbound.send({ type: "deliver", outboundId: row.id });
    return "retry";
  }
  const attempts = row.attempts + 1;
  const delayMinutes = RETRY_DELAY_MINUTES[attempts - 1];
  if (error.retryable && delayMinutes !== undefined) {
    const delaySeconds = Math.max(delayMinutes * 60, error.retryAfterSeconds ?? 0);
    const dueAt = new Date(deps.clock.now().getTime() + delaySeconds * 1000);
    await deps.db
      .update(outbound)
      .set({ attempts, error: describe(error.code, error.message), queuedAt: dueAt })
      .where(eq(outbound.id, row.id));
    await deps.queues.outbound.send({ type: "deliver", outboundId: row.id }, { delaySeconds });
    deps.logger.warn("outbound_retry", {
      outboundId: row.id,
      kind: row.kind,
      attempts,
      code: error.code,
      delaySeconds,
    });
    return "retry";
  }
  return fail(deps, loaded, payload.effect, attempts, error.code, error.message);
}

/** `outbound.error`: the code and the platform's reason, bounded; never message content. */
function describe(code: string, message: string): string {
  return `${code}: ${message}`.slice(0, 500);
}

async function fail(
  deps: Deps,
  loaded: LoadedOutbound,
  effect: unknown,
  attempts: number,
  code: string,
  message: string,
): Promise<"failed"> {
  const { row, member, family } = loaded;
  const failedAt = deps.clock.now();
  const outcome: FailedOutcome = await deps.db.transaction(async (tx) => {
    await tx
      .update(outbound)
      .set({ status: "failed", attempts, error: describe(code, message) })
      .where(eq(outbound.id, row.id));
    const effects = await applyFailureEffects(deps, tx, {
      row,
      member,
      family,
      effect,
      code,
      attempts,
      failedAt,
    });
    for (const notice of effects.notices) {
      await enqueueOutbound(deps, tx, notice);
    }
    return effects;
  });
  for (const memberId of outcome.wakeMemberIds) {
    await deps.scheduler.wakeAt(memberId, failedAt);
  }
  deps.logger.error("outbound_failed", { outboundId: row.id, kind: row.kind, attempts, code });
  return "failed";
}

/** A row for a family that has ended is never sent (flows §3.7). */
async function drop(deps: Deps, loaded: LoadedOutbound, reason: string): Promise<"skipped"> {
  const { row, family } = loaded;
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(outbound)
      .set({ status: "dropped", error: reason })
      .where(eq(outbound.id, row.id));
    await recordEvent(
      tx,
      {
        name: "gateway_dropped",
        familyId: family.id,
        memberId: row.memberId,
        exchangeId: row.exchangeId ?? undefined,
        props: { kind: row.kind, reason },
      },
      at,
    );
  });
  deps.logger.info("outbound_dropped", { outboundId: row.id, kind: row.kind, reason });
  return "skipped";
}
