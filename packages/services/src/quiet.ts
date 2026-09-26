/**
 * Silence (spec §8, flows §3.12): a quiet event opens when her morning goes unanswered past
 * T_quiet, organisers are told (at once, or after the learning period's eight hours), a "wait 2
 * hours" tap brings the notice back, and any answer or a "she's fine" tap closes it and tells
 * everyone who was told. Nothing is ever sent to a nearby contact: their names and numbers are
 * listed for the organiser to call.
 */
import type { Button, InboundEvent, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  addMinutes,
  type ButtonAction,
  encodeButton,
  localTimeOf,
  outboundKey,
  SCHEDULE,
  TUNING,
} from "@vela/core";
import {
  type Exchange,
  type Family,
  type Member,
  type QuietEvent,
  quietEvents,
  type VelaTransaction,
} from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { quietNobodyToldAlert } from "./admin-alerts.ts";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { formatNearbyContacts, formatTime } from "./format.ts";
import { enqueueOutbound, type OutboundRequest } from "./gateway.ts";
import { closingNoticeFor, NOTICE_CHANNEL } from "./quiet-closing.ts";
import {
  activeOrganisersWithLinks,
  consentedNearbyContacts,
  familyById,
  firstAnswersByDate,
  lockExchangeForLocalDate,
  markWakeDue,
  memberByChannelUser,
  memberById,
  quietEventById,
  recentAnswerTimes,
} from "./repo.ts";

/** `Button.label` allows at most 64 characters, and her name is the family's own words. */
const LABEL_MAX_LENGTH = 64;

export type QuietButtonAction = Extract<ButtonAction, { type: "quiet_fine" | "quiet_wait" }>;

interface QuietContext {
  member: Member;
  family: Family;
  exchange: Exchange;
}

async function loadQuietContext(
  deps: Deps,
  tx: VelaTransaction,
  memberId: string,
  date: LocalDate,
): Promise<QuietContext | null> {
  const member = await memberById(tx, memberId);
  const family = member === null ? null : await familyById(tx, member.familyId);
  // Locked, so the answer that lands while the tick is deciding is either already visible here or
  // waits for this transaction and then resolves what it opened.
  const exchange = await lockExchangeForLocalDate(tx, memberId, date);
  if (member === null || family === null || exchange === null) {
    deps.logger.warn("quiet_context_missing", { memberId, date });
    return null;
  }
  // Silence is measured from a delivery: a morning that never reached her, or whose delivery
  // failed, opens no quiet event (flows §3.7), however the decision that got here was made.
  if (exchange.deliveredAt === null || exchange.deliveryFailedAt !== null) {
    deps.logger.warn("quiet_without_delivery", { memberId, date, exchangeId: exchange.id });
    return null;
  }
  // A morning she has answered is never quiet (flows §3.12), and an answer counts for the local date
  // it arrives on, whichever exchange it attached to (flows §3.9): a message before the arrival, or
  // a tap on an older arrival's buttons. The schedule decided this from state read before the
  // transaction, so a day answered since then is caught only here. An answer to another exchange
  // takes this lock too (`lightTheLight`), so it is visible here or closes what this opens.
  if (
    exchange.answeredAt !== null ||
    (await firstAnswersByDate(tx, memberId, member.tz, date, date)).has(date)
  ) {
    deps.logger.info("quiet_after_answer", { memberId, date, exchangeId: exchange.id });
    return null;
  }
  return { member, family, exchange };
}

function fitLabel(text: string): string {
  if (text.length <= LABEL_MAX_LENGTH) {
    return text;
  }
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > LABEL_MAX_LENGTH - 1) {
      break;
    }
    kept += character;
  }
  return `${kept.trimEnd()}…`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * When she usually answers: the median wall-clock time of her recent answered days, in her zone.
 * Null until her rhythm is known (spec §8: from the 14th answered day).
 */
