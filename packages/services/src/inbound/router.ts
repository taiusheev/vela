/**
 * The one door every platform event comes through (flows §5, the routing table). It decides which
 * flow an event belongs to and hands it over; it holds no flow of its own, so a rule that changes
 * changes in one place.
 *
 * Two rules shape it. A group message that is not an ask, a reply to an answer post, or a reaction
 * on one is dropped where it arrives: nothing about it is stored, sent, or logged, because the
 * family's own conversation is not Vela's. And nothing the kept-light member sends counts before
 * she has tapped Yes, after a No, or once she is left or deceased (§3.9).
 */
import type { InboundEvent, InboundKind } from "@vela/contracts";
import { t } from "@vela/copy";
import { decodeButton, outboundKey, parseParentCommand } from "@vela/core";
import {
  type AnswerButtonAction,
  canAnswer,
  handleAnswerButton,
  handleParentMessage,
} from "../answers.ts";
import { handleAskCommand, handleGroupAsk, parseAskCommand } from "../asks.ts";
import { handleConsentButton, handleInviteStart } from "../consent.ts";
import type { Deps } from "../deps.ts";
import { errorLabel } from "../errors.ts";
import { enqueueOutbound } from "../gateway.ts";
import {
  handleBotAdded,
  handleBotRemoved,
  handleGroupMigrated,
  handleMemberLeft,
  isKeptLightMember,
  languageOfSender,
  resolveGroupSender,
  sendOutsideGateway,
} from "../group.ts";
import { handleOnboarding } from "../onboarding.ts";
import { handleParentCommand } from "../parent-commands.ts";
import { handleQuietButton } from "../quiet.ts";
import { handleGroupReply, handleReaction } from "../replies.ts";
import {
  familyByLinkedGroup,
  familyHasEnded,
  type MemberWithFamily,
  memberByChannelUser,
  messageRefFor,
  setChannelLinkBlocked,
} from "../repo.ts";

/** What a person can send in a private chat; anything else there (a read receipt) is not for us. */
const PRIVATE_MESSAGE_KINDS: ReadonlySet<InboundKind> = new Set<InboundKind>([
  "start",
  "text",
  "voice",
  "image",
  "sticker",
  "other",
]);

/**
 * Routes each event in the batch. One event that throws does not hold the others back; the first
 * failure is thrown on when the batch is done, so the platform delivers the update again and every
 * handler, being idempotent, finds its work already done.
 */
export async function handleInbound(deps: Deps, events: InboundEvent[]): Promise<void> {
  let failure: unknown = null;
  for (const event of events) {
    try {
      await route(deps, event);
    } catch (error) {
      deps.logger.error("inbound_failed", {
        kind: event.kind,
        conversation: event.conversation.kind,
        error: errorLabel(error),
      });
      failure ??= error;
    }
  }
  if (failure !== null) {
    throw failure;
  }
}

async function route(deps: Deps, event: InboundEvent): Promise<void> {
  if (event.conversation.kind === "group") {
    await routeGroup(deps, event);
    return;
  }
  await routePrivate(deps, event);
}

// the private chat ---------------------------------------------------------------------------------

async function routePrivate(deps: Deps, event: InboundEvent): Promise<void> {
  if (event.kind === "blocked" || event.kind === "unblocked") {
    const blocked = event.kind === "blocked";
    const known = await setChannelLinkBlocked(
      deps.db,
      event.channel,
      event.sender.externalUserId,
      blocked ? new Date(event.at) : null,
    );
    deps.logger.info("channel_link_blocked", { blocked, known });
    return;
  }
  if (event.kind === "button") {
    await routeButton(deps, event);
    return;
  }
  if (!PRIVATE_MESSAGE_KINDS.has(event.kind)) {
    return;
  }
  if (event.kind === "start" && (event.startParam?.trim() ?? "").length > 0) {
    await handleInviteStart(deps, event);
    return;
  }
  const linked = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (linked === null || event.kind === "start") {
    // Onboarding owns a /start and everything typed into a live session; it tells us when the
    // event was none of its business.
    if (await handleOnboarding(deps, event)) {
      return;
    }
    await sayHowToBegin(deps, event, linked);
    return;
  }
  if (!isKeptLightMember(linked.member)) {
    // An organiser writing in their own chat: Vela answers only there, and only with how to begin.
    await sayHowToBegin(deps, event, linked);
    return;
  }
  if (!canAnswer(linked.member, linked.family)) {
    deps.logger.info("her_message_ignored", { status: linked.member.status });
    return;
  }
  const command = event.text === undefined ? null : parseParentCommand(event.text);
  if (command !== null) {
    await handleParentCommand(deps, linked.member, command, event);
    return;
  }
  await handleParentMessage(deps, linked.member, event);
}

/** A tap is always acknowledged, whatever it turns out to mean, so her phone stops spinning. */
async function acknowledge(deps: Deps, event: InboundEvent): Promise<void> {
  try {
    await deps.channels.get(event.channel).acknowledgeButton(event);
  } catch (error) {
    deps.logger.error("button_ack_failed", { error: errorLabel(error) });
  }
}

