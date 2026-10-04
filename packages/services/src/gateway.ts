/**
 * The outbound gateway: the only code that calls `ChannelAdapter.send` (code design §8, flows §3.7).
 *
 * A flow enqueues a message as a row whose idempotency key names it, so the same message computed
 * twice is inserted once, and the budget index refuses a second message of a budgeted kind for the
 * same member and local day. The queue delivers rows one at a time: a send that fails for a reason
 * that can pass is tried again at 5, 15, and 30 minutes; one that cannot, or one whose last retry
 * fails, is marked failed and its consequences applied; a row for a family that has ended is dropped
 * unsent, and so is a morning of hers that a pause, her answer, or her start has made moot on its
 * way. Telegram has no idempotency keys, so a delivery takes the row before it sends (`sent_at` on a
 * queued row) and writes its outcome only on the row it holds: a second delivery of the row, however
 * it overlaps the first, finds it taken or sent and stops. Only failures are ever retried, a retry
 * sends only the media that did not go out, and a row whose delivery stopped between its take and
 * its record is never sent again, since its message may be out.
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
  type InboundEvent,
  type Lang,
  LocalDate,
  type OutboundKind,
  type OutboundMediaRef,
  OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import { localDateOf } from "@vela/core";
import {
  events,
  exchanges,
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
import { and, asc, eq, gt, isNull, lt, type SQL, sql } from "drizzle-orm";
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
import { loadOutboundFiles } from "./outbound-media.ts";
import { type PushSend, sendPush, settlePush } from "./push.ts";
import { appRowProblem, PUSH_CHANNEL } from "./push-messages.ts";
import {
  familyHasEnded,
  firstAnswersByDate,
  memberById,
  type Queryable,
  repointFamilyGroup,
} from "./repo.ts";

/** Minutes before each retry of a send that failed for a passing reason: the first send, then these. */
export const RETRY_DELAY_MINUTES = [5, 15, 30] as const;

/**
 * The kinds her pause holds back: her morning and its repeat (flows §3.13). Everything else to her
 * answers her own words — the reply to her stop, her thanks, a receipt — and still goes.
 */
const HELD_BY_PAUSE: ReadonlySet<OutboundKind> = new Set<OutboundKind>(["arrival", "repeat"]);

/**
 * The reason, and `outbound.error`, of a row dropped because she had said stop: the one reason a
 * dropped row can be queued again (`requeueArrivalHeldByPause`).
 */
const PAUSED = "member_paused";

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

/**
 * How long a delivery may hold a row it took before the hold counts as lost: longer than any
 * delivery runs, since a queue consumer's invocation ends after 15 minutes of wall time. A row held
 * that long was taken by a delivery that stopped between its take and its record, perhaps with its
 * message out, so it is failed unsent (`INTERRUPTED_CODE`) rather than sent a second time.
 */
export const CLAIM_LOST_AFTER_MINUTES = 15;

/** The code in `outbound.error`, and of the failure, for a row whose delivery stopped mid-send. */
const INTERRUPTED_CODE = "interrupted";

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

/**
 * The media of the message that went out on an earlier try whose later call failed: each item's
 * platform message id, keyed by `mediaKey`, so a later try sends only the rest (flows §3.7).
 */
const SentMedia = z.record(z.string(), z.string());
type SentMedia = z.infer<typeof SentMedia>;

/** `outbound.payload`: the message as it will be sent, what it is about, and what its send changes. */
/**
 * A free reply (LINE's reply token, 05-line-flows §5.11) to the event that caused the row: used on
 * its first attempt only, while `until` has not passed, and only in the chat the token came from.
 */
const StoredReply = z.object({
  token: z.string().min(1),
  until: z.iso.datetime({ offset: true }),
  conversationId: z.string().min(1),
});
export type StoredReply = z.infer<typeof StoredReply>;

/** The reply an event offers, as a row stores it; none from a platform without free replies. */
export function replyOf(event: InboundEvent): StoredReply | undefined {
  return event.reply === undefined
    ? undefined
    : { ...event.reply, conversationId: event.conversation.externalId };
}

/** The `reply` a request answering this event carries: spread into the request. */
export function replyFieldOf(event: InboundEvent): { reply?: StoredReply } {
  const reply = replyOf(event);
  return reply === undefined ? {} : { reply };
}

/**
 * The reply token a message sent straight to the adapter carries, answering this event in its own
 * chat while the token is fresh (05-line-flows §5.11): spread into the message.
 */
export function directReplyOf(event: InboundEvent, now: Date): { replyToken?: string } {
  return event.reply !== undefined && now.getTime() < Date.parse(event.reply.until)
    ? { replyToken: event.reply.token }
    : {};
}

