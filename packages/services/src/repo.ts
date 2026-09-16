/**
 * The queries several flows share, each named for the question it answers and returning typed rows.
 * No business logic lives here: a flow decides what a result means. Every function accepts the
 * database or the caller's transaction, so a flow can read inside the transaction it writes in.
 */
import type { Channel, LocalDate, MediaRef } from "@vela/contracts";
import { addMinutes } from "@vela/core";
import {
  type ChannelLink,
  channelLinks,
  type Exchange,
  exchanges,
  type Family,
  type FamilyChannel,
  families,
  familyChannels,
  type Media,
  type Member,
  type MessageRef,
  media,
  members,
  messageRefs,
  type NearbyContact,
  nearbyContacts,
  outbound,
  type QuietEvent,
  quietEvents,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

/** The database, or the transaction a flow is already inside. */
export type Queryable = VelaDatabase | VelaTransaction;

export interface MemberWithFamily {
  member: Member;
  link: ChannelLink;
  family: Family;
}

/** The member a platform user is linked to on the channel, with their family. */
export async function memberByChannelUser(
  db: Queryable,
  channel: Channel,
  externalUserId: string,
): Promise<MemberWithFamily | null> {
  const rows = await db
    .select({ member: members, link: channelLinks, family: families })
    .from(channelLinks)
    .innerJoin(members, eq(members.id, channelLinks.memberId))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(and(eq(channelLinks.channel, channel), eq(channelLinks.externalId, externalUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface LinkedGroup {
  family: Family;
  group: FamilyChannel;
}

/** The family whose group this conversation is, while the group is linked. */
export async function familyByLinkedGroup(
  db: Queryable,
  channel: Channel,
  conversationId: string,
): Promise<LinkedGroup | null> {
  const rows = await db
    .select({ family: families, group: familyChannels })
    .from(familyChannels)
    .innerJoin(families, eq(families.id, familyChannels.familyId))
    .where(
      and(
        eq(familyChannels.channel, channel),
        eq(familyChannels.conversationId, conversationId),
        eq(familyChannels.kind, "group"),
        isNull(familyChannels.unlinkedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The family's linked group on the channel, if it has one. */
export async function linkedGroupOfFamily(
  db: Queryable,
  familyId: string,
  channel: Channel,
): Promise<FamilyChannel | null> {
  const rows = await db
    .select()
    .from(familyChannels)
    .where(
      and(
        eq(familyChannels.familyId, familyId),
        eq(familyChannels.channel, channel),
        eq(familyChannels.kind, "group"),
        isNull(familyChannels.unlinkedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface MemberLink {
  member: Member;
  link: ChannelLink;
}

/**
 * The family's active organisers who can be reached on the channel: each with their link, leaving
 * out links the person has blocked, since a send to those can only fail.
 */
export async function activeOrganisersWithLinks(
  db: Queryable,
  familyId: string,
  channel: Channel,
): Promise<MemberLink[]> {
  return db
    .select({ member: members, link: channelLinks })
    .from(members)
    .innerJoin(
      channelLinks,
      and(eq(channelLinks.memberId, members.id), eq(channelLinks.channel, channel)),
    )
    .where(
      and(
        eq(members.familyId, familyId),
        eq(members.role, "organiser"),
        eq(members.status, "active"),
        isNull(channelLinks.blockedAt),
      ),
    )
    .orderBy(members.createdAt, members.id);
}

/**
 * The family's kept-light members: those whose light is on, or was consented to once (the light is
 * switched off again when she is marked deceased, and consent is never cleared).
 */
export async function keptLightMembersOfFamily(db: Queryable, familyId: string): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        or(eq(members.lightOn, true), isNotNull(members.lightConsentedAt)),
      ),
    )
    .orderBy(members.createdAt, members.id);
}

export async function memberById(db: Queryable, memberId: string): Promise<Member | null> {
  const rows = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  return rows[0] ?? null;
}

export async function familyById(db: Queryable, familyId: string): Promise<Family | null> {
  const rows = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Records that the person blocked the bot on the channel, or unblocked it (flows §5, the routing
 * table): a blocked link is left out of every send, so nothing is queued that can only fail.
 */
export async function setChannelLinkBlocked(
  db: Queryable,
  channel: Channel,
  externalUserId: string,
  blockedAt: Date | null,
): Promise<boolean> {
  const rows = await db
    .update(channelLinks)
    .set({ blockedAt })
    .where(and(eq(channelLinks.channel, channel), eq(channelLinks.externalId, externalUserId)))
    .returning({ id: channelLinks.id });
  return rows.length > 0;
}

/** The member's link on the channel, blocked or not. */
export async function channelLinkOfMember(
  db: Queryable,
  memberId: string,
  channel: Channel,
): Promise<ChannelLink | null> {
  const rows = await db
    .select()
    .from(channelLinks)
    .where(and(eq(channelLinks.memberId, memberId), eq(channelLinks.channel, channel)))
    .limit(1);
  return rows[0] ?? null;
}

/** The member's exchange for one of her local dates; withdrawn exchanges do not count. */
export async function exchangeForLocalDate(
  db: Queryable,
  memberId: string,
  date: LocalDate,
): Promise<Exchange | null> {
  const rows = await db
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        eq(exchanges.scheduledFor, date),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The same row, locked for the caller's transaction. The quiet ladder decides from state read
 * before the transaction opens, so it locks the exchange before acting on that decision: her answer
 * takes the same lock (`lightTheLight`), and one of the two then sees what the other wrote.
 */
export async function lockExchangeForLocalDate(
  tx: VelaTransaction,
  memberId: string,
  date: LocalDate,
): Promise<Exchange | null> {
  const rows = await tx
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        eq(exchanges.scheduledFor, date),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

/** Her most recent exchange delivered at or after `since` that is not archived. */
export async function latestDeliveredExchangeWithin(
  db: Queryable,
  memberId: string,
  since: Date,
): Promise<Exchange | null> {
  const rows = await db
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        gte(exchanges.deliveredAt, since),
        ne(exchanges.state, "archived"),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .orderBy(desc(exchanges.deliveredAt))
    .limit(1);
  return rows[0] ?? null;
}

/** What a platform message was about, so a reply or a tap on it resolves. */
export async function messageRefFor(
  db: Queryable,
  channel: Channel,
  conversationId: string,
  messageId: string,
): Promise<MessageRef | null> {
  const rows = await db
    .select()
    .from(messageRefs)
    .where(
      and(
        eq(messageRefs.channel, channel),
        eq(messageRefs.conversationId, conversationId),
        eq(messageRefs.messageId, messageId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Her nearby contacts who said yes to being listed and have not since declined. */
export async function consentedNearbyContacts(
  db: Queryable,
  memberId: string,
): Promise<NearbyContact[]> {
  return db
    .select()
    .from(nearbyContacts)
    .where(
      and(
        eq(nearbyContacts.memberId, memberId),
        isNotNull(nearbyContacts.consentedAt),
        isNull(nearbyContacts.declinedAt),
      ),
    )
    .orderBy(nearbyContacts.createdAt, nearbyContacts.id);
}

export async function quietEventById(
  db: Queryable,
  quietEventId: string,
): Promise<QuietEvent | null> {
  const rows = await db.select().from(quietEvents).where(eq(quietEvents.id, quietEventId)).limit(1);
  return rows[0] ?? null;
}

/** The quiet event still open for an exchange, if one is. */
export async function openQuietEventForExchange(
  db: Queryable,
  exchangeId: string,
): Promise<QuietEvent | null> {
  const rows = await db
    .select()
    .from(quietEvents)
    .where(and(eq(quietEvents.exchangeId, exchangeId), isNull(quietEvents.resolvedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export interface AnswerTiming {
  deliveredAt: Date;
  answeredAt: Date;
}

/**
 * Her last `limit` answered days that were delivered, newest first. The quiet threshold is tuned
 * from the minutes between the two (spec §8); a day answered without a delivery has no latency and
 * is left out, so it cannot pull the median.
 */
export async function recentAnswerLatencies(
  db: Queryable,
  memberId: string,
  limit: number,
): Promise<AnswerTiming[]> {
  const rows = await db
    .select({ deliveredAt: exchanges.deliveredAt, answeredAt: exchanges.answeredAt })
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        isNotNull(exchanges.answeredAt),
        isNotNull(exchanges.deliveredAt),
      ),
    )
    .orderBy(desc(exchanges.answeredAt))
    .limit(limit);
  return rows.flatMap((row) =>
    row.answeredAt === null || row.deliveredAt === null
      ? []
      : [{ deliveredAt: row.deliveredAt, answeredAt: row.answeredAt }],
  );
}

/** When she answered her last `limit` answered exchanges, newest first. */
export async function recentAnswerTimes(
  db: Queryable,
  memberId: string,
  limit: number,
): Promise<Date[]> {
  const rows = await db
    .select({ answeredAt: exchanges.answeredAt })
    .from(exchanges)
    .where(and(eq(exchanges.recipientId, memberId), isNotNull(exchanges.answeredAt)))
    .orderBy(desc(exchanges.answeredAt))
    .limit(limit);
  return rows.flatMap((row) => (row.answeredAt === null ? [] : [row.answeredAt]));
}

/**
 * True once nothing may be sent for the family: its deletion was requested, or a kept-light member
 * is left or deceased (flows §3.7).
 */
export async function familyHasEnded(db: Queryable, familyId: string): Promise<boolean> {
  const rows = await db
    .select({ ended: sql<boolean>`true` })
    .from(families)
    .where(
      and(
        eq(families.id, familyId),
        or(
          isNotNull(families.deletedAt),
          sql`exists (select 1 from ${members} where ${members.familyId} = ${families.id} and (${members.lightOn} or ${members.lightConsentedAt} is not null) and ${members.status} in ('left', 'deceased'))`,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Points a family's next scheduler decision at `at`, so a change that can make something due sooner
 * (a delivery, a failure, a wait) is picked up: the Durable Object alarm set alongside ticks at
 * once, and `reconcile` catches a member whose alarm never fired.
 */
export async function markWakeDue(db: Queryable, memberId: string, at: Date): Promise<void> {
  await db.update(members).set({ nextWakeAt: at }).where(eq(members.id, memberId));
}

/**
 * Moves a family group to its new conversation id (a basic Telegram group upgraded to a supergroup,
 * flows §3.3 and §3.7): the linked `family_channels` row, that conversation's `message_refs`, and
 * the outbound rows still queued for it, in the caller's transaction. Telegram reports one move
 * twice and a send can report it too, so a repeat finds nothing left to move and changes nothing.
 */
export async function repointFamilyGroup(
  tx: VelaTransaction,
  channel: Channel,
  fromConversationId: string,
  toConversationId: string,
): Promise<void> {
  if (fromConversationId === toConversationId) {
    return;
  }
  await tx
    .update(familyChannels)
    .set({ conversationId: toConversationId })
    .where(
      and(
        eq(familyChannels.channel, channel),
        eq(familyChannels.conversationId, fromConversationId),
        isNull(familyChannels.unlinkedAt),
      ),
    );
  // Message ids are unique only within one chat: a ref the new chat already holds under the same id
  // stays as it is, and the old chat's ref for that id is dropped rather than made to collide.
  const taken = tx
    .select({ messageId: messageRefs.messageId })
    .from(messageRefs)
    .where(and(eq(messageRefs.channel, channel), eq(messageRefs.conversationId, toConversationId)));
  await tx
    .update(messageRefs)
    .set({ conversationId: toConversationId })
    .where(
      and(
        eq(messageRefs.channel, channel),
        eq(messageRefs.conversationId, fromConversationId),
        sql`${messageRefs.messageId} not in (${taken})`,
      ),
    );
  await tx
    .delete(messageRefs)
    .where(
      and(eq(messageRefs.channel, channel), eq(messageRefs.conversationId, fromConversationId)),
    );
  await tx
    .update(outbound)
    .set({ conversationId: toConversationId })
    .where(
      and(
        eq(outbound.channel, channel),
        eq(outbound.conversationId, fromConversationId),
        eq(outbound.status, "queued"),
      ),
    );
}

/** A received file may be fetched from the platform for this long; retention deletes it after. */
export const MEDIA_RETENTION_DAYS = 30;

export interface InboundMediaInput {
  familyId: string;
  uploadedBy: string;
  ref: MediaRef;
  now: Date;
}

/**
 * Records a file the platform holds, once per family (flows §3.5): the unique index on the
 * provider's `file_unique_id` makes a re-forwarded file reuse its row, and the row is read back
 * when the insert finds it there. A reference without a provider file id cannot be fetched later,
 * so it is not stored. Her answers, the family's asks, and the family's replies all record through
 * this, so one file inside one family is one row whichever flow received it.
 */
export async function recordInboundMedia(
  tx: VelaTransaction,
  channel: Channel,
  input: InboundMediaInput,
): Promise<Media | null> {
  const { ref } = input;
  if (ref.providerFileId === undefined) {
    return null;
  }
  const existing = async (): Promise<Media | null> => {
    if (ref.providerUniqueId === undefined) {
      return null;
    }
    const rows = await tx
      .select()
      .from(media)
      .where(
        and(
          eq(media.familyId, input.familyId),
          eq(media.channel, channel),
          eq(media.providerUniqueId, ref.providerUniqueId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  };
  const found = await existing();
  if (found !== null) {
    return found;
  }
  const [inserted] = await tx
    .insert(media)
    .values({
      familyId: input.familyId,
      uploadedBy: input.uploadedBy,
      kind: ref.kind,
      channel,
      providerFileId: ref.providerFileId,
      providerUniqueId: ref.providerUniqueId ?? null,
      mime: ref.mime ?? null,
      bytes: ref.bytes ?? null,
      durationMs: ref.durationMs ?? null,
      createdAt: input.now,
      expiresAt: addMinutes(input.now, MEDIA_RETENTION_DAYS * 24 * 60),
    })
    .onConflictDoNothing()
    .returning();
  return inserted ?? existing();
}

/** The exchanges with these ids, in no particular order; an empty list reads nothing. */
export async function exchangesByIds(db: Queryable, ids: readonly string[]): Promise<Exchange[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(exchanges)
    .where(inArray(exchanges.id, [...ids]));
}
