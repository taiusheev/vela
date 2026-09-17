/**
 * Rows a test starts from: a pilot family with an organiser and a kept-light member who has
 * consented, both linked on Telegram; the family group; further group members; her exchanges and
 * nearby contacts. Values follow the flows (§3.1, §3.2): the organiser and the kept-light member
 * share her zone, arrivals start the day after consent, and a contact is unlisted until they say yes.
 */
import type {
  ExchangeState,
  ExchangeType,
  Lang,
  LocalDate,
  LocalTime,
  Role,
} from "@vela/contracts";
import { addDays, learningUntil, localDateOf } from "@vela/core";
import {
  type ChannelLink,
  type Consent,
  channelLinks,
  consents,
  type Exchange,
  exchanges,
  type Family,
  type FamilyChannel,
  families,
  familyChannels,
  type Member,
  members,
  type NearbyContact,
  nearbyContacts,
  type VelaDatabase,
} from "@vela/db";
import { sha256Hex } from "../hash.ts";

export interface SeedFamilyOptions {
  /** The consent time; her arrivals start the next local day. */
  now: Date;
  familyName?: string;
  /** The family group's language, and the organiser's. */
  language?: Lang;
  /** Her language; the family's when left out. */
  memberLanguage?: Lang;
  timeZone?: string;
  arrivalTime?: LocalTime;
  organiserName?: string;
  organiserExternalId?: string;
  memberName?: string;
  memberAddress?: string;
  memberExternalId?: string;
}

export interface SeededFamily {
  family: Family;
  organiser: Member;
  organiserLink: ChannelLink;
  /** The kept-light member. */
  member: Member;
  memberLink: ChannelLink;
}

function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(`expected exactly one row, got ${rows.length}`);
  }
  return row;
}

export async function seedFamily(
  db: VelaDatabase,
  options: SeedFamilyOptions,
): Promise<SeededFamily> {
  const language = options.language ?? "en";
  const memberLanguage = options.memberLanguage ?? language;
  const tz = options.timeZone ?? "Asia/Taipei";
  const today = localDateOf(options.now, tz);
  const family = only(
    await db
      .insert(families)
      .values({
        name: options.familyName ?? "The Chens",
        region: "apac",
        country: "TW",
        language,
        createdAt: options.now,
      })
      .returning(),
  );
  const organiser = only(
    await db
      .insert(members)
      .values({
        familyId: family.id,
        role: "organiser",
        billing: true,
        displayName: options.organiserName ?? "Mia",
        language,
        tz,
        country: "TW",
        status: "active",
        primarySurface: "telegram",
        createdAt: options.now,
      })
      .returning(),
  );
  const organiserLink = only(
    await db
      .insert(channelLinks)
      .values({
        memberId: organiser.id,
        channel: "telegram",
        externalId: options.organiserExternalId ?? "1001",
        displayName: organiser.displayName,
        linkedAt: options.now,
      })
      .returning(),
  );
  const member = only(
    await db
      .insert(members)
      .values({
        familyId: family.id,
        role: "member",
        displayName: options.memberName ?? "Mom",
        addressForm: options.memberAddress ?? "Mrs Chen",
        language: memberLanguage,
        tz,
        country: "TW",
        status: "active",
        turnsIn: false,
        primarySurface: "telegram",
        lightOn: true,
        lightConsentedAt: options.now,
        lightConsentText: "consent.request@2",
        lightStartsOn: addDays(today, 1),
        wakeTime: "07:30",
        arrivalTime: options.arrivalTime ?? "08:00",
        learningUntil: learningUntil(today),
        createdAt: options.now,
      })
      .returning(),
  );
  const memberLink = only(
    await db
      .insert(channelLinks)
      .values({
        memberId: member.id,
        channel: "telegram",
        externalId: options.memberExternalId ?? "2001",
        displayName: member.displayName,
        linkedAt: options.now,
      })
      .returning(),
  );
  await db.insert(consents).values({
    memberId: member.id,
    subjectRef: `member:${member.id}`,
    kind: "light",
    answer: "yes",
    textVersion: "consent.request@2",
    lang: memberLanguage,
    channel: "telegram",
    givenAt: options.now,
    evidence: { chat_id: memberLink.externalId, message_id: "1" },
  });
  return { family, organiser, organiserLink, member, memberLink };
}

/**
 * The family's Telegram group, linked by the organiser. No greeting was posted, so the hash it keeps
 * is of a stand-in text; a test about the greeting links the group through `handleBotAdded`.
 */