const OutboundPayload = z.object({
  message: StoredMessage,
  reply: StoredReply.optional(),
  ref: MessageRefIntent.optional(),
  effect: z.unknown().optional(),
  sentMedia: SentMedia.optional(),
});
type OutboundPayload = z.infer<typeof OutboundPayload>;

/**
 * Names a media item in `sentMedia` by the file itself, as the platform, a URL, or Vela's own store
 * (ADR-33) holds it, not by its place in the message, so the entry still holds when the request is
 * built again (a morning her pause dropped, queued again with the read-back as it stands then). The
 * contract requires one of the three.
 */
function mediaKey(ref: OutboundMediaRef): string {
  return ref.providerFileId ?? ref.url ?? ref.storageKey ?? "";
}

/** The media still to send: the stored media without the items that went out on an earlier try. */
function unsentMedia(
  media: OutboundMediaRef[] | undefined,
  sent: SentMedia,
): OutboundMediaRef[] | undefined {
  if (media === undefined || Object.keys(sent).length === 0) {
    return media;
  }
  const left = media.filter((item) => sent[mediaKey(item)] === undefined);
  return left.length === 0 ? undefined : left;
}

/**
 * `sent` with the items of `sending` that went out before the send failed: the error names one
 * platform message per item, in the order the items were given.
 */
function addSentMedia(
  sent: SentMedia,
  sending: readonly OutboundMediaRef[] | undefined,
  messageIds: readonly string[],
): SentMedia {
  const next: SentMedia = { ...sent };
  messageIds.forEach((messageId, index) => {
    const item = sending?.[index];
    if (item !== undefined) {
      next[mediaKey(item)] = messageId;
    }
  });
  return next;
}

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
  media?: OutboundMediaRef[];
  replyToMessageId?: string;
  /** The event's free reply (`replyOf`), for the kinds that answer someone's own message. */
  reply?: StoredReply;
  ref?: MessageRefIntent;
  /**
   * Whole seconds, 1 to 60, before the row is due and its delivery runs. Cloudflare Queues promise no
   * order between two jobs sent one after the other, so a message that must follow another in the
   * same chat (the health-words question after `consent.accepted`, flows §3.2) waits a little. The
   * row's `queued_at` is the due time, so `redriveStrandedOutbound` counts from it too.
   */
  delaySeconds?: number;
}

/**
 * The reply token for this attempt: only the first (a retry may follow a reply that was delivered
 * after all), only before it expires, and only to the chat it came from, since a reply always lands
 * there, so an organiser's notice caused by her tap never carries her token.
 */
function freeReply(
  reply: StoredReply | undefined,
  row: { attempts: number; conversationId: string },
  now: Date,
): { replyToken?: string } {
  if (
    reply === undefined ||
    row.attempts !== 0 ||
    reply.conversationId !== row.conversationId ||
    now.getTime() >= Date.parse(reply.until)
  ) {
    return {};
  }
  return { replyToken: reply.token };
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
  // Push (ADR-34): an app row is a push of a push kind, with no buttons, files, reply or ref.
  const notAPush = request.channel === PUSH_CHANNEL ? appRowProblem(request) : null;
  if (notAPush !== null) {
    throw new VelaError("invalid_outbound", `app request: ${notAPush}`);
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
    ...(request.reply === undefined ? {} : { reply: request.reply }),
    ref: request.ref,
    effect: request.effect,
  };
  const queuedAt = new Date(deps.clock.now().getTime() + (delaySeconds ?? 0) * 1000);
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
      queuedAt,
    })
    .onConflictDoNothing()
    .returning({ id: outbound.id });
  const row = inserted[0] ?? (await requeueArrivalHeldByPause(db, request, payload, queuedAt));
  if (row === undefined) return { duplicate: true };
  return delaySeconds === undefined ? { outboundId: row.id } : { outboundId: row.id, delaySeconds };
}

/**
 * Her morning, dropped unsent because she had said stop, asked for again: she has said start and
 * its window is still open, so it goes out now, as any morning not sent before her start does
 * (flows §3.13). Its key names that one morning and the dropped row holds it, so the row itself is
 * queued again, as a new delivery holding what the request holds now (a late note, the read-back),
 * and it is sent once like any other. The media an earlier try got out before its pause stays in
 * `sentMedia`, so none of it reaches her twice. No other dropped row comes back: an ended family,
 * an answer, a start, and a closed quiet event are for good, and a repeat a pause dropped is never
 * asked for again, because its morning went out before her start.
 */
