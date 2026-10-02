/**
 * The queries several flows share, each named for the question it answers and returning typed rows.
 * No business logic lives here: a flow decides what a result means. Every function accepts the
 * database or the caller's transaction, so a flow can read inside the transaction it writes in.
 */
import type { Channel, LocalDate, MediaRef, OutboundMediaRef } from "@vela/contracts";
import { addDays, addMinutes, localDateOf, zonedInstant } from "@vela/core";
import {
  answers,
  type ChannelLink,
  channelLinks,
  consents,
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
  pushDevices,
  type QuietEvent,
  quietEvents,
  users,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

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

/**
 * The channel of the family group that sees what came in on `channel`: the same one, except for her
 * phone on the parent surface (ADR-35), which has no group of its own, so what she says there is
 * posted to the family's Telegram group, where her mornings' turn prompts already go.
 */
export function groupChannelOf(channel: Channel): Channel {
  return channel === "device" ? "telegram" : channel;
}

/**
 * Her file from her phone as a group on another channel can be sent it (ADR-35): by the storage key
 * of the copy her phone uploaded, which Telegram is sent as an upload. Null when the row holds no
 * stored copy, or no such row of the family's is there.
 */
export async function deviceFileForGroup(
  db: Queryable,
  familyId: string,
  ref: Pick<MediaRef, "providerUniqueId">,
): Promise<OutboundMediaRef | null> {
  if (ref.providerUniqueId === undefined) return null;
  const [row] = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.familyId, familyId),
        eq(media.channel, "device"),
        eq(media.providerUniqueId, ref.providerUniqueId),
      ),
    )
    .limit(1);
  return row === undefined || row.storageKey === null
    ? null
    : {
        kind: row.kind,
        storageKey: row.storageKey,
        ...(row.mime === null ? {} : { mime: row.mime }),
        ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
      };
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
 * table): a blocked link is left out of every send, so nothing is queued that can only fail. Says
 * whether any link was known, whose link this has just blocked — one already blocked is not
 * "just" — so the caller can tell whether a family has lost its last organiser who could be told,
 * and whose mark this has cleared, so the caller can re-decide a schedule the mark held back.
 */
export async function setChannelLinkBlocked(
  db: Queryable,
  channel: Channel,
  externalUserId: string,
  blockedAt: Date | null,
): Promise<{ known: boolean; newlyBlockedMemberIds: string[]; unblockedMemberIds: string[] }> {
  const where = and(eq(channelLinks.channel, channel), eq(channelLinks.externalId, externalUserId));
  // Read under the row lock (in the caller's transaction), so a block the gateway records at the
  // same moment is seen, and only one of the two counts as the moment the link became blocked.
  const before = await db
    .select({ memberId: channelLinks.memberId, blockedAt: channelLinks.blockedAt })
    .from(channelLinks)
    .where(where)
    .for("update");
  if (before.length === 0) {
    return { known: false, newlyBlockedMemberIds: [], unblockedMemberIds: [] };
  }
  await db.update(channelLinks).set({ blockedAt }).where(where);
  return {
    known: true,
    newlyBlockedMemberIds:
      blockedAt === null
        ? []
        : before.filter((link) => link.blockedAt === null).map((l) => l.memberId),
    unblockedMemberIds:
      blockedAt === null
        ? before.filter((link) => link.blockedAt !== null).map((l) => l.memberId)
        : [],
  };
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
 *
 * `for no key update`, not `for update`, and her answer's lock is the same. Both go on to lock the
 * exchange's quiet event, while "she's fine" (the app's and the Telegram button's) holds that event
 * and writes outbound rows whose foreign key is this exchange — each insert taking `for key share`
 * on it, which `for update` blocks. That is a lock cycle, and PostgreSQL broke it by aborting her
 * answer, or the detector (the contention drill's `quiet-notice-race`). `for no key update` still
 * excludes every other writer of the row, and admits only those foreign-key checks; it is enough
 * because no caller deletes the exchange or changes its id, which would need the stronger lock.
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
    .for("no key update");
  return rows[0] ?? null;
}

/**
 * The same row and lock, only once the morning has been delivered: her answer takes it for the
 * local date it arrives on, whichever exchange the answer attaches to (`lightTheLight`, flows §3.9).
 * A morning not delivered yet has no quiet to open or close, and is not locked: preparing it locks
 * her member row before writing it, which an answer writes last, and the arrival's effects lock it
 * before the exchange read back, which the answer may already hold; either would be a lock cycle.
 * A row being delivered as this runs reads as undelivered and is passed over without waiting.
 */
export async function lockDeliveredExchangeForLocalDate(
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
        isNotNull(exchanges.deliveredAt),
      ),
    )
    .limit(1)
    .for("no key update");
  return rows[0] ?? null;
}

