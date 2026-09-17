/**
 * Consent in her private chat (spec §9, flows §3.2). The invite link the organiser sent her opens
 * the request; only a tap on Yes or No answers it. Yes switches the light on in one transaction,
 * tells the organisers, and asks her the separate health-words question once; No records the
 * decline and deletes what setup stored about her, keeping only the proof of the decline (ADR-28).
 * Everything else she writes before a Yes is not this module's: the router ignores it (§3.9).
 *
 * Every tap is recorded as a `consents` row whose evidence can rebuild the message she tapped
 * under: its chat and message ids, the values filled into the text, and the text's SHA-256
 * (`chatConsentEvidence`).
 *
 * A person who opens a spent or unknown link is nobody the gateway can address, so that one reply
 * goes straight to the adapter, as onboarding's prompts do; so does the reply to a No, since her
 * member row is gone by then.
 */
import type { Button, Channel, InboundEvent, Lang } from "@vela/contracts";
import { type MessageKey, t } from "@vela/copy";
import {
  addDays,
  type ButtonAction,
  encodeButton,
  learningUntil,
  localDateOf,
  outboundKey,
} from "@vela/core";
import {
  channelLinks,
  consents,
  type Family,
  type Invite,
  invites,
  type Member,
  members,
  type VelaTransaction,
} from "@vela/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { languageOfSender, sendOutsideGateway } from "./group.ts";
import {
  type ChatConsentEvidence,
  chatConsentEvidence,
  forgetMembersWithTheirContacts,
  subjectRef,
} from "./proofs.ts";
import {
  activeOrganisersWithLinks,
  familyById,
  type MemberWithFamily,
  memberByChannelUser,
  memberById,
  type Queryable,
} from "./repo.ts";
import { type TickMember, tickMember } from "./tick.ts";

/** The consent copy she agrees to, kept with the consent so a later rewording is a new version. */
export const CONSENT_TEXT_VERSION = "consent.request@2";

/** The health-words question she answers after her yes (L1), versioned the same way. */
export const HEALTH_WORDS_TEXT_VERSION = "consent.health_words@1";

/**
 * How long the health-words question waits after her yes. Cloudflare Queues promise no order between
 * two jobs sent back to back, and the question must follow `consent.accepted` (flows §3.2).
 */
export const HEALTH_WORDS_QUESTION_DELAY_SECONDS = 10;

/** The pilot's organisers are reached on Telegram (flows §3.2). */
const ORGANISER_CHANNEL: Channel = "telegram";

export type ConsentButtonAction = Extract<ButtonAction, { type: "consent" }>;
export type HealthWordsButtonAction = Extract<ButtonAction, { type: "health_words" }>;

type InviteRefusal = "unknown" | "expired" | "used";

function refusalOf(invite: Invite | undefined, now: Date): InviteRefusal | null {
  if (invite === undefined || invite.forMemberId === null) {
    return "unknown";
  }
  if (invite.acceptedAt !== null) {
    return "used";
  }
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : null;
}

/** `consent.invalid_link`: through the gateway when the person is a member, directly otherwise. */
async function refuseInvite(
  deps: Deps,
  event: InboundEvent,
  sender: MemberWithFamily | null,
  reason: InviteRefusal,
): Promise<void> {
  deps.logger.info("invite_refused", { reason });
  const conversationId = event.conversation.externalId;
  const idempotencyKey = outboundKey("consent", {
    conversationId,
    suffix: `invalid:${event.eventId}`,
  });
  if (sender === null) {
    const lang = languageOfSender(event.sender.languageCode);
    await sendOutsideGateway(deps, {
      kind: "consent",
      idempotencyKey,
      lang,
      to: { channel: event.channel, conversationId },
      text: t(lang, "consent.invalid_link"),
    });
    return;
  }
  const lang = sender.member.language;
  await enqueueOutbound(deps, deps.db, {
    kind: "consent",
    idempotencyKey,
    memberId: sender.member.id,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "consent.invalid_link"),
  });
}

/** A person in two families is out of scope for the pilot (flows §2): the link is refused. */
async function refuseLinkedElsewhere(
  deps: Deps,
  event: InboundEvent,
  sender: MemberWithFamily,
): Promise<void> {
  deps.logger.info("invite_refused_already_linked", { familyId: sender.family.id });
  const lang = sender.member.language;
  await enqueueOutbound(deps, deps.db, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", {
      conversationId: event.conversation.externalId,
      suffix: `already_linked:${event.eventId}`,
    }),
    memberId: sender.member.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    lang,
    text: t(lang, "consent.already_linked"),
  });
}

