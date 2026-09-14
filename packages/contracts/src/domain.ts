/**
 * The domain vocabulary shared by every package. Each concept is a const tuple (the single source
 * of the allowed values), a Zod schema built from it, and a TypeScript type inferred from the
 * schema. Database CHECK constraints in @vela/db are generated from the same tuples.
 *
 * Spec: product/05-product-spec-v2.md. Architecture: architecture/02-technical-architecture-v2.md.
 */
import { z } from "zod";

export const LANGS = ["en", "zh-TW", "ja", "de", "hi", "ru"] as const;
export const Lang = z.enum(LANGS);
export type Lang = z.infer<typeof Lang>;

/** Languages with complete copy at MVP. Other languages fall back to English copy. */
export const MVP_LANGS = ["en", "zh-TW"] as const satisfies readonly Lang[];

export const REGIONS = ["apac", "eu", "us"] as const;
export const Region = z.enum(REGIONS);
export type Region = z.infer<typeof Region>;

export const PLANS = ["free", "light"] as const;
export const Plan = z.enum(PLANS);
export type Plan = z.infer<typeof Plan>;

export const ROLES = ["organiser", "member"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const MEMBER_STATUSES = ["invited", "active", "paused", "left", "deceased"] as const;
export const MemberStatus = z.enum(MEMBER_STATUSES);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const AGE_BANDS = ["child", "teen", "adult", "elder"] as const;
export const AgeBand = z.enum(AGE_BANDS);
export type AgeBand = z.infer<typeof AgeBand>;

/** Where a member receives their daily arrival. */
export const SURFACES = ["app", "parent-surface", "line", "whatsapp", "telegram", "voice"] as const;
export const Surface = z.enum(SURFACES);
export type Surface = z.infer<typeof Surface>;

/** Transport a channel adapter implements. */
export const CHANNELS = ["line", "whatsapp", "telegram", "voice", "app"] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

export const EXCHANGE_TYPES = [
  "question",
  "photo_choice",
  "voice_note",
  "word",
  "story",
  "recipe",
  "memory_photo",
  "vote",
  "hello",
] as const;
export const ExchangeType = z.enum(EXCHANGE_TYPES);
export type ExchangeType = z.infer<typeof ExchangeType>;

/** Spec §3. `withdrawn` is terminal and only reachable before delivery. */
export const EXCHANGE_STATES = [
  "composed",
  "scheduled",
  "delivered",
  "seen",
  "answered",
  "replied",
  "read_back",
  "archived",
  "withdrawn",
] as const;
export const ExchangeState = z.enum(EXCHANGE_STATES);
export type ExchangeState = z.infer<typeof ExchangeState>;

export const WHEN_RULES = ["tomorrow", "date", "whenever"] as const;
export const WhenRule = z.enum(WHEN_RULES);
export type WhenRule = z.infer<typeof WhenRule>;

export const ANSWER_KINDS = [
  "voice",
  "chip",
  "photo_pick",
  "vote",
  "heart",
  "text",
  "photo",
  "fine",
  "sticker",
  /** Any other content (video, document, location, contact): still a sign of life. */
  "other",
] as const;
export const AnswerKind = z.enum(ANSWER_KINDS);
export type AnswerKind = z.infer<typeof AnswerKind>;

export const REPLY_KINDS = ["heart", "laugh", "hug", "text", "voice", "photo"] as const;
export const ReplyKind = z.enum(REPLY_KINDS);
export type ReplyKind = z.infer<typeof ReplyKind>;

/** Reaction kinds are the subset of reply kinds that carry no content. */
export const REACTION_KINDS = ["heart", "laugh", "hug"] as const satisfies readonly ReplyKind[];
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** Spec §2.2: what a member's light shows. */
export const LIGHT_STATES = ["resting", "lit", "quiet", "away", "paused", "none"] as const;
export const LightState = z.enum(LIGHT_STATES);
export type LightState = z.infer<typeof LightState>;

export const OUTBOUND_KINDS = [
  "arrival",
  "repeat",
  "turn_prompt",
  "answer_receipt",
  "answer_post",
  "quiet_notice",
  "quiet_resolved",
  "weekly_read",
  "ack",
  "nearby_ask",
  "flag",
  "consent",
  "onboarding",
  "system",
] as const;
export const OutboundKind = z.enum(OUTBOUND_KINDS);
export type OutboundKind = z.infer<typeof OutboundKind>;

/**
 * Spec §15: at most one message of each of these kinds per member per local day. Enforced by a
 * partial unique index on outbound (member_id, local_day, kind), not by application discipline.
 */
export const BUDGETED_OUTBOUND_KINDS = [
  "arrival",
  "repeat",
  "turn_prompt",
  "weekly_read",
  "ack",
  "answer_receipt",
] as const satisfies readonly OutboundKind[];
export type BudgetedOutboundKind = (typeof BUDGETED_OUTBOUND_KINDS)[number];

export const OUTBOUND_STATUSES = ["queued", "sent", "failed", "dropped"] as const;
export const OutboundStatus = z.enum(OUTBOUND_STATUSES);
export type OutboundStatus = z.infer<typeof OutboundStatus>;

export const QUIET_OUTCOMES = [
  "answered_late",
  "away",
  "fine_known",
  "true_concern",
  "unknown",
] as const;
export const QuietOutcome = z.enum(QUIET_OUTCOMES);
export type QuietOutcome = z.infer<typeof QuietOutcome>;

export const AWAY_SOURCES = ["organiser", "member", "answer", "pattern"] as const;
export const AwaySource = z.enum(AWAY_SOURCES);
export type AwaySource = z.infer<typeof AwaySource>;

/** What a member's scheduler can wake up for (architecture §6). */
export const WAKE_KINDS = [
  "arrival",
  "repeat",
  "quiet",
  "turn_prompt",
  "prepare",
  "weekly_read",
] as const;
export const WakeKind = z.enum(WAKE_KINDS);
export type WakeKind = z.infer<typeof WakeKind>;

export const MEDIA_KINDS = ["audio", "image"] as const;
export const MediaKind = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKind>;

export const CONSENT_KINDS = ["light", "nearby", "privacy_notice", "pilot"] as const;
export const ConsentKind = z.enum(CONSENT_KINDS);
export type ConsentKind = z.infer<typeof ConsentKind>;

/**
 * What the founder does on the Access-protected admin page. Every use writes an `admin_access_log`
 * row (its `action` CHECK comes from this tuple) and records the domain event for what it changed:
 * `view` → `admin_page_opened`; `record_consent` → `consent_given`; `record_contact_consent` →
 * `consent_given` or `consent_declined` (kind `nearby`); `add_contact` and `remove_contact` →
 * `nearby_contact_added` and `nearby_contact_removed`; `set_away` and `end_away` → `away_set`
 * (source `organiser`) and `away_ended`; `mark_left` → `member_left`; `mark_deceased` →
 * `member_marked_deceased`; `delete_family` → `family_deletion_requested`; `send_weekly_read` →
 * `weekly_read_sent`.
 */
export const ADMIN_ACTIONS = [
  "view",
  "record_consent",
  "record_contact_consent",
  "add_contact",
  "remove_contact",
  "set_away",
  "end_away",
  "mark_left",
  "mark_deceased",
  "delete_family",
  "send_weekly_read",
] as const;
export const AdminAction = z.enum(ADMIN_ACTIONS);
export type AdminAction = z.infer<typeof AdminAction>;

/** A calendar date in a member's own time zone, `YYYY-MM-DD`. */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "expected YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    const probe = new Date(Date.UTC(year, month - 1, day));
    return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  }, "not a real calendar date");