export async function seedLinkedGroup(
  db: VelaDatabase,
  seed: SeededFamily,
  options: { now: Date; conversationId?: string },
): Promise<FamilyChannel> {
  const conversationId = options.conversationId ?? "-100500";
  return only(
    await db
      .insert(familyChannels)
      .values({
        familyId: seed.family.id,
        channel: "telegram",
        conversationId,
        kind: "group",
        linkedByMemberId: seed.organiser.id,
        linkedAt: options.now,
        linkedTextSha256: await sha256Hex(`seeded greeting in ${conversationId}`),
      })
      .returning(),
  );
}

/**
 * A family member who replied in the group, created lazily as the flows do (flows §2), or with
 * `role: "organiser"` a second organiser.
 */
export async function seedGroupMember(
  db: VelaDatabase,
  seed: SeededFamily,
  options: { now: Date; name: string; externalId: string; role?: Role },
): Promise<{ member: Member; link: ChannelLink }> {
  const member = only(
    await db
      .insert(members)
      .values({
        familyId: seed.family.id,
        role: options.role ?? "member",
        displayName: options.name,
        language: seed.family.language,
        tz: seed.member.tz,
        country: seed.member.country,
        status: "active",
        primarySurface: "telegram",
        createdAt: options.now,
      })
      .returning(),
  );
  const link = only(
    await db
      .insert(channelLinks)
      .values({
        memberId: member.id,
        channel: "telegram",
        externalId: options.externalId,
        displayName: options.name,
        linkedAt: options.now,
      })
      .returning(),
  );
  return { member, link };
}

export interface SeedExchangeOptions {
  date: LocalDate;
  type?: ExchangeType;
  text?: string | null;
  state?: ExchangeState;
  askerId?: string | null;
  deliveredAt?: Date | null;
  answeredAt?: Date | null;
  createdAt?: Date;
}

/** One of her exchanges; a `hello` has no asker, anything else the organiser unless given. */
export async function seedExchange(
  db: VelaDatabase,
  seed: SeededFamily,
  options: SeedExchangeOptions,
): Promise<Exchange> {
  const type = options.type ?? "question";
  const askerId =
    options.askerId !== undefined ? options.askerId : type === "hello" ? null : seed.organiser.id;
  return only(
    await db
      .insert(exchanges)
      .values({
        familyId: seed.family.id,
        recipientId: seed.member.id,
        askerId,
        type,
        state: options.state ?? "scheduled",
        text: options.text === undefined ? "What are you cooking tonight?" : options.text,
        textLang: seed.family.language,
        whenRule: "tomorrow",
        scheduledFor: options.date,
        deliveredAt: options.deliveredAt ?? null,
        answeredAt: options.answeredAt ?? null,
        createdAt: options.createdAt,
      })
      .returning(),
  );
}

/**
 * A nearby contact near her. Their number exists only inside a yes, as the database holds it (L8):
 * a contact with no answer yet, or with a no, is a name, and is listed nowhere.
 */
export async function seedNearbyContact(
  db: VelaDatabase,
  seed: SeededFamily,
  options: {
    now: Date;
    name: string;
    relation?: string | null;
    answer: { yes: { phone: string } } | "no" | null;
  },
): Promise<NearbyContact> {
  const yes = options.answer === null || options.answer === "no" ? null : options.answer.yes;
  return only(
    await db
      .insert(nearbyContacts)
      .values({
        familyId: seed.family.id,
        memberId: seed.member.id,
        name: options.name,
        relation: options.relation ?? null,
        phone: yes?.phone ?? null,
        consentedAt: yes === null ? null : options.now,
        declinedAt: options.answer === "no" ? options.now : null,
        createdAt: options.now,
      })
      .returning(),
  );
}

/**
 * Her answer to the health-words question (flows §3.2), as the tap records it; a test of what
 * understanding keeps with and without that consent starts from it.
 */
export async function seedHealthWordsConsent(
  db: VelaDatabase,
  seed: SeededFamily,
  options: { at: Date; answer: "yes" | "no" },
): Promise<Consent> {
  return only(
    await db
      .insert(consents)
      .values({
        memberId: seed.member.id,
        subjectRef: `member:${seed.member.id}`,
        kind: "health_words",
        answer: options.answer,
        textVersion: "consent.health_words@1",
        lang: seed.member.language,
        channel: "telegram",
        givenAt: options.at,
        evidence: { chat_id: seed.memberLink.externalId, message_id: "2" },
      })
      .returning(),
  );
}