/** Yes and No under a consent message; the buttons carry the action they answer. */
function yesNoButtons(lang: Lang, yes: ButtonAction, no: ButtonAction): Button[][] {
  return [
    [
      { id: encodeButton(yes), label: t(lang, "consent.yes") },
      { id: encodeButton(no), label: t(lang, "consent.no") },
    ],
  ];
}

/**
 * Who `{organiser}` names in her consent messages: the display name of whoever sent her latest
 * invite (each member has one: inviting again creates a new member), or the family's name when that
 * person is gone. The request and the health-words question fill it the
 * same way, and a tap derives it again from the same rows, so the hash of the rebuilt text matches
 * the message she saw.
 */
async function organiserNameFor(db: Queryable, member: Member, family: Family): Promise<string> {
  const [invite] = await db
    .select({ invitedBy: invites.invitedBy })
    .from(invites)
    .where(eq(invites.forMemberId, member.id))
    .orderBy(desc(invites.createdAt), desc(invites.id))
    .limit(1);
  const inviter = invite === undefined ? null : await memberById(db, invite.invitedBy);
  return inviter?.displayName ?? family.name;
}

/** The values filled into `consent.request` for her: who asks, and the notice in her language. */
async function requestParams(
  deps: Deps,
  db: Queryable,
  member: Member,
  family: Family,
): Promise<{ organiser: string; notice: string }> {
  return {
    organiser: await organiserNameFor(db, member, family),
    notice: deps.config.privacyNoticeUrls[member.language],
  };
}

type LinkOutcome = "linked" | "unusable" | "linked_elsewhere";

/**
 * Links her to the invite's member, spends the invite, and sends the request, in one transaction
 * under the invite's row lock, so two openings of one link at once spend it once.
 */
async function acceptInvite(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  inviteId: string,
  now: Date,
): Promise<LinkOutcome> {
  const [invite] = await tx.select().from(invites).where(eq(invites.id, inviteId)).for("update");
  if (refusalOf(invite, now) !== null || invite === undefined || invite.forMemberId === null) {
    return "unusable";
  }
  const member = await memberById(tx, invite.forMemberId);
  const family = member === null ? null : await familyById(tx, member.familyId);
  if (member === null || family === null || family.deletedAt !== null) {
    return "unusable";
  }
  const [link] = await tx
    .insert(channelLinks)
    .values({
      memberId: member.id,
      channel: event.channel,
      externalId: event.sender.externalUserId,
      displayName: event.sender.displayName ?? null,
      linkedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: channelLinks.id });
  if (link === undefined) {
    return "linked_elsewhere";
  }
  await tx
    .update(invites)
    .set({ acceptedAt: now, acceptedBy: member.id })
    .where(eq(invites.id, invite.id));
  const lang = member.language;
  const conversationId = event.conversation.externalId;
  await enqueueOutbound(deps, tx, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", { conversationId, suffix: `request:${invite.id}` }),
    memberId: member.id,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "consent.request", await requestParams(deps, tx, member, family)),
    buttons: yesNoButtons(
      lang,
      { type: "consent", memberId: member.id, accept: true },
      { type: "consent", memberId: member.id, accept: false },
    ),
    ref: { purpose: "consent", memberId: member.id },
  });
  await recordEvent(
    tx,
    {
      name: "invite_accepted",
      familyId: family.id,
      memberId: member.id,
      surface: event.channel,
      props: { invite_id: invite.id },
    },
    now,
  );
  return "linked";
}

/**
 * `/start <token>` in a private chat (flows §3.2). An unknown, expired, or used token gets one short
 * refusal; a valid one links the person to the invite's member and sends the consent request. A
 * person already linked elsewhere is refused and the invite stays unspent. Her own link opened
 * again, or the same update delivered twice, changes nothing: the request is keyed by the invite.
 */
export async function handleInviteStart(deps: Deps, event: InboundEvent): Promise<void> {
  const token = event.startParam?.trim() ?? "";
  if (event.conversation.kind !== "private" || event.kind !== "start" || token.length === 0) {
    return;
  }
  const now = deps.clock.now();
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  const [invite] = await deps.db.select().from(invites).where(eq(invites.token, token)).limit(1);
  if (invite !== undefined && sender !== null && sender.member.id === invite.forMemberId) {
    deps.logger.info("invite_start_repeated", { familyId: sender.family.id });
    return;
  }
  const refusal = refusalOf(invite, now);
  if (refusal !== null || invite === undefined) {
    await refuseInvite(deps, event, sender, refusal ?? "unknown");
    return;
  }
  if (sender !== null) {
    await refuseLinkedElsewhere(deps, event, sender);
    return;
  }
  const outcome = await deps.db.transaction((tx) => acceptInvite(deps, tx, event, invite.id, now));
  switch (outcome) {
    case "linked":
      deps.logger.info("invite_accepted", { familyId: invite.familyId });
      return;
    case "unusable":
      await refuseInvite(deps, event, null, refusalOf(invite, now) ?? "used");
      return;
    case "linked_elsewhere": {
      // Another update linked this person between the read above and the lock.
      const again = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
      if (again !== null && again.member.id !== invite.forMemberId) {
        await refuseLinkedElsewhere(deps, event, again);
      }
      return;
    }
  }
}

