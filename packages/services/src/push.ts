/**
 * Push (ADR-34): the one place a row on the `app` channel is sent, and where Apple's and Google's
 * receipts for it are read. Adapters never touch the database, so this resolves the reader's phones
 * and hands Expo one message per phone through `deps.push`; the gateway calls `sendPush` for an app
 * row before any file is loaded, and records what it returns as it records any send.
 *
 * What a send can come to:
 * - Sent, when at least one phone's message was taken: the row's external id is the first ticket,
 *   and each ticket is kept (`push_tickets`) until its receipt is read.
 * - Dropped, when nothing may or can go: push is off (`push_off`), "One moment a day" is off
 *   (`one_moment_off`) or it is outside the reader's waking hours (`quiet_hours`) for an ordinary
 *   push, or no phone can be told (`no_push_device`), including when Expo said every phone is gone.
 *   A dropped row holds no budget, and the app shows what it would have said.
 * - Failed, as a `ChannelSendError` the gateway retries or fails as it does any other: the whole
 *   request failed, or every phone that is not gone refused it.
 *
 * A phone Expo, Apple or Google says is gone (DeviceNotRegistered) is deleted, while it still holds
 * the token that push went to, in the transaction that records the send's outcome or settles its
 * receipt, with the founder's alert its loss calls for (`settlePush`). Vela's own credentials
 * refused tell the founder once a day (`pushMisconfiguredAlert`), and a quiet notice that reached
 * no phone tells the founder unless Telegram carried it or still may (`quietNoticeUnheard`),
 * decided under the quiet event's lock. Tokens are never logged: a log line names the device.
 */