export type LocalDate = z.infer<typeof LocalDate>;

/** A wall-clock time in a member's own time zone, `HH:MM` (24-hour). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
export type LocalTime = z.infer<typeof LocalTime>;

/**
 * A zone that is only a fixed offset: `+08:00`, or the tz database's `Etc/GMT-8` (its sign is
 * inverted: it means UTC+8). Signed names that mean UTC (`Etc/GMT+0`, `GMT-0`) match too, so the
 * rule reads the same for every N. Any letter case matches, as it does in `Intl`.
 */
const FIXED_OFFSET_ZONE = /^(?:[+-]|(?:etc\/)?gmt[+-]\d+$)/i;

/**
 * The one time zone rule: true for an IANA zone name the runtime's time zone data recognises,
 * including `UTC` and `Etc/UTC`. Fixed offsets are refused even though `Intl` accepts them: a member
 * stored with an offset would silently lose daylight saving and receive her morning an hour off for
 * half the year. `@vela/core` delegates here, so the schema and the scheduler never disagree.
 *
 * Both the name as given and the name the runtime resolves it to are checked: runtimes differ in
 * which aliases they canonicalise, and an offset written with the Unicode minus sign (U+2212)
 * resolves to `-08:00` without matching as given.
 */
export function isIanaTimeZone(name: string): boolean {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return false;
  }
  return !FIXED_OFFSET_ZONE.test(name) && !FIXED_OFFSET_ZONE.test(resolved);
}

/** An IANA time zone name, e.g. `Asia/Taipei`, under the rule in `isIanaTimeZone`. */
export const TimeZone = z.string().refine(isIanaTimeZone, "not a recognised IANA time zone");
export type TimeZone = z.infer<typeof TimeZone>;

/** ISO 3166-1 alpha-2 country code, upper case. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, "expected ISO 3166-1 alpha-2");
export type CountryCode = z.infer<typeof CountryCode>;
