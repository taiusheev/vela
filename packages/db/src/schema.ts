/**
 * The data model: the single source of truth. `architecture/schema.sql` and the migrations are
 * generated from this file. One database per data region (apac, eu, us), same schema everywhere.
 *
 * Conventions: uuidv7 primary keys from Postgres 18 (time-ordered, no extension), timestamptz for
 * instants, `date` and `time` for a member's local calendar values, text + CHECK instead of enum
 * types (cheaper to evolve), no soft deletes except the documented status fields.
 *
 * Spec: product/05-product-spec-v2.md. The exchange (§3) is the core object; arrivals are its
 * deliveries. Code design: architecture/03-code-design.md §3.
 *
 * Retention: the data map's pilot rules (plan/materials/pilot/data-map.md), implemented by
 * applyRetention in services and documented here because they explain the nullable columns and the
 * member ids without a foreign key.
 *
 * - Cleared: exchanges.text and exchanges.options 30 days after delivery, or after they were
 *   written when the morning never reached her (delivered_at stays null on a failed arrival and on
 *   a whenever ask nothing scheduled); outbound.payload 30 days after sent_at, or after it was
 *   queued when the row never sent; after 30 days, chips, translations, replies.text, the text inside
 *   answers.payload, answers.transcript, answers.mentions, mood_words and flag_reason,
 *   suggestions.text, ai_calls.output, and the reply text inside quiet_events.ask_to_check. A
 *   cleared column that is NOT NULL takes its empty value ('', '{}', '[]'); chips and translations
 *   rows hold nothing but their text, so clearing them deletes the rows.
 * - Deleted: message_refs older than 30 days; invites 30 days after expires_at or accepted_at, except
 *   an invite meant for a member still invited without light_consented_at, which stays until that
 *   member is deleted; onboarding sessions once expires_at has passed.
 * - Media is deleted when expires_at has passed and kept is false, and every media deletion writes a
 *   deletions row. Foreign-key references to it are set null; the job removes its id from
 *   exchanges.media_ids and exchanges.options, which no foreign key covers.
 * - Members are deleted 30 days after left_at, and a member still invited without consent 30 days
 *   after her last invite expired (a no to the light deletes her at once). Rows that only credit them
 *   with an act (asker, uploader, resolver, turn holder) stay with the reference set null; rows that
 *   exist only because of them (invites they sent or that were meant for them, outbound messages
 *   sent on their tap, nearby contacts near them) are deleted with them. Member ids held in arrays or
 *   JSON (quiet_events.notified_member_ids, ask_to_check) and in admin_access_log have no foreign key.
 * - Families are deleted, with everything that cascades from them, within 24 h of deleted_at.
 * - Consent proofs outlive their subject. Before any member or nearby contact is deleted, a family's
 *   included, the consent rows about them are forgotten: evidence cut to CONSENT_PROOF_KEYS and
 *   subject_deleted_at set (consents_subject_deleted_check refuses the delete otherwise). The delete
 *   then sets member_id and contact_id null, and subject_ref still names the subject by id.
 * - events, metrics_daily, ai_calls and outbound rows are deleted after 24 months.
 * - After 5 years: consents that no longer permit anything (a no, a withdrawn yes, or a deleted
 *   subject), counted from the latest of given_at, withdrawn_at and subject_deleted_at, and deletions
 *   rows, counted from deleted_at. A standing yes whose subject still exists is never deleted by age.
 * - Kept while the family uses Vela: answers.summary, the answers.flag boolean, and away periods'
 *   dates.
 * - Outside this database, a member's Durable Object storage is cleared when they stop, leave, are
 *   marked deceased, or are deleted.
 */
import {
  ADMIN_ACTIONS,
  AGE_BANDS,
  ANSWER_KINDS,
  AWAY_SOURCES,
  BUDGETED_OUTBOUND_KINDS,
  CHANNELS,
  CONSENT_ANSWERS,
  CONSENT_KINDS,
  type ConsentAnswer,
  type ConversationKind,
  EVENT_NAMES,
  EXCHANGE_STATES,
  EXCHANGE_TYPES,
  LANGS,
  type LocalTime,
  MEDIA_KINDS,
  MEMBER_STATUSES,
  OUTBOUND_KINDS,
  OUTBOUND_STATUSES,
  type OutboundKind,
  PLANS,
  QUIET_OUTCOMES,
  REACTION_KINDS,
  REGIONS,
  REPLY_KINDS,
  ROLES,
  SUBSCRIPTION_STATUSES,
  SURFACES,
  WHEN_RULES,
} from "@vela/contracts";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { isOneOf, quoteLiteral } from "./checks.ts";

// Sets that belong to a single table and are not part of the shared domain vocabulary.
export const FAMILY_CHANNEL_KINDS = [
  "private",
  "group",
] as const satisfies readonly ConversationKind[];
export const MESSAGE_REF_PURPOSES = [
  "arrival",
  "repeat",
  "turn_prompt",
  "answer_post",
  "quiet_notice",
  "consent",
  "ask_confirmation",
] as const;
export type MessageRefPurpose = (typeof MESSAGE_REF_PURPOSES)[number];
export const INVITE_CHANNELS = ["link", "line", "whatsapp", "telegram", "sms", "email"] as const;
export const NEARBY_CONTACT_CHANNELS = ["line", "whatsapp", "telegram", "sms"] as const;
export const TRANSLATION_OBJECT_TYPES = [
  "exchange",
  "answer",
  "reply",
  "story",
  "weekly_read",
  "recipe",
] as const;
export const RECIPE_STATUSES = ["draft", "confirmed"] as const;
export const MEMORY_FACT_KINDS = [
  "date",
  "person",
  "place",
  "health",
  "plan",
  "preference",
] as const;
/**
 * What a consent row's `evidence` keeps once its member or contact is deleted (ADR-28): the ids of
 * the chat and the message that carried the buttons, the hash of the text she saw, and the marker of
 * a row the founder recorded. Enough to show what was agreed or declined, and nothing of what the
 * person said or was called; `consents_subject_deleted_check` is built from this list.
 */
export const CONSENT_PROOF_KEYS = ["chat_id", "message_id", "text_sha256", "recorded_by"] as const;
export const SUBSCRIPTION_PROVIDERS = ["trial", "stripe", "revenuecat", "manual"] as const;
export { SUBSCRIPTION_STATUSES };
export const PLAN_INTERVALS = ["month", "year"] as const;

type JsonObject = Record<string, unknown>;

const uuidv7Id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

/**
 * A `time` column read as the domain's `LocalTime` (`HH:MM`). Postgres always prints `time` with
 * seconds ("08:00:00"), which core's time functions reject, so the seconds are dropped at the
 * database boundary instead of in every service.
 */
const localTime = customType<{ data: LocalTime; driverData: string }>({
  dataType: () => "time",
  fromDriver: (value) => value.slice(0, 5),
});

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

