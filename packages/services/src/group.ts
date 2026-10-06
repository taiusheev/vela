/**
 * The family group (flows §3.3, §3.16): linking the group the organiser adds Vela to, each adult's
 * tap saying they have read the privacy notice, following the group when Telegram gives it a new
 * id, and departures. Also the questions the other inbound flows share about who is in the family:
 * which member is the kept-light member, who a group sender is (created lazily on their first act,
 * made active again when they act after leaving), and how to reach a person the gateway cannot
 * address because they are not a member yet.
 */
import {
  type Channel,
  ChannelSendError,
  type InboundEvent,
  type Lang,
  type OutboundMessage,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { type ButtonAction, encodeButton, outboundKey } from "@vela/core";
import {
  channelLinks,
  consents,
  events,
  type Family,
  families,
  familyChannels,
  type Member,
  members,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ADMIN_CHANNEL, ADMIN_LANG } from "./admin.ts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { directReplyOf, enqueueOutbound, replyFieldOf } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import { groupNoticeEvidence, subjectRef } from "./proofs.ts";
import {
  familyById,
  familyHasEnded,
  isMessenger,
  linkedGroupOfFamily,
  MESSENGER,
  type MemberWithFamily,
  memberByChannelUser,
  type Queryable,
  repointFamilyGroup,
} from "./repo.ts";

/**
 * The name a lazily created member gets when the platform sent none. Telegram always carries a
 * first name, so this is a guard, not copy the family will read.
 */
const NAMELESS_MEMBER = "Family member";

/**
 * The organiser's language from the platform's hint (flows §3.1): any Chinese variant reads the
 * Traditional Chinese catalog, everything else English, the two languages the pilot has copy for.
 */
export function languageOfSender(languageCode: string | undefined, channel?: Channel): Lang {
  // LINE omits the hint until someone accepts LY's privacy policy; its market is Taiwan, so
  // someone with no hint there is greeted in Traditional Chinese (05-line-flows D7).
  if (languageCode === undefined && channel === "line") return "zh-TW";
  return languageCode?.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

/**
 * Whether a member is the one whose light the family keeps. Before consent she is only the member
 * onboarding created with a wake time; after it her light is on, or was consented to once (it is
 * switched off again when she is marked deceased, and consent is never cleared).
 */
export function isKeptLightMember(member: Member): boolean {
  return member.lightOn || member.lightConsentedAt !== null || member.wakeTime !== null;
}

/** The family's kept-light member, whether or not she has consented yet; the earliest when several. */
export async function keptLightMemberOfFamily(
  db: Queryable,
  familyId: string,
): Promise<Member | null> {
  const rows = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        or(
          eq(members.lightOn, true),
          isNotNull(members.lightConsentedAt),
          isNotNull(members.wakeTime),
        ),
      ),
    )
    .orderBy(members.createdAt, members.id)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * A reply to someone who is not a member: an organiser still onboarding, a stranger with a spent
 * invite link, a person adding Vela to a group that is not theirs. An outbound row belongs to a
 * member, so the gateway cannot carry these, and they go straight to the adapter. Nothing retries a
 * failure: the person just wrote, and can write again. Returns whether the platform took it.
 */
export async function sendOutsideGateway(deps: Deps, message: OutboundMessage): Promise<boolean> {
  try {
    await deps.channels.get(message.to.channel).send(message);
    return true;
  } catch (error) {
    if (error instanceof ChannelSendError) {
      deps.logger.warn("direct_send_failed", { kind: message.kind, code: error.code });
      return false;
    }
    throw error;
  }
}

/** `group.not_linked` to whoever added the bot, through the gateway when they are a member. */
async function refuseLink(
  deps: Deps,
  event: InboundEvent,
  sender: MemberWithFamily | null,
  reason: string,
): Promise<void> {
  deps.logger.info("group_link_refused", { reason });
  const conversationId = event.conversation.externalId;
  const idempotencyKey = outboundKey("system", {
    conversationId,
    suffix: `not_linked:${event.eventId}`,
  });
  if (sender === null) {
    const lang =
      deps.config.pilotAdmission == null
        ? languageOfSender(event.sender.languageCode, event.channel)
        : "en";
    await sendOutsideGateway(deps, {
      kind: "system",
      idempotencyKey,
      lang,
      to: { channel: event.channel, conversationId },
      ...directReplyOf(event, deps.clock.now()),
      text: t(lang, "group.not_linked"),
    });
    return;
  }
  const lang = sender.member.language;
  await enqueueOutbound(deps, deps.db, {
    kind: "system",
    idempotencyKey,
    memberId: sender.member.id,
    channel: event.channel,
    conversationId,
    lang,
    ...replyFieldOf(event),
    text: t(lang, "group.not_linked"),
  });
}

/**
 * The `group.linked` text: her name as the family calls her (the family's name while she has none),
 * and the notice in the family's language. Rendered once, when the group is linked; its hash is kept
 * on the link for the notice button's taps (flows §3.3).
 */
async function linkedText(deps: Deps, db: Queryable, family: Family, lang: Lang): Promise<string> {
  const her = await keptLightMemberOfFamily(db, family.id);
  return t(lang, "group.linked", {
    name: her?.displayName ?? family.name,
    notice: deps.config.privacyNoticeUrls[lang],
  });
}

/**
 * The bot was added to a group. Only an organiser links it, and only to a family without a group:
 * the family's language becomes the organiser's, and the group hears who Vela is and where the
 * privacy notice is, with a button each adult taps once they have read it. The link keeps the hash
 * of that text for the taps' evidence. Anyone else, or a second group, is told only the organiser
 * can connect Vela.
 */
export async function handleBotAdded(deps: Deps, event: InboundEvent): Promise<void> {
  if (event.conversation.kind !== "group") {
    return;
  }
  // LINE's join names nobody (05-line-flows §3.1): who is in the group decides instead (D2).
  const unnamed = event.sender.externalUserId === event.conversation.externalId;
  if (unnamed) {
    const probed = await probeGroup(deps, event);
    if (probed === null) return;
    await linkGroup(deps, event, probed);
    return;
  }
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (sender === null || sender.member.role !== "organiser" || sender.family.deletedAt !== null) {
    await refuseLink(deps, event, sender, "not_organiser");
    return;
  }
  const conversationId = event.conversation.externalId;
  // One group per family, on whichever messenger (D9): a group on another one is a second group.
  const current = await linkedGroupOfFamily(deps.db, sender.family.id, MESSENGER);
  if (
    current !== null &&
    current.channel === event.channel &&
    current.conversationId === conversationId
  ) {
    // The same group again: Telegram can report one addition twice.
    return;
  }
  if (current !== null) {
    await refuseLink(deps, event, sender, "second_group");
    return;
  }
  await linkGroup(deps, event, sender);
}

/** The most organisers a join is probed for, inside the Workers Free plan's 50 subrequests. */
const PROBE_CAP = 20;

/**
 * Whose group a join that names nobody is (05-line-flows §3.1, D2): the active organisers on this
 * messenger, in families with no group yet, newest family first, are looked up in the group by
 * their profile there. Exactly one family's organisers present: that organiser links it. None, two
 * families, a legacy room, or more candidates than the cap: Vela says it cannot link and leaves.
 * Null when it was refused, or is already this group's link (a join delivered twice).
 */
async function probeGroup(deps: Deps, event: InboundEvent): Promise<MemberWithFamily | null> {
  const adapter = deps.channels.get(event.channel);
  const groupId = event.conversation.externalId;
  const refuse = async (reason: string): Promise<null> => {
    await refuseLink(deps, event, null, reason);
    try {
      await adapter.leaveConversation?.(groupId);
    } catch (error) {
      deps.logger.warn("group_leave_failed", { error: errorLabel(error) });
    }
    return null;
  };
  const [already] = await deps.db
    .select({ id: familyChannels.id })
    .from(familyChannels)
    .where(
      and(
        eq(familyChannels.channel, event.channel),
        eq(familyChannels.conversationId, groupId),
        eq(familyChannels.kind, "group"),
        isNull(familyChannels.unlinkedAt),
      ),
    )
    .limit(1);
  if (already !== undefined) return null;
  if (groupId.startsWith("R")) return refuse("room");
  if (adapter.profile === undefined) return refuse("no_organiser");
  const rows = await deps.db
    .select({ member: members, link: channelLinks, family: families })
    .from(members)
    .innerJoin(families, eq(families.id, members.familyId))
    .innerJoin(
      channelLinks,
      and(eq(channelLinks.memberId, members.id), eq(channelLinks.channel, event.channel)),
    )
    .where(
      and(
        eq(members.role, "organiser"),
        eq(members.status, "active"),
        isNull(channelLinks.blockedAt),
        isNull(families.deletedAt),
      ),
    )
    .orderBy(desc(families.createdAt), asc(members.id));
  const candidates: typeof rows = [];
  for (const row of rows) {
    if (await familyHasEnded(deps.db, row.family.id)) continue;
    if ((await linkedGroupOfFamily(deps.db, row.family.id, MESSENGER)) !== null) continue;
    candidates.push(row);
  }
  if (candidates.length > PROBE_CAP) return refuse("probe_overflow");
  const present: typeof rows = [];
  for (const candidate of candidates) {
    try {
      if ((await adapter.profile(candidate.link.externalId, groupId)) !== null) {
        present.push(candidate);
      }
    } catch (error) {
      deps.logger.warn("group_probe_failed", { error: errorLabel(error) });
    }
  }
  const familiesPresent = new Set(present.map((row) => row.family.id));
  if (familiesPresent.size === 0) return refuse("no_organiser");
  if (familiesPresent.size > 1) return refuse("several_families");
  const [first] = present;
  return first === undefined
    ? null
    : { member: first.member, family: first.family, link: first.link };
}

/** Links the group to the organiser's family, as the founder's notice of what Vela keeps (04 §3.3). */
async function linkGroup(deps: Deps, event: InboundEvent, sender: MemberWithFamily): Promise<void> {
  const conversationId = event.conversation.externalId;
  const now = deps.clock.now();
  const lang = sender.member.language;
  const linked = await deps.db.transaction(async (tx) => {
    const text = await linkedText(deps, tx, sender.family, lang);
    const [row] = await tx
      .insert(familyChannels)
      .values({
        familyId: sender.family.id,
        channel: event.channel,
        conversationId,
        kind: "group",
        linkedByMemberId: sender.member.id,
        linkedAt: now,
        linkedTextSha256: await sha256Hex(text),
      })
      .onConflictDoNothing()
      .returning();
    if (row === undefined) {
      return false;
    }
    await tx.update(families).set({ language: lang }).where(eq(families.id, sender.family.id));
    await enqueueOutbound(deps, tx, {
      kind: "system",
      idempotencyKey: outboundKey("system", { conversationId, suffix: `linked:${row.id}` }),
      memberId: sender.member.id,
      channel: event.channel,
      conversationId,
      lang,
      ...replyFieldOf(event),
      text,
      buttons: [
        [
          {
            id: encodeButton({ type: "notice_read", familyChannelId: row.id }),
            label: t(lang, "group.notice_read"),
          },
        ],
      ],
    });
    return true;
  });
  if (!linked) {
    // The conversation is another family's group while it stays linked there.
    await refuseLink(deps, event, sender, "linked_elsewhere");
    return;
  }
  deps.logger.info("group_linked", { familyId: sender.family.id });
}

/** The bot left a group or was removed: the link ends, and its history rows stay. */
export async function handleBotRemoved(deps: Deps, event: InboundEvent): Promise<void> {
  if (event.conversation.kind !== "group") {
    return;
  }
  const rows = await deps.db
    .update(familyChannels)
    .set({ unlinkedAt: deps.clock.now() })
    .where(
      and(
        eq(familyChannels.channel, event.channel),
        eq(familyChannels.conversationId, event.conversation.externalId),
        eq(familyChannels.kind, "group"),
        isNull(familyChannels.unlinkedAt),
      ),
    )
    .returning({ familyId: familyChannels.familyId });
  const row = rows[0];
  if (row !== undefined) {
    deps.logger.info("group_unlinked", { familyId: row.familyId });
  }
}

/**
 * A basic group became a supergroup with a new id (flows §3.3). The link, that conversation's
 * message refs, and its queued sends follow, as they do when a send reports the move. Telegram
 * posts the notice in both chats, so the second report finds the move already made.
 */
export async function handleGroupMigrated(deps: Deps, event: InboundEvent): Promise<void> {
  const to = event.migratedToConversationId;
  if (to === undefined) {
    return;
  }
  const from = event.conversation.externalId;
  await deps.db.transaction((tx) => repointFamilyGroup(tx, event.channel, from, to));
  deps.logger.info("group_migrated", { channel: event.channel });
}

/**
 * Whether the organiser's or her departure from this group was already recorded: the event log is
 * the only trace it leaves, so a redelivered update is recognised there.
 */
async function departureRecorded(
  tx: VelaTransaction,
  memberId: string,
  inboundEventId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.name, "member_left_group"),
        eq(events.memberId, memberId),
        sql`${events.props}->>'inbound_event_id' = ${inboundEventId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Someone left the linked group or was removed (flows §3.16). A linked member who is neither an
 * organiser nor the kept-light member leaves the rotation as `left`; an organiser or the kept-light
 * member keeps everything, and the founder hears about it without any content; a person with no
 * link stores nothing.
 */
export async function handleMemberLeft(
  deps: Deps,
  familyId: string,
  event: InboundEvent,
): Promise<void> {
  const subject = event.subject;
  if (subject === undefined || event.conversation.kind !== "group") {
    return;
  }
  const linked = await memberByChannelUser(deps.db, event.channel, subject.externalUserId);
  if (linked === null || linked.family.id !== familyId) {
    deps.logger.info("departure_unlinked", { familyId });
    return;
  }
  const { member, family } = linked;
  const at = new Date(event.at);
  const removed = event.sender.externalUserId !== subject.externalUserId;

  if (member.role === "member" && !isKeptLightMember(member)) {
    if (member.status === "left") {
      return;
    }
    await deps.db.transaction(async (tx) => {
      const changed = await tx
        .update(members)
        .set({ status: "left", leftAt: at, turnsIn: false })
        .where(and(eq(members.id, member.id), sql`${members.status} <> 'left'`))
        .returning({ id: members.id });
      if (changed.length === 0) {
        return;
      }
      await recordEvent(
        tx,
        {
          name: "member_left",
          familyId,
          memberId: member.id,
          props: { reason: "left_group", removed },
        },
        at,
      );
    });
    deps.logger.info("member_left_group", { familyId, role: member.role });
    return;
  }

  await deps.db.transaction(async (tx) => {
    if (await departureRecorded(tx, member.id, event.eventId)) {
      return;
    }
    await recordEvent(
      tx,
      {
        name: "member_left_group",
        familyId,
        memberId: member.id,
        props: {
          role: member.role,
          kept_light: isKeptLightMember(member),
          removed,
          inbound_event_id: event.eventId,
        },
      },
      at,
    );
    const admin = deps.config.adminConversationId;
    if (admin === null) {
      return;
    }
    await enqueueOutbound(deps, tx, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: admin,
        suffix: `member_left_group:${event.eventId}`,
      }),
      memberId: member.id,
      channel: ADMIN_CHANNEL,
      conversationId: admin,
      lang: ADMIN_LANG,
      text: t(ADMIN_LANG, "admin.member_left_group", {
        name: member.displayName,
        family: family.name,
      }),
    });
  });
  deps.logger.info("member_left_group", { familyId, role: member.role });
}

/**
 * A group member's name from the platform's profile, for a message that carries none (LINE, 05-line-flows
 * §5.11), looked up through the group. Null when the platform has no profiles or does not answer: a
 * failed lookup never holds the message back.
 */
async function profileName(deps: Deps, event: InboundEvent): Promise<string | null> {
  const adapter = deps.channels.get(event.channel);
  if (adapter.profile === undefined) return null;
  try {
    const profile = await adapter.profile(
      event.sender.externalUserId,
      event.conversation.externalId,
    );
    const name = profile?.displayName?.trim() ?? "";
    return name.length > 0 ? name : null;
  } catch (error) {
    deps.logger.warn("profile_lookup_failed", { channel: event.channel, error: errorLabel(error) });
    return null;
  }
}

/**
 * The member behind a group sender (flows §2, §3.16): the linked member, made active again when
 * they had left; or a member created on their first act, named as the platform names them, in the
 * family's language and her zone. Null for a person linked to another family.
 */
export async function resolveGroupSender(
  deps: Deps,
  familyId: string,
  event: InboundEvent,
): Promise<Member | null> {
  const linked = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  const now = deps.clock.now();
  if (linked !== null) {
    if (linked.family.id !== familyId) {
      deps.logger.warn("group_sender_linked_elsewhere", { familyId });
      return null;
    }
    const { member } = linked;
    if (member.role !== "member" || isKeptLightMember(member) || member.status !== "left") {
      return member;
    }
    const rejoined = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(members)
        .set({ status: "active", leftAt: null, turnsIn: true })
        .where(and(eq(members.id, member.id), eq(members.status, "left")))
        .returning();
      if (row === undefined) {
        return null;
      }
      await recordEvent(
        tx,
        { name: "member_joined", familyId, memberId: member.id, props: { rejoined: true } },
        now,
      );
      return row;
    });
    return rejoined ?? member;
  }

  const family = await familyById(deps.db, familyId);
  if (family === null) {
    return null;
  }
  const her = await keptLightMemberOfFamily(deps.db, familyId);
  const name = event.sender.displayName ?? (await profileName(deps, event)) ?? NAMELESS_MEMBER;
  const created = await deps.db.transaction(async (tx) => {
    // As with an invite (consent.ts, acceptInvite): no member or link joins a family being deleted.
    const [current] = await tx
      .select({ deletedAt: families.deletedAt })
      .from(families)
      .where(eq(families.id, familyId))
      .for("share");
    if (current === undefined || current.deletedAt !== null) {
      return null;
    }
    const [member] = await tx
      .insert(members)
      .values({
        familyId,
        role: "member",
        displayName: name,
        language: family.language,
        tz: her?.tz ?? "UTC",
        country: her?.country ?? family.country,
        status: "active",
        primarySurface: isMessenger(event.channel) ? event.channel : "telegram",
        createdAt: now,
      })
      .returning();
    if (member === undefined) {
      return null;
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
      .returning();
    if (link === undefined) {
      // Two of their messages arrived at once and the other one won the link.
      await tx.delete(members).where(eq(members.id, member.id));
      return null;
    }
    await recordEvent(
      tx,
      { name: "member_joined", familyId, memberId: member.id, props: { rejoined: false } },
      now,
    );
    return member;
  });
  if (created !== null) {
    return created;
  }
  const again = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  return again !== null && again.family.id === familyId ? again.member : null;
}

/**
 * A tap on "I've read it" under `group.linked` (flows §3.3, L9): the adult who tapped is recorded as
 * having read the privacy notice, once per member and notice version. Acknowledged first. It counts
 * only in a family that has not ended, and only when the button's group row belongs to the family
 * this group is linked to: a row the family re-linked or migrated still does. The person who tapped
 * is resolved as any group sender is, so a family member who never wrote in the group is created
 * here. The evidence carries the hash that row kept of the greeting, never the greeting rebuilt now
 * (`groupNoticeEvidence`). Nothing is posted and the button stays open for the next adult; asks
 * never wait for it.
 */
export async function handleNoticeReadButton(
  deps: Deps,
  familyId: string,
  event: InboundEvent,
  action: Extract<ButtonAction, { type: "notice_read" }>,
): Promise<void> {
  await deps.channels.get(event.channel).acknowledgeButton(event);
  if (event.conversation.kind !== "group") {
    return;
  }
  const [row] = await deps.db
    .select({
      familyId: familyChannels.familyId,
      linkedTextSha256: familyChannels.linkedTextSha256,
    })
    .from(familyChannels)
    .where(eq(familyChannels.id, action.familyChannelId))
    .limit(1);
  if (row === undefined || row.familyId !== familyId) {
    deps.logger.info("notice_read_ignored", { familyId, reason: "other_group" });
    return;
  }
  if (await familyHasEnded(deps.db, familyId)) {
    deps.logger.info("notice_read_ignored", { familyId, reason: "family_ended" });
    return;
  }
  const reader = await resolveGroupSender(deps, familyId, event);
  if (reader === null) {
    deps.logger.info("notice_read_ignored", { familyId, reason: "sender" });
    return;
  }
  const version = deps.config.privacyNoticeVersion;
  const now = deps.clock.now();
  const recorded = await deps.db.transaction(async (tx) => {
    const [member] = await tx.select().from(members).where(eq(members.id, reader.id)).for("update");
    const family = await familyById(tx, familyId);
    if (member === undefined || family === null) {
      return false;
    }
    const read = await tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.memberId, member.id),
          eq(consents.kind, "privacy_notice"),
          eq(consents.answer, "yes"),
          eq(consents.textVersion, version),
          isNull(consents.withdrawnAt),
        ),
      )
      .limit(1);
    if (read.length > 0) {
      return false;
    }
    await tx.insert(consents).values({
      memberId: member.id,
      subjectRef: subjectRef({ memberId: member.id }),
      kind: "privacy_notice",
      answer: "yes",
      textVersion: version,
      lang: family.language,
      channel: event.channel,
      givenAt: now,
      evidence: groupNoticeEvidence(
        event.conversation.externalId,
        event.messageId,
        row.linkedTextSha256,
      ),
    });
    await recordEvent(
      tx,
      {
        name: "consent_given",
        familyId,
        memberId: member.id,
        surface: event.channel,
        props: { kind: "privacy_notice", text_version: version, source: "button" },
      },
      now,
    );
    return true;
  });
  deps.logger.info("notice_read", { familyId, recorded });
}