export function usualAnswerTime(answerTimes: readonly Date[], timeZone: string): string | null {
  if (answerTimes.length < TUNING.minSamples) {
    return null;
  }
  const minutes = answerTimes
    .map((instant) => {
      const [hour, minute] = localTimeOf(instant, timeZone).split(":");
      return Number(hour) * 60 + Number(minute);
    })
    .sort((a, b) => a - b);
  const middle = Math.floor(minutes.length / 2);
  const upper = minutes[middle] ?? 0;
  const median =
    minutes.length % 2 === 1 ? upper : Math.round(((minutes[middle - 1] ?? upper) + upper) / 2);
  return `${pad(Math.floor(median / 60))}:${pad(median % 60)}`;
}

/**
 * One notice per active organiser with a Telegram link, keyed by the round (the event's notify
 * count before this round), so a re-notification after "wait" is a new message and a replay of the
 * same round is not.
 */
async function sendQuietNotices(
  deps: Deps,
  tx: VelaTransaction,
  ctx: QuietContext & { quiet: QuietEvent },
): Promise<void> {
  const { member, family, exchange, quiet } = ctx;
  const organisers = await activeOrganisersWithLinks(tx, family.id, NOTICE_CHANNEL);
  if (organisers.length === 0) {
    // Nobody who could be told: an app-made family, or one whose last organiser was marked left or
    // blocked the bot. Her silence must not end here unheard, so the founder hears it.
    deps.logger.error("quiet_notice_nobody_told", { familyId: family.id, memberId: member.id });
    const alert = quietNobodyToldAlert(deps, {
      quietId: quiet.id,
      round: quiet.notifyCount,
      her: member,
      family,
    });
    if (alert !== null) {
      await enqueueOutbound(deps, tx, alert);
    }
    return;
  }
  const contacts = await consentedNearbyContacts(tx, member.id);
  const usual = usualAnswerTime(
    await recentAnswerTimes(tx, member.id, TUNING.minSamples),
    member.tz,
  );
  const sent = formatTime(exchange.deliveredAt ?? quiet.openedAt, member.tz);
  const name = member.displayName;

  for (const organiser of organisers) {
    const lang = organiser.member.language;
    const paragraphs = [
      usual === null
        ? t(lang, "quiet.notice_no_usual", { name, sent })
        : t(lang, "quiet.notice", { name, sent, usual }),
    ];
    if (contacts.length > 0) {
      paragraphs.push(t(lang, "quiet.nearby", { contacts: formatNearbyContacts(lang, contacts) }));
    }
    const buttons: Button[][] = [
      [
        {
          id: encodeButton({ type: "quiet_fine", quietEventId: quiet.id }),
          label: fitLabel(t(lang, "quiet.fine_button", { name })),
        },
        {
          id: encodeButton({ type: "quiet_wait", quietEventId: quiet.id }),
          label: t(lang, "quiet.wait_button"),
        },
      ],
    ];
    await enqueueOutbound(deps, tx, {
      kind: "quiet_notice",
      idempotencyKey: outboundKey("quiet_notice", {
        quietEventId: quiet.id,
        memberId: organiser.member.id,
        suffix: String(quiet.notifyCount),
      }),
      memberId: organiser.member.id,
      channel: organiser.link.channel,
      conversationId: organiser.link.externalId,
      exchangeId: exchange.id,
      lang,
      text: paragraphs.join("\n\n"),
      buttons,
      ref: { purpose: "quiet_notice", exchangeId: exchange.id, quietEventId: quiet.id },
      effect: {
        quietEventId: quiet.id,
        notifyCount: quiet.notifyCount + 1,
        notifiedMemberId: organiser.member.id,
      },
    });
  }
}

/**
 * Opens the quiet event for her exchange of that date and, when `notify`, tells the organisers in
 * the same transaction. `last_notified_at` is set as the notices are enqueued, so the next schedule
 * decision does not ask again before they are out. An event already open is left as it is.
 */
