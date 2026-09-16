/**
 * Her answer (spec §5, flows §3.9). The light path runs first, in one transaction: the answer row,
 * the exchange to `answered`, the open quiet event resolved, her open-ended away periods ended, the
 * event. Everything the family sees follows outside it (the ack, the group post, the understanding
 * jobs) and can fail without touching the light.
 *
 * Nothing she writes before she taps Yes on the consent message, or after she says no, or once she
 * is left or deceased, is stored, sent, posted, or logged: the privacy notice promises it.
 */
import type { AnswerKind, InboundEvent, InboundKind, Lang, MediaRef } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  addMinutes,
  type ButtonAction,
  canApply,
  localDateOf,
  minutesBetween,
  nextExchangeState,
  outboundKey,
} from "@vela/core";
import {
  type Answer,
  answers,
  awayPeriods,
  chips,
  type Exchange,
  exchanges,
  type Family,
  type Member,
} from "@vela/db";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { fitMessageText, formatTime, inboundExternalId } from "./format.ts";
import { enqueueOutbound } from "./gateway.ts";
import { resolveQuietOnAnswer } from "./quiet.ts";
import {
  exchangesByIds,
  familyById,
  latestDeliveredExchangeWithin,
  linkedGroupOfFamily,
  markWakeDue,
  memberById,
  type Queryable,
  recordInboundMedia,
} from "./repo.ts";

/** A message attaches to her most recent delivered exchange within this window (flows §3.9). */
export const ANSWER_WINDOW_HOURS = 36;

export type AnswerButtonAction = Extract<
  ButtonAction,
  { type: "answer" | "chip" | "pick" | "vote" }
>;

/**
 * What she answered, typed by kind so the group line and the stored payload are built from the same
 * value: her words for a message, the option she tapped for a button.
 */
export type AnswerContent =
  | { kind: "text" | "voice" | "photo" | "sticker" | "other"; text: string | null }
  | { kind: "fine" | "heart" }
  | { kind: "chip" | "vote"; index: number; choice: string }
  | { kind: "photo_pick"; index: number; mediaId: string };

/** The kinds a message from her can be: those that carry her words, or none. */
type MessageAnswerKind = Extract<AnswerContent, { text: string | null }>["kind"];

const ANSWER_KIND_BY_INBOUND: ReadonlyMap<InboundKind, MessageAnswerKind> = new Map([
  ["text", "text"],
  ["voice", "voice"],
  ["image", "photo"],
  ["sticker", "sticker"],
  ["other", "other"],
]);

/**
 * Flows §3.9: her messages and taps count once she has consented and while she is active or paused.
 * Before consent, after a No, once she is left or deceased, or once her family's deletion was
 * requested, nothing she sends is stored, sent, posted, or logged.
 */
export function canAnswer(member: Member, family: Family): boolean {
  return (
    member.lightConsentedAt !== null &&
    (member.status === "active" || member.status === "paused") &&
    family.deletedAt === null
  );
}

function payloadOf(content: AnswerContent): Record<string, unknown> {
  switch (content.kind) {
    case "fine":
    case "heart":
      return {};
    case "chip":
    case "vote":
      return { index: content.index, choice: content.choice };
    case "photo_pick":
      return { index: content.index, media_id: content.mediaId };
    default:
      return content.text === null ? {} : { text: content.text };
  }
}

/** The line under the light in the group, in the family's language; none for a heart or a voice. */
function contentLine(lang: Lang, name: string, content: AnswerContent): string | null {
  switch (content.kind) {
    case "chip":
      return t(lang, "group.answer_chip", { name, choice: content.choice });
    case "vote":
      return t(lang, "group.answer_vote", { name, choice: content.choice });
    case "photo_pick":
      return t(lang, "group.answer_pick", { name, n: content.index + 1 });
    case "fine":
    case "heart":
      return null;
    default:
      return content.text === null
        ? null
        : t(lang, "group.answer_text", { name, text: content.text });
  }
}

interface AnswerInput {
  member: Member;
  family: Family;
  exchange: Exchange;
  event: InboundEvent;
  content: AnswerContent;
  /** Her voice or photo, still held by the platform. */
  media: MediaRef | null;
  now: Date;
}

/**
 * The light path (flows §3.9), in one transaction. A duplicate of the platform message (a redelivered
 * webhook, a second tap on the same arrival) ends the flow with `null`.
 */