async function requeueArrivalHeldByPause(
  db: Queryable,
  request: OutboundRequest,
  payload: OutboundPayload,
  queuedAt: Date,
): Promise<{ id: string } | undefined> {
  if (request.kind !== "arrival") {
    return undefined;
  }
  const [row] = await db
    .update(outbound)
    .set({
      exchangeId: request.exchangeId ?? null,
      channel: request.channel,
      conversationId: request.conversationId,
      payload: sql`${JSON.stringify(payload)}::jsonb || jsonb_strip_nulls(jsonb_build_object('sentMedia', ${outbound.payload} -> 'sentMedia'))`,
      status: "queued",
      attempts: 0,
      error: null,
      queuedAt,
      sentAt: null,
    })
    .where(
      and(
        eq(outbound.idempotencyKey, request.idempotencyKey),
        eq(outbound.status, "dropped"),
        eq(outbound.error, PAUSED),
      ),
    )
    .returning({ id: outbound.id });
  return row;
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
  const written = await insertOutbound(deps, db, request);
  // Push (ADR-34, D1): the budget's refusal is logged apart from a replay of the same message.
  if ("duplicate" in written && !(await keyIsTaken(db, request.idempotencyKey))) {
    deps.logger.warn("outbound_budget_refused", {
      kind: request.kind,
      memberId: request.memberId,
      channel: request.channel,
    });
    return written;
  }
  return handOverOutbound(deps, request, written);
}

/**
 * Enqueues the delivery of a row `insertOutbound` wrote for `request`, as `enqueueOutbound` does
 * after its insert; a duplicate is logged and nothing is enqueued. For a caller that writes the row
 * under a lock it should not hold across the queue's send, and hands the row over after its commit.
 */