async function routeButton(deps: Deps, event: InboundEvent): Promise<void> {
  const action = event.buttonData === undefined ? null : decodeButton(event.buttonData);
  if (action === null) {
    await acknowledge(deps, event);
    deps.logger.warn("button_unreadable", { hasData: event.buttonData !== undefined });
    return;
  }
  switch (action.type) {
    case "consent":
      await handleConsentButton(deps, event, action);
      return;
    case "quiet_fine":
    case "quiet_wait":
      await handleQuietButton(deps, event, action);
      return;
    case "onboarding":
      await handleOnboarding(deps, event);
      return;
    default:
      await routeAnswerButton(deps, event, action);
  }
}

async function routeAnswerButton(
  deps: Deps,
  event: InboundEvent,
  action: AnswerButtonAction,
): Promise<void> {
  const linked = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (linked === null || !isKeptLightMember(linked.member)) {
    // The tap is answered and nothing else happens: only her arrivals carry these buttons.
    await acknowledge(deps, event);
    deps.logger.warn("answer_button_ignored", { action: action.type, known: linked !== null });
    return;
  }
  await handleAnswerButton(deps, linked.member, event, action);
}

/**
 * `help.private`, keyed by the event so a redelivered message answers once. A person Vela has no
 * member row for cannot own an outbound row, so their one line goes straight to the adapter.
 */
async function sayHowToBegin(
  deps: Deps,
  event: InboundEvent,
  linked: MemberWithFamily | null,
): Promise<void> {
  const conversationId = event.conversation.externalId;
  const idempotencyKey = outboundKey("system", {
    conversationId,
    suffix: `help:${event.eventId}`,
  });
  if (linked === null) {
    const lang = languageOfSender(event.sender.languageCode);
    await sendOutsideGateway(deps, {
      kind: "system",
      idempotencyKey,
      lang,
      to: { channel: event.channel, conversationId },
      text: t(lang, "help.private"),
    });
    return;
  }
  const lang = linked.member.language;
  await enqueueOutbound(deps, deps.db, {
    kind: "system",
    idempotencyKey,
    memberId: linked.member.id,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "help.private"),
  });
}

// the family group ---------------------------------------------------------------------------------

async function routeGroup(deps: Deps, event: InboundEvent): Promise<void> {
  if (event.kind === "bot_added") {
    await handleBotAdded(deps, event);
    return;
  }
  if (event.kind === "bot_removed") {
    await handleBotRemoved(deps, event);
    return;
  }
  if (event.kind === "migrated") {
    await handleGroupMigrated(deps, event);
    return;
  }
  const linked = await familyByLinkedGroup(deps.db, event.channel, event.conversation.externalId);
  if (linked === null) {
    // Not a group Vela belongs to: a departure, an ask, a reply there mean nothing (flows §3.16).
    return;
  }
  const familyId = linked.family.id;
  if (event.kind === "member_left") {
    await handleMemberLeft(deps, familyId, event);
    return;
  }
  if (await familyHasEnded(deps.db, familyId)) {
    deps.logger.info("group_event_ignored", { familyId, reason: "family_ended" });
    return;
  }
  if (parseAskCommand(event.text, deps.config.telegramBotUsername) !== null) {
    await withGroupSender(deps, familyId, event, (senderId) =>
      handleAskCommand(deps, event, familyId, senderId),
    );
    return;
  }
  if (event.replyToMessageId !== undefined) {
    await routeGroupReply(deps, familyId, event, event.replyToMessageId);
    return;
  }
  if (event.kind === "reaction" && event.messageId !== undefined) {
    await routeReaction(deps, familyId, event, event.messageId);
    return;
  }
  deps.logger.info("group_event_ignored", { familyId, kind: event.kind });
}

/**
 * The member behind the sender, created on their first act (flows §2), then the handler. Only the
 * events Vela acts on get this far, so an unrelated message never creates a member.
 */
async function withGroupSender(
  deps: Deps,
  familyId: string,
  event: InboundEvent,
  handle: (senderId: string) => Promise<void>,
): Promise<void> {
  const sender = await resolveGroupSender(deps, familyId, event);
  if (sender === null) {
    return;
  }
  await handle(sender.id);
}

/** A reply in the group counts when it answers the evening prompt or an answer post. */
async function routeGroupReply(
  deps: Deps,
  familyId: string,
  event: InboundEvent,
  repliedToMessageId: string,
): Promise<void> {
  const ref = await messageRefFor(
    deps.db,
    event.channel,
    event.conversation.externalId,
    repliedToMessageId,
  );
  if (ref === null || ref.familyId !== familyId) {
    return;
  }
  if (ref.purpose === "turn_prompt") {
    const recipientId = ref.memberId;
    if (recipientId === null) {
      deps.logger.warn("turn_prompt_ref_without_member", { familyId });
      return;
    }
    await withGroupSender(deps, familyId, event, (senderId) =>
      handleGroupAsk(deps, event, { familyId, recipientId, senderId, date: ref.localDate }),
    );
    return;
  }
  if (ref.purpose === "answer_post") {
    await withGroupSender(deps, familyId, event, (senderId) =>
      handleGroupReply(deps, familyId, senderId, event, ref),
    );
  }
}

async function routeReaction(
  deps: Deps,
  familyId: string,
  event: InboundEvent,
  messageId: string,
): Promise<void> {
  const ref = await messageRefFor(deps.db, event.channel, event.conversation.externalId, messageId);
  if (ref === null || ref.familyId !== familyId || ref.purpose !== "answer_post") {
    return;
  }
  await withGroupSender(deps, familyId, event, (senderId) =>
    handleReaction(deps, familyId, senderId, event, ref),
  );
}
