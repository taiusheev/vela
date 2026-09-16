/**
 * Silence (spec §8, flows §3.12): a quiet event opens when her morning goes unanswered past
 * T_quiet, organisers are told (at once, or after the learning period's eight hours), a "wait 2
 * hours" tap brings the notice back, and any answer or a "she's fine" tap closes it and tells
 * everyone who was told. Nothing is ever sent to a nearby contact: their names and numbers are
 * listed for the organiser to call.
 */
import type { Button, Channel, InboundEvent, LocalDate } from "@vela/contracts";
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
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { formatNearbyContacts, formatTime } from "./format.ts";
import { enqueueOutbound } from "./gateway.ts";
import {
  activeOrganisersWithLinks,
  channelLinkOfMember,
  consentedNearbyContacts,
  familyById,
  lockExchangeForLocalDate,
  markWakeDue,
  memberByChannelUser,
  memberById,
  quietEventById,
  recentAnswerTimes,
} from "./repo.ts";

/** The pilot's organisers are reached on Telegram (flows §3.12). */
const NOTICE_CHANNEL: Channel = "telegram";

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
  // A morning she has answered is never quiet (flows §3.12). The schedule decided this from state
  // read before the transaction, so a day answered since then is caught only here.
  if (exchange.answeredAt !== null) {
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
function usualAnswerTime(answerTimes: readonly Date[], timeZone: string): string | null {
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

/** One `quiet_resolved` to each member who was told, except `exclude`, in their own language. */
async function tellNotified(
  deps: Deps,
  tx: VelaTransaction,
  input: {
    quiet: QuietEvent;
    exclude: string | null;
    text: (lang: Member["language"]) => string;
  },
): Promise<void> {
  for (const readerId of input.quiet.notifiedMemberIds) {
    if (readerId === input.exclude) {
      continue;
    }
    const reader = await memberById(tx, readerId);
    const link = await channelLinkOfMember(tx, readerId, NOTICE_CHANNEL);
    if (reader === null || link === null || link.blockedAt !== null) {
      continue;
    }
    await enqueueOutbound(deps, tx, {
      kind: "quiet_resolved",
      idempotencyKey: outboundKey("quiet_resolved", {
        quietEventId: input.quiet.id,
        memberId: readerId,
      }),
      memberId: readerId,
      channel: link.channel,
      conversationId: link.externalId,
      exchangeId: input.quiet.exchangeId,
      lang: reader.language,
      text: input.text(reader.language),
    });
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
  await tx
    .update(quietEvents)
    .set({ resolvedAt: now, outcome: "answered_late" })
    .where(eq(quietEvents.id, quiet.id));
  const time = formatTime(now, member.tz);
  await tellNotified(deps, tx, {
    quiet,
    exclude: null,
    text: (lang) => t(lang, "quiet.resolved_answered", { name: member.displayName, time }),
  });
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
      await tx
        .update(quietEvents)
        .set({ resolvedAt: now, outcome: "fine_known", resolvedBy: sender.member.id })
        .where(eq(quietEvents.id, locked.id));
      await tellNotified(deps, tx, {
        quiet: locked,
        exclude: sender.member.id,
        text: (readerLang) =>
          t(readerLang, "quiet.resolved_fine", {
            organiser: sender.member.displayName,
            name: her.displayName,
          }),
      });
      await recordEvent(
        tx,
        {
          name: "quiet_notice_resolved",
          familyId: her.familyId,
          memberId: her.id,
          exchangeId: locked.exchangeId,
          props: { outcome: "fine_known", by: sender.member.id },
        },
        now,
      );
      return true;
    });
    if (resolved) {
      replacement = t(lang, "quiet.fine_button", { name: her.displayName });
    }
  } else {
    const waitUntil = addMinutes(now, SCHEDULE.waitMinutes);
    const waiting = await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(quietEvents)
        .where(eq(quietEvents.id, quiet.id))
        .for("update");
      if (locked === undefined || locked.resolvedAt !== null) {
        return false;
      }
      await tx.update(quietEvents).set({ waitUntil }).where(eq(quietEvents.id, locked.id));
      // The wait is a threshold the schedule did not know about, so her scheduler decides again:
      // the alarm at once, and `reconcile` should the alarm never fire.
      await markWakeDue(tx, her.id, now);
      return true;
    });
    if (waiting) {
      replacement = t(lang, "quiet.waiting", { time: formatTime(waitUntil, her.tz) });
      await deps.scheduler.wakeAt(her.id, now);
    }
  }
  if (event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId, replacement);
  }
}