export async function handOverOutbound(
  deps: Pick<Deps, "logger" | "queues">,
  request: OutboundRequest,
  written: InsertResult,
): Promise<EnqueueResult> {
  if ("duplicate" in written) {
    deps.logger.info("outbound_duplicate", { kind: request.kind, memberId: request.memberId });
    return written;
  }
  const job: OutboundJob = { type: "deliver", outboundId: written.outboundId };
  await (written.delaySeconds === undefined
    ? deps.queues.outbound.send(job)
    : deps.queues.outbound.send(job, { delaySeconds: written.delaySeconds }));
  return { outboundId: written.outboundId };
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

/**
 * Why a repeat's morning no longer waits for an answer, or null while it does (flows §3.8). The
 * schedule decided the repeat before any of these, and the seconds before the send, a retry, or a
 * re-drive can hold it for many minutes: she answered it, or answered on its day, which counts the
 * same (§3.9: a message before the arrival, a tap on an older arrival); or she said start since it
 * went out, which stands for that morning's ladder as an answer would (§3.13). Sent, "in case you
 * missed it" would reach her after she wrote, with buttons whose tap posts her answer to the group
 * a second time. One already on its way when she answers still arrives: that gap, as a quiet
 * notice's, cannot close.
 */
async function repeatIsMoot(
  db: Queryable,
  row: Outbound,
  member: Member,
): Promise<"answered" | "resumed" | null> {
  if (row.kind !== "repeat" || row.exchangeId === null) {
    return null;
  }
  const [exchange] = await db
    .select({ answeredAt: exchanges.answeredAt, deliveredAt: exchanges.deliveredAt })
    .from(exchanges)
    .where(eq(exchanges.id, row.exchangeId))
    .limit(1);
  if (exchange === undefined) {
    return null;
  }
  if (
    exchange.answeredAt !== null ||
    (await firstAnswersByDate(db, member.id, member.tz, row.localDay, row.localDay)).has(
      row.localDay,
    )
  ) {
    return "answered";
  }
  if (exchange.deliveredAt === null) {
    return null;
  }
  const [started] = await db
    .select({ at: events.at })
    .from(events)
    .where(
      and(
        eq(events.name, "start_said"),
        eq(events.memberId, member.id),
        gt(events.at, exchange.deliveredAt),
      ),
    )
    .limit(1);
  return started === undefined ? null : "resumed";
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
 *
 * Before it sends, the delivery takes the row (`takeOutbound`), and it writes the outcome only on
 * the row it holds, so a second delivery of the row finds it taken or sent and sends nothing
 * (flows §3.7). A row another delivery holds is left to it, and one held past
 * `CLAIM_LOST_AFTER_MINUTES` is failed unsent.
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
  if (row.sentAt !== null) {
    return heldElsewhere(deps, loaded, row.sentAt);
  }
  if (member.status === "left" || member.status === "deceased") {
    return drop(deps, loaded, `member_${member.status}`);
  }
  if (await familyHasEnded(deps.db, family.id)) {
    return drop(deps, loaded, "family_ended");
  }
  // She said stop after the tick that read her active, or while the row waited for a retry or a
  // re-drive: nothing of her morning goes to her until she says start (flows §3.13). Her start can
  // land after this read, and another delivery can take the row, so the drop is decided again under
  // locks, and a drop that no longer holds leaves the delivery to decide again from what is stored
  // now: a row taken since is that delivery's to send, since the take decided.
  if (member.status === "paused" && HELD_BY_PAUSE.has(row.kind)) {
    return (await dropWhilePaused(deps, loaded)) ?? deliverOutbound(deps, outboundId);
  }
  const repeatMoot = await repeatIsMoot(deps.db, row, member);
  if (repeatMoot !== null) {
    return drop(deps, loaded, repeatMoot);
  }
  if (await quietNoticeIsMoot(deps.db, row)) {
    return drop(deps, loaded, "quiet_resolved");
  }

  const held = await takeOutbound(deps, row);
  if (held === null) {
    deps.logger.info("outbound_skipped", { outboundId, kind: row.kind, status: row.status });
    return "skipped";
  }
  // From here on the row is as taken: a morning queued again, or a group re-pointed, since it was
  // read is sent as it stands now.
  const taken: LoadedOutbound = { row: held.row, member, family };
  const { heldSince } = held;
  const payload = OutboundPayload.safeParse(taken.row.payload);
  if (!payload.success) {
    return fail(
      deps,
      taken,
      heldSince,
      undefined,
      taken.row.attempts + 1,
      "invalid_payload",
      "stored payload does not parse",
    );
  }
  if (taken.row.attempts > RETRY_DELAY_MINUTES.length) {
    // Every try the retry policy allows has been spent, the last on a delivery that was lost and
    // re-driven: the row fails as it would on its last failed send, without sending.
    return fail(
      deps,
      taken,
      heldSince,
      payload.data.effect,
      taken.row.attempts,
      STRANDED_CODE,
      "no delivery ran by its due time",
    );
  }
  const sentMedia = payload.data.sentMedia ?? {};
  const message = OutboundMessage.safeParse({
    kind: taken.row.kind,
    idempotencyKey: taken.row.idempotencyKey,
    lang: payload.data.message.lang,
    to: { channel: taken.row.channel, conversationId: taken.row.conversationId },
    text: payload.data.message.text,
    buttons: payload.data.message.buttons,
    media: unsentMedia(payload.data.message.media, sentMedia),
    replyToMessageId: payload.data.message.replyToMessageId,
    ...freeReply(payload.data.reply, taken.row, deps.clock.now()),
  });
  if (!message.success) {
    return fail(
      deps,
      taken,
      heldSince,
      payload.data.effect,
      taken.row.attempts + 1,
      "invalid_outbound",
      "row is not a valid message",
    );
  }

  let sent: RowSend;
  try {
    sent = await sendRow(deps, taken, message.data, payload.data.effect);
  } catch (error) {
    if (error instanceof ChannelSendError) {
      return handleSendError(deps, taken, heldSince, payload.data, message.data.media, error);
    }
    throw error;
  }
  if (sent.status !== "sent") {
    return settleUnsentPush(deps, taken, heldSince, payload.data, sent);
  }
  const { result, push } = sent;

  // The send is committed alone (D-B1): the message is out, and no later failure may undo the row
  // that proves it. The effects follow in their own transaction. The media an earlier try got out
  // is part of the message, so a reply to it resolves too. The row names the chat the message went
  // to, which an upgrade of the group handled while the send was out has moved on (flows §3.3).
  const sentAt = deps.clock.now();
  const attempts = taken.row.attempts + 1;
  const created: SendResult = {
    externalMessageIds: [...Object.values(sentMedia), ...result.externalMessageIds],
    primaryMessageId: result.primaryMessageId,
  };
  const recorded = await deps.db.transaction(async (tx) => {
    const [sent] = await tx
      .update(outbound)
      .set({
        status: "sent",
        sentAt,
        attempts,
        conversationId: taken.row.conversationId,
        externalId: result.primaryMessageId,
        error: null,
      })
      .where(heldBy(taken.row.id, heldSince))
      .returning({ id: outbound.id });
    if (sent === undefined) {
      return false;
    }
    await recordRefs(tx, taken, payload.data.ref, created);
    // Push (ADR-34): the tickets whose receipts are read later, the phones found gone, and the
    // alerts those call for, committed with the send or not at all.
    if (push !== undefined) {
      for (const notice of await settlePush(deps, tx, taken.row, push, payload.data.effect)) {
        await enqueueOutbound(deps, tx, notice);
      }
    }
    return true;
  });
  if (!recorded) {
    // Only a hold older than any delivery runs is taken from its delivery, so this cannot happen
    // while the platform keeps its limits; if it does, the message is out and the row says not.
    deps.logger.error("outbound_sent_unrecorded", { outboundId, kind: row.kind, attempts });
    return "skipped";
  }
  deps.logger.info("outbound_sent", { outboundId, kind: row.kind, attempts });
  await applyEffects(deps, taken, payload.data.effect, sentAt, result.primaryMessageId);
  return "sent";
}

/**
 * Takes a queued row for this delivery before anything is sent (flows §3.7): on a queued row,
 * `sent_at` is when a delivery took it. The update matches only the row as this delivery read it,
 * queued, held by no one, and with no attempt counted since, so of two deliveries of one row
 * however they overlap (a duplicate job, a re-driven one beside a late one) exactly one takes it.
 * Returns the row as taken and the time that names this delivery's hold, or null.
 */
async function takeOutbound(
  deps: Deps,
  row: Outbound,
): Promise<{ row: Outbound; heldSince: Date } | null> {
  const heldSince = deps.clock.now();
  const [taken] = await deps.db
    .update(outbound)
    .set({ sentAt: heldSince })
    .where(
      and(
        eq(outbound.id, row.id),
        eq(outbound.status, "queued"),
        isNull(outbound.sentAt),
        eq(outbound.attempts, row.attempts),
      ),
    )
    .returning();
  return taken === undefined ? null : { row: taken, heldSince };
}

/**
 * The row as this delivery holds it: still queued, and held since `heldSince`, or, for a delivery
 * that has not taken it, held by no one. Every outcome is written only there, so no delivery ever
 * overwrites what another recorded.
 */
function heldBy(rowId: string, heldSince: Date | null): SQL | undefined {
  return and(
    eq(outbound.id, rowId),
    eq(outbound.status, "queued"),
    heldSince === null ? isNull(outbound.sentAt) : eq(outbound.sentAt, heldSince),
  );
}

/** Whether a hold taken at `heldSince` is older than any delivery runs (`CLAIM_LOST_AFTER_MINUTES`). */
function holdIsLost(deps: Deps, heldSince: Date): boolean {
  return heldSince.getTime() <= deps.clock.now().getTime() - CLAIM_LOST_AFTER_MINUTES * 60_000;
}

/**
 * A queued row another delivery took. Within the time a delivery runs it is at the platform, and
 * that delivery records what happened, so this one sends nothing. Past it, the delivery that took
 * it stopped between its take and its record (its invocation ended, or the record's commit
 * failed), perhaps with the message out: the row fails unsent, the lost delivery counted as an
 * attempt, rather than reach its reader twice (flows §3.7).
 */
async function heldElsewhere(
  deps: Deps,
  loaded: LoadedOutbound,
  heldSince: Date,
): Promise<DeliveryResult> {
  const { row } = loaded;
  if (!holdIsLost(deps, heldSince)) {
    deps.logger.info("outbound_skipped", { outboundId: row.id, kind: row.kind, status: "held" });
    return "skipped";
  }
  return fail(
    deps,
    loaded,
    heldSince,
    effectOf(deps, row),
    row.attempts + 1,
    INTERRUPTED_CODE,
    "a delivery took the row and never recorded its send",
  );
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
 * Should a late job turn up after all, whichever delivery takes the row first sends and the other
 * finds it taken or sent. A row a delivery holds is not lost: it is left to that delivery, and
 * failed unsent through `deliverOutbound` once the hold is older than any delivery runs. A row that
 * has ended meanwhile is dropped as usual. A row that throws is logged and left for the next sweep,
 * so one broken row never holds the others back.
 */
export async function redriveStrandedOutbound(deps: Deps): Promise<void> {
  const now = deps.clock.now();
  const dueBefore = new Date(now.getTime() - STRANDED_AFTER_MINUTES * 60_000);
  const stranded = await deps.db
    .select({
      id: outbound.id,
      kind: outbound.kind,
      attempts: outbound.attempts,
      heldSince: outbound.sentAt,
    })
    .from(outbound)
    .where(and(eq(outbound.status, "queued"), lt(outbound.queuedAt, dueBefore)))
    .orderBy(asc(outbound.queuedAt), asc(outbound.id));
  for (const row of stranded) {
    if (row.heldSince !== null) {
      if (holdIsLost(deps, row.heldSince)) {
        await redriveSafely(deps, row, () => deliverOutbound(deps, row.id));
      }
      continue;
    }
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
          isNull(outbound.sentAt),
          eq(outbound.attempts, row.attempts),
          lt(outbound.queuedAt, dueBefore),
        ),
      )
      .returning({ id: outbound.id });
    if (claimed === undefined) {
      continue;
    }
    deps.logger.warn("outbound_stranded", { outboundId: row.id, kind: row.kind, attempts });
    await redriveSafely(deps, row, () =>
      attempts > RETRY_DELAY_MINUTES.length
        ? deliverOutbound(deps, row.id)
        : deps.queues.outbound.send({ type: "deliver", outboundId: row.id }),
    );
  }
}