async function lightTheLight(deps: Deps, input: AnswerInput): Promise<Answer | null> {
  const { member, family, event, content, now } = input;
  const localDate = localDateOf(now, member.tz);
  return deps.db.transaction(async (tx) => {
    const file =
      input.media === null
        ? null
        : await recordInboundMedia(tx, event.channel, {
            familyId: family.id,
            uploadedBy: member.id,
            ref: input.media,
            now,
          });
    const [answer] = await tx
      .insert(answers)
      .values({
        exchangeId: input.exchange.id,
        memberId: member.id,
        kind: content.kind,
        channel: event.channel,
        externalId: inboundExternalId(event),
        payload: payloadOf(content),
        mediaId: file?.id ?? null,
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (answer === undefined) {
      deps.logger.info("answer_duplicate", { memberId: member.id, kind: content.kind });
      return null;
    }

    const [exchange] = await tx
      .select()
      .from(exchanges)
      .where(eq(exchanges.id, input.exchange.id))
      .for("update");
    if (exchange === undefined) {
      // The answer row's foreign key has just proven the exchange exists; this guards the type.
      throw new VelaError("not_found", `exchange ${input.exchange.id} does not exist`);
    }
    const state = canApply(exchange.state, "answer")
      ? nextExchangeState(exchange.state, "answer")
      : exchange.state;
    if (state === exchange.state && exchange.answeredAt === null) {
      deps.logger.warn("answer_illegal_transition", {
        exchangeId: exchange.id,
        from: exchange.state,
      });
    }
    await tx
      .update(exchanges)
      .set({ state, answeredAt: exchange.answeredAt ?? now })
      .where(eq(exchanges.id, exchange.id));

    await resolveQuietOnAnswer(deps, tx, exchange.id);

    // An open-ended away ("until I'm back") lasts until her first answer on or after its start.
    const ended = await tx
      .update(awayPeriods)
      .set({ endedAt: now })
      .where(
        and(
          eq(awayPeriods.memberId, member.id),
          isNull(awayPeriods.toDate),
          isNull(awayPeriods.endedAt),
          lte(awayPeriods.fromDate, localDate),
        ),
      )
      .returning({ id: awayPeriods.id, source: awayPeriods.source });
    for (const period of ended) {
      await recordEvent(
        tx,
        {
          name: "away_ended",
          familyId: family.id,
          memberId: member.id,
          exchangeId: exchange.id,
          props: { source: period.source, by: "answer" },
        },
        now,
      );
    }

    await recordEvent(
      tx,
      {
        name: "answer_recorded",
        familyId: family.id,
        memberId: member.id,
        exchangeId: exchange.id,
        surface: event.channel,
        props: {
          kind: content.kind,
          latency: exchange.deliveredAt === null ? null : minutesBetween(exchange.deliveredAt, now),
          type: exchange.type,
        },
      },
      now,
    );
    // Her repeat and quiet thresholds no longer apply today: the scheduler must decide again.
    await markWakeDue(tx, member.id, now);
    return answer;
  });
}

/** `ack.thanks`, at most once per local day: the budget index refuses a second row. */
async function sendAck(deps: Deps, input: AnswerInput): Promise<void> {
  const { member, event, now } = input;
  const lang = member.language;
  await enqueueOutbound(deps, deps.db, {
    kind: "ack",
    idempotencyKey: outboundKey("ack", { memberId: member.id, date: localDateOf(now, member.tz) }),
    memberId: member.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    exchangeId: input.exchange.id,
    lang,
    text: t(lang, "ack.thanks", { address: member.addressForm ?? member.displayName }),
  });
}

/**
 * The family sees her answer as one `answer_post` per answer (one exchange can take several): the
 * light line, then what she said, with her voice or photo attached by its platform file id.
 */
async function postAnswer(deps: Deps, input: AnswerInput, answer: Answer): Promise<void> {
  const { member, family, exchange, event, content, now } = input;
  const group = await linkedGroupOfFamily(deps.db, family.id, event.channel);
  if (group === null) {
    deps.logger.info("answer_post_skipped", { familyId: family.id, reason: "no_group" });
    return;
  }
  const asker = exchange.askerId === null ? null : await memberById(deps.db, exchange.askerId);
  const lang = family.language;
  const name = member.displayName;
  const time = formatTime(now, member.tz);
  const light =
    exchange.type === "hello" || content.kind === "fine" || asker === null
      ? t(lang, "group.answer_hello", { name, time })
      : t(lang, "group.answer_light", { name, asker: asker.displayName, time });
  const line = contentLine(lang, name, content);
  await enqueueOutbound(deps, deps.db, {
    kind: "answer_post",
    idempotencyKey: outboundKey("answer_post", { exchangeId: exchange.id, suffix: answer.id }),
    memberId: member.id,
    channel: event.channel,
    conversationId: group.conversationId,
    exchangeId: exchange.id,
    lang,
    text: fitMessageText(line === null ? light : `${light}\n${line}`),
    media: input.media === null ? undefined : [input.media],
    ref: { purpose: "answer_post", exchangeId: exchange.id, memberId: member.id },
  });
}

/**
 * One step after the light. A step that throws is logged and the next still runs: the light is
 * already committed, and throwing would only make the platform redeliver the webhook, whose replay
 * finds the answer row and ends at once. An understanding job that was never enqueued is picked up
 * by `reconcile` after 15 minutes (flows §3.15).
 */
async function settle(
  deps: Deps,
  step: string,
  answerId: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    deps.logger.error("after_light_failed", { step, answerId, error: errorLabel(error) });
  }
}

/** What follows the light, outside its transaction: none of it can hold the light back. */
async function afterLight(deps: Deps, input: AnswerInput, answer: Answer): Promise<void> {
  await settle(deps, "ack", answer.id, () => sendAck(deps, input));
  await settle(deps, "post", answer.id, () => postAnswer(deps, input, answer));
  await settle(deps, "queue", answer.id, () =>
    input.content.kind === "voice" && answer.mediaId !== null
      ? deps.queues.media.send({ type: "ingest_answer_media", answerId: answer.id })
      : deps.queues.understand.send({ type: "understand_answer", answerId: answer.id }),
  );
  await settle(deps, "wake", answer.id, () => deps.scheduler.wakeAt(input.member.id, input.now));
}

/**
 * A message with no delivered exchange in the window is still shown to the family, as one `system`
 * post keyed by the inbound event, without an answers row: nothing lights (flows §3.9).
 */
async function postUnattached(
  deps: Deps,
  member: Member,
  family: Family,
  event: InboundEvent,
  kind: AnswerKind,
  now: Date,
): Promise<void> {
  const text = event.text?.trim() ?? "";
  const file = event.media ?? null;
  const group = await linkedGroupOfFamily(deps.db, family.id, event.channel);
  const lang = family.language;
  const name = member.displayName;
  let line: string | null = null;
  if (text.length > 0) {
    line = t(lang, "group.answer_text", { name, text });
  } else if (file?.kind === "audio") {
    line = t(lang, "readback.voice", { name });
  } else if (file?.kind === "image") {
    line = t(lang, "readback.photo", { name });
  }
  if (group !== null && line !== null) {
    await enqueueOutbound(deps, deps.db, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: group.conversationId,
        suffix: event.eventId,
      }),
      memberId: member.id,
      channel: event.channel,
      conversationId: group.conversationId,
      lang,
      text: fitMessageText(line),
      media: file === null ? undefined : [file],
    });
  }
  await recordEvent(
    deps.db,
    {
      name: "answer_recorded",
      familyId: family.id,
      memberId: member.id,
      surface: event.channel,
      props: { kind, unattached: true, posted: group !== null && line !== null },
    },
    now,
  );
}