/**
 * What one of her consent messages shows once her answer is recorded: the text she tapped under,
 * rebuilt as its evidence is, with her choice below it. The label alone would take who runs Vela and
 * the notice link out of her chat, and leave the evidence's message id naming a message that no
 * longer shows the text its hash proves (L6).
 */
function answeredText(
  lang: Lang,
  key: MessageKey,
  params: Record<string, string>,
  accept: boolean,
): string {
  return `${t(lang, key, params)}\n\n${t(lang, accept ? "consent.yes" : "consent.no")}`;
}

/** The evidence of a tap on one of her consent messages, rebuilt from what the send filled in. */
function tapEvidence(
  event: InboundEvent,
  lang: Lang,
  key: MessageKey,
  params: Record<string, string>,
): Promise<ChatConsentEvidence> {
  return chatConsentEvidence({
    chatId: event.conversation.externalId,
    messageId: event.messageId,
    lang,
    key,
    params,
  });
}

/**
 * Yes, in one transaction under her row lock: the consent row with its evidence, her light on with
 * its start date and learning period, her thanks, the health-words question after it, and the
 * organisers told. Returns the text the answered request shows, or null when she had already said
 * yes, so a second tap or a redelivered one consents once.
 */
async function acceptConsent(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  memberId: string,
  now: Date,
): Promise<string | null> {
  const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (member === undefined || member.lightConsentedAt !== null) {
    return null;
  }
  if (member.status !== "invited") {
    deps.logger.warn("consent_ignored", { memberId, status: member.status });
    return null;
  }
  const family = await familyById(tx, member.familyId);
  if (family === null) {
    return null;
  }
  const lang = member.language;
  const params = await requestParams(deps, tx, member, family);
  const today = localDateOf(now, member.tz);
  await tx.insert(consents).values({
    memberId: member.id,
    subjectRef: subjectRef({ memberId: member.id }),
    kind: "light",
    answer: "yes",
    textVersion: CONSENT_TEXT_VERSION,
    lang,
    channel: event.channel,
    givenAt: now,
    evidence: await tapEvidence(event, lang, "consent.request", params),
  });
  await tx
    .update(members)
    .set({
      lightOn: true,
      lightConsentedAt: now,
      lightConsentText: CONSENT_TEXT_VERSION,
      status: "active",
      lightStartsOn: addDays(today, 1),
      learningUntil: learningUntil(today),
    })
    .where(eq(members.id, member.id));
  const time = member.arrivalTime;
  const conversationId = event.conversation.externalId;
  await enqueueOutbound(deps, tx, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", { conversationId, suffix: `accepted:${member.id}` }),
    memberId: member.id,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "consent.accepted", { time }),
  });
  // Keyed by the member alone, so she is asked once, whatever happens to her light later.
  await enqueueOutbound(deps, tx, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", {
      conversationId,
      suffix: `health_words:${member.id}`,
    }),
    memberId: member.id,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "consent.health_words", { organiser: params.organiser }),
    buttons: yesNoButtons(
      lang,
      { type: "health_words", memberId: member.id, accept: true },
      { type: "health_words", memberId: member.id, accept: false },
    ),
    ref: { purpose: "consent", memberId: member.id },
    delaySeconds: HEALTH_WORDS_QUESTION_DELAY_SECONDS,
  });
  await tellOrganisers(deps, tx, member, "organiser.consent_given", `given:${member.id}`, time);
  await recordEvent(
    tx,
    {
      name: "consent_given",
      familyId: family.id,
      memberId: member.id,
      surface: event.channel,
      props: { kind: "light", text_version: CONSENT_TEXT_VERSION },
    },
    now,
  );
  return answeredText(lang, "consent.request", params, true);
}