/** Runs one row's re-drive; one that throws is logged and left for the next sweep. */
async function redriveSafely(
  deps: Deps,
  row: { id: string; kind: OutboundKind },
  redrive: () => Promise<unknown>,
): Promise<void> {
  try {
    await redrive();
  } catch (error) {
    deps.logger.error("outbound_redrive_failed", {
      outboundId: row.id,
      kind: row.kind,
      error: errorLabel(error),
    });
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

/**
 * A failed send, on the row this delivery holds since `heldSince`. A retry gives the row back
 * (`sent_at` null) with the media this send got out added to `sentMedia`, in the same write, so the
 * next try sends only the rest (flows §3.7); a re-send to a migrated group gives it back with none,
 * since those ids name nothing in the new chat (flows §3.3).
 */
async function handleSendError(
  deps: Deps,
  loaded: LoadedOutbound,
  heldSince: Date,
  payload: OutboundPayload,
  sending: readonly OutboundMediaRef[] | undefined,
  error: ChannelSendError,
): Promise<DeliveryResult> {
  const { row } = loaded;
  const progress: { payload?: OutboundPayload } =
    error.sentMediaMessageIds.length === 0
      ? {}
      : {
          payload: {
            ...payload,
            sentMedia: addSentMedia(payload.sentMedia ?? {}, sending, error.sentMediaMessageIds),
          },
        };
  const migratedTo = error.migratedToConversationId;
  if (migratedTo !== undefined && migratedTo !== row.conversationId) {
    // The group became a supergroup: the family group follows it, as it does on the inbound
    // notice, and the send goes again at once to the new id. The row's own conversation id moves
    // with the group's other queued rows. The media this try got out went to the old chat, whose
    // ids name nothing in the new one, so it is not kept: the message goes to the new chat whole
    // (flows §3.3). A row already addressed to the id the error names falls through to a permanent
    // failure, so a send cannot loop.
    const released = await deps.db.transaction(async (tx) => {
      await repointFamilyGroup(tx, row.channel, row.conversationId, migratedTo);
      const [mine] = await tx
        .update(outbound)
        .set({ queuedAt: deps.clock.now(), sentAt: null })
        .where(heldBy(row.id, heldSince))
        .returning({ id: outbound.id });
      return mine !== undefined;
    });
    if (!released) {
      return holdTaken(deps, row);
    }
    deps.logger.info("outbound_group_migrated", { outboundId: row.id, kind: row.kind });
    await deps.queues.outbound.send({ type: "deliver", outboundId: row.id });
    return "retry";
  }
  const attempts = row.attempts + 1;
  const delayMinutes = RETRY_DELAY_MINUTES[attempts - 1];
  if (error.retryable && delayMinutes !== undefined) {
    const delaySeconds = Math.max(delayMinutes * 60, error.retryAfterSeconds ?? 0);
    const dueAt = new Date(deps.clock.now().getTime() + delaySeconds * 1000);
    const giveBack = (kept: { payload?: OutboundPayload }, where: SQL | undefined) =>
      deps.db
        .update(outbound)
        .set({
          attempts,
          error: describe(error.code, error.message),
          queuedAt: dueAt,
          sentAt: null,
          ...kept,
        })
        .where(where)
        .returning({ id: outbound.id });
    // The media this send got out is kept only while the row addresses the chat it went to. An
    // upgrade of the group handled while the send was out has moved the row to the supergroup,
    // where those ids name other messages, and taken its reply target, so the retry goes there
    // whole (flows §3.3).
    let [released] = await giveBack(
      progress,
      progress.payload === undefined
        ? heldBy(row.id, heldSince)
        : and(heldBy(row.id, heldSince), eq(outbound.conversationId, row.conversationId)),
    );
    if (released === undefined && progress.payload !== undefined) {
      [released] = await giveBack({}, heldBy(row.id, heldSince));
    }
    if (released === undefined) {
      return holdTaken(deps, row);
    }
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
  return fail(deps, loaded, heldSince, payload.effect, attempts, error.code, error.message);
}

/**
 * The row is no longer as this delivery left it: its hold was counted as lost and the row failed
 * (`CLAIM_LOST_AFTER_MINUTES`), or, before any take, another delivery took, sent, or dropped it.
 * That outcome stands, and this delivery writes nothing over it.
 */
function holdTaken(deps: Deps, row: Outbound): "skipped" {
  deps.logger.warn("outbound_hold_taken", { outboundId: row.id, kind: row.kind });
  return "skipped";
}

/** `outbound.error`: the code and the platform's reason, bounded; never message content. */
function describe(code: string, message: string): string {
  return `${code}: ${message}`.slice(0, 500);
}

/**
 * Marks the row failed, on the row as the delivery holds it since `heldSince`, and applies the
 * failure's consequences in the same transaction, only when that write took: two reconciliations
 * failing one lost hold tell nobody twice.
 */
async function fail(
  deps: Deps,
  loaded: LoadedOutbound,
  heldSince: Date,
  effect: unknown,
  attempts: number,
  code: string,
  message: string,
): Promise<"failed" | "skipped"> {
  const { row, member, family } = loaded;
  const failedAt = deps.clock.now();
  const outcome: FailedOutcome | null = await deps.db.transaction(async (tx) => {
    const [failed] = await tx
      .update(outbound)
      .set({ status: "failed", attempts, error: describe(code, message), sentAt: null })
      .where(heldBy(row.id, heldSince))
      .returning({ id: outbound.id });
    if (failed === undefined) {
      return null;
    }
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
  if (outcome === null) {
    return holdTaken(deps, row);
  }
  for (const memberId of outcome.wakeMemberIds) {
    await deps.scheduler.wakeAt(memberId, failedAt);
  }
  deps.logger.error("outbound_failed", { outboundId: row.id, kind: row.kind, attempts, code });
  return "failed";
}

/**
 * A row that must not go out is marked dropped unsent (flows §3.7): its family has ended, or it is
 * a morning of hers, or a notice, that has become moot on its way. It is decided before the take,
 * so it is written only on a row still held by no delivery, and recorded only then: a row another
 * delivery took in the meantime is that delivery's to finish. A push nothing may or can carry
 * (ADR-34) is decided after its take instead, so it is dropped on the row this delivery holds,
 * and what the push came to (`settlePush`: the phones found gone, and the founder's alerts,
 * among them a quiet notice left unheard) is written in the same transaction, after the drop.
 */
async function drop(
  deps: Deps,
  loaded: LoadedOutbound,
  reason: string,
  held: { heldSince: Date; push: PushSend; effect: unknown } | null = null,
): Promise<"skipped"> {
  const dropped = await deps.db.transaction(async (tx) => {
    const mine = await markDropped(deps, tx, loaded, reason, held?.heldSince ?? null);
    if (mine && held !== null) {
      for (const notice of await settlePush(deps, tx, loaded.row, held.push, held.effect)) {
        await enqueueOutbound(deps, tx, notice);
      }
    }
    return mine;
  });
  if (!dropped) {
    return holdTaken(deps, loaded.row);
  }
  deps.logger.info("outbound_dropped", {
    outboundId: loaded.row.id,
    kind: loaded.row.kind,
    reason,
  });
  return "skipped";
}

/**
 * Marks the row dropped and records it, only on a row still queued and held by no delivery (or, for
 * a push, by this one since `heldSince`); false, writing nothing, when another delivery took, sent,
 * or dropped it first.
 */
async function markDropped(
  deps: Deps,
  tx: VelaTransaction,
  loaded: LoadedOutbound,
  reason: string,
  heldSince: Date | null = null,
): Promise<boolean> {
  const { row, family } = loaded;
  const [mine] = await tx
    .update(outbound)
    .set({ status: "dropped", error: reason, sentAt: null })
    .where(heldBy(row.id, heldSince))
    .returning({ id: outbound.id });
  if (mine === undefined) {
    return false;
  }
  await recordEvent(
    tx,
    {
      name: "gateway_dropped",
      familyId: family.id,
      memberId: row.memberId,
      exchangeId: row.exchangeId ?? undefined,
      props: { kind: row.kind, reason },
    },
    deps.clock.now(),
  );
  return true;
}

/**
 * The pause drop, decided again under locks, since the delivery read her paused before it got here.
 * Her start may have landed since: its tick asked for this morning, found the row still queued, and
 * left it to this delivery, so a drop now would lose the morning her start asked for until a later
 * tick (flows §3.13). Another delivery of the row may have taken or sent it since: the take decided,
 * so that delivery sends it even though she paused after it, and `dropped` over `sent` would hide
 * the send from `reconcile` and let her start queue the morning again. So the row is locked and
 * must still be queued and held by no delivery; then her row is read `for share`, which waits for a
 * start in flight (it locks her row `for update` before it makes her active) and holds off a later
 * one until this commits, whose tick then finds the row dropped and queues it again
 * (`requeueArrivalHeldByPause`). The row before hers, as a send's effects take them. Null when she
 * is no longer paused or the row is no longer queued and free: the delivery decides again from what
 * is stored.
 */
async function dropWhilePaused(deps: Deps, loaded: LoadedOutbound): Promise<"skipped" | null> {
  const { row } = loaded;
  const dropped = await deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: outbound.status, heldSince: outbound.sentAt })
      .from(outbound)
      .where(eq(outbound.id, row.id))
      .for("update");
    if (current?.status !== "queued" || current.heldSince !== null) {
      return false;
    }
    const [her] = await tx
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, row.memberId))
      .for("share");
    if (her?.status !== "paused") {
      return false;
    }
    return markDropped(deps, tx, loaded, PAUSED);
  });
  if (!dropped) {
    deps.logger.info("outbound_pause_drop_moot", { outboundId: row.id, kind: row.kind });
    return null;
  }
  deps.logger.info("outbound_dropped", { outboundId: row.id, kind: row.kind, reason: PAUSED });
  return "skipped";
}