/**
 * A message from the kept-light member in her private chat that is not a command (flows §3.9). The
 * caller has resolved her; the gate is checked again here, so nothing before consent or after the
 * end can slip through a routing mistake.
 */
export async function handleParentMessage(
  deps: Deps,
  member: Member,
  event: InboundEvent,
): Promise<void> {
  const kind = ANSWER_KIND_BY_INBOUND.get(event.kind);
  if (kind === undefined) {
    return;
  }
  const family = await familyById(deps.db, member.familyId);
  if (family === null || !canAnswer(member, family)) {
    return;
  }
  const now = deps.clock.now();
  const exchange = await latestDeliveredExchangeWithin(
    deps.db,
    member.id,
    addMinutes(now, -ANSWER_WINDOW_HOURS * 60),
  );
  if (exchange === null) {
    await postUnattached(deps, member, family, event, kind, now);
    return;
  }
  const text = event.text?.trim() ?? "";
  const input: AnswerInput = {
    member,
    family,
    exchange,
    event,
    content: { kind, text: text.length > 0 ? text : null },
    media: event.media ?? null,
    now,
  };
  const answer = await lightTheLight(deps, input);
  if (answer !== null) {
    await afterLight(deps, input, answer);
  }
}

/** An arrival's buttons answer only the exchange they were sent for, while it can still take one. */
function answerable(member: Member, exchange: Exchange): boolean {
  return (
    exchange.recipientId === member.id &&
    exchange.deliveredAt !== null &&
    exchange.state !== "archived" &&
    canApply(exchange.state, "answer")
  );
}