/**
 * No, in one transaction under her row lock (L7): the decline row with its evidence, the organisers
 * told, then her consent rows and her nearby contacts' forgotten and her member row deleted, which
 * takes her channel link, invite, contacts, message refs, and outbound rows with it. Only the proof
 * of the decline stays, naming her by id. Null when there was nothing to decline (she had already
 * said yes, or is no longer invited); otherwise her language, for the reply sent after the commit,
 * and the text the answered request shows, rebuilt here while the invite that names the organiser
 * still exists.
 */
async function declineConsent(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  memberId: string,
  now: Date,
): Promise<{ lang: Lang; answered: string } | null> {
  const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (member === undefined || member.lightConsentedAt !== null || member.status !== "invited") {
    return null;
  }
  const family = await familyById(tx, member.familyId);
  if (family === null) {
    return null;
  }
  const lang = member.language;
  const params = await requestParams(deps, tx, member, family);
  await tx.insert(consents).values({
    memberId: member.id,
    subjectRef: subjectRef({ memberId: member.id }),
    kind: "light",
    answer: "no",
    textVersion: CONSENT_TEXT_VERSION,
    lang,
    channel: event.channel,
    givenAt: now,
    evidence: await tapEvidence(event, lang, "consent.request", params),
  });
  await tellOrganisers(deps, tx, member, "organiser.consent_declined", `declined:${member.id}`);
  await recordEvent(
    tx,
    {
      name: "consent_declined",
      familyId: member.familyId,
      memberId: member.id,
      surface: event.channel,
      props: { kind: "light", text_version: CONSENT_TEXT_VERSION, member_deleted: true },
    },
    now,
  );
  await forgetMembersWithTheirContacts(tx, [member.id], now);
  await tx.delete(members).where(eq(members.id, member.id));
  return { lang, answered: answeredText(lang, "consent.request", params, false) };
}

/** One message per active organiser with a Telegram link, in their own language. */
async function tellOrganisers(
  deps: Deps,
  tx: VelaTransaction,
  member: Member,
  key: "organiser.consent_given" | "organiser.consent_declined",
  suffix: string,
  time?: string,
): Promise<void> {
  const organisers = await activeOrganisersWithLinks(tx, member.familyId, ORGANISER_CHANNEL);
  for (const organiser of organisers) {
    const lang = organiser.member.language;
    const name = member.displayName;
    await enqueueOutbound(deps, tx, {
      kind: "consent",
      idempotencyKey: outboundKey("consent", {
        conversationId: organiser.link.externalId,
        suffix,
      }),
      memberId: organiser.member.id,
      channel: organiser.link.channel,
      conversationId: organiser.link.externalId,
      lang,
      text:
        key === "organiser.consent_given"
          ? t(lang, key, { name, time: time ?? member.arrivalTime })
          : t(lang, key, { name }),
    });
  }
}

/**
 * Her tap on the consent request (flows §3.2). The tap is acknowledged first; it counts only from
 * the person linked to the member the payload names. A recorded answer closes the buttons and adds
 * her choice below the request, which stays in her chat. A Yes then ticks her schedule. A No closes
 * them once it has deleted her, then tells her nothing more will arrive, straight through the
 * adapter: no member is left to address, and a failed send is logged and not retried, since the
 * answered request already shows her choice. A tap that records nothing only removes the buttons, so
 * it can never label the message with an answer that was not recorded.
 */
export async function handleConsentButton(
  deps: Deps,
  event: InboundEvent,
  action: ConsentButtonAction,
  tick: TickMember = tickMember,
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (
    sender === null ||
    sender.member.id !== action.memberId ||
    event.conversation.kind !== "private"
  ) {
    deps.logger.warn("consent_button_ignored", { known: sender !== null });
    return;
  }
  if (sender.family.deletedAt !== null) {
    deps.logger.info("consent_button_ignored", { familyId: sender.family.id, reason: "deleted" });
    return;
  }
  const now = deps.clock.now();
  const conversationId = event.conversation.externalId;
  if (action.accept) {
    const answered = await deps.db.transaction((tx) =>
      acceptConsent(deps, tx, event, action.memberId, now),
    );
    if (event.messageId !== undefined) {
      await adapter.closeButtons(conversationId, event.messageId, answered ?? undefined);
    }
    const changed = answered !== null;
    if (changed) {
      await tick(deps, action.memberId);
    }
    deps.logger.info("consent_button", { familyId: sender.family.id, accept: true, changed });
    return;
  }
  const declined = await deps.db.transaction((tx) =>
    declineConsent(deps, tx, event, action.memberId, now),
  );
  if (event.messageId !== undefined) {
    await adapter.closeButtons(conversationId, event.messageId, declined?.answered);
  }
  if (declined !== null) {
    await sendOutsideGateway(deps, {
      kind: "consent",
      idempotencyKey: outboundKey("consent", {
        conversationId,
        suffix: `declined:${event.eventId}`,
      }),
      lang: declined.lang,
      to: { channel: event.channel, conversationId },
      text: t(declined.lang, "consent.declined"),
    });
  }
  deps.logger.info("consent_button", {
    familyId: sender.family.id,
    accept: false,
    changed: declined !== null,
  });
}