/** A person with an account. Kept-light members reached only on a messenger have no user row. */
export const users = pgTable(
  "users",
  {
    id: uuidv7Id(),
    /** Id from the auth provider. */
    authSubject: text("auth_subject").unique("users_auth_subject_key"),
    email: text("email").unique("users_email_key"),
    /** E.164. */
    phone: text("phone").unique("users_phone_key"),
    displayName: text("display_name").notNull(),
    language: text("language", { enum: LANGS }).notNull().default("en"),
    /** IANA zone. */
    tz: text("tz").notNull().default("UTC"),
    createdAt: createdAt(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [check("users_language_check", isOneOf(t.language, LANGS))],
);

export const families = pgTable(
  "families",
  {
    id: uuidv7Id(),
    name: text("name").notNull(),
    region: text("region", { enum: REGIONS }).notNull(),
    /** ISO 3166-1 alpha-2 of the kept-light member; sets region and holidays. */
    country: text("country").notNull(),
    /** The family group chat's language, used for posts every member reads. */
    language: text("language", { enum: LANGS }).notNull().default("en"),
    plan: text("plan", { enum: PLANS }).notNull().default("free"),
    /** 0 = Sunday. */
    storyDay: smallint("story_day").notNull().default(0),
    turnsEnabled: boolean("turns_enabled").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    /** Deleting a family cascades within 24 h (retention job). */
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    check("families_region_check", isOneOf(t.region, REGIONS)),
    check("families_language_check", isOneOf(t.language, LANGS)),
    check("families_plan_check", isOneOf(t.plan, PLANS)),
    check("families_story_day_check", sql`${sql.identifier(t.storyDay.name)} between 0 and 6`),
  ],
);

/** Membership of a person in a family. The kept-light member is a member with light_on = true. */
export const members = pgTable(
  "members",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** NULL for members reached only through a channel. */
    userId: uuid("user_id").references(() => users.id),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    /** The organiser who pays. */
    billing: boolean("billing").notNull().default(false),
    /** "Mom", "Mia". */
    displayName: text("display_name").notNull(),
    /** "Mrs Ivanova", "Галина Петровна"; used in every greeting. */
    addressForm: text("address_form"),
    language: text("language", { enum: LANGS }).notNull().default("en"),
    /** IANA zone; DST is handled by the tz database. */
    tz: text("tz").notNull(),
    country: text("country").notNull(),
    ageBand: text("age_band", { enum: AGE_BANDS }),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("invited"),
    turnsIn: boolean("turns_in").notNull().default(true),
    primarySurface: text("primary_surface", { enum: SURFACES }).notNull().default("app"),
    lightOn: boolean("light_on").notNull().default(false),
    lightConsentedAt: timestamptz("light_consented_at"),
    /** Version of the consent copy she agreed to. */
    lightConsentText: text("light_consent_text"),
    /**
     * The first local date on which arrivals may be delivered: the day after consent, so the first
     * morning is tomorrow, as the consent copy promises. NULL until the light is switched on.
     */
    lightStartsOn: date("light_starts_on"),
    /** Her local wake time. */
    wakeTime: localTime("wake_time"),
    /** Local arrival time (wake + 30 min for kept-light members). */
    arrivalTime: localTime("arrival_time").notNull().default("08:00"),
    /**
     * When this member's scheduler should next wake (UTC). The Durable Object alarm is the primary
     * scheduler; this column lets the reconciliation job find members whose wake was missed.
     */
    nextWakeAt: timestamptz("next_wake_at"),
    /** T_quiet: starts at 6 h, tuned weekly, floor 240, cap 600. */
    quietAfterMin: integer("quiet_after_min").notNull().default(360),
    /** The first 14 days: quiet shows in the app only, push after 8 h. */
    learningUntil: date("learning_until"),
    /** {median_latency_min, sunday_median_min, n_days, updated_at} */
    answerStats: jsonb("answer_stats").$type<JsonObject>().notNull().default({}),
    createdAt: createdAt(),
    /** Data is deleted 30 days later by the retention job. */
    leftAt: timestamptz("left_at"),
  },
  (t) => [
    unique("members_family_id_user_id_key").on(t.familyId, t.userId),
    index("members_due_idx")
      .on(t.nextWakeAt)
      .where(sql`${sql.identifier(t.status.name)} = 'active'`),
    index("members_family_idx").on(t.familyId),
    check("members_role_check", isOneOf(t.role, ROLES)),
    check("members_language_check", isOneOf(t.language, LANGS)),
    check("members_age_band_check", isOneOf(t.ageBand, AGE_BANDS)),
    check("members_status_check", isOneOf(t.status, MEMBER_STATUSES)),
    check("members_primary_surface_check", isOneOf(t.primarySurface, SURFACES)),
  ],
);

/** Identity of a member on a channel. There is no account for her; this row is her. */
export const channelLinks = pgTable(
  "channel_links",
  {
    id: uuidv7Id(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /** LINE userId, WhatsApp wa_id, Telegram chat id, E.164, device id. */
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    linkedAt: timestamptz("linked_at").notNull().defaultNow(),
    /** Unfollow, block, or unreachable. */
    blockedAt: timestamptz("blocked_at"),
    meta: jsonb("meta").$type<JsonObject>().notNull().default({}),
  },
  (t) => [
    unique("channel_links_channel_external_id_key").on(t.channel, t.externalId),
    index("channel_links_member_idx").on(t.memberId),
    check("channel_links_channel_check", isOneOf(t.channel, CHANNELS)),
  ],
);

/** The family's own conversation on a messenger, usually its group chat, where turns are taken. */
export const familyChannels = pgTable(
  "family_channels",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    conversationId: text("conversation_id").notNull(),
    kind: text("kind", { enum: FAMILY_CHANNEL_KINDS }).notNull(),
    linkedByMemberId: uuid("linked_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    linkedAt: timestamptz("linked_at").notNull().defaultNow(),
    unlinkedAt: timestamptz("unlinked_at"),
    /**
     * SHA-256, lowercase hex, of the text Vela posted when it linked the conversation
     * (`group.linked`). Each adult's "I've read it" tap copies it into their `privacy_notice`
     * evidence, so the proof names the message the group received, however the family changes
     * later, and holds no one's name: the text names the kept-light member, and her name must not
     * outlive her deletion in another adult's row (flows §3.3).
     */
    linkedTextSha256: text("linked_text_sha256").notNull(),
  },
  (t) => [
    // Unique only while linked: a group can be linked again after the bot was removed, and the
    // unlinked rows stay as history.
    uniqueIndex("family_channels_channel_conversation_id_idx")
      .on(t.channel, t.conversationId)
      .where(sql`${sql.identifier(t.unlinkedAt.name)} is null`),
    check("family_channels_channel_check", isOneOf(t.channel, CHANNELS)),
    check("family_channels_kind_check", isOneOf(t.kind, FAMILY_CHANNEL_KINDS)),
  ],
);

/** Invites into a family (link, phone, or email). Tokens are single use. */
export const invites = pgTable(
  "invites",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    /** A pre-created member row, e.g. the kept-light member. */
    forMemberId: uuid("for_member_id").references(() => members.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique("invites_token_key"),
    channel: text("channel", { enum: INVITE_CHANNELS }).notNull().default("link"),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => members.id, { onDelete: "set null" }),
  },
  (t) => [check("invites_channel_check", isOneOf(t.channel, INVITE_CHANNELS))],
);

/** A setup conversation with an organiser on a messenger, before any family exists. */
export const onboardingSessions = pgTable(
  "onboarding_sessions",
  {
    channel: text("channel", { enum: CHANNELS }).notNull(),
    conversationId: text("conversation_id").notNull(),
    externalUserId: text("external_user_id").notNull(),
    step: text("step").notNull(),
    /** Answers collected so far. */
    data: jsonb("data").$type<JsonObject>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "onboarding_sessions_pkey", columns: [t.channel, t.conversationId] }),
    check("onboarding_sessions_channel_check", isOneOf(t.channel, CHANNELS)),
  ],
);