// Push (ADR-34) -----------------------------------------------------------------------------------

/** What one send came to: sent with the platform's result (a push's with its tickets), or not. */
type RowSend =
  | { status: "sent"; result: SendResult; push?: Extract<PushSend, { status: "sent" }> }
  | Exclude<PushSend, { status: "sent" }>;

/**
 * The one dispatch. An app row goes to the reader's phones through the push port, before any file
 * is loaded (a push carries none) and never through a channel adapter, which the registry has none
 * of for `app`. Any other row goes to its channel's adapter with its stored photos (ADR-33), each
 * loaded for this attempt unless the adapter names them by key (`mediaByUrl`); one that cannot be
 * loaded is a passing failure.
 */
async function sendRow(
  deps: Deps,
  loaded: LoadedOutbound,
  message: OutboundMessage,
  effect: unknown,
): Promise<RowSend> {
  if (loaded.row.channel === PUSH_CHANNEL) {
    const push = await sendPush(deps, loaded, message, effect);
    return push.status === "sent" ? { status: "sent", result: push.result, push } : push;
  }
  const adapter = deps.channels.get(loaded.row.channel);
  // An adapter that names a stored file by its key (her phone, LINE) never needs its bytes.
  const files = adapter.capabilities.mediaByUrl
    ? undefined
    : await loadOutboundFiles(deps, loaded.row.id, message);
  const result = await (files === undefined ? adapter.send(message) : adapter.send(message, files));
  return { status: "sent", result };
}

