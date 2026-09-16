/**
 * Consent in her private chat (spec §9, flows §3.2). The invite link the organiser sent her opens
 * the request; only a tap on Yes or No answers it. Yes switches the light on in one transaction and
 * tells the organisers; No records the decline and sends nothing more. Everything else she writes
 * before a Yes is not this module's: the router ignores it (§3.9).
 *
 * A person who opens a spent or unknown link is nobody the gateway can address, so that one reply
 * goes straight to the adapter, as onboarding's prompts do.
 */
import type { Button, Channel, InboundEvent, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
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
  type Invite,
  invites,
  type Member,
  members,
  type VelaTransaction,
} from "@vela/db";
import { eq } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { languageOfSender, sendOutsideGateway } from "./group.ts";
import {
  activeOrganisersWithLinks,
  familyById,
  type MemberWithFamily,
  memberByChannelUser,
  memberById,
} from "./repo.ts";
import { type TickMember, tickMember } from "./tick.ts";

/** The consent copy she agrees to, kept with the consent so a later rewording is a new version. */
export const CONSENT_TEXT_VERSION = "consent.request@1";

/** The pilot's organisers are reached on Telegram (flows §3.2). */
const ORGANISER_CHANNEL: Channel = "telegram";

export type ConsentButtonAction = Extract<ButtonAction, { type: "consent" }>;

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

function consentButtons(lang: Lang, memberId: string): Button[][] {
  return [
    [
      {
        id: encodeButton({ type: "consent", memberId, accept: true }),
        label: t(lang, "consent.yes"),
      },
      {
        id: encodeButton({ type: "consent", memberId, accept: false }),
        label: t(lang, "consent.no"),
      },
    ],
  ];
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
  const inviter = await memberById(tx, invite.invitedBy);
  const lang = member.language;
  const conversationId = event.conversation.externalId;
  await enqueueOutbound(deps, tx, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", { conversationId, suffix: `request:${invite.id}` }),
    memberId: member.id,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "consent.request", { organiser: inviter?.displayName ?? family.name }),
    buttons: consentButtons(lang, member.id),
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
 * Yes, in one transaction under her row lock: the consent row, her light on with its start date and
 * learning period, her thanks, and the organisers told. False when she had already said yes, so a
 * second tap or a redelivered one consents once.
 */
async function acceptConsent(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  memberId: string,
  now: Date,
): Promise<boolean> {
  const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (member === undefined || member.lightConsentedAt !== null) {
    return false;
  }
  if (member.status !== "invited") {
    deps.logger.warn("consent_ignored", { memberId, status: member.status });
    return false;
  }
  const family = await familyById(tx, member.familyId);
  if (family === null) {
    return false;
  }
  const today = localDateOf(now, member.tz);
  await tx.insert(consents).values({
    memberId: member.id,
    kind: "light",
    textVersion: CONSENT_TEXT_VERSION,
    lang: member.language,
    channel: event.channel,
    givenAt: now,
    evidence: event.messageId === undefined ? {} : { message_id: event.messageId },
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
  const lang = member.language;
  await enqueueOutbound(deps, tx, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", {
      conversationId: event.conversation.externalId,
      suffix: `accepted:${member.id}`,
    }),
    memberId: member.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    lang,
    text: t(lang, "consent.accepted", { time }),
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
  return true;
}

/**
 * No: the decline is recorded and she hears that nothing will arrive; the organisers hear it too.
 * She stays `invited` with the light off. Her reply's idempotency key is the guard, so a repeated No
 * records nothing twice. False when she had already said yes, or had already declined.
 */
async function declineConsent(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  memberId: string,
  now: Date,
): Promise<boolean> {
  const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (member === undefined || member.lightConsentedAt !== null || member.status !== "invited") {
    return false;
  }
  const lang = member.language;
  const reply = await enqueueOutbound(deps, tx, {
    kind: "consent",
    idempotencyKey: outboundKey("consent", {
      conversationId: event.conversation.externalId,
      suffix: `declined:${member.id}`,
    }),
    memberId: member.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    lang,
    text: t(lang, "consent.declined"),
  });
  if ("duplicate" in reply) {
    return false;
  }
  await tellOrganisers(deps, tx, member, "organiser.consent_declined", `declined:${member.id}`);
  await recordEvent(
    tx,
    {
      name: "consent_declined",
      familyId: member.familyId,
      memberId: member.id,
      surface: event.channel,
      props: { kind: "light", text_version: CONSENT_TEXT_VERSION },
    },
    now,
  );
  return true;
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
 * the person linked to the member the payload names. The buttons are closed with the chosen label
 * whatever the tap changed, and a Yes that switched the light on ticks her schedule.
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
  const changed = await deps.db.transaction((tx) =>
    action.accept
      ? acceptConsent(deps, tx, event, action.memberId, now)
      : declineConsent(deps, tx, event, action.memberId, now),
  );
  if (event.messageId !== undefined) {
    const lang = sender.member.language;
    await adapter.closeButtons(
      event.conversation.externalId,
      event.messageId,
      t(lang, action.accept ? "consent.yes" : "consent.no"),
    );
  }
  if (changed && action.accept) {
    await tick(deps, action.memberId);
  }
  deps.logger.info("consent_button", {
    familyId: sender.family.id,
    accept: action.accept,
    changed,
  });
}