import {
  ChannelSendError,
  type ChannelSendErrorCode,
  type OutboundMessage,
  PushData,
  type PushKind,
  type SendResult,
} from "@vela/contracts";
import {
  exchanges,
  type Family,
  type Member,
  type NewPushTicket,
  type Outbound,
  outbound,
  type PushDevice,
  pushDevices,
  pushTickets,
  quietEvents,
  suggestions,
  users,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { pushMisconfiguredAlert } from "./admin-alerts.ts";
import {
  type Deps,
  type PushFailure,
  type PushReceipt,
  type PushResult,
  pushFailureOf,
} from "./deps.ts";
import { errorLabel } from "./errors.ts";
import type { OutboundRequest } from "./gateway.ts";
import {
  lockQuietEventOfNotice,
  QuietNoticeEffect,
  quietNoticeUnheard,
  TurnPromptEffect,
} from "./gateway-effects.ts";
import { sha256Hex } from "./hash.ts";
import { alertsAfterDeviceLoss, deviceAlertsOf, forgetGoneDevice } from "./push-devices.ts";
import {
  isOrdinaryPush,
  isPushKind,
  PUSH_CHANNEL,
  pushMessageFor,
  pushUnheardError,
  withinWakingHours,
} from "./push-messages.ts";
import { type Queryable, quietEventById } from "./repo.ts";

/** Why an app row was dropped unsent; the row's `error` and the `gateway_dropped` event say it. */
export type PushDropReason = "push_off" | "no_push_device" | "one_moment_off" | "quiet_hours";

/**
 * A phone Expo said is gone at the ticket (DeviceNotRegistered), with the SHA-256 of the token the
 * push went to: deleted, with the founder's alert that calls for, by `settlePush`, in the
 * transaction that records what the send came to.
 */
export interface GonePhone {
  readonly deviceId: string;
  readonly tokenSha256: string;
}

/**
 * What sending one app row came to. Nothing of it is written yet: `settlePush` writes it in the
 * transaction that records the row's outcome, so a phone found gone is never deleted without the
 * alert its loss calls for, and an unsent quiet notice's alert is decided with its drop.
 */
export type PushSend =
  | {
      status: "sent";
      result: SendResult;
      /** For `recordPushTickets`, in the transaction that marks the row sent. */
      tickets: NewPushTicket[];
      gone: GonePhone[];
      /** Founder's alerts that need nothing read: Vela's own credentials refused. */
      notices: OutboundRequest[];
    }
  | { status: "dropped"; reason: PushDropReason; gone: GonePhone[]; notices: OutboundRequest[] }
  | { status: "failed"; error: ChannelSendError; gone: GonePhone[]; notices: OutboundRequest[] };

/** The row and whose it is, as the gateway loaded them. */
export interface PushRow {
  row: Outbound;
  member: Member;
  family: Family;
}

/** A phone this send goes to, with the SHA-256 of the token it goes to. */
interface Phone {
  device: PushDevice;
  tokenSha256: string;
}

/**
 * Sends one app row to the reader's phones (the design's fan-out): one message per phone that can
 * be told, in one request. `message` is the row as the gateway parsed it, and `effect` the effect
 * stored with it, which says what a quiet notice or a turn prompt is about.
 */
export async function sendPush(
  deps: Deps,
  loaded: PushRow,
  message: OutboundMessage,
  effect: unknown,
): Promise<PushSend> {
  const { row, member } = loaded;
  if (!isPushKind(row.kind)) {
    return failed(new ChannelSendError("invalid_request", `${row.kind} is not a push`));
  }
  const kind = row.kind;
  if (deps.push === null) {
    return dropped("push_off");
  }
  const [account] =
    member.userId === null
      ? []
      : await deps.db
          .select({ id: users.id, oneMomentADay: users.oneMomentADay })
          .from(users)
          .where(and(eq(users.id, member.userId), isNull(users.deletedAt)))
          .limit(1);
  if (account === undefined) {
    return dropped("no_push_device");
  }
  if (isOrdinaryPush(kind)) {
    if (!account.oneMomentADay) {
      return dropped("one_moment_off");
    }
    if (!withinWakingHours(deps.clock.now(), member.tz)) {
      return dropped("quiet_hours");
    }
  }
  const phones = await phonesToTell(deps.db, account.id, kind);
  if (phones.length === 0) {
    return dropped("no_push_device");
  }
  const data = await pushDataOf(deps.db, loaded, kind, effect);
  if (data === null) {
    return failed(
      new ChannelSendError("invalid_request", `${kind} has nothing to point the app at`),
    );
  }

  let results: readonly PushResult[];
  try {
    results = await deps.push.send(
      phones.map((phone) => pushMessageFor(kind, phone.device.token, message.text, data)),
    );
  } catch (error) {
    if (!(error instanceof ChannelSendError)) {
      throw error;
    }
    const failure = pushFailureOf(error);
    const notices: OutboundRequest[] = [];
    if (failure?.misconfigured === true) {
      addMisconfigured(deps, notices, new Set(), row.memberId, failure);
    }
    return { status: "failed", error, gone: [], notices };
  }

  const now = deps.clock.now();
  const tickets: NewPushTicket[] = [];
  const refused: { phone: Phone; failure: PushFailure }[] = [];
  for (const [index, phone] of phones.entries()) {
    const result = results[index];
    if (result?.status === "ok") {
      tickets.push({
        id: result.id,
        deviceId: phone.device.id,
        tokenSha256: phone.tokenSha256,
        outboundId: row.id,
        createdAt: now,
      });
    } else {
      refused.push({
        phone,
        failure: result?.failure ?? {
          code: "unknown",
          misconfigured: false,
          reason: "no_ticket",
          message: "expo push: no ticket for this message",
        },
      });
    }
  }
  const { gone, notices } = afterRefusals(deps, row, refused);
  const [first] = tickets;
  if (first !== undefined) {
    return {
      status: "sent",
      result: {
        externalMessageIds: tickets.map((ticket) => ticket.id),
        primaryMessageId: first.id,
      },
      tickets,
      gone,
      notices,
    };
  }
  // Nothing was taken. Phones that are gone are gone (and deleted with the drop): with none left,
  // the row is dropped rather than failed, so it holds no budget and no retry waits on it.
  const others = refused.filter((entry) => entry.failure.code !== "blocked");
  if (others.length === 0) {
    return { status: "dropped", reason: "no_push_device", gone, notices };
  }
  // A refusal that may pass (Expo's rate limit) is tried again before one that cannot.
  const chosen = others.find((entry) => RETRYABLE.has(entry.failure.code)) ?? others[0];
  const failure = chosen?.failure;
  return {
    status: "failed",
    error: new ChannelSendError(failure?.code ?? "unknown", failure?.message ?? "expo push"),
    gone,
    notices,
  };
}

/** The codes a `ChannelSendError` retries, as its constructor decides. */
const RETRYABLE: ReadonlySet<ChannelSendErrorCode> = new Set<ChannelSendErrorCode>([
  "rate_limited",
  "quota_exhausted",
  "unavailable",
]);

function failed(error: ChannelSendError): PushSend {
  return { status: "failed", error, gone: [], notices: [] };
}

/**
 * A drop, before any phone was asked. Whether it leaves a quiet notice unheard is decided with the
 * drop itself, under the quiet event's lock (`settlePush`), never here: read now, the round's other
 * notice could be failing at this very moment and read this one as still on its way.
 */
function dropped(reason: PushDropReason): PushSend {
  return { status: "dropped", reason, gone: [], notices: [] };
}

/**
 * Writes what a push came to, in the transaction that records its row's outcome — marked sent,
 * dropped, or given back or failed — and returns the founder's alerts to enqueue there:
 *
 * - a sent push's tickets (`recordPushTickets`, D-B1);
 * - for a quiet notice dropped unsent, the founder's alert when that left its reader unheard (S2),
 *   decided under the quiet event's lock after the drop is written, the lock a notice of the round
 *   failing for good takes too, so of the two, the one that decides second sees the other's final
 *   status and neither can read the other as still on its way;
 * - each phone Expo said is gone, deleted while it holds the token the push went to, with the
 *   alert when that left a family with nobody to tell, so a delete never commits without it;
 * - the alerts the send already made (Vela's own credentials refused).
 *
 * The drop's alert comes before the phones, so the quiet event is locked before any device row,
 * as the receipts check takes them.
 */
export async function settlePush(
  deps: Deps,
  tx: VelaTransaction,
  row: Outbound,
  push: PushSend,
  effect: unknown,
): Promise<OutboundRequest[]> {
  const notices: OutboundRequest[] = [];
  if (push.status === "sent") {
    await recordPushTickets(tx, push.tickets);
  }
  if (push.status === "dropped" && row.kind === "quiet_notice") {
    const unheard = await quietNoticeUnheard(deps, tx, { row, effect });
    if (unheard !== null) {
      notices.push(unheard);
    }
  }
  const lost = new Map<string, string>();
  for (const phone of push.gone) {
    const gone = await forgetGoneDevice(tx, phone.deviceId, phone.tokenSha256);
    if (gone !== null) {
      deps.logger.info("push_device_gone", { deviceId: phone.deviceId, by: "ticket" });
      if (!lost.has(gone.userId)) lost.set(gone.userId, phone.deviceId);
    }
  }
  for (const [userId, deviceId] of lost) {
    notices.push(
      ...(await alertsAfterDeviceLoss(
        deviceAlertsOf(deps),
        tx,
        userId,
        `push_device_gone:${deviceId}`,
      )),
    );
  }
  notices.push(...push.notices);
  return notices;
}

/**
 * The account's phones a push of `kind` can go to: notifications allowed, and for the quiet notice
 * and its close, the loud Android channel not blocked, which the ordinary pushes do not use.
 */
async function phonesToTell(db: Queryable, userId: string, kind: PushKind): Promise<Phone[]> {
  const devices = await db
    .select()
    .from(pushDevices)
    .where(
      and(
        eq(pushDevices.userId, userId),
        eq(pushDevices.permission, "granted"),
        isOrdinaryPush(kind) ? undefined : eq(pushDevices.quietChannelBlocked, false),
      ),
    )
    .orderBy(asc(pushDevices.createdAt), asc(pushDevices.id));
  const phones: Phone[] = [];
  for (const device of devices) {
    phones.push({ device, tokenSha256: await sha256Hex(device.token) });
  }
  return phones;
}

/**
 * What a tap opens (`PushData`, ids only): the family, the kept-light member it is about, and the
 * quiet event, the exchange or tomorrow's suggestion. Null when the row no longer points at one.
 */
async function pushDataOf(
  db: Queryable,
  loaded: PushRow,
  kind: PushKind,
  effect: unknown,
): Promise<PushData | null> {
  const { row, family } = loaded;
  let data: unknown = null;
  switch (kind) {
    case "quiet_notice": {
      const parsed = QuietNoticeEffect.safeParse(effect);
      const quiet = parsed.success ? await quietEventById(db, parsed.data.quietEventId) : null;
      data = quiet && {
        kind,
        family_id: family.id,
        member_id: quiet.memberId,
        quiet_event_id: quiet.id,
        exchange_id: quiet.exchangeId,
      };
      break;
    }
    case "quiet_resolved": {
      const [quiet] =
        row.exchangeId === null
          ? []
          : await db
              .select()
              .from(quietEvents)
              .where(eq(quietEvents.exchangeId, row.exchangeId))
              .limit(1);
      data = quiet && {
        kind,
        family_id: family.id,
        member_id: quiet.memberId,
        quiet_event_id: quiet.id,
        exchange_id: quiet.exchangeId,
      };
      break;
    }
    case "answer_receipt": {
      const [exchange] =
        row.exchangeId === null
          ? []
          : await db
              .select({ id: exchanges.id, recipientId: exchanges.recipientId })
              .from(exchanges)
              .where(eq(exchanges.id, row.exchangeId))
              .limit(1);
      data = exchange && {
        kind,
        family_id: family.id,
        member_id: exchange.recipientId,
        exchange_id: exchange.id,
      };
      break;
    }
    case "turn_prompt": {
      const parsed = TurnPromptEffect.safeParse(effect);
      if (!parsed.success) break;
      const [suggestion] = await db
        .select({ id: suggestions.id })
        .from(suggestions)
        .where(
          and(
            eq(suggestions.aboutMemberId, parsed.data.recipientId),
            eq(suggestions.localDay, parsed.data.localDay),
          ),
        )
        .limit(1);
      data = {
        kind,
        family_id: parsed.data.familyId,
        member_id: parsed.data.recipientId,
        ...(suggestion === undefined ? {} : { suggestion_id: suggestion.id }),
      };
      break;
    }
  }
  const parsed = PushData.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * What the refused tickets of one send call for: each logged by device and Expo's label; a phone
 * that is gone kept for `settlePush` to delete, with the founder's alert if that leaves a family
 * with nobody to tell; Vela's own credentials refused told to the founder once a day.
 */
function afterRefusals(
  deps: Pick<Deps, "config" | "clock" | "logger">,
  row: Outbound,
  refused: readonly { phone: Phone; failure: PushFailure }[],
): { gone: GonePhone[]; notices: OutboundRequest[] } {
  const notices: OutboundRequest[] = [];
  const gone: GonePhone[] = [];
  const reasons = new Set<string>();
  for (const { phone, failure } of refused) {
    deps.logger.warn("push_ticket_refused", {
      outboundId: row.id,
      kind: row.kind,
      deviceId: phone.device.id,
      code: failure.code,
      reason: failure.reason,
    });
    if (failure.code === "blocked") {
      gone.push({ deviceId: phone.device.id, tokenSha256: phone.tokenSha256 });
    } else if (failure.misconfigured) {
      addMisconfigured(deps, notices, reasons, row.memberId, failure);
    }
  }
  return { gone, notices };
}

/** Vela's own push credentials were refused: logged, and the founder's alert of the day added. */
function addMisconfigured(
  deps: Pick<Deps, "config" | "clock" | "logger">,
  notices: OutboundRequest[],
  reasons: Set<string>,
  memberId: string,
  failure: PushFailure,
): void {
  if (reasons.has(failure.reason)) {
    return;
  }
  reasons.add(failure.reason);
  deps.logger.error("push_misconfigured", { reason: failure.reason, code: failure.code });
  const alert = pushMisconfiguredAlert(deps, memberId, failure.reason);
  if (alert !== null) {
    notices.push(alert);
  }
}

/**
 * Keeps the tickets of a send that has just succeeded, in the transaction that marks its row sent
 * (D-B1). Each phone is held against a delete until this commits (`for key share`); one deleted
 * since the send — signed out, or found gone — keeps no ticket, since its receipt could change
 * nothing, and the send must not fail over it.
 */
export async function recordPushTickets(
  tx: VelaTransaction,
  tickets: readonly NewPushTicket[],
): Promise<void> {
  if (tickets.length === 0) {
    return;
  }
  const alive = await tx
    .select({ id: pushDevices.id })
    .from(pushDevices)
    .where(
      inArray(
        pushDevices.id,
        tickets.map((ticket) => ticket.deviceId),
      ),
    )
    .for("key share");
  const kept = new Set(alive.map((device) => device.id));
  const keep = tickets.filter((ticket) => kept.has(ticket.deviceId));
  if (keep.length > 0) {
    await tx.insert(pushTickets).values(keep).onConflictDoNothing();
  }
}

// receipts ---------------------------------------------------------------------------------------

/** A ticket is asked about this long after its send, as Expo advises. */
export const RECEIPT_AFTER_MINUTES = 15;
/** At most this many tickets a run, the oldest first: one `getReceipts` request's worth. */
export const RECEIPTS_PER_RUN = 1000;
/** Expo keeps a receipt for a day: a ticket this old without one will never get one. */
export const RECEIPT_GIVE_UP_HOURS = 24;

/** How a message leaves the receipts check: enqueued inside the transaction that decided it. */
export type EmitIn = (tx: VelaTransaction, request: OutboundRequest) => Promise<unknown>;

export interface PushReceiptsRun {
  /** Tickets asked about. */
  asked: number;
  ok: number;
  refused: number;
  /** Tickets with no receipt yet, asked again next run. */
  waiting: number;
  /** Tickets a day old with no receipt, given up on. */
  missing: number;
}

const NO_RUN: PushReceiptsRun = { asked: 0, ok: 0, refused: 0, waiting: 0, missing: 0 };

/**
 * Reads Apple's and Google's receipts for the tickets at least 15 minutes old, the 1000 oldest
 * (S3), from `reconcile`, after the ticks. A ticket whose receipt came back is deleted; one without
 * is asked about again next run, until a day has passed, when it is logged `push_receipt_missing`
 * and deleted. A refused receipt is logged; DeviceNotRegistered deletes the phone while it still
 * holds the token the push went to (and tells the founder if a family is left with nobody to tell),
 * Vela's own credentials refused tell the founder once a day, and a quiet notice left unheard by
 * any refusal tells the founder too. Nothing while push is off. Throws when Expo cannot be asked;
 * the next run asks again.
 */
export async function checkPushReceipts(deps: Deps, emit: EmitIn): Promise<PushReceiptsRun> {
  if (deps.push === null) {
    return NO_RUN;
  }
  const now = deps.clock.now();
  const due = await deps.db
    .select({ ticket: pushTickets, row: outbound })
    .from(pushTickets)
    .innerJoin(outbound, eq(outbound.id, pushTickets.outboundId))
    .where(lte(pushTickets.createdAt, new Date(now.getTime() - RECEIPT_AFTER_MINUTES * 60_000)))
    .orderBy(asc(pushTickets.createdAt), asc(pushTickets.id))
    .limit(RECEIPTS_PER_RUN);
  if (due.length === 0) {
    return NO_RUN;
  }
  const giveUpBefore = now.getTime() - RECEIPT_GIVE_UP_HOURS * 60 * 60_000;
  const expired = due.filter((entry) => entry.ticket.createdAt.getTime() <= giveUpBefore);
  const asked = due.filter((entry) => entry.ticket.createdAt.getTime() > giveUpBefore);
  for (const { ticket, row } of expired) {
    deps.logger.warn("push_receipt_missing", {
      outboundId: row.id,
      kind: row.kind,
      deviceId: ticket.deviceId,
    });
  }
  if (expired.length > 0) {
    await deps.db.delete(pushTickets).where(
      inArray(
        pushTickets.id,
        expired.map((entry) => entry.ticket.id),
      ),
    );
  }
  if (asked.length === 0) {
    return { ...NO_RUN, missing: expired.length };
  }

  let receipts: Readonly<Record<string, PushReceipt>>;
  try {
    receipts = await deps.push.getReceipts(asked.map((entry) => entry.ticket.id));
  } catch (error) {
    const failure = pushFailureOf(error);
    const [first] = asked;
    if (failure?.misconfigured === true && first !== undefined) {
      const notices: OutboundRequest[] = [];
      addMisconfigured(deps, notices, new Set(), first.row.memberId, failure);
      await deps.db.transaction(async (tx) => {
        for (const notice of notices) await emit(tx, notice);
      });
    }
    throw error;
  }

  const okIds: string[] = [];
  const refused: { entry: (typeof asked)[number]; failure: PushFailure }[] = [];
  for (const entry of asked) {
    const receipt = Object.hasOwn(receipts, entry.ticket.id)
      ? receipts[entry.ticket.id]
      : undefined;
    if (receipt?.status === "ok") {
      okIds.push(entry.ticket.id);
    } else if (receipt?.status === "error") {
      refused.push({ entry, failure: receipt.failure });
    }
  }
  if (okIds.length > 0) {
    await deps.db.delete(pushTickets).where(inArray(pushTickets.id, okIds));
  }
  // A row one of whose phones took the push was heard, whatever its other phones said.
  const heard = new Set(
    asked.filter((entry) => okIds.includes(entry.ticket.id)).map((e) => e.row.id),
  );
  const reasons = new Set<string>();
  for (const { entry, failure } of refused) {
    try {
      await deps.db.transaction((tx) =>
        afterRefusedReceipt(deps, tx, emit, entry, failure, {
          heard,
          reasons,
        }),
      );
    } catch (error) {
      // One ticket that cannot be settled is left for the next run; the others still are.
      deps.logger.error("push_receipt_failed", {
        outboundId: entry.row.id,
        deviceId: entry.ticket.deviceId,
        error: errorLabel(error),
      });
    }
  }
  const run: PushReceiptsRun = {
    asked: asked.length,
    ok: okIds.length,
    refused: refused.length,
    waiting: asked.length - okIds.length - refused.length,
    missing: expired.length,
  };
  deps.logger.info("push_receipts_checked", { ...run });
  return run;
}

/**
 * One refused receipt, settled in its own transaction: the ticket goes, and what it means follows.
 * A quiet notice no phone of the reader took, whatever Apple or Google refused it for, tells the
 * founder (S2) once its last ticket is settled: not while another phone's receipt is still to come,
 * and not when another phone's receipt came back ok in this run. One that came back ok in an
 * earlier run was deleted then, so that notice can still raise the alert: a false alarm, never a
 * missed one.
 *
 * Such a notice stays `sent` (Expo took it) but is marked unheard (`pushUnheardError`) in the same
 * transaction, so the round's Telegram notice, if it is still waiting for a retry and later fails
 * for good, does not count this one as having reached the reader and stay silent. For a quiet
 * notice the row and then its quiet event are locked first, the order the gateway's drop and
 * failure take them in, so a Telegram notice of the round failing at the same moment decides
 * after this commits, or before this reads.
 */
async function afterRefusedReceipt(
  deps: Deps,
  tx: VelaTransaction,
  emit: EmitIn,
  entry: { ticket: typeof pushTickets.$inferSelect; row: Outbound },
  failure: PushFailure,
  run: { heard: ReadonlySet<string>; reasons: Set<string> },
): Promise<void> {
  const { ticket, row } = entry;
  deps.logger.warn("push_receipt_refused", {
    outboundId: row.id,
    kind: row.kind,
    deviceId: ticket.deviceId,
    code: failure.code,
    reason: failure.reason,
  });
  const quietNotice = row.kind === "quiet_notice" && row.channel === PUSH_CHANNEL;
  const effect = effectOfRow(row);
  if (quietNotice) {
    await tx
      .select({ id: outbound.id })
      .from(outbound)
      .where(eq(outbound.id, row.id))
      .for("no key update");
    await lockQuietEventOfNotice(tx, effect);
  }
  // Deleting the phone below also deletes its other tickets, so this one may be gone already.
  await tx.delete(pushTickets).where(eq(pushTickets.id, ticket.id));
  if (failure.code === "blocked") {
    const gone = await forgetGoneDevice(tx, ticket.deviceId, ticket.tokenSha256);
    if (gone !== null) {
      deps.logger.info("push_device_gone", { deviceId: ticket.deviceId, by: "receipt" });
      for (const alert of await alertsAfterDeviceLoss(
        deviceAlertsOf(deps),
        tx,
        gone.userId,
        `push_device_gone:${ticket.deviceId}`,
      )) {
        await emit(tx, alert);
      }
    }
  } else if (failure.misconfigured) {
    const notices: OutboundRequest[] = [];
    addMisconfigured(deps, notices, run.reasons, row.memberId, failure);
    for (const notice of notices) await emit(tx, notice);
  }
  if (quietNotice && !run.heard.has(row.id)) {
    // Another phone's ticket for the same notice may still be waiting for its receipt.
    const [waiting] = await tx
      .select({ id: pushTickets.id })
      .from(pushTickets)
      .where(eq(pushTickets.outboundId, row.id))
      .limit(1);
    if (waiting === undefined) {
      await tx
        .update(outbound)
        .set({ error: pushUnheardError(failure.reason) })
        .where(eq(outbound.id, row.id));
      const unheard = await quietNoticeUnheard(deps, tx, { row, effect });
      if (unheard !== null) {
        await emit(tx, unheard);
      }
    }
  }
}

/** The effect stored with a sent row (`outbound.payload.effect`), or undefined. */
function effectOfRow(row: Outbound): unknown {
  const payload: unknown = row.payload;
  return typeof payload === "object" && payload !== null && "effect" in payload
    ? payload.effect
    : undefined;
}
