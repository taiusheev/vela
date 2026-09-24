import { z } from "zod";
import {
  AnswerKind,
  ExchangeState,
  ExchangeType,
  Lang,
  LightState,
  LocalDate,
  LocalTime,
  MemberStatus,
  Plan,
  Region,
  ReplyKind,
  Role,
  SubscriptionStatus,
  TimeZone,
  WhenRule,
} from "./domain.ts";

export const API_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid",
  "conflict",
  "budget",
  "rate_limited",
  "internal",
  "unavailable",
] as const;
export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.json()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const ApiIdempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
export type ApiIdempotencyKey = z.infer<typeof ApiIdempotencyKey>;

export const ApiMutationResponse = z
  .strictObject({
    status: z.union([z.literal(200), z.literal(201), z.literal(202), z.literal(204)]),
    body: z.json(),
  })
  .refine((response) => response.status !== 204 || response.body === null, {
    message: "a 204 response has no body",
    path: ["body"],
  });
export type ApiMutationResponse = z.infer<typeof ApiMutationResponse>;

export const ApiLinkChallenge = z.object({
  challenge_id: z.uuid(),
  expires_at: z.iso.datetime({ offset: true }),
});
export type ApiLinkChallenge = z.infer<typeof ApiLinkChallenge>;

export const ApiLinkCode = z
  .string()
  .length(22)
  .regex(/^[A-Za-z0-9_-]+$/);
export type ApiLinkCode = z.infer<typeof ApiLinkCode>;

export const ApiLinkOutcome = z.union([
  z.strictObject({ linked: z.literal(false) }),
  z.strictObject({ linked: z.literal(true), member_id: z.uuid(), family_id: z.uuid() }),
]);
export type ApiLinkOutcome = z.infer<typeof ApiLinkOutcome>;

export const PageQuery = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;
export type PageQueryInput = z.input<typeof PageQuery>;

export const ApiAccountProfile = z.strictObject({
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(
      (name) => name.isWellFormed() && !name.includes("\u0000"),
      "name must be valid UTF8 text without NUL",
    ),
  language: Lang,
  tz: TimeZone,
});
export type ApiAccountProfile = z.infer<typeof ApiAccountProfile>;

export const ApiAccountPatch = ApiAccountProfile.partial().refine(
  (patch) =>
    Object.keys(patch).length > 0 && Object.values(patch).every((value) => value !== undefined),
  "provide at least one defined profile field",
);
export type ApiAccountPatch = z.infer<typeof ApiAccountPatch>;

export const ApiUser = z.object({
  id: z.uuid(),
  display_name: z.string(),
  language: Lang,
  tz: TimeZone,
});
export type ApiUser = z.infer<typeof ApiUser>;

export const ApiMe = z.object({
  user: ApiUser,
  memberships: z.array(
    z.object({
      member_id: z.uuid(),
      role: Role,
      status: MemberStatus.extract(["active", "paused"]),
      family: z.object({ id: z.uuid(), name: z.string(), region: Region, plan: Plan }),
    }),
  ),
});
export type ApiMe = z.infer<typeof ApiMe>;