export async function openQuiet(
  deps: Deps,
  memberId: string,
  date: LocalDate,
  notify: boolean,
): Promise<void> {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const ctx = await loadQuietContext(deps, tx, memberId, date);
    if (ctx === null) {
      return;
    }
    const [quiet] = await tx
      .insert(quietEvents)
      .values({
        exchangeId: ctx.exchange.id,
        memberId,
        openedAt: now,
        lastNotifiedAt: notify ? now : null,
      })
      .onConflictDoNothing()
      .returning();
    if (quiet === undefined) {
      return;
    }
    if (notify) {
      await sendQuietNotices(deps, tx, { ...ctx, quiet });
    }
  });
}

/**
 * The schedule's own rule (core's `decideSchedule`), checked again under the row lock: a notice is
 * due when nobody was told yet, or a wait has passed since the last notice. Two ticks deciding at
 * once, or a decision made on stale state, then cannot send a round twice.
 */
function notificationDue(quiet: QuietEvent, now: Date): boolean {
  if (quiet.lastNotifiedAt === null) {
    return true;
  }
  return (
    quiet.waitUntil !== null &&
    quiet.waitUntil.getTime() > quiet.lastNotifiedAt.getTime() &&
    now.getTime() >= quiet.waitUntil.getTime()
  );
}

/** Tells the organisers about an open, unresolved quiet event whose notice is due. */
export async function notifyQuiet(deps: Deps, memberId: string, date: LocalDate): Promise<void> {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const ctx = await loadQuietContext(deps, tx, memberId, date);
    if (ctx === null) {
      return;
    }
    const [quiet] = await tx
      .select()
      .from(quietEvents)
      .where(eq(quietEvents.exchangeId, ctx.exchange.id))
      .for("update");
    if (quiet === undefined || quiet.resolvedAt !== null || !notificationDue(quiet, now)) {
      return;
    }
    await tx.update(quietEvents).set({ lastNotifiedAt: now }).where(eq(quietEvents.id, quiet.id));
    await sendQuietNotices(deps, tx, { ...ctx, quiet });
  });
}

/**
 * How a message leaves a transaction: enqueued at once from the pilot Worker, or written alone by an
 * API mutation, which hands the rows over after it commits (`insertOutbound`).
 */
export type EmitOutbound = (request: OutboundRequest) => Promise<unknown>;

/**
 * One `quiet_resolved` to each member the closed event counts as told, except whoever closed it, in
 * their own language (`closingNoticeFor`). A notice still on its way is not counted yet; the gateway
 * tells its reader once it lands (`quietNoticeSent`), and drops one not yet sent.
 */
async function tellNotified(
  tx: VelaTransaction,
  closed: QuietEvent,
  her: Member,
  emit: EmitOutbound,
): Promise<void> {
  for (const readerId of closed.notifiedMemberIds) {
    const notice = await closingNoticeFor(tx, closed, her, readerId);
    if (notice !== null) {
      await emit(notice);
    }
  }
}

/**
 * Her answer closes the exchange's open quiet event (`answered_late`) inside the answer's own
 * transaction, and everyone who was told hears that the light is lit again.
 */
export async function resolveQuietOnAnswer(
  deps: Deps,
  tx: VelaTransaction,
  exchangeId: string,
): Promise<void> {
  const now = deps.clock.now();
  const [quiet] = await tx
    .select()
    .from(quietEvents)
    .where(and(eq(quietEvents.exchangeId, exchangeId), isNull(quietEvents.resolvedAt)))
    .for("update");
  if (quiet === undefined) {
    return;
  }
  const member = await memberById(tx, quiet.memberId);
  if (member === null) {
    return;
  }
  const [closed] = await tx
    .update(quietEvents)
    .set({ resolvedAt: now, outcome: "answered_late" })
    .where(eq(quietEvents.id, quiet.id))
    .returning();
  if (closed === undefined) {
    throw new Error("quiet event vanished under its own lock");
  }
  await tellNotified(tx, closed, member, (request) => enqueueOutbound(deps, tx, request));
  await recordEvent(
    tx,
    {
      name: "quiet_notice_resolved",
      familyId: member.familyId,
      memberId: member.id,
      exchangeId,
      props: { outcome: "answered_late", told: quiet.notifiedMemberIds.length },
    },
    now,
  );
}