type HealthWordsOutcome =
  | { recorded: true; answered: string }
  | { recorded: false; reason: "status" | "already_answered" };

/**
 * Her answer to the health-words question, in one transaction under her row lock: counted only
 * while her light is consented to and she is active, and only as her first answer, so a second tap,
 * a tap on the other button, or a redelivered tap records nothing. A recorded answer returns the
 * text the answered question shows.
 */
async function recordHealthWords(
  tx: VelaTransaction,
  event: InboundEvent,
  action: HealthWordsButtonAction,
  now: Date,
): Promise<HealthWordsOutcome> {
  const [member] = await tx
    .select()
    .from(members)
    .where(eq(members.id, action.memberId))
    .for("update");
  if (member === undefined || member.lightConsentedAt === null || member.status !== "active") {
    return { recorded: false, reason: "status" };
  }
  const answered = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.memberId, member.id), eq(consents.kind, "health_words")))
    .limit(1);
  if (answered.length > 0) {
    return { recorded: false, reason: "already_answered" };
  }
  const family = await familyById(tx, member.familyId);
  if (family === null) {
    return { recorded: false, reason: "status" };
  }
  const lang = member.language;
  const params = { organiser: await organiserNameFor(tx, member, family) };
  const answer = action.accept ? "yes" : "no";
  await tx.insert(consents).values({
    memberId: member.id,
    subjectRef: subjectRef({ memberId: member.id }),
    kind: "health_words",
    answer,
    textVersion: HEALTH_WORDS_TEXT_VERSION,
    lang,
    channel: event.channel,
    givenAt: now,
    evidence: await tapEvidence(event, lang, "consent.health_words", params),
  });
  await recordEvent(
    tx,
    {
      name: action.accept ? "consent_given" : "consent_declined",
      familyId: member.familyId,
      memberId: member.id,
      surface: event.channel,
      props: { kind: "health_words", text_version: HEALTH_WORDS_TEXT_VERSION },
    },
    now,
  );
  return {
    recorded: true,
    answered: answeredText(lang, "consent.health_words", params, action.accept),
  };
}

/**
 * Her tap on the health-words question (flows §3.2, L1). Acknowledged first; it counts only from the
 * person linked to the member the payload names, in her private chat, in a family that has not
 * asked to be deleted. What the answer changes is how her words are understood (§3.10); nothing is
 * sent to her or to the organisers, and her schedule is not ticked. The buttons are closed, with her
 * choice added below the question, only when it was recorded, so a later tap on the other button
 * cannot relabel them.
 */
export async function handleHealthWordsButton(
  deps: Deps,
  event: InboundEvent,
  action: HealthWordsButtonAction,
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (
    sender === null ||
    sender.member.id !== action.memberId ||
    event.conversation.kind !== "private" ||
    sender.family.deletedAt !== null
  ) {
    deps.logger.info("health_words_button_ignored", { reason: "sender" });
    return;
  }
  const now = deps.clock.now();
  const outcome = await deps.db.transaction((tx) => recordHealthWords(tx, event, action, now));
  if (!outcome.recorded) {
    deps.logger.info("health_words_button_ignored", {
      familyId: sender.family.id,
      reason: outcome.reason,
    });
    return;
  }
  if (event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId, outcome.answered);
  }
  deps.logger.info("health_words_button", {
    familyId: sender.family.id,
    accept: action.accept,
  });
}

/**
 * `stop` withdraws a health-words yes with the light (L1, flows §3.13), in the caller's transaction.
 * Returns whether a yes was withdrawn; `start` gives nothing back.
 */
export async function withdrawHealthWords(
  tx: VelaTransaction,
  memberId: string,
  at: Date,
): Promise<boolean> {
  const withdrawn = await tx
    .update(consents)
    .set({ withdrawnAt: at })
    .where(
      and(
        eq(consents.memberId, memberId),
        eq(consents.kind, "health_words"),
        eq(consents.answer, "yes"),
        isNull(consents.withdrawnAt),
      ),
    )
    .returning({ id: consents.id });
  return withdrawn.length > 0;
}