export const ApiFamilyPlan = z.object({
  family_id: z.uuid(),
  plan: Plan,
  subscriptions: z.array(
    z.object({
      member_id: z.uuid(),
      status: SubscriptionStatus,
      trial_ends_at: z.iso.datetime({ offset: true }).nullable(),
      current_period_end: z.iso.datetime({ offset: true }).nullable(),
      grace_until: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
});
export type ApiFamilyPlan = z.infer<typeof ApiFamilyPlan>;

export const MemberLight = z.object({
  member_id: z.uuid(),
  display_name: z.string(),
  state: LightState,
  answered_at: z.iso.datetime({ offset: true }).nullable(),
  usual_time: LocalTime.nullable(),
  away_until: LocalDate.nullable(),
  quiet_event_id: z.uuid().nullable(),
});
export type MemberLight = z.infer<typeof MemberLight>;

export const SetLight = z.strictObject({ on: z.boolean() });
export type SetLight = z.infer<typeof SetLight>;

export const PauseMember = z.strictObject({ paused: z.boolean() });
export type PauseMember = z.infer<typeof PauseMember>;

export const ApiTodayAnswer = z.object({
  kind: AnswerKind,
  /** Her words: what she said, else what she wrote, else what she tapped. */
  text: z.string().nullable(),
  at: z.iso.datetime({ offset: true }),
});
export type ApiTodayAnswer = z.infer<typeof ApiTodayAnswer>;

export const ApiTodayReply = z.object({
  from: z.string(),
  kind: ReplyKind,
  text: z.string().nullable(),
});
export type ApiTodayReply = z.infer<typeof ApiTodayReply>;

export const ApiTodayExchange = z.object({
  id: z.uuid(),
  recipient_id: z.uuid(),
  recipient_name: z.string(),
  /** Null for Vela's own hello, and for an ask whose asker has since been deleted. */
  asker_name: z.string().nullable(),
  on_behalf_of: z.string().nullable(),
  type: ExchangeType,
  ask: z.string().nullable(),
  answer: ApiTodayAnswer.nullable(),
  replies: z.array(ApiTodayReply),
  /** The receipt chip: she opened it. */
  seen_at: z.iso.datetime({ offset: true }).nullable(),
  /**
   * Whether a reply written now reaches her: her next arrival reads back only her latest delivered
   * exchange, so a reply to any older one is kept for the family but never heard.
   */
  replies_reach_her: z.boolean(),
});
export type ApiTodayExchange = z.infer<typeof ApiTodayExchange>;

export const ApiTomorrowTurn = z.object({
  local_day: LocalDate,
  recipient_id: z.uuid(),
  recipient_name: z.string(),
  /** Null when nobody holds turns, or the holder has left. */
  holder_id: z.uuid().nullable(),
  holder_name: z.string().nullable(),
  /** The ask already composed for that morning, once someone has claimed it. */
  ask: z
    .object({
      id: z.uuid(),
      type: ExchangeType,
      text: z.string().nullable(),
      asker_name: z.string().nullable(),
      on_behalf_of: z.string().nullable(),
    })
    .nullable(),
  /** Never offered beside an ask: a claimed morning holds one, and only one. */
  suggestion: z.object({ id: z.uuid(), text: z.string() }).nullable(),
});
export type ApiTomorrowTurn = z.infer<typeof ApiTomorrowTurn>;

export const ApiToday = z.object({
  lights: z.array(MemberLight),
  exchanges: z.array(ApiTodayExchange),
  tomorrow: z.array(ApiTomorrowTurn),
});
export type ApiToday = z.infer<typeof ApiToday>;

/**
 * Composing an ask (`POST /v1/families/:familyId/exchanges`, API contract §4, spec §14.1 A7).
 * Only the types an arrival can carry from words alone: a photo choice, a voice note and an old
 * photo need media the app cannot yet attach, so they are refused rather than stored undeliverable.
 */
export const COMPOSABLE_EXCHANGE_TYPES = ["question", "word", "story", "recipe", "vote"] as const;
export const ComposableExchangeType = z.enum(COMPOSABLE_EXCHANGE_TYPES);
export type ComposableExchangeType = z.infer<typeof ComposableExchangeType>;

/** What `renderArrival` keeps of an ask before it starts shortening (core's `ASK_TEXT_FLOOR`). */
export const MAX_ASK_TEXT = 1_000;
/** A vote's options are buttons, and the last row is always the heart and "I'm fine". */
export const MAX_VOTE_OPTIONS = 7;
/** Retention clears an undelivered ask's words after 30 days; no ask may be composed into that. */
export const MAX_ASK_DAYS_AHEAD = 14;

const AskText = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ASK_TEXT)
  .refine(
    (text) => text.isWellFormed() && !text.includes("\u0000"),
    "the ask must be valid UTF8 text without NUL",
  );

export const ComposeAsk = z
  .strictObject({
    recipient_id: z.uuid(),
    type: ComposableExchangeType,
    text: AskText,
    vote_options: z
      .array(AskText.pipe(z.string().max(64)))
      .min(2)
      .max(MAX_VOTE_OPTIONS)
      .optional(),
    when: WhenRule,
    /** Only a `date` ask carries one, and only a day in the recipient's own future. */
    date: LocalDate.optional(),
    /** A child's name when a parent sends for them. */
    on_behalf_of: z.string().trim().min(1).max(80).optional(),
  })
  .refine((ask) => (ask.when === "date") === (ask.date !== undefined), {
    message: "a date ask needs its date, and no other kind takes one",
    path: ["date"],
  })
  .refine((ask) => (ask.type === "vote") === (ask.vote_options !== undefined), {
    message: "a vote needs its options, and nothing else takes them",
    path: ["vote_options"],
  });
export type ComposeAsk = z.infer<typeof ComposeAsk>;

export const ApiComposedAsk = z.object({
  id: z.uuid(),
  family_id: z.uuid(),
  recipient_id: z.uuid(),
  recipient_name: z.string(),
  asker_name: z.string(),
  on_behalf_of: z.string().nullable(),
  type: ExchangeType,
  ask: z.string().nullable(),
  when_rule: WhenRule,
  /** Null for a whenever ask: it waits for the first morning nobody else has claimed. */
  scheduled_for: LocalDate.nullable(),
  state: ExchangeState,
});
export type ApiComposedAsk = z.infer<typeof ApiComposedAsk>;

/** The 409's `details` when that morning is already someone's (spec A7: "or the day after"). */
export const ApiAskConflict = z.strictObject({
  taken_by: z.string(),
  date_alternative: LocalDate.nullable(),
});
export type ApiAskConflict = z.infer<typeof ApiAskConflict>;

/**
 * The Exchanges list (`GET /v1/families/:familyId/exchanges`, spec §14.1 A8). The same card Today
 * shows, with the day it was for and the moment it arrived.
 */
export const ApiExchangeSummary = ApiTodayExchange.extend({
  scheduled_for: LocalDate.nullable(),
  delivered_at: z.iso.datetime({ offset: true }).nullable(),
});
export type ApiExchangeSummary = z.infer<typeof ApiExchangeSummary>;

/** How far back the list reaches before the family book takes over (spec A8). */
export const EXCHANGE_LIST_DAYS = 30;
export const EXCHANGE_PAGE_SIZE = 20;
export const MAX_EXCHANGE_PAGE_SIZE = 50;

export const ApiExchangePage = z.object({
  exchanges: z.array(ApiExchangeSummary),
  /**
   * The id to ask for next, or null at the end. Ids are uuidv7 and so already in the order the
   * list reads, which `scheduled_for` is not: it is nullable, and two exchanges can share a day.
   */
  next_cursor: z.uuid().nullable(),
});
export type ApiExchangePage = z.infer<typeof ApiExchangePage>;

/**
 * A reply from the app (`POST /v1/exchanges/:exchangeId/replies`, spec §14.1 A8). Words only: a
 * heart, a laugh or a hug is the same row a Telegram reaction writes, and the Telegram path makes a
 * member's reactions equal to their platform set, so an app reaction would vanish the next time
 * that member reacted in the group.
 */
export const MAX_REPLY_TEXT = 1_000;

export const ComposeReply = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REPLY_TEXT)
    .refine(
      (text) => text.isWellFormed() && !text.includes("\u0000"),
      "a reply must be valid UTF8 text without NUL",
    ),
});
export type ComposeReply = z.infer<typeof ComposeReply>;