/** Two people the organiser would call first. Consent once, in the organiser's name. */
export const nearbyContacts = pgTable(
  "nearby_contacts",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** The kept-light member they are near. */
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relation: text("relation"),
    /**
     * Stored exactly while the contact's yes stands (L8): setup stores a name, the founder adds the
     * number with the recorded yes, and a no clears it.
     */
    phone: text("phone"),
    channel: text("channel", { enum: NEARBY_CONTACT_CHANNELS }),
    consentRequestedAt: timestamptz("consent_requested_at"),
    consentedAt: timestamptz("consented_at"),
    declinedAt: timestamptz("declined_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("nearby_contacts_channel_check", isOneOf(t.channel, NEARBY_CONTACT_CHANNELS)),
    // A number without a standing yes is a third person's data held without their agreement, and a
    // yes without a number would list a contact nobody can call.
    check(
      "nearby_contacts_phone_consented_check",
      sql`(${sql.identifier(t.phone.name)} is not null) = (${sql.identifier(t.consentedAt.name)} is not null and ${sql.identifier(t.declinedAt.name)} is null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

export const media = pgTable(
  "media",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => members.id, { onDelete: "set null" }),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
    /** R2 object key inside the region bucket; NULL until the media queue has copied the file. */
    storageKey: text("storage_key").unique("media_storage_key_key"),
    /** The channel the file arrived on, when it arrived on one. */
    channel: text("channel", { enum: CHANNELS }),
    /** The provider's handle for downloading the file (Telegram file_id). */
    providerFileId: text("provider_file_id"),
    /**
     * The provider's stable id for the same file (Telegram file_unique_id); deduplicates redelivery
     * within a family. It belongs to the file, not the message, so a forwarded file keeps it: the
     * same family reuses its row, and another family records its own.
     */
    providerUniqueId: text("provider_unique_id"),
    /** NULL until known: Telegram photos carry no MIME type, and a file size may only be known after download. */
    mime: text("mime"),
    bytes: integer("bytes"),
    /** Audio only. */
    durationMs: integer("duration_ms"),
    /** Images only. */
    width: integer("width"),
    height: integer("height"),
    /** In the family book: exempt from the 30-day deletion. */
    kept: boolean("kept").notNull().default(false),
    createdAt: createdAt(),
    /** created_at + 30 days unless kept. */
    expiresAt: timestamptz("expires_at"),
  },
  (t) => [
    index("media_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${sql.identifier(t.kept.name)} = false`),
    uniqueIndex("media_family_id_channel_provider_unique_id_idx")
      .on(t.familyId, t.channel, t.providerUniqueId)
      .where(sql`${sql.identifier(t.providerUniqueId.name)} is not null`),
    check("media_kind_check", isOneOf(t.kind, MEDIA_KINDS)),
    check("media_channel_check", isOneOf(t.channel, CHANNELS)),
    // A provider id means nothing without the channel that issued it, and a null channel would
    // escape the unique index above.
    check(
      "media_provider_unique_id_channel_check",
      sql`${sql.identifier(t.providerUniqueId.name)} is null or ${sql.identifier(t.channel.name)} is not null`,
    ),
    // A media row must be reachable: stored in R2, or still fetchable from the provider.
    check(
      "media_storage_key_or_provider_file_id_check",
      sql`${sql.identifier(t.storageKey.name)} is not null or ${sql.identifier(t.providerFileId.name)} is not null`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// The exchange (spec §3): one ask, one answer, its replies
// ---------------------------------------------------------------------------------------------

export const exchanges = pgTable(
  "exchanges",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    /**
     * NULL for Vela's fallback hello, and for an ask whose asker was deleted after leaving. The
     * type tells them apart (only a `hello` comes from Vela); a null asker alone does not.
     */
    askerId: uuid("asker_id").references(() => members.id, { onDelete: "set null" }),
    /** A child's name when a parent sends for them. */
    onBehalfOf: text("on_behalf_of"),
    type: text("type", { enum: EXCHANGE_TYPES }).notNull(),
    state: text("state", { enum: EXCHANGE_STATES }).notNull().default("composed"),
    /** The ask, in the asker's language. */
    text: text("text"),
    textLang: text("text_lang").notNull().default("en"),
    /** Vote options, photo ids for a choice, the word to teach, the story question id. */
    options: jsonb("options"),
    mediaIds: uuid("media_ids").array().notNull().default([]),
    /** The asker's 10-second hello. */
    voiceHelloId: uuid("voice_hello_id").references(() => media.id, { onDelete: "set null" }),
    whenRule: text("when_rule", { enum: WHEN_RULES }).notNull().default("tomorrow"),
    /** Recipient-local date of delivery. */
    scheduledFor: date("scheduled_for"),
    deliveredAt: timestamptz("delivered_at"),
    /** The gateway gave up on the arrival; the quiet ladder is not armed for that day. */
    deliveryFailedAt: timestamptz("delivery_failed_at"),
    deliveryLate: boolean("delivery_late").notNull().default(false),
    repeatedAt: timestamptz("repeated_at"),
    seenAt: timestamptz("seen_at"),
    answeredAt: timestamptz("answered_at"),
    repliedAt: timestamptz("replied_at"),
    readBackAt: timestamptz("read_back_at"),
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // The idempotency backbone (spec §4.1): at most one live exchange per recipient per local
    // date, so two asks cannot claim the same morning even before the composer schedules them.
    uniqueIndex("exchanges_one_per_day")
      .on(t.recipientId, t.scheduledFor)
      .where(
        sql`${sql.identifier(t.scheduledFor.name)} is not null and ${sql.identifier(t.state.name)} <> 'withdrawn'`,
      ),
    index("exchanges_queue_idx")
      .on(t.recipientId, t.whenRule, t.createdAt)
      .where(sql`${sql.identifier(t.state.name)} = 'composed'`),
    index("exchanges_family_recent_idx").on(t.familyId, t.scheduledFor.desc().nullsFirst()),
    check("exchanges_type_check", isOneOf(t.type, EXCHANGE_TYPES)),
    check("exchanges_state_check", isOneOf(t.state, EXCHANGE_STATES)),
    check("exchanges_when_rule_check", isOneOf(t.whenRule, WHEN_RULES)),
  ],
);

/** Every text shown to a reader in their language. */
export const translations = pgTable(
  "translations",
  {
    objectType: text("object_type", { enum: TRANSLATION_OBJECT_TYPES }).notNull(),
    objectId: uuid("object_id").notNull(),
    lang: text("lang").notNull(),
    text: text("text").notNull(),
    /** "claude:v3" etc. */
    provider: text("provider").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "translations_pkey", columns: [t.objectType, t.objectId, t.lang] }),
    check("translations_object_type_check", isOneOf(t.objectType, TRANSLATION_OBJECT_TYPES)),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: uuidv7Id(),
    exchangeId: uuid("exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ANSWER_KINDS }).notNull(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /**
     * The provider's id for the message, unique on its channel; deduplicates redelivered webhooks.
     * Where message ids are unique only within one chat (Telegram), it is
     * "<conversation_id>:<message_id>", so two chats' message 77 stay two answers.
     */
    externalId: text("external_id"),
    /** Chip text, picked option, vote, sticker id. */
    payload: jsonb("payload").$type<JsonObject>().notNull().default({}),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    transcript: text("transcript"),
    transcriptLang: text("transcript_lang"),
    /** One neutral line (AI). */
    summary: text("summary"),
    moodWords: text("mood_words").array().notNull().default([]),
    /** {people[], places[], plans[], health[], dates[]} */
    mentions: jsonb("mentions").$type<JsonObject>().notNull().default({}),
    flag: boolean("flag").notNull().default(false),
    flagReason: text("flag_reason"),
    /** Detected "going to my sister's until Sunday". */
    awayUntil: date("away_until"),
    /** Set only when understand and flag both succeeded; a failed translation does not block it. */
    understoodAt: timestamptz("understood_at"),
    /**
     * Incremented by services when media ingestion or understanding starts for this answer, so
     * reconcile can re-run an answer that was never understood and stop after the third attempt
     * instead of retrying a failing answer forever.
     */
    processingAttempts: smallint("processing_attempts").notNull().default(0),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  (t) => [
    unique("answers_channel_external_id_key").on(t.channel, t.externalId),
    index("answers_exchange_idx").on(t.exchangeId),
    index("answers_member_recent_idx").on(t.memberId, t.receivedAt.desc().nullsFirst()),
    check("answers_kind_check", isOneOf(t.kind, ANSWER_KINDS)),
    check("answers_channel_check", isOneOf(t.channel, CHANNELS)),
  ],
);

export const replies = pgTable(
  "replies",
  {
    id: uuidv7Id(),
    exchangeId: uuid("exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: REPLY_KINDS }).notNull(),
    text: text("text"),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /**
     * The provider's id for the message when the platform gives one (reactions often have none),
     * unique on its channel. Where message ids are unique only within one chat (Telegram), it is
     * "<conversation_id>:<message_id>", as for answers.
     */
    externalId: text("external_id"),
    /** Replies among ordinary members are not read back to her. */
    toRecipient: boolean("to_recipient").notNull().default(true),
    readBackAt: timestamptz("read_back_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("replies_exchange_idx").on(t.exchangeId),
    uniqueIndex("replies_channel_external_id_idx")
      .on(t.channel, t.externalId)
      .where(sql`${sql.identifier(t.externalId.name)} is not null`),
    // A reaction is a state, not a message: re-tapping the same one must not count twice.
    uniqueIndex("replies_one_reaction_idx")
      .on(t.exchangeId, t.memberId, t.kind)
      .where(isOneOf(t.kind, REACTION_KINDS)),
    check("replies_kind_check", isOneOf(t.kind, REPLY_KINDS)),
    check("replies_channel_check", isOneOf(t.channel, CHANNELS)),
  ],
);

/** Chips drafted for a question, only ever shown to her. */
export const chips = pgTable("chips", {
  exchangeId: uuid("exchange_id")
    .primaryKey()
    .references(() => exchanges.id, { onDelete: "cascade" }),
  chips: text("chips").array().notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Turns, suggestions, story day, the family book, memory
// ---------------------------------------------------------------------------------------------

export const turns = pgTable(
  "turns",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** The recipient's local day the ask is for. */
    localDay: date("local_day").notNull(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    /** NULL when nobody holds turns (the prompt is open to anyone) or the holder was deleted. */
    holderId: uuid("holder_id").references(() => members.id, { onDelete: "set null" }),
    promptedAt: timestamptz("prompted_at"),
    /** The group message carrying the prompt; a reply to it is an ask for that day. */
    promptMessageId: text("prompt_message_id"),
    /** An exchange was composed for that day by anyone. */
    actedAt: timestamptz("acted_at"),
  },
  (t) => [primaryKey({ name: "turns_pkey", columns: [t.familyId, t.localDay, t.recipientId] })],
);

/**
 * Tomorrow's suggestion: one ask per kept-light member per local day, written nightly ahead of the
 * day (services `suggestions.ts`). A row holds either a bank item or an AI draft: a bank row keeps
 * no words at all (`text` '' and `lang` NULL; the reader sees the bank item in their own language),
 * and an AI draft keeps its text in the language it was written in until retention clears it.
 */
export const suggestions = pgTable(
  "suggestions",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /**
     * Unused by the writer: a suggestion is her morning's, not one turn holder's, because the
     * holder is chosen only at the evening prompt and anyone may compose.
     */
    forMemberId: uuid("for_member_id").references(() => members.id, { onDelete: "cascade" }),
    /** The kept-light member the suggestion is about. */
    aboutMemberId: uuid("about_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    /** Her local day the ask would arrive. */
    localDay: date("local_day").notNull(),
    /**
     * The question bank item the writer picked (`ASK_BANK` in `@vela/copy`), which an AI draft
     * stands on. It holds no family words, so retention keeps it, and the repeat and used rules key
     * on it.
     */
    bankId: text("bank_id").notNull(),
    type: text("type", { enum: EXCHANGE_TYPES }).notNull(),
    /** An AI draft; '' for a bank row, and once retention has cleared the draft. */
    text: text("text").notNull(),
    /** The language an AI draft is written in; NULL for a bank row. */
    lang: text("lang", { enum: LANGS }),
    /** {ai_source?: "mention" | "date" | "last_ask" | "rotation"}: names, never words. */
    source: jsonb("source").$type<JsonObject>().notNull().default({}),
    promptVersion: text("prompt_version").notNull(),
    createdAt: createdAt(),
    usedAt: timestamptz("used_at"),
  },
  (t) => [
    // The writer runs every night for the next days and inserts with ON CONFLICT DO NOTHING, so a
    // second run, or a second writer, finds the day taken instead of adding another suggestion.
    uniqueIndex("suggestions_one_per_day").on(t.aboutMemberId, t.localDay),
    check("suggestions_type_check", isOneOf(t.type, EXCHANGE_TYPES)),
    check("suggestions_lang_check", isOneOf(t.lang, LANGS)),
  ],
);

/** The curated story bank, per language. */
export const storyQuestions = pgTable("story_questions", {
  id: uuidv7Id(),
  lang: text("lang").notNull(),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  theme: text("theme").notNull(),
});

/** The family book. */
export const stories = pgTable("stories", {
  id: uuidv7Id(),
  familyId: uuid("family_id")
    .notNull()
    .references(() => families.id, { onDelete: "cascade" }),
  /** The storyteller. */
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  exchangeId: uuid("exchange_id").references(() => exchanges.id),
  question: text("question").notNull(),
  askedBy: uuid("asked_by").references(() => members.id, { onDelete: "set null" }),
  transcript: text("transcript"),
  mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
  /** "Don't keep that one" flips it and deletes the media. */
  kept: boolean("kept").notNull().default(true),
  createdAt: createdAt(),
});

export const recipes = pgTable(
  "recipes",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** {ingredients[], steps[], remarks[]} */
    card: jsonb("card").$type<JsonObject>().notNull().default({}),
    status: text("status", { enum: RECIPE_STATUSES }).notNull().default("draft"),
    exchangeIds: uuid("exchange_ids").array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [check("recipes_status_check", isOneOf(t.status, RECIPE_STATUSES))],
);

export const memoryFacts = pgTable(
  "memory_facts",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** Whose fact. */
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MEMORY_FACT_KINDS }).notNull(),
    text: text("text").notNull(),
    onDate: date("on_date"),
    sourceAnswerId: uuid("source_answer_id").references(() => answers.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at"),
  },
  (t) => [check("memory_facts_kind_check", isOneOf(t.kind, MEMORY_FACT_KINDS))],
);

export const reminders = pgTable("reminders", {
  id: uuidv7Id(),
  familyId: uuid("family_id")
    .notNull()
    .references(() => families.id, { onDelete: "cascade" }),
  /** Who is reminded. */
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  aboutMemberId: uuid("about_member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  dueDate: date("due_date").notNull(),
  factId: uuid("fact_id").references(() => memoryFacts.id, { onDelete: "set null" }),
  /** Only created after a person's tap (spec §12). */
  createdAt: createdAt(),
  doneAt: timestamptz("done_at"),
});

// ---------------------------------------------------------------------------------------------
// The light: quiet events, away, weekly reads
// ---------------------------------------------------------------------------------------------

export const quietEvents = pgTable(
  "quiet_events",
  {
    id: uuidv7Id(),
    exchangeId: uuid("exchange_id")
      .notNull()
      .unique("quiet_events_exchange_id_key")
      .references(() => exchanges.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    openedAt: timestamptz("opened_at").notNull().defaultNow(),
    noticeInAppAt: timestamptz("notice_in_app_at"),
    noticePushAt: timestamptz("notice_push_at"),
    /** The last time organisers were told; a "wait 2 hours" re-notifies only after this. */
    lastNotifiedAt: timestamptz("last_notified_at"),
    notifyCount: integer("notify_count").notNull().default(0),
    /** Everyone who was told, so everyone who was told hears the resolution. */
    notifiedMemberIds: uuid("notified_member_ids").array().notNull().default([]),
    waitUntil: timestamptz("wait_until"),
    /** [{contact_id, sent_by, sent_at, reply}] */
    askToCheck: jsonb("ask_to_check").$type<unknown[]>().notNull().default([]),
    resolvedAt: timestamptz("resolved_at"),
    outcome: text("outcome", { enum: QUIET_OUTCOMES }),
    resolvedBy: uuid("resolved_by").references(() => members.id, { onDelete: "set null" }),
    /** The organiser's one-tap verdict; feeds the precision page. */
    useful: boolean("useful"),
  },
  (t) => [
    index("quiet_open_idx")
      .on(t.memberId)
      .where(sql`${sql.identifier(t.resolvedAt.name)} is null`),
    check("quiet_events_outcome_check", isOneOf(t.outcome, QUIET_OUTCOMES)),
  ],
);

export const awayPeriods = pgTable(
  "away_periods",
  {
    id: uuidv7Id(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    fromDate: date("from_date").notNull(),
    /** NULL = until she answers ("until I'm back"). */
    toDate: date("to_date"),
    source: text("source", { enum: AWAY_SOURCES }).notNull(),
    setBy: uuid("set_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    endedAt: timestamptz("ended_at"),
  },
  (t) => [
    index("away_active_idx")
      .on(t.memberId)
      .where(sql`${sql.identifier(t.endedAt.name)} is null`),
    check("away_periods_source_check", isOneOf(t.source, AWAY_SOURCES)),
  ],
);

export const weeklyReads = pgTable(
  "weekly_reads",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** The kept-light member. */
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    /**
     * The draft lines about her week, zero to four, one string per line, as `ai.weeklyRead` returned
     * them and never edited, so prompt versions can be compared; other languages via translations.
     */
    lines: jsonb("lines").$type<string[]>().notNull(),
    /** The draft suggestion as the model wrote it, kept unedited like `lines`. */
    suggestion: text("suggestion"),
    /**
     * {answered_days, counted_days, hello_mornings, family_asks, usual_time, drift_min, topics[],
     * voice_len_drift}. The first four are the counts `renderWeeklyRead` in @vela/core writes for
     * organisers; the model never writes a count, and she never sees one (spec §8, §13).
     */
    stats: jsonb("stats").$type<JsonObject>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: createdAt(),
    /**
     * The lines as the founder sent them from the admin page, after editing the draft, in the same
     * one-string-per-line shape as `lines`. NULL until sent; "what does the family see" shows her
     * the lines of the most recent sent read, without its counts or suggestion.
     */
    sentLines: jsonb("sent_lines").$type<string[]>(),
    /**
     * The suggestion as the founder sent it to organisers; '' when the founder removed it. NULL
     * until sent.
     */
    sentSuggestion: text("sent_suggestion"),
    sentAt: timestamptz("sent_at"),
  },
  (t) => [
    unique("weekly_reads_member_id_week_start_key").on(t.memberId, t.weekStart),
    // The lines, the suggestion, and the time are written together when the founder taps Send, so
    // any of them without the others is a half-recorded send that "what does the family see" or a
    // comparison of drafts with what was sent could misread.
    check(
      "weekly_reads_sent_lines_sent_suggestion_sent_at_check",
      sql`(${sql.identifier(t.sentLines.name)} is null) = (${sql.identifier(t.sentAt.name)} is null) and (${sql.identifier(t.sentSuggestion.name)} is null) = (${sql.identifier(t.sentAt.name)} is null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Outbound (the gateway) and the notification budget
// ---------------------------------------------------------------------------------------------

export const outbound = pgTable(
  "outbound",
  {
    id: uuidv7Id(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    exchangeId: uuid("exchange_id").references(() => exchanges.id, { onDelete: "set null" }),
    kind: text("kind", { enum: OUTBOUND_KINDS }).notNull(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /** The platform conversation the message goes to: her private chat or the family group. */
    conversationId: text("conversation_id").notNull(),
    /** The member's local day; the budget key. */
    localDay: date("local_day").notNull(),
    /** For example arrival:<member>:<day>. */
    idempotencyKey: text("idempotency_key").notNull().unique("outbound_idempotency_key_key"),
    /**
     * Required for nearby_ask: a message to a third person is always a person's tap (spec §8).
     * Deleting the actor deletes the row, since setting it null would break that rule.
     */
    actorId: uuid("actor_id").references(() => members.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    status: text("status", { enum: OUTBOUND_STATUSES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    externalId: text("external_id"),
    error: text("error"),
    queuedAt: timestamptz("queued_at").notNull().defaultNow(),
    sentAt: timestamptz("sent_at"),
    /**
     * When the kind's effects were applied (D-B1, 2026-09-15). The gateway commits the send in its
     * own transaction and applies the effects in a second one, so a failed effect can never make a
     * message go out twice: a row already `sent` with this null gets its effects and is never sent
     * again, and `reconcile` sweeps rows left that way.
     */
    effectsAt: timestamptz("effects_at"),
  },
  (t) => [
    // The notification budget (spec §15) is a database constraint, not application discipline.
    uniqueIndex("outbound_budget_idx")
      .on(t.memberId, t.localDay, t.kind)
      .where(
        sql`${isOneOf(t.kind, BUDGETED_OUTBOUND_KINDS)} and ${sql.identifier(t.status.name)} <> 'dropped'`,
      ),
    index("outbound_pending_idx")
      .on(t.queuedAt)
      .where(sql`${sql.identifier(t.status.name)} = 'queued'`),
    check("outbound_kind_check", isOneOf(t.kind, OUTBOUND_KINDS)),
    check("outbound_channel_check", isOneOf(t.channel, CHANNELS)),
    check("outbound_status_check", isOneOf(t.status, OUTBOUND_STATUSES)),
    check(
      "outbound_nearby_ask_actor_check",
      sql`${sql.identifier(t.kind.name)} <> ${sql.raw(quoteLiteral("nearby_ask" satisfies OutboundKind))} or ${sql.identifier(t.actorId.name)} is not null`,
    ),
  ],
);

/**
 * Maps a platform message to what it was about, so a reply or a button tap on it resolves to the
 * exchange or quiet event without trusting anything in the payload beyond the message id.
 */
export const messageRefs = pgTable(
  "message_refs",
  {
    channel: text("channel", { enum: CHANNELS }).notNull(),
    conversationId: text("conversation_id").notNull(),
    messageId: text("message_id").notNull(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    exchangeId: uuid("exchange_id").references(() => exchanges.id, { onDelete: "cascade" }),
    quietEventId: uuid("quiet_event_id").references(() => quietEvents.id, { onDelete: "cascade" }),
    /** The member the message is about when no exchange exists yet (a turn prompt's recipient). */
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
    /** That member's local date the message is about (a turn prompt's day). */
    localDate: date("local_date"),
    purpose: text("purpose", { enum: MESSAGE_REF_PURPOSES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "message_refs_pkey", columns: [t.channel, t.conversationId, t.messageId] }),
    check("message_refs_channel_check", isOneOf(t.channel, CHANNELS)),
    check("message_refs_purpose_check", isOneOf(t.purpose, MESSAGE_REF_PURPOSES)),
  ],
);

// ---------------------------------------------------------------------------------------------
// AI, events, consent, deletion, flags, billing
// ---------------------------------------------------------------------------------------------

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id").references(() => families.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    /** understand | flag | chips | translate | suggest | readback | hello | weekly_read | transcribe */
    call: text("call").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    /** {answer_id | exchange_id | ...}; inputs are referenced, never copied. */
    inputRef: jsonb("input_ref").$type<JsonObject>().notNull(),
    output: jsonb("output"),
    ok: boolean("ok").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    tokensCached: integer("tokens_cached"),
    latencyMs: integer("latency_ms"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" }),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [index("ai_calls_at_idx").on(t.at)],
);

/**
 * Append-only: the KPI job and the admin view read it, nothing updates it. A plain table until
 * volume justifies partitioning. Events carry kinds, types, durations, and outcomes, never content.
 */
export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamptz("at").notNull().defaultNow(),
    name: text("name", { enum: EVENT_NAMES }).notNull(),
    familyId: uuid("family_id"),
    memberId: uuid("member_id"),
    exchangeId: uuid("exchange_id"),
    surface: text("surface"),
    localTime: localTime("local_time"),
    props: jsonb("props").$type<JsonObject>().notNull().default({}),
  },
  (t) => [
    index("events_family_at_idx").on(t.familyId, t.at),
    index("events_name_at_idx").on(t.name, t.at),
    check("events_name_check", isOneOf(t.name, EVENT_NAMES)),
  ],
);

/**
 * A proof of consent or decline (ADR-28). It outlives the member or contact it is about without
 * holding their data: the references are set null when the subject is deleted, `subject_ref` still
 * names the subject by id, and `evidence` has been cut to `CONSENT_PROOF_KEYS` beforehand.
 */
export const consents = pgTable(
  "consents",
  {
    id: uuidv7Id(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => nearbyContacts.id, { onDelete: "set null" }),
    /**
     * `member:<member id>` or `contact:<contact id>`, written at insert and never changed, so the
     * proof still names its subject once `member_id` or `contact_id` is null.
     */
    subjectRef: text("subject_ref").notNull(),
    kind: text("kind", { enum: CONSENT_KINDS }).notNull(),
    /** No default: every row states whether it records a yes or a no. */
    answer: text("answer", { enum: CONSENT_ANSWERS }).notNull(),
    textVersion: text("text_version").notNull(),
    lang: text("lang").notNull(),
    channel: text("channel").notNull(),
    givenAt: timestamptz("given_at").notNull().defaultNow(),
    withdrawnAt: timestamptz("withdrawn_at"),
    /**
     * For a tap on her consent messages: {chat_id, message_id, params, text_sha256}, so the text
     * version and the parameters rebuild the message and the hash shows it is the one she saw. For
     * an adult's tap on "I've read it": {chat_id, message_id, text_sha256}, the hash copied from the
     * group's `family_channels` row and no parameters, which would name her. For a row the founder
     * records: the founder's fields and recorded_by "founder". Once the subject is deleted: only the
     * keys in `CONSENT_PROOF_KEYS` that were present.
     */
    evidence: jsonb("evidence").$type<JsonObject>().notNull().default({}),
    /** When the member or contact was deleted and `evidence` was cut to the proof keys. */
    subjectDeletedAt: timestamptz("subject_deleted_at"),
  },
  (t) => [
    index("consents_subject_ref_idx").on(t.subjectRef),
    check("consents_kind_check", isOneOf(t.kind, CONSENT_KINDS)),
    check("consents_answer_check", isOneOf(t.answer, CONSENT_ANSWERS)),
    // A reference that names another subject than the row's own member or contact would make the
    // proof point at the wrong person once the reference is set null.
    check(
      "consents_subject_ref_check",
      sql`${sql.identifier(t.subjectRef.name)} ~ '^(member|contact):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (${sql.identifier(t.memberId.name)} is null or ${sql.identifier(t.subjectRef.name)} = ('member:' || ${sql.identifier(t.memberId.name)}::text)) and (${sql.identifier(t.contactId.name)} is null or ${sql.identifier(t.subjectRef.name)} = ('contact:' || ${sql.identifier(t.contactId.name)}::text))`,
    ),
    // Only a yes permits anything, so only a yes can be withdrawn.
    check(
      "consents_withdrawn_at_check",
      sql`${sql.identifier(t.withdrawnAt.name)} is null or ${sql.identifier(t.answer.name)} = ${sql.raw(quoteLiteral("yes" satisfies ConsentAnswer))}`,
    ),
    // Postgres checks this on the update a foreign key's SET NULL makes, so deleting a member or
    // contact whose consent rows were not forgotten first fails, a deletion by hand included, instead
    // of keeping their words in a proof.
    check(
      "consents_subject_deleted_check",
      sql`${sql.identifier(t.memberId.name)} is not null or ${sql.identifier(t.contactId.name)} is not null or (${sql.identifier(t.subjectDeletedAt.name)} is not null and ${sql.identifier(t.evidence.name)}${sql.raw(CONSENT_PROOF_KEYS.map((key) => ` - ${quoteLiteral(key)}`).join(""))} = '{}'::jsonb)`,
    ),
  ],
);

/**
 * Proof of deletion without keeping what was deleted. `content_hash` is the SHA-256, lowercase hex,
 * of `<object_type>:<object_id>` and nothing else (ADR-28): a hash of a phone number or a storage key
 * would give the value back to anyone who tries the few values it can have.
 */
export const deletions = pgTable(
  "deletions",
  {
    id: uuidv7Id(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    contentHash: text("content_hash").notNull(),
    reason: text("reason").notNull(),
    deletedAt: timestamptz("deleted_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "deletions_content_hash_check",
      sql`${sql.identifier(t.contentHash.name)} = encode(sha256(convert_to(${sql.identifier(t.objectType.name)} || ':' || ${sql.identifier(t.objectId.name)}::text, 'UTF8')), 'hex')`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuidv7Id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** The kept-light member covered. */
    memberId: uuid("member_id")
      .notNull()
      .unique("subscriptions_member_id_key")
      .references(() => members.id, { onDelete: "cascade" }),
    payerUserId: uuid("payer_user_id").references(() => users.id),
    provider: text("provider", { enum: SUBSCRIPTION_PROVIDERS }).notNull(),
    externalId: text("external_id"),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
    planInterval: text("plan_interval", { enum: PLAN_INTERVALS }),
    currency: text("currency"),
    priceCents: integer("price_cents"),
    trialEndsAt: timestamptz("trial_ends_at"),
    currentPeriodEnd: timestamptz("current_period_end"),
    graceUntil: timestamptz("grace_until"),
    createdAt: createdAt(),
  },
  (t) => [
    check("subscriptions_provider_check", isOneOf(t.provider, SUBSCRIPTION_PROVIDERS)),
    check("subscriptions_status_check", isOneOf(t.status, SUBSCRIPTION_STATUSES)),
    check("subscriptions_plan_interval_check", isOneOf(t.planInterval, PLAN_INTERVALS)),
  ],
);

export const accountLinkChallenges = pgTable(
  "account_link_challenges",
  {
    id: uuidv7Id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionHash: text("session_hash").notNull(),
    familyId: uuid("family_id").references(() => families.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
    channelLinkId: uuid("channel_link_id").references(() => channelLinks.id, {
      onDelete: "cascade",
    }),
    channelIdentityHash: text("channel_identity_hash"),
    codeHash: text("code_hash"),
    attempts: smallint("attempts").notNull().default(0),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    completedAt: timestamptz("completed_at"),
    invalidatedAt: timestamptz("invalidated_at"),
  },
  (t) => [
    index("account_link_challenges_user_idx").on(t.userId),
    index("account_link_challenges_expiry_idx").on(t.expiresAt),
    index("account_link_challenges_completed_idx").on(t.completedAt),
    check(
      "account_link_challenges_hashes_check",
      sql`${sql.identifier(t.sessionHash.name)} ~ '^[0-9a-f]{64}$' and (${sql.identifier(t.channelIdentityHash.name)} is null or ${sql.identifier(t.channelIdentityHash.name)} ~ '^[0-9a-f]{64}$') and (${sql.identifier(t.codeHash.name)} is null or ${sql.identifier(t.codeHash.name)} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "account_link_challenges_attempts_check",
      sql`${sql.identifier(t.attempts.name)} between 0 and 5`,
    ),
    check(
      "account_link_challenges_binding_check",
      sql`(${sql.identifier(t.familyId.name)} is null and ${sql.identifier(t.memberId.name)} is null and ${sql.identifier(t.channelLinkId.name)} is null and ${sql.identifier(t.channelIdentityHash.name)} is null) or (${sql.identifier(t.familyId.name)} is not null and ${sql.identifier(t.memberId.name)} is not null and ${sql.identifier(t.channelLinkId.name)} is not null and ${sql.identifier(t.channelIdentityHash.name)} is not null)`,
    ),
    check(
      "account_link_challenges_state_check",
      sql`(${sql.identifier(t.completedAt.name)} is null or (${sql.identifier(t.familyId.name)} is not null and ${sql.identifier(t.codeHash.name)} is null and ${sql.identifier(t.invalidatedAt.name)} is null)) and (${sql.identifier(t.invalidatedAt.name)} is null or (${sql.identifier(t.codeHash.name)} is null and ${sql.identifier(t.completedAt.name)} is null)) and (${sql.identifier(t.codeHash.name)} is null or (${sql.identifier(t.familyId.name)} is not null and ${sql.identifier(t.completedAt.name)} is null and ${sql.identifier(t.invalidatedAt.name)} is null))`,
    ),
    check(
      "account_link_challenges_timing_check",
      sql`${sql.identifier(t.expiresAt.name)} > ${sql.identifier(t.createdAt.name)} and ${sql.identifier(t.expiresAt.name)} <= ${sql.identifier(t.createdAt.name)} + interval '15 minutes' and (${sql.identifier(t.completedAt.name)} is null or (${sql.identifier(t.completedAt.name)} >= ${sql.identifier(t.createdAt.name)} and ${sql.identifier(t.completedAt.name)} < ${sql.identifier(t.expiresAt.name)})) and (${sql.identifier(t.invalidatedAt.name)} is null or ${sql.identifier(t.invalidatedAt.name)} >= ${sql.identifier(t.createdAt.name)})`,
    ),
  ],
);

export const apiRequestReceipts = pgTable(
  "api_request_receipts",
  {
    id: uuidv7Id(),
    actorHash: text("actor_hash").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").$type<JsonObject>(),
    familyId: uuid("family_id").references(() => families.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    unique("api_request_receipts_actor_key_key").on(t.actorHash, t.keyHash),
    index("api_request_receipts_expiry_idx").on(t.expiresAt),
    check(
      "api_request_receipts_hashes_check",
      sql`${sql.identifier(t.actorHash.name)} ~ '^[0-9a-f]{64}$' and ${sql.identifier(t.keyHash.name)} ~ '^[0-9a-f]{64}$' and ${sql.identifier(t.requestHash.name)} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "api_request_receipts_expiry_check",
      sql`${sql.identifier(t.expiresAt.name)} > ${sql.identifier(t.createdAt.name)} and ${sql.identifier(t.expiresAt.name)} <= ${sql.identifier(t.createdAt.name)} + interval '24 hours'`,
    ),
    check(
      "api_request_receipts_result_check",
      sql`${sql.identifier(t.result.name)} is null or jsonb_typeof(${sql.identifier(t.result.name)}) = 'object'`,
    ),
    check(
      "api_request_receipts_member_scope_check",
      sql`${sql.identifier(t.memberId.name)} is null or ${sql.identifier(t.familyId.name)} is not null`,
    ),
  ],
);

export const flags = pgTable("flags", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/**
 * One row per admin page view and per admin write action; organisers may see their family's rows on
 * request. family_id and member_id have no foreign key: the log is kept 24 months, while members
 * are deleted 30 days after they leave and families within 24 h of deletion.
 */
export const adminAccessLog = pgTable(
  "admin_access_log",
  {
    id: uuidv7Id(),
    admin: text("admin").notNull(),
    familyId: uuid("family_id"),
    /** The member the action was about, when it was about one. */
    memberId: uuid("member_id"),
    action: text("action", { enum: ADMIN_ACTIONS }).notNull(),
    /** The page or a detail of the action; never message content. */
    what: text("what").notNull(),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [check("admin_access_log_action_check", isOneOf(t.action, ADMIN_ACTIONS))],
);

/**
 * Daily rollups written by the KPI job; the founder's dashboard reads only this and events. No
 * foreign keys, so the numbers outlive the families they describe.
 */
export const metricsDaily = pgTable(
  "metrics_daily",
  {
    day: date("day").notNull(),
    familyId: uuid("family_id").notNull(),
    memberId: uuid("member_id").notNull(),
    delivered: integer("delivered").notNull().default(0),
    answered: integer("answered").notNull().default(0),
    answerKind: jsonb("answer_kind").$type<JsonObject>().notNull().default({}),
    latencyMin: integer("latency_min"),
    replies: integer("replies").notNull().default(0),
    readBack: boolean("read_back"),
    quietNotice: boolean("quiet_notice").notNull().default(false),
    quietOutcome: text("quiet_outcome"),
    away: boolean("away").notNull().default(false),
    /** The fallback hello was used. */
    quietDay: boolean("quiet_day").notNull().default(false),
  },
  (t) => [primaryKey({ name: "metrics_daily_pkey", columns: [t.day, t.memberId] })],
);

// ---------------------------------------------------------------------------------------------
// Relations (for db.query; they add no constraints)
// ---------------------------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  members: many(members),
}));

export const familiesRelations = relations(families, ({ many }) => ({
  members: many(members),
  familyChannels: many(familyChannels),
  exchanges: many(exchanges),
  nearbyContacts: many(nearbyContacts),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  family: one(families, { fields: [members.familyId], references: [families.id] }),
  user: one(users, { fields: [members.userId], references: [users.id] }),
  channelLinks: many(channelLinks),
  nearbyContacts: many(nearbyContacts),
  receivedExchanges: many(exchanges, { relationName: "exchange_recipient" }),
  awayPeriods: many(awayPeriods, { relationName: "away_member" }),
  quietEvents: many(quietEvents, { relationName: "quiet_member" }),
}));

export const channelLinksRelations = relations(channelLinks, ({ one }) => ({
  member: one(members, { fields: [channelLinks.memberId], references: [members.id] }),
}));

export const familyChannelsRelations = relations(familyChannels, ({ one }) => ({
  family: one(families, { fields: [familyChannels.familyId], references: [families.id] }),
  linkedBy: one(members, {
    fields: [familyChannels.linkedByMemberId],
    references: [members.id],
  }),
}));

export const nearbyContactsRelations = relations(nearbyContacts, ({ one }) => ({
  family: one(families, { fields: [nearbyContacts.familyId], references: [families.id] }),
  member: one(members, { fields: [nearbyContacts.memberId], references: [members.id] }),
}));

export const exchangesRelations = relations(exchanges, ({ one, many }) => ({
  family: one(families, { fields: [exchanges.familyId], references: [families.id] }),
  recipient: one(members, {
    fields: [exchanges.recipientId],
    references: [members.id],
    relationName: "exchange_recipient",
  }),
  asker: one(members, {
    fields: [exchanges.askerId],
    references: [members.id],
    relationName: "exchange_asker",
  }),
  voiceHello: one(media, { fields: [exchanges.voiceHelloId], references: [media.id] }),
  chips: one(chips),
  quietEvent: one(quietEvents),
  answers: many(answers),
  replies: many(replies),
}));

export const answersRelations = relations(answers, ({ one }) => ({
  exchange: one(exchanges, { fields: [answers.exchangeId], references: [exchanges.id] }),
  member: one(members, { fields: [answers.memberId], references: [members.id] }),
  media: one(media, { fields: [answers.mediaId], references: [media.id] }),
}));

export const repliesRelations = relations(replies, ({ one }) => ({
  exchange: one(exchanges, { fields: [replies.exchangeId], references: [exchanges.id] }),
  member: one(members, { fields: [replies.memberId], references: [members.id] }),
  media: one(media, { fields: [replies.mediaId], references: [media.id] }),
}));

export const chipsRelations = relations(chips, ({ one }) => ({
  exchange: one(exchanges, { fields: [chips.exchangeId], references: [exchanges.id] }),
}));

export const turnsRelations = relations(turns, ({ one }) => ({
  family: one(families, { fields: [turns.familyId], references: [families.id] }),
  recipient: one(members, { fields: [turns.recipientId], references: [members.id] }),
  holder: one(members, { fields: [turns.holderId], references: [members.id] }),
}));

export const quietEventsRelations = relations(quietEvents, ({ one }) => ({
  exchange: one(exchanges, { fields: [quietEvents.exchangeId], references: [exchanges.id] }),
  member: one(members, {
    fields: [quietEvents.memberId],
    references: [members.id],
    relationName: "quiet_member",
  }),
  resolvedByMember: one(members, {
    fields: [quietEvents.resolvedBy],
    references: [members.id],
    relationName: "quiet_resolved_by",
  }),
}));

export const awayPeriodsRelations = relations(awayPeriods, ({ one }) => ({
  member: one(members, {
    fields: [awayPeriods.memberId],
    references: [members.id],
    relationName: "away_member",
  }),
  setByMember: one(members, {
    fields: [awayPeriods.setBy],
    references: [members.id],
    relationName: "away_set_by",
  }),
}));

export const outboundRelations = relations(outbound, ({ one }) => ({
  member: one(members, { fields: [outbound.memberId], references: [members.id] }),
  actor: one(members, { fields: [outbound.actorId], references: [members.id] }),
  exchange: one(exchanges, { fields: [outbound.exchangeId], references: [exchanges.id] }),
}));

export const messageRefsRelations = relations(messageRefs, ({ one }) => ({
  family: one(families, { fields: [messageRefs.familyId], references: [families.id] }),
  member: one(members, { fields: [messageRefs.memberId], references: [members.id] }),
  exchange: one(exchanges, { fields: [messageRefs.exchangeId], references: [exchanges.id] }),
  quietEvent: one(quietEvents, {
    fields: [messageRefs.quietEventId],
    references: [quietEvents.id],
  }),
}));

// ---------------------------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Family = typeof families.$inferSelect;
export type NewFamily = typeof families.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type ChannelLink = typeof channelLinks.$inferSelect;
export type NewChannelLink = typeof channelLinks.$inferInsert;
export type FamilyChannel = typeof familyChannels.$inferSelect;
export type NewFamilyChannel = typeof familyChannels.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type OnboardingSession = typeof onboardingSessions.$inferSelect;
export type NewOnboardingSession = typeof onboardingSessions.$inferInsert;
export type NearbyContact = typeof nearbyContacts.$inferSelect;
export type NewNearbyContact = typeof nearbyContacts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Exchange = typeof exchanges.$inferSelect;
export type NewExchange = typeof exchanges.$inferInsert;
export type Translation = typeof translations.$inferSelect;
export type NewTranslation = typeof translations.$inferInsert;
export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
export type Reply = typeof replies.$inferSelect;
export type NewReply = typeof replies.$inferInsert;
export type Chips = typeof chips.$inferSelect;
export type NewChips = typeof chips.$inferInsert;
export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;
export type Suggestion = typeof suggestions.$inferSelect;
export type NewSuggestion = typeof suggestions.$inferInsert;
export type StoryQuestion = typeof storyQuestions.$inferSelect;
export type NewStoryQuestion = typeof storyQuestions.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type MemoryFact = typeof memoryFacts.$inferSelect;
export type NewMemoryFact = typeof memoryFacts.$inferInsert;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
export type QuietEvent = typeof quietEvents.$inferSelect;
export type NewQuietEvent = typeof quietEvents.$inferInsert;
export type AwayPeriod = typeof awayPeriods.$inferSelect;
export type NewAwayPeriod = typeof awayPeriods.$inferInsert;
export type WeeklyRead = typeof weeklyReads.$inferSelect;
export type NewWeeklyRead = typeof weeklyReads.$inferInsert;
export type Outbound = typeof outbound.$inferSelect;
export type NewOutbound = typeof outbound.$inferInsert;
export type MessageRef = typeof messageRefs.$inferSelect;
export type NewMessageRef = typeof messageRefs.$inferInsert;
export type AiCall = typeof aiCalls.$inferSelect;
export type NewAiCall = typeof aiCalls.$inferInsert;
/** Named EventRecord so it never shadows the DOM `Event` type where it is imported. */
export type EventRecord = typeof events.$inferSelect;
export type NewEventRecord = typeof events.$inferInsert;
export type Consent = typeof consents.$inferSelect;
export type NewConsent = typeof consents.$inferInsert;
export type Deletion = typeof deletions.$inferSelect;
export type NewDeletion = typeof deletions.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type AccountLinkChallenge = typeof accountLinkChallenges.$inferSelect;
export type NewAccountLinkChallenge = typeof accountLinkChallenges.$inferInsert;
export type ApiRequestReceipt = typeof apiRequestReceipts.$inferSelect;
export type NewApiRequestReceipt = typeof apiRequestReceipts.$inferInsert;
export type Flag = typeof flags.$inferSelect;
export type NewFlag = typeof flags.$inferInsert;
export type AdminAccessLogEntry = typeof adminAccessLog.$inferSelect;
export type NewAdminAccessLogEntry = typeof adminAccessLog.$inferInsert;
export type MetricsDaily = typeof metricsDaily.$inferSelect;
export type NewMetricsDaily = typeof metricsDaily.$inferInsert;