/**
 * When her first answer of each local date between `from` and `to` arrived, whichever exchange it
 * attached to: an answer counts for the date it arrives on (flows §3.9), so one sent before the
 * day's arrival, which attaches to the previous exchange, or tapped on an older arrival's buttons,
 * is still the day's answer. The schedule reads each day's answer by it (`loadScheduleInput`), and
 * the quiet ladder checks it again under the day's lock (`quiet.ts`); `dayAnsweredAt` combines it
 * with the day's own exchange.
 */
export async function firstAnswersByDate(
  db: Queryable,
  memberId: string,
  timeZone: string,
  from: LocalDate,
  to: LocalDate,
): Promise<Map<LocalDate, Date>> {
  const rows = await db
    .select({ receivedAt: answers.receivedAt })
    .from(answers)
    .where(
      and(
        eq(answers.memberId, memberId),
        gte(answers.receivedAt, zonedInstant(from, "00:00", timeZone)),
        lt(answers.receivedAt, zonedInstant(addDays(to, 1), "00:00", timeZone)),
      ),
    )
    .orderBy(asc(answers.receivedAt));
  const first = new Map<LocalDate, Date>();
  for (const row of rows) {
    const date = localDateOf(row.receivedAt, timeZone);
    if (!first.has(date)) {
      first.set(date, row.receivedAt);
    }
  }
  return first;
}

/**
 * When her day counts as answered: the earlier of the day's own exchange's `answered_at` and her
 * first answer that arrived on the date to any exchange (`firstAnswersByDate`), or null when she has
 * given neither. The schedule (`loadScheduleInput`), the weekly read's counts (`jobs.ts`), T_quiet's
 * tuning and `{usual}` (`recentAnsweredDays`), and the lights (`api-lights.ts`) read her day by it,
 * so the family sees her lit exactly when the quiet ladder counts her day answered.
 */
export function dayAnsweredAt(
  exchangeAnsweredAt: Date | null,
  firstAnswer: Date | null,
): Date | null {
  if (exchangeAnsweredAt === null) {
    return firstAnswer;
  }
  if (firstAnswer === null) {
    return exchangeAnsweredAt;
  }
  return exchangeAnsweredAt.getTime() <= firstAnswer.getTime() ? exchangeAnsweredAt : firstAnswer;
}

/**
 * The exchange whose replies her next arrival reads back: her latest delivered one. `loadReadBack`
 * in `arrivals.ts` selects the latest delivered exchange before the arrival's date, and every
 * exchange on or after that date is still undelivered when it runs, so the two always agree. Any
 * reply to an older exchange is kept for the family and never heard.
 */
export async function readBackExchangeId(db: Queryable, memberId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: exchanges.id })
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        isNotNull(exchanges.scheduledFor),
        isNotNull(exchanges.deliveredAt),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .orderBy(desc(exchanges.scheduledFor))
    .limit(1);
  return row?.id ?? null;
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

/** A nearby contact whose yes stands, and so whose number is stored. */
export type ListedNearbyContact = NearbyContact & { phone: string };

/**
 * Her nearby contacts who said yes to being listed and have not since declined. The database holds a
 * number exactly while a yes stands (`nearby_contacts_phone_consented_check`), so each has one; the
 * filter only tells the type so.
 */