export const ApiReply = z.object({
  id: z.uuid(),
  exchange_id: z.uuid(),
  from: z.string(),
  kind: ReplyKind,
  text: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  /** Whether her next arrival reads this one back to her; see `replies_reach_her`. */
  reaches_her: z.boolean(),
});
export type ApiReply = z.infer<typeof ApiReply>;

/**
 * Why a reply was refused, in the error's `details`: `not_answered` (409) when she has not answered
 * yet, so there is nothing to reply to; `her_own` (403) when the kept-light member herself replies,
 * which would read her own words back to her tomorrow.
 */
export const REPLY_REFUSALS = ["not_answered", "her_own"] as const;
export const ReplyRefusal = z.enum(REPLY_REFUSALS);
export type ReplyRefusal = z.infer<typeof ReplyRefusal>;

/** What onboarding's first screen asks about her (spec §14.1 A1). */
export const NEW_MEMBER_NAME_MAX = 40;
export const NEW_MEMBER_ADDRESS_MAX = 60;

const PersonText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => text.isWellFormed() && !text.includes("\u0000"), "must be valid text");

/**
 * Creating a family from the app (`POST /v1/families`, spec §14.1 A1). The organiser is the caller;
 * she is invited, not enrolled: her light stays off until she says yes on her own channel. Age, city
 * and "lives alone" from A1 are not asked, because nothing stores or uses them and the privacy
 * notice does not cover them.
 */
export const CreateFamily = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/, "a two-letter country code"),
  kept_light_member: z.strictObject({
    display_name: PersonText(NEW_MEMBER_NAME_MAX),
    address_form: PersonText(NEW_MEMBER_ADDRESS_MAX),
    language: Lang,
    tz: TimeZone,
    wake_time: LocalTime,
  }),
});
export type CreateFamily = z.infer<typeof CreateFamily>;