/** `exchanges.options.vote_options`: the vote's choices in the order the arrival showed them. */
function voteOptionsOf(options: unknown): string[] {
  if (typeof options !== "object" || options === null || !Object.hasOwn(options, "vote_options")) {
    return [];
  }
  const value: unknown = Reflect.get(options, "vote_options");
  return Array.isArray(value)
    ? value.filter((option): option is string => typeof option === "string")
    : [];
}

interface Choice {
  content: AnswerContent;
  /** Replaces the arrival's buttons, so she sees what she chose. */
  label: string;
}

/**
 * The option a tap names, or null when the index is outside the exchange's options: a stale or
 * forged payload is ignored (with its acknowledgement) rather than answered with the wrong words.
 */
async function resolveChoice(
  db: Queryable,
  lang: Lang,
  exchange: Exchange,
  action: AnswerButtonAction,
): Promise<Choice | null> {
  switch (action.type) {
    case "answer":
      return action.answer === "fine"
        ? { content: { kind: "fine" }, label: t(lang, "button.fine") }
        : { content: { kind: "heart" }, label: t(lang, "button.heart") };
    case "chip": {
      const [row] = await db.select().from(chips).where(eq(chips.exchangeId, exchange.id)).limit(1);
      const choice = row?.chips[action.index];
      return choice === undefined
        ? null
        : { content: { kind: "chip", index: action.index, choice }, label: choice };
    }
    case "pick": {
      // A photo choice is always two photos (spec §4.4), the arrival's "1" and "2".
      const mediaId =
        exchange.type === "photo_choice" ? exchange.mediaIds[action.index] : undefined;
      return mediaId === undefined || action.index > 1
        ? null
        : {
            content: { kind: "photo_pick", index: action.index, mediaId },
            label: t(lang, "button.choice", { n: action.index + 1 }),
          };
    }
    case "vote": {
      const choice = voteOptionsOf(exchange.options)[action.index];
      return choice === undefined
        ? null
        : { content: { kind: "vote", index: action.index, choice }, label: choice };
    }
  }
}

/**
 * Her tap on an arrival's button (flows §3.9). The tap is acknowledged first, whatever follows; a
 * tap that fails the gate, names an exchange that is not hers or cannot take an answer, or an option
 * the arrival did not show, is otherwise ignored.
 */
export async function handleAnswerButton(
  deps: Deps,
  member: Member,
  event: InboundEvent,
  action: AnswerButtonAction,
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  try {
    await adapter.acknowledgeButton(event);
  } catch (error) {
    // The spinner on her phone is not worth more than the light: the tap still counts.
    deps.logger.error("answer_button_ack_failed", {
      eventId: event.eventId,
      error: errorLabel(error),
    });
  }
  const family = await familyById(deps.db, member.familyId);
  if (family === null || !canAnswer(member, family)) {
    return;
  }
  const [exchange] = await exchangesByIds(deps.db, [action.exchangeId]);
  if (exchange === undefined || !answerable(member, exchange)) {
    deps.logger.warn("answer_button_ignored", {
      action: action.type,
      known: exchange !== undefined,
      state: exchange?.state ?? null,
    });
    return;
  }
  const choice = await resolveChoice(deps.db, member.language, exchange, action);
  if (choice === null) {
    deps.logger.warn("answer_button_option_ignored", {
      action: action.type,
      exchangeId: exchange.id,
    });
    return;
  }
  const now = deps.clock.now();
  const input: AnswerInput = {
    member,
    family,
    exchange,
    event,
    content: choice.content,
    media: null,
    now,
  };
  const answer = await lightTheLight(deps, input);
  if (answer === null) {
    return;
  }
  if (event.messageId !== undefined) {
    try {
      await adapter.closeButtons(event.conversation.externalId, event.messageId, choice.label);
    } catch (error) {
      deps.logger.error("answer_button_close_failed", {
        eventId: event.eventId,
        error: errorLabel(error),
      });
    }
  }
  await afterLight(deps, input, answer);
}