/**
 * A push that did not go, on the row this delivery holds since `heldSince`: dropped with what the
 * drop calls for, or failed as any send fails, after its refusals are written — each phone found
 * gone deleted with the alert its loss calls for, and Vela's credentials refused — in one
 * transaction, so a phone is never deleted without its alert.
 */
async function settleUnsentPush(
  deps: Deps,
  taken: LoadedOutbound,
  heldSince: Date,
  payload: OutboundPayload,
  push: Exclude<PushSend, { status: "sent" }>,
): Promise<DeliveryResult> {
  if (push.status === "dropped") {
    return drop(deps, taken, push.reason, { heldSince, push, effect: payload.effect });
  }
  if (push.gone.length > 0 || push.notices.length > 0) {
    await deps.db.transaction(async (tx) => {
      for (const notice of await settlePush(deps, tx, taken.row, push, payload.effect)) {
        await enqueueOutbound(deps, tx, notice);
      }
    });
  }
  return handleSendError(deps, taken, heldSince, payload, undefined, push.error);
}

/**
 * Whether a conflicting insert met the row its own key names — a replay of the same message — or
 * the budget index, which refused a second message of the kind for the member's day (spec §15,
 * D1). The two are logged apart.
 */
async function keyIsTaken(db: Queryable, idempotencyKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: outbound.id })
    .from(outbound)
    .where(eq(outbound.idempotencyKey, idempotencyKey))
    .limit(1);
  return row !== undefined;
}