export const ApiCreatedFamily = z.object({
  family: z.object({ id: z.uuid(), name: z.string(), region: Region, country: z.string() }),
  organiser_member_id: z.uuid(),
  kept_light_member: z.object({
    id: z.uuid(),
    display_name: z.string(),
    status: MemberStatus,
    /** Half an hour after she wakes, in her own time zone. */
    arrival_time: LocalTime,
  }),
  invite: z.object({
    url: z.url(),
    expires_at: z.iso.datetime({ offset: true }),
    /** What the organiser sends her, in her language (spec A4). */
    text: z.string(),
  }),
});
export type ApiCreatedFamily = z.infer<typeof ApiCreatedFamily>;

/**
 * A quiet morning, as the organiser's sheet reads it (`GET /v1/quiet/:quietEventId`, spec §14.1 A11,
 * §8). Facts only, never her words: when the ask reached her, when it was asked again, when she
 * usually answers and last did, and the people nearby who have said yes, with the number to call.
 */
export const ApiQuietNotice = z.object({
  quiet_event_id: z.uuid(),
  member_id: z.uuid(),
  member_name: z.string(),
  delivered_at: z.iso.datetime({ offset: true }).nullable(),
  repeated_at: z.iso.datetime({ offset: true }).nullable(),
  /** Her usual hour from her recent answered days; null until her rhythm is known. */
  usual_time: LocalTime.nullable(),
  last_answered_at: z.iso.datetime({ offset: true }).nullable(),
  opened_at: z.iso.datetime({ offset: true }),
  /** Set after "wait 2 hours": the notice is not raised again before it. */
  wait_until: z.iso.datetime({ offset: true }).nullable(),
  resolved: z
    .object({
      outcome: z.string(),
      at: z.iso.datetime({ offset: true }),
      by_name: z.string().nullable(),
    })
    .nullable(),
  contacts: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      relation: z.string().nullable(),
      phone: z.string(),
    }),
  ),
});
export type ApiQuietNotice = z.infer<typeof ApiQuietNotice>;

/** "She's fine" and "wait 2 hours" carry nothing but the event in their path. */
export const QuietAction = z.strictObject({});
export type QuietAction = z.infer<typeof QuietAction>;

/**
 * What "she's fine" and "wait" answer: the notice without the people nearby. A write's answer is
 * kept for a day to replay, and a contact's number must not outlive their yes in it; the sheet has
 * no use for the numbers once the morning is settled or put off.
 */
export const ApiQuietState = ApiQuietNotice.omit({ contacts: true });
export type ApiQuietState = z.infer<typeof ApiQuietState>;

/** Where a nearby contact's yes stands: given, refused, or not yet given (spec §8, L8). */
export const NEARBY_CONSENTS = ["yes", "no", "waiting"] as const;
export const NearbyConsent = z.enum(NEARBY_CONSENTS);
export type NearbyConsent = z.infer<typeof NearbyConsent>;

/**
 * The family as You shows it (`GET /v1/families/:familyId`, spec §14.1 A12). Every live member with
 * their light — on, waiting for her yes, or off — and, for a kept-light member, where her Vela Light
 * trial or plan stands. The people nearby are for the organisers, who set them up, and carry where
 * their yes stands, never their numbers; anyone else gets null.
 */
export const ApiFamily = z.object({
  family: z.object({ id: z.uuid(), name: z.string(), plan: Plan }),
  me: z.object({ member_id: z.uuid(), role: Role }),
  members: z.array(
    z.object({
      member_id: z.uuid(),
      display_name: z.string(),
      role: Role,
      status: MemberStatus.extract(["invited", "active", "paused"]),
      light: z.enum(["on", "waiting", "off"]),
      subscription: z
        .object({
          status: SubscriptionStatus,
          trial_ends_at: z.iso.datetime({ offset: true }).nullable(),
          current_period_end: z.iso.datetime({ offset: true }).nullable(),
        })
        .nullable(),
    }),
  ),
  nearby: z
    .array(
      z.object({
        id: z.uuid(),
        near_member_id: z.uuid(),
        name: z.string(),
        relation: z.string().nullable(),
        consent: NearbyConsent,
      }),
    )
    .nullable(),
});
export type ApiFamily = z.infer<typeof ApiFamily>;