/**
 * "She's fine" (spec §8, flows §3.12): the event, already locked by the caller and still open, closes
 * with `fine_known` and who said so; everyone else who was told hears it, through `emit`. Shared by
 * the Telegram tap and the app, so the two cannot close an event differently.
 */
export async function resolveQuietAsFine(
  tx: VelaTransaction,
  now: Date,
  input: { quiet: QuietEvent; her: Member; resolver: Member },
  emit: EmitOutbound,
): Promise<void> {
  const { quiet, her, resolver } = input;
  const [closed] = await tx
    .update(quietEvents)
    .set({ resolvedAt: now, outcome: "fine_known", resolvedBy: resolver.id })
    .where(eq(quietEvents.id, quiet.id))
    .returning();
  if (closed === undefined) {
    throw new Error("quiet event vanished under its caller's lock");
  }
  await tellNotified(tx, closed, her, emit);
  await recordEvent(
    tx,
    {
      name: "quiet_notice_resolved",
      familyId: her.familyId,
      memberId: her.id,
      exchangeId: quiet.exchangeId,
      props: { outcome: "fine_known", by: resolver.id },
    },
    now,
  );
}

/**
 * "Wait 2 hours": the event, already locked by the caller and still open, is not to be raised again
 * before the wait ends. The wait is a threshold her schedule did not know about, so her next wake is
 * marked due at once — which `reconcile` finds should nothing else wake her. Returns when it ends.
 */
export async function waitOnQuiet(
  tx: VelaTransaction,
  now: Date,
  input: { quiet: QuietEvent; her: Member },
): Promise<Date> {
  const waitUntil = addMinutes(now, SCHEDULE.waitMinutes);
  await tx.update(quietEvents).set({ waitUntil }).where(eq(quietEvents.id, input.quiet.id));
  await markWakeDue(tx, input.her.id, now);
  return waitUntil;
}

/**
 * An organiser's tap on a quiet notice. The payload names the event, but the tapper must be a
 * member of her family, or the tap is acknowledged and ignored. A tap on an event already resolved
 * only takes the buttons away.
 */
export async function handleQuietButton(
  deps: Deps,
  event: InboundEvent,
  action: QuietButtonAction,
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  const quiet = await quietEventById(deps.db, action.quietEventId);
  const her = quiet === null ? null : await memberById(deps.db, quiet.memberId);
  if (sender === null || quiet === null || her === null || her.familyId !== sender.family.id) {
    deps.logger.warn("quiet_button_ignored", { action: action.type, known: quiet !== null });
    return;
  }
  const now = deps.clock.now();
  const lang = sender.member.language;
  let replacement: string | undefined;
  if (action.type === "quiet_fine") {
    const resolved = await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(quietEvents)
        .where(eq(quietEvents.id, quiet.id))
        .for("update");
      if (locked === undefined || locked.resolvedAt !== null) {
        return false;
      }
      await resolveQuietAsFine(
        tx,
        now,
        { quiet: locked, her, resolver: sender.member },
        (request) => enqueueOutbound(deps, tx, request),
      );
      return true;
    });
    if (resolved) {
      replacement = t(lang, "quiet.fine_button", { name: her.displayName });
    }
  } else {
    const waitUntil = await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(quietEvents)
        .where(eq(quietEvents.id, quiet.id))
        .for("update");
      if (locked === undefined || locked.resolvedAt !== null) {
        return null;
      }
      return waitOnQuiet(tx, now, { quiet: locked, her });
    });
    if (waitUntil !== null) {
      replacement = t(lang, "quiet.waiting", { time: formatTime(waitUntil, her.tz) });
      await deps.scheduler.wakeAt(her.id, now);
    }
  }
  if (event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId, replacement);
  }
}