/** Everyone near her with a standing yes, by number or on Telegram, in the order they were added. */
export async function listedNearbyContacts(
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

export async function consentedNearbyContacts(
  db: Queryable,
  memberId: string,
): Promise<ListedNearbyContact[]> {
  const rows = await db
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
  return rows.flatMap((contact) =>
    contact.phone === null ? [] : [{ ...contact, phone: contact.phone }],
  );
}

/**
 * Whether she had agreed that Vela may carry her health words for an answer received at `at`
 * (flows §3.10, ADR-27): a `health_words` yes given at or before it and not withdrawn now. A yes
 * given after the answer arrived, or withdrawn before it is understood, counts as none.
 */
export async function hasHealthWordsConsent(
  db: Queryable,
  memberId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.memberId, memberId),
        eq(consents.kind, "health_words"),
        eq(consents.answer, "yes"),
        lte(consents.givenAt, at),
        isNull(consents.withdrawnAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
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

/** One of her answered days: the day's delivered morning, and the answer the day counts. */
export interface AnsweredDay {
  date: LocalDate;
  deliveredAt: Date;
  answeredAt: Date;
}

/** Her delivered mornings read at a time, newest first, while looking for answered ones. */
const ANSWERED_DAYS_PAGE = 30;

/**
 * Her last `limit` answered days whose morning was delivered, newest first, each with the answer
 * the day counts (flows §3.9, `dayAnsweredAt`), as the schedule and the weekly read count it: the
 * earlier of its exchange's `answered_at` and her first answer received on that local date, to
 * whichever exchange. A message before the arrival attaches to the previous morning and is still
 * its own day's answer, so that day's latency is negative (spec §19), as `quietAfterMinutes`
 * expects; read per exchange, it counted only for the previous morning, nearly a day late, and an
 * early writer's threshold went to the cap. T_quiet is tuned from these days (spec §8) and
 * `{usual}` is read from them (flows §3.12). A day whose morning was never delivered has no latency
 * and is left out.
 */
export async function recentAnsweredDays(
  db: Queryable,
  member: Pick<Member, "id" | "tz">,
  limit: number,
): Promise<AnsweredDay[]> {
  const days: AnsweredDay[] = [];
  let before: LocalDate | null = null;
  while (days.length < limit) {
    const mornings = await db
      .select({
        date: exchanges.scheduledFor,
        deliveredAt: exchanges.deliveredAt,
        answeredAt: exchanges.answeredAt,
      })
      .from(exchanges)
      .where(
        and(
          eq(exchanges.recipientId, member.id),
          isNotNull(exchanges.deliveredAt),
          ne(exchanges.state, "withdrawn"),
          before === null ? isNotNull(exchanges.scheduledFor) : lt(exchanges.scheduledFor, before),
        ),
      )
      .orderBy(desc(exchanges.scheduledFor))
      .limit(ANSWERED_DAYS_PAGE);
    const newest = mornings[0]?.date ?? null;
    const oldest: LocalDate | null = mornings.at(-1)?.date ?? null;
    if (newest === null || oldest === null) {
      break;
    }
    const firstOn = await firstAnswersByDate(db, member.id, member.tz, oldest, newest);
    for (const { date, deliveredAt, answeredAt } of mornings) {
      const counted = dayAnsweredAt(
        answeredAt,
        (date === null ? undefined : firstOn.get(date)) ?? null,
      );
      if (date !== null && deliveredAt !== null && counted !== null) {
        days.push({ date, deliveredAt, answeredAt: counted });
      }
    }
    if (mornings.length < ANSWERED_DAYS_PAGE) {
      break;
    }
    before = oldest;
  }
  return days.slice(0, limit);
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
 * flows §3.3 and §3.7): the linked `family_channels` row and the outbound rows still queued for it,
 * in the caller's transaction. Message ids are unique only within one chat, and a supergroup
 * numbers its own from 1, so nothing that names an old message moves: the old conversation's
 * `message_refs` are deleted, since a moved ref would resolve whichever new message took its number
 * (and a reply there to a message from before the upgrade does not carry that message's id); a
 * queued row loses the message it replies to, and the media an earlier try got out in the old chat
 * (`sentMedia`), which then goes again with the text, so the post stands whole in the new chat and
 * each ref it records is the new chat's. Telegram reports one move twice and a send can report it
 * too, so a repeat finds nothing left to move and changes nothing.
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
  await tx
    .delete(messageRefs)
    .where(
      and(eq(messageRefs.channel, channel), eq(messageRefs.conversationId, fromConversationId)),
    );
  await tx
    .update(outbound)
    .set({
      conversationId: toConversationId,
      payload: sql`(${outbound.payload} - 'sentMedia') #- '{message,replyToMessageId}'`,
    })
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

// Push (ADR-34) -----------------------------------------------------------------------------------

/** An active organiser who can be told of her silence, and on what. */
export interface ReachableOrganiser {
  member: Member;
  /** Their links on the notice channel that they have not blocked, oldest first. */
  links: ChannelLink[];
  /** Their live account has a phone that can be told (`pushDeviceCanBeTold`), and push is on. */
  push: boolean;
}

/**
 * The family's active organisers who can be told anything (ADR-34, D4): with a link on `channel`
 * they have not blocked, or, while push is on (`pushOn`, `deps.push` non-null), with a live account
 * holding a phone whose notifications are allowed and whose quiet channel is not blocked. Push off
 * counts Telegram alone, as before push was built. Oldest membership first.
 */
export async function reachableOrganisers(
  db: Queryable,
  familyId: string,
  channel: Channel,
  pushOn: boolean,
): Promise<ReachableOrganiser[]> {
  const push = pushOn
    ? sql<boolean>`exists (select 1 from ${pushDevices} inner join ${users} on ${users.id} = ${pushDevices.userId} where ${pushDevices.userId} = ${members.userId} and ${users.deletedAt} is null and ${pushDevices.permission} = 'granted' and not ${pushDevices.quietChannelBlocked})`
    : sql<boolean>`false`;
  const rows = await db
    .select({ member: members, link: channelLinks, push })
    .from(members)
    .leftJoin(
      channelLinks,
      and(
        eq(channelLinks.memberId, members.id),
        eq(channelLinks.channel, channel),
        isNull(channelLinks.blockedAt),
      ),
    )
    .where(
      and(
        eq(members.familyId, familyId),
        eq(members.role, "organiser"),
        eq(members.status, "active"),
      ),
    )
    .orderBy(members.createdAt, members.id, channelLinks.linkedAt, channelLinks.id);
  const byMember = new Map<string, ReachableOrganiser>();
  for (const row of rows) {
    const known = byMember.get(row.member.id);
    const organiser = known ?? { member: row.member, links: [], push: row.push === true };
    if (row.link !== null) organiser.links.push(row.link);
    if (known === undefined) byMember.set(row.member.id, organiser);
  }
  return [...byMember.values()].filter((organiser) => organiser.links.length > 0 || organiser.push);
}
