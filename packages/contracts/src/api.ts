import { z } from "zod";
import {
  AnswerKind,
  Channel,
  ExchangeState,
  ExchangeType,
  Lang,
  LightState,
  LocalDate,
  LocalTime,
  MemberStatus,
  Plan,
  PushKind,
  PushPermission,
  PushPlatform,
  REACTION_KINDS,
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
  telegram_url: z.url().optional(),
});
export type ApiLinkChallenge = z.infer<typeof ApiLinkChallenge>;

export const ApiLinkCode = z
  .string()
  .length(22)
  .regex(/^[A-Za-z0-9_-]+$/);
export type ApiLinkCode = z.infer<typeof ApiLinkCode>;

export const ApiLinkStartInput = z.strictObject({});
export type ApiLinkStartInput = z.infer<typeof ApiLinkStartInput>;
export const ApiLinkCompleteInput = z.strictObject({ challenge_id: z.uuid(), code: ApiLinkCode });
export type ApiLinkCompleteInput = z.infer<typeof ApiLinkCompleteInput>;

/** Public capabilities contain only product switches, never account or provider details. */
export const ApiCapabilities = z.strictObject({
  pilot: z.boolean(),
  telegram_first: z.boolean(),
  english_only: z.boolean(),
  memory: z.boolean(),
  book: z.boolean().default(false),
  parent_app: z.boolean(),
  billing: z.boolean(),
});
export type ApiCapabilities = z.infer<typeof ApiCapabilities>;

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

/**
 * `PATCH /v1/me`: the profile's own fields, and `one_moment_a_day` (ADR-34), the account's switch
 * for its ordinary pushes. It never stops the quiet notice or its close.
 */
export const ApiAccountPatch = ApiAccountProfile.partial()
  .extend({ one_moment_a_day: z.boolean().optional() })
  .refine(
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
  /**
   * Whether this API keeps photos from the app (ADR-33): true when it has somewhere to keep them,
   * false where media storage is off or its store could not be built, so the app can switch its
   * photo asks off before anyone picks a photo. The upload's 503 stays as the backstop.
   */
  photos: z.boolean(),
  /**
   * "One moment a day" (ADR-34): whether this account's ordinary pushes, an answer's receipt and
   * the evening's turn prompt, are sent. The quiet notice and its close come whatever it says.
   */
  one_moment_a_day: z.boolean(),
  /**
   * Whether this API sends pushes at all (ADR-34, the Worker's `PUSH_SEND`): false while the switch
   * is off, so the app says its notifications are not sent yet instead of showing them as on to an
   * organiser who would then believe she will be told. Devices still register while it is off.
   */
  push: z.boolean(),
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
  /** The recipient's clock; optional only for older cached responses. */
  tz: TimeZone.optional(),
  local_date: LocalDate.optional(),
  state: LightState,
  answered_at: z.iso.datetime({ offset: true }).nullable(),
  usual_time: LocalTime.nullable(),
  away_until: LocalDate.nullable(),
  /** The away period she is in today, which a member may end; null when she is not away. */
  away_id: z.uuid().nullable(),
  /**
   * The messenger her mornings go to when Vela can no longer reach her there (she blocked Vela, or
   * left the platform; spec §19 "we lost Mom's Telegram"); null while she can be reached.
   */
  unreachable_on: Channel.nullable(),
  quiet_event_id: z.uuid().nullable(),
});
export type MemberLight = z.infer<typeof MemberLight>;

/**
 * One day of the week a weekly read covers, for its seven small lights (spec A9): answered, answered
 * only after that morning's quiet notice opened (`late`), not answered, or before her light started
 * (`not_counted`). `answered_at` is her local time, for an answered or late day.
 */
export const WEEK_DAY_STATES = ["answered", "late", "unanswered", "not_counted"] as const;
export const WeekDayState = z.enum(WEEK_DAY_STATES);
export type WeekDayState = z.infer<typeof WeekDayState>;

export const ApiWeekDay = z.object({
  date: LocalDate,
  state: WeekDayState,
  answered_at: LocalTime.nullable(),
});
export type ApiWeekDay = z.infer<typeof ApiWeekDay>;

const WeekCount = z.number().int().min(0);

/**
 * Her latest weekly read the founder sent (`GET /v1/families/:id/weekly-read?member=`, API contract
 * §7), for organisers. The counts are the numbers stored when it was drafted, never words of the
 * model, and the app renders them. `locked` is true when no Vela Light trial or plan covers her: the
 * seven days show, and the counts, the notes and the suggestion are null. `read` is null until a
 * read of hers has been sent.
 */
export const ApiWeeklyRead = z.object({
  member_id: z.uuid(),
  display_name: z.string(),
  locked: z.boolean(),
  read: z
    .object({
      id: z.uuid(),
      week_start: LocalDate,
      week_end: LocalDate,
      sent_at: z.iso.datetime({ offset: true }),
      days: z.array(ApiWeekDay).length(7),
      counts: z
        .object({
          counted_days: WeekCount.max(7),
          answered_days: WeekCount.max(7),
          hello_mornings: WeekCount.max(7),
          family_asks: WeekCount,
        })
        .nullable(),
      notes: z.array(z.string()).nullable(),
      /** Null when locked, and when the founder removed it before sending. */
      suggestion: z.string().nullable(),
    })
    .nullable(),
});
export type ApiWeeklyRead = z.infer<typeof ApiWeeklyRead>;

/** An organiser opened a sent, unlocked read on screen; its id is in the path. */
export const OpenWeeklyRead = z.strictObject({});
export type OpenWeeklyRead = z.infer<typeof OpenWeeklyRead>;

export const ApiWeeklyReadOpened = z.strictObject({
  weekly_read_id: z.uuid(),
  opened: z.literal(true),
});
export type ApiWeeklyReadOpened = z.infer<typeof ApiWeeklyReadOpened>;

const PrecisionCount = z.number().int().min(0);

/**
 * One month of quiet notices (spec §8 "Precision accounting"), by the UTC month the quiet morning
 * opened. A notice is a quiet morning that told someone; `open` ones have no outcome yet. `useful`
 * counts the organisers' verdicts on settled ones. Quiet mornings that told nobody are not counted
 * here, so the page never tallies her silences (spec §8, "No guilt").
 */
export const ApiPrecisionMonth = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  notices: PrecisionCount,
  open: PrecisionCount,
  outcomes: z.object({
    answered_late: PrecisionCount,
    away: PrecisionCount,
    fine_known: PrecisionCount,
    true_concern: PrecisionCount,
    unknown: PrecisionCount,
  }),
  useful: z.object({ yes: PrecisionCount, no: PrecisionCount }),
});
export type ApiPrecisionMonth = z.infer<typeof ApiPrecisionMonth>;

/**
 * How Vela is doing (`GET /v1/families/:id/precision`, API contract §7), for organisers: the
 * family's own notices, and Vela's across every family, newest month first, the last twelve. A Vela
 * month is shown only once it has at least `vela_minimum.notices` notices from at least
 * `vela_minimum.families` families, so no one family's morning can be read out of it.
 */
export const ApiPrecision = z.object({
  family: z.array(ApiPrecisionMonth),
  vela: z.array(ApiPrecisionMonth),
  vela_minimum: z.object({ notices: PrecisionCount, families: PrecisionCount }),
});
export type ApiPrecision = z.infer<typeof ApiPrecision>;

/**
 * Vela's monthly precision as the public website publishes it (spec §8 "Precision accounting"):
 * only months that have ended, newest first, and only those with at least `minimum.notices`
 * notices from at least `minimum.families` families, the same floor as the app's Vela months. No
 * family is named and nothing is per family. `through` is the last month that could appear.
 */
export const PublicPrecision = z.object({
  months: z.array(ApiPrecisionMonth),
  minimum: z.object({ notices: PrecisionCount, families: PrecisionCount }),
  through: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type PublicPrecision = z.infer<typeof PublicPrecision>;

export const SetLight = z.strictObject({ on: z.boolean() });
export type SetLight = z.infer<typeof SetLight>;

export const PauseMember = z.strictObject({ paused: z.boolean() });
export type PauseMember = z.infer<typeof PauseMember>;

/** The original shared recording; availability changes as its source copy is kept or expires. */
export const ApiExchangeAudio = z.object({
  id: z.uuid(),
  mime: z.enum(["audio/mp4", "audio/ogg", "audio/mpeg"]),
  duration_ms: z.number().int().positive().nullable(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  state: z.enum(["pending", "ready", "unavailable"]),
  role: z.literal("original"),
});
export type ApiExchangeAudio = z.infer<typeof ApiExchangeAudio>;

export const ApiExchangePhoto = z.object({
  id: z.uuid(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  stored: z.boolean(),
  /** Kept photos have no expiry; omitted only by an older server or cached response. */
  expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type ApiExchangePhoto = z.infer<typeof ApiExchangePhoto>;

export const ApiTodayAnswer = z.object({
  kind: AnswerKind,
  /** Her words: what she said, else what she wrote, else what she tapped. */
  text: z.string().nullable(),
  at: z.iso.datetime({ offset: true }),
  /**
   * The photo she picked, on a photo choice she answered by picking one (ADR-33): kept when a
   * later answer, her voice say, is the one shown. Null otherwise. The photo itself may have been
   * deleted since, and `ApiTodayExchange.photos` then no longer lists it.
   */
  picked_media_id: z.uuid().nullable(),
  /**
   * Which of the two she picked, 1 or 2, as her buttons numbered them, whenever `picked_media_id`
   * is set: the pick still reads "photo 1" once that photo is deleted. It is never a place in
   * `ApiTodayExchange.photos`, which leaves a deleted photo out.
   */
  picked_number: z.number().int().min(1).max(2).nullable(),
  /**
   * Her words in the family's language, where they differ from hers and the translation is done
   * (flows §3.10); null otherwise. `text` stays her own words, which the app offers as the original.
   */
  translation: z.object({ lang: Lang, text: z.string() }).nullable(),
  audio: ApiExchangeAudio.nullable().default(null),
  photo: ApiExchangePhoto.nullable().default(null),
});
export type ApiTodayAnswer = z.infer<typeof ApiTodayAnswer>;

/**
 * A photo of an exchange as the app shows it (ADR-33). `stored` says whether the API can show it
 * (`GET /v1/families/:familyId/media/:id`); one Telegram alone holds cannot be, and the app shows a
 * placeholder.
 */
export const ApiTodayReply = z.object({
  from: z.string(),
  kind: ReplyKind,
  text: z.string().nullable(),
  /** A photo reply's photo, shown as itself; null for any other reply, or once it is deleted. */
  photo: ApiExchangePhoto.nullable(),
  audio: ApiExchangeAudio.nullable().default(null),
});
export type ApiTodayReply = z.infer<typeof ApiTodayReply>;

export const ApiTodayExchange = z.object({
  id: z.uuid(),
  recipient_id: z.uuid(),
  recipient_name: z.string(),
  /** Recipient clock for answer/read receipts, including a directly opened exchange. */
  recipient_tz: TimeZone.optional(),
  /** Null for Vela's own hello, and for an ask whose asker has since been deleted. */
  asker_name: z.string().nullable(),
  on_behalf_of: z.string().nullable(),
  type: ExchangeType,
  ask: z.string().nullable(),
  voice_hello: ApiExchangeAudio.nullable().default(null),
  answer: ApiTodayAnswer.nullable(),
  replies: z.array(ApiTodayReply),
  /** The receipt chip: she opened it. */
  seen_at: z.iso.datetime({ offset: true }).nullable(),
  /**
   * Whether a reply written now reaches her: her next arrival reads back only her latest delivered
   * exchange, so a reply to any older one is kept for the family but never heard.
   */
  replies_reach_her: z.boolean(),
  /**
   * The ask's photos, in the order she was shown them, so a photo choice's first is her "1"
   * (ADR-33). `stored` says whether the API can show it (`GET /v1/families/:familyId/media/:id`);
   * one Telegram alone holds cannot be, and the app shows a placeholder. A photo deleted after its
   * 30 days is no longer listed.
   */
  photos: z.array(ApiExchangePhoto),
});
export type ApiTodayExchange = z.infer<typeof ApiTodayExchange>;

export const ApiTomorrowTurn = z.object({
  local_day: LocalDate,
  recipient_id: z.uuid(),
  recipient_name: z.string(),
  /**
   * Null until the evening prompt has chosen a holder (`turn_pending`), when nobody holds turns, or
   * when the holder has left.
   */
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
      /** The reader asked it and her morning is not prepared yet, so they may withdraw it. */
      withdrawable: z.boolean(),
    })
    .nullable(),
  /**
   * Never offered beside an ask: a claimed morning holds one, and only one. It is her morning's, not
   * the holder's, so anyone in the family may use it; never offered to her about herself.
   */
  suggestion: z
    .object({
      id: z.uuid(),
      /** In the reader's own language. */
      text: z.string().min(1),
      /** The kind of ask the words were written as: a question, a story, a recipe or a word. */
      type: ExchangeType,
      /** Drafted from something she mentioned, rather than taken from Vela's question bank. */
      from_her_words: z.boolean(),
    })
    .nullable(),
  /** No turn row yet: the evening prompt that chooses a holder has not run for that day. */
  turn_pending: z.boolean(),
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
 * Only the types an arrival can carry: words alone, or words with the photos the app uploaded
 * first (ADR-33), two for a photo choice and one for an old photo. A voice note needs media the
 * app cannot yet attach, so it is refused rather than stored undeliverable.
 */
export const COMPOSABLE_EXCHANGE_TYPES = [
  "question",
  "word",
  "story",
  "recipe",
  "vote",
  "photo_choice",
  "memory_photo",
  /** The asker's own short recording is the ask (spec §4); it needs a `voice_hello_id`. */
  "voice_note",
] as const;
export const ComposableExchangeType = z.enum(COMPOSABLE_EXCHANGE_TYPES);
export type ComposableExchangeType = z.infer<typeof ComposableExchangeType>;

/** What `renderArrival` keeps of an ask before it starts shortening (core's `ASK_TEXT_FLOOR`). */
export const MAX_ASK_TEXT = 1_000;
/** A vote's options are buttons, and the last row is always the heart and "I'm fine". */
export const MAX_VOTE_OPTIONS = 7;
/** Retention clears an undelivered ask's words after 30 days; no ask may be composed into that. */
export const MAX_ASK_DAYS_AHEAD = 14;
/** How many uploaded photos an ask names (ADR-33); every other type names none. */
export const ASK_PHOTO_COUNT = { photo_choice: 2, memory_photo: 1 } as const;

function askPhotoCount(type: ComposableExchangeType): number {
  return type === "photo_choice" || type === "memory_photo" ? ASK_PHOTO_COUNT[type] : 0;
}

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
    /**
     * The suggestion the ask started from, even if its words were changed; marked used when the ask
     * is composed. One already used, or not hers, marks nothing and never stops the ask.
     */
    suggestion_id: z.uuid().optional(),
    /**
     * The photos a photo ask shows her, in order, each one uploaded to this family first
     * (`POST /v1/families/:familyId/media`, ADR-33). A photo choice's first is her "1".
     */
    media_ids: z.array(z.uuid()).min(1).max(2).optional(),
    /**
     * A voice hello the asker recorded and uploaded first (`POST /v1/families/:familyId/voice`),
     * which plays before the ask (spec §4: about 10 seconds, on any type).
     */
    voice_hello_id: z.uuid().optional(),
  })
  .refine((ask) => (ask.when === "date") === (ask.date !== undefined), {
    message: "a date ask needs its date, and no other kind takes one",
    path: ["date"],
  })
  .refine((ask) => (ask.type === "vote") === (ask.vote_options !== undefined), {
    message: "a vote needs its options, and nothing else takes them",
    path: ["vote_options"],
  })
  .refine((ask) => (ask.media_ids?.length ?? 0) === askPhotoCount(ask.type), {
    message: "a photo choice takes two photos, an old photo one, and nothing else takes any",
    path: ["media_ids"],
  })
  .refine(
    (ask) =>
      ask.media_ids === undefined ||
      new Set(ask.media_ids.map((id) => id.toLowerCase())).size === ask.media_ids.length,
    { message: "each photo is named once", path: ["media_ids"] },
  )
  .refine((ask) => ask.media_ids === undefined || ask.when !== "whenever", {
    // A whenever ask waits for a free morning with no end, and a photo is deleted after 30 days.
    message: "a photo ask names its morning",
    path: ["when"],
  })
  .refine((ask) => ask.type !== "voice_note" || ask.voice_hello_id !== undefined, {
    message: "a voice note ask carries its recording",
    path: ["voice_hello_id"],
  })
  .refine((ask) => ask.voice_hello_id === undefined || ask.when !== "whenever", {
    // So is a recording: the voice hello waits for no morning it might outlive.
    message: "an ask with a voice hello names its morning",
    path: ["when"],
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
 * A reply from the app (`POST /v1/exchanges/:exchangeId/replies`, spec §14.1 A8): words, a voice,
 * a photo, or a reaction (a heart, a laugh or a hug), which is the same row a Telegram reaction writes, one of
 * each kind per member per exchange. The Telegram path makes a member's reactions in the group
 * equal to the group's set, and leaves one given in the app alone (API contract §4, "Reactions").
 */
export const MAX_REPLY_TEXT = 1_000;

export const ComposeReply = z.union([
  z.strictObject({
    text: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REPLY_TEXT)
      .refine(
        (text) => text.isWellFormed() && !text.includes("\u0000"),
        "a reply must be valid UTF8 text without NUL",
      ),
  }),
  z.strictObject({ reaction: z.enum(REACTION_KINDS) }),
  /** A voice the replier uploaded first (`POST /v1/families/:familyId/voice`), by its id. */
  z.strictObject({ voice: z.uuid() }),
  /** A photo the replier uploaded first (`POST /v1/families/:familyId/media`), by its id. */
  z.strictObject({ photo: z.uuid() }),
]);
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
export const REPLY_REFUSALS = [
  "not_answered",
  "her_own",
  "voice_missing",
  "photo_missing",
] as const;
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
    /** The same invite on LINE, where LINE is on here (05-line-flows §2.3); null otherwise. */
    line_url: z.url().nullable(),
    line_text: z.string().nullable(),
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
  /** The organisers' one-tap verdict once it is settled, for the precision page (spec §18). */
  useful: z.boolean().nullable(),
  /**
   * The people nearby who said yes: with the number to call when they gave one, and, when they said
   * yes on Telegram, whether they can be asked to look in and how this morning's ask stands.
   */
  contacts: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      relation: z.string().nullable(),
      phone: z.string().nullable(),
      can_ask: z.boolean(),
      asked: z
        .object({
          at: z.iso.datetime({ offset: true }),
          by_name: z.string().nullable(),
          reply: z.enum(["yes", "no"]).nullable(),
        })
        .nullable(),
    }),
  ),
});
export type ApiQuietNotice = z.infer<typeof ApiQuietNotice>;

/** Whether the notice was useful (`POST /v1/quiet/:quietEventId/useful`), once it is settled. */
export const QuietUseful = z.strictObject({ useful: z.boolean() });
export type QuietUseful = z.infer<typeof QuietUseful>;

/** "Ask them to look in" (`POST /v1/quiet/:quietEventId/ask-to-check`), ADR-36. */
export const AskToLookIn = z.strictObject({ contact_id: z.uuid() });
export type AskToLookIn = z.infer<typeof AskToLookIn>;

/** What asking answers: the ask as it stands, a repeat on the same morning included. */
export const ApiLookInAsk = z.object({
  quiet_event_id: z.uuid(),
  contact_id: z.uuid(),
  asked_at: z.iso.datetime({ offset: true }),
  reply: z.enum(["yes", "no"]).nullable(),
});
export type ApiLookInAsk = z.infer<typeof ApiLookInAsk>;

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

/** A person nearby as You lists them, and as adding one answers: never their number. */
export const ApiNearbyContact = z.object({
  id: z.uuid(),
  near_member_id: z.uuid(),
  name: z.string(),
  relation: z.string().nullable(),
  consent: NearbyConsent,
});
export type ApiNearbyContact = z.infer<typeof ApiNearbyContact>;

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
  nearby: z.array(ApiNearbyContact).nullable(),
  /**
   * How the caller would be told if her morning goes quiet (ADR-34, D4), for an organiser; null for
   * anyone else, whom a quiet notice never goes to. `telegram`: they have a Telegram link they have
   * not blocked. `app`: this API sends pushes and their account has a phone that can be told
   * (notifications allowed, quiet channel not blocked). Neither means nobody tells them, and You
   * says so plainly (principle 7).
   */
  told_if_quiet: z.object({ telegram: z.boolean(), app: z.boolean() }).nullable(),
});
export type ApiFamily = z.infer<typeof ApiFamily>;

/** What pausing oneself answers: where the caller's membership now stands (spec A12). */
export const ApiMemberPause = z.object({
  member_id: z.uuid(),
  status: MemberStatus.extract(["active", "paused"]),
});
export type ApiMemberPause = z.infer<typeof ApiMemberPause>;

/** Leaving carries nothing but the member in its path. */
export const LeaveFamily = z.strictObject({});
export type LeaveFamily = z.infer<typeof LeaveFamily>;

export const ApiLeft = z.object({
  member_id: z.uuid(),
  left_at: z.iso.datetime({ offset: true }),
});
export type ApiLeft = z.infer<typeof ApiLeft>;

/** Deleting one's account carries nothing: the session names the account (ADR-43). */
export const DeleteAccount = z.strictObject({});
export type DeleteAccount = z.infer<typeof DeleteAccount>;

/**
 * What account deletion answers. `left`: memberships left as Leave leaves them. `kept`: memberships
 * Leave would refuse (her own light, or the family's last active organiser), kept in the family as
 * messenger-only members with no account, so the person is still told on Telegram or LINE there.
 */
export const ApiAccountDeleted = z.object({
  deleted: z.literal(true),
  left: z.int().nonnegative(),
  kept: z.int().nonnegative(),
});
export type ApiAccountDeleted = z.infer<typeof ApiAccountDeleted>;

/**
 * Why pausing or leaving was refused, in a 409's `details.reason`. `last_organiser`: nobody else
 * who organises the family is active, and an organiser who is paused or gone is not told when her
 * light goes quiet. `kept_light`: a kept-light member's pause and stop go through her own chat,
 * where her schedule, her words and her yes are handled together.
 */
export const MEMBER_CHANGE_REFUSALS = ["last_organiser", "kept_light"] as const;
export const MemberChangeRefusal = z.enum(MEMBER_CHANGE_REFUSALS);
export type MemberChangeRefusal = z.infer<typeof MemberChangeRefusal>;

/** How long the trial runs, from the moment it is started (spec §16: no card). */
export const TRIAL_DAYS = 30;

/** "Start the 30 days" for one kept-light member (spec A13, API contract §7). */
/**
 * Someone nearby her, added from the app (`POST /v1/families/:familyId/nearby`, API contract
 * § "People nearby", spec A3): a name and how they know her, each 1 to 40 characters once trimmed,
 * and never a number. A number arrives only with the contact's own yes, which the founder records
 * (L8); a name or relation holding one is refused (`NearbyRefusal` `number`).
 */
export const AddNearby = z.strictObject({
  member_id: z.uuid(),
  name: z.string().trim().min(1).max(40),
  relation: z.string().trim().min(1).max(40).nullable(),
});
export type AddNearby = z.infer<typeof AddNearby>;

/** Removing someone nearby takes no body: the contact is in the path. */
export const RemoveNearby = z.strictObject({});

/** Asking someone nearby on Telegram (`POST /v1/nearby/:contactId/invite`, ADR-36): no body. */
export const InviteNearby = z.strictObject({});
export type InviteNearby = z.infer<typeof InviteNearby>;

/** The link to share with them, once: it is the only way in, and a new one voids it. */
export const ApiNearbyInvite = z.object({ contact_id: z.uuid(), link: z.url() });
export type ApiNearbyInvite = z.infer<typeof ApiNearbyInvite>;
export type RemoveNearby = z.infer<typeof RemoveNearby>;

/** What removing someone nearby answers, a replay included. */
export const ApiNearbyRemoved = z.object({ id: z.uuid(), removed: z.literal(true) });
export type ApiNearbyRemoved = z.infer<typeof ApiNearbyRemoved>;

/**
 * Why adding someone nearby was refused, in a 409's `details.reason`: she already has two (spec
 * §17: no contacts beyond the two nearby), or the name or relation holds a phone number.
 */
export const NEARBY_REFUSALS = ["full", "number"] as const;
export const NearbyRefusal = z.enum(NEARBY_REFUSALS);
export type NearbyRefusal = z.infer<typeof NearbyRefusal>;

/**
 * Her phone for the parent surface (ADR-35). Setting it up and removing it take no body: she is
 * in the path. Setting up answers the token once, which her phone keeps and nothing else does.
 */
export const DeviceWrite = z.strictObject({});
export type DeviceWrite = z.infer<typeof DeviceWrite>;

export const ApiDeviceSetUp = z.object({
  member_id: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type ApiDeviceSetUp = z.infer<typeof ApiDeviceSetUp>;

export const ApiDeviceRemoved = z.object({ member_id: z.uuid(), removed: z.literal(true) });
export type ApiDeviceRemoved = z.infer<typeof ApiDeviceRemoved>;

/**
 * Who a device token is (`GET /v1/device`): what her phone needs to greet her and choose its
 * language before anything else is read, and whether she has said yes yet (`invited` until then).
 */
export const ApiDeviceMember = z.object({
  member_id: z.uuid(),
  display_name: z.string(),
  address_form: z.string(),
  language: z.string(),
  status: MemberStatus,
  /** When her morning arrives, her local time: the hour her phone tells her it is there. */
  arrival_time: LocalTime.nullable(),
});
export type ApiDeviceMember = z.infer<typeof ApiDeviceMember>;

/**
 * A message Vela sent her phone (`GET /v1/device/messages`, ADR-35): its text and its buttons as
 * they were sent, newest first. `message_id` is what a tap under it names.
 */
export const ApiDeviceMessage = z.object({
  message_id: z.string().min(1),
  kind: z.string(),
  exchange_id: z.uuid().nullable(),
  text: z.string(),
  buttons: z.array(z.array(z.object({ id: z.string(), label: z.string() }))),
  /** The message's photos in order, each read through `GET /v1/device/media/:id`. */
  photos: z.array(z.uuid()),
  /** The family's voice notes it reads back, in order, each played from the same route. */
  voices: z.array(z.uuid()),
  sent_at: z.iso.datetime({ offset: true }),
});
export type ApiDeviceMessage = z.infer<typeof ApiDeviceMessage>;

export const ApiDeviceMessages = z.object({ messages: z.array(ApiDeviceMessage) });
export type ApiDeviceMessages = z.infer<typeof ApiDeviceMessages>;

/**
 * What her phone sends (`POST /device/messages`, ADR-35): a tap on a button of a message it was
 * sent, her own words, at most as long as a Telegram message, or her voice.
 */
export const DeviceInput = z.union([
  z.strictObject({
    button: z.string().min(1).max(64),
    message_id: z.string().min(1).max(64),
  }),
  z.strictObject({ text: z.string().trim().min(1).max(4_000) }),
  /** Her recording, uploaded first (`POST /device/voice`), by the media id the upload answered. */
  z.strictObject({ voice: z.uuid() }),
]);
export type DeviceInput = z.infer<typeof DeviceInput>;

export const StartTrial = z.strictObject({ member_id: z.uuid() });
export type StartTrial = z.infer<typeof StartTrial>;

/** Where her Vela Light stands once the trial is asked for: the new trial, or what was there. */
export const ApiTrial = z.object({
  member_id: z.uuid(),
  status: SubscriptionStatus,
  trial_ends_at: z.iso.datetime({ offset: true }).nullable(),
});
export type ApiTrial = z.infer<typeof ApiTrial>;

/**
 * Why a trial was refused, in a 409's `details.reason`: she has not answered yet, and the trial
 * starts after her first answer (spec §16), or her light is not on.
 */
export const TRIAL_REFUSALS = ["not_answered_yet", "light_off"] as const;
export const TrialRefusal = z.enum(TRIAL_REFUSALS);
export type TrialRefusal = z.infer<typeof TrialRefusal>;

/**
 * A photo the app uploaded for an ask (ADR-33, `POST /v1/families/:familyId/media`): its id, which a
 * photo ask names, its size in pixels and in bytes as Vela keeps it (cleaned of everything but what
 * draws it), and when it is deleted unless the family keeps it.
 */
export const ApiUploadedMedia = z.object({
  id: z.uuid(),
  kind: z.literal("image"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  expires_at: z.iso.datetime({ offset: true }),
});
export type ApiUploadedMedia = z.infer<typeof ApiUploadedMedia>;

/** A voice kept for a reply (`POST /v1/families/:familyId/voice`), named by `{voice}` in a reply. */
export const ApiUploadedVoice = z.object({
  id: z.uuid(),
  kind: z.literal("audio"),
  duration_ms: z.number().int().positive().nullable(),
  bytes: z.number().int().positive(),
  expires_at: z.iso.datetime({ offset: true }),
});
export type ApiUploadedVoice = z.infer<typeof ApiUploadedVoice>;

/**
 * Why a photo upload was refused, in `details.reason`. `jpeg_only` (415): not a JPEG, or a JPEG kind
 * Telegram and phones do not draw (lossless, arithmetic, hierarchical). `malformed` (400): a JPEG
 * that cannot be walked to its end. `dimensions` (400): a side of 0, a long side over 4096, or one
 * side over 20 times the other. `photo_limit` (429): the account's 20 photos in 24 hours, or the
 * family's 60 photos waiting to be asked about or deleted. For a voice (`POST …/voice`): `m4a_only`
 * (415), anything but an MPEG-4 recording, and `voice_limit` (429), the account's 30 in 24 hours.
 */
export const MEDIA_REFUSALS = [
  "jpeg_only",
  "malformed",
  "dimensions",
  "photo_limit",
  "m4a_only",
  "voice_limit",
] as const;
export const MediaRefusal = z.enum(MEDIA_REFUSALS);
export type MediaRefusal = z.infer<typeof MediaRefusal>;

/**
 * Why an upload answered 503 `unavailable`, in `details.reason`: `media_storage_off`, where this
 * environment keeps no media at all, or `media_storage_unavailable`, where it should and its store
 * could not be built. `ApiMe.photos` is false in both.
 */
export const MEDIA_UNAVAILABLE_REASONS = [
  "media_storage_off",
  "media_storage_unavailable",
] as const;
export const MediaUnavailableReason = z.enum(MEDIA_UNAVAILABLE_REASONS);
export type MediaUnavailableReason = z.infer<typeof MediaUnavailableReason>;

// ---------------------------------------------------------------------------------------------
// Push (build plan 3.8, ADR-34)
// ---------------------------------------------------------------------------------------------

/**
 * An Expo push token as `getExpoPushTokenAsync` gives it. It names one installation of the app to
 * Expo, so it is never logged and never answered back.
 */
export const ExpoPushToken = z.string().regex(/^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/);
export type ExpoPushToken = z.infer<typeof ExpoPushToken>;

/**
 * `POST /v1/me/devices`: this installation registers, or refreshes, the phone it runs on for the
 * signed-in account. The installation id is a uuid the app mints once and keeps; a token or an
 * installation seen under another account moves to this one (the phone changed hands). What the
 * phone allows is sent every time, so an organiser who turned notifications off, or blocked the
 * quiet channel on Android, stops counting as someone who can be told.
 */
export const RegisterPushDevice = z.strictObject({
  installation_id: z.uuid(),
  token: ExpoPushToken,
  platform: PushPlatform,
  permission: PushPermission,
  /** Android: the `quiet` notification channel is blocked in the phone's settings. */
  quiet_channel_blocked: z.boolean(),
});
export type RegisterPushDevice = z.infer<typeof RegisterPushDevice>;

/** A registered installation as the API answers it: never its token. */
export const ApiPushDevice = z.object({
  installation_id: z.uuid(),
  platform: PushPlatform,
  permission: PushPermission,
  quiet_channel_blocked: z.boolean(),
  registered_at: z.iso.datetime({ offset: true }),
});
export type ApiPushDevice = z.infer<typeof ApiPushDevice>;

/** `POST /v1/me/devices/:installationId/remove`: nothing but the installation, in its path. */
export const RemovePushDevice = z.strictObject({});
export type RemovePushDevice = z.infer<typeof RemovePushDevice>;

/**
 * What removing answers: whether this account had that installation. An installation of another
 * account, or one already removed, answers `removed: false`, never 403 or 404, so the app's
 * sign-out always finishes and nothing is learnt about anyone else's phone.
 */
export const ApiPushDeviceRemoved = z.object({
  installation_id: z.uuid(),
  removed: z.boolean(),
});
export type ApiPushDeviceRemoved = z.infer<typeof ApiPushDeviceRemoved>;

/**
 * What a push carries besides its text, read by the app when it is tapped: ids only, never words.
 * Push text and data pass through Expo, Apple and Google, so neither ever holds her words, an
 * answer, a nearby contact, or anything about her health.
 */
export const PushData = z.strictObject({
  kind: PushKind,
  family_id: z.uuid(),
  /** The kept-light member it is about: whose morning went quiet, who answered, whose turn. */
  member_id: z.uuid(),
  quiet_event_id: z.uuid().optional(),
  exchange_id: z.uuid().optional(),
  /** A turn prompt's suggestion for her morning, which Ask opens with. */
  suggestion_id: z.uuid().optional(),
});
export type PushData = z.infer<typeof PushData>;

/** One story kept in the family book (`GET /v1/families/:familyId/book`, spec §10, ADR-39). */
export const ApiBookEntry = z.object({
  exchange_id: z.uuid(),
  member_id: z.uuid(),
  member_name: z.string(),
  asked_by: z.string().nullable(),
  /** The story ask she answered; null if its words are gone. */
  question: z.string().nullable(),
  /** The old photo she told about (an old-photo ask), read through the family's media route. */
  photo_ids: z.array(z.uuid()),
  kept_at: z.iso.datetime({ offset: true }),
  answers: z.array(
    z.object({
      kind: z.string(),
      /** Her words, or the transcript of her voice. */
      text: z.string().nullable(),
      /** Her voice note or photo, read through `GET /v1/families/:familyId/media/:id`. */
      media_id: z.uuid().nullable(),
      media_kind: z.enum(["audio", "image"]).nullable(),
      at: z.iso.datetime({ offset: true }),
    }),
  ),
});
export type ApiBookEntry = z.infer<typeof ApiBookEntry>;

/** A story ask set for a coming morning (spec A10: "this Sunday's question with who chose it"). */
export const ApiComingStory = z.object({
  exchange_id: z.uuid(),
  member_id: z.uuid(),
  member_name: z.string(),
  question: z.string().nullable(),
  /** Who chose it, or null when the asker has since been deleted. */
  asked_by: z.string().nullable(),
  date: LocalDate,
});
export type ApiComingStory = z.infer<typeof ApiComingStory>;

/** A recipe card she kept (spec §10, ADR-41), in her own words. */
export const ApiBookRecipe = z.object({
  id: z.uuid(),
  member_id: z.uuid(),
  member_name: z.string(),
  title: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  remarks: z.array(z.string()),
  kept_at: z.iso.datetime({ offset: true }),
});
export type ApiBookRecipe = z.infer<typeof ApiBookRecipe>;

export const ApiBook = z.object({
  entries: z.array(ApiBookEntry),
  /** Her kept recipe cards, newest first. */
  recipes: z.array(ApiBookRecipe),
  /** Story asks not yet delivered, soonest first. */
  coming: z.array(ApiComingStory),
});
export type ApiBook = z.infer<typeof ApiBook>;

/** An organiser takes a story out of the book: no body, the exchange is in the path. */
export const RemoveBookEntry = z.strictObject({});
export type RemoveBookEntry = z.infer<typeof RemoveBookEntry>;

export const ApiBookRemoved = z.object({ exchange_id: z.uuid(), removed: z.literal(true) });
export type ApiBookRemoved = z.infer<typeof ApiBookRemoved>;

/**
 * Something she said will happen on a known day (spec §12, build plan 5.3), offered to a family
 * member as a reminder to ask how it went. Nothing exists for the member until they tap.
 */
export const ApiReminderSuggestion = z.object({
  fact_id: z.uuid(),
  about_member_id: z.uuid(),
  about_name: z.string(),
  /** Her words for it, in the family's language: "lunch with Auntie Lin". */
  what: z.string(),
  on: LocalDate,
});
export type ApiReminderSuggestion = z.infer<typeof ApiReminderSuggestion>;

/** A reminder the member asked for: on `due_date`, ask her how `what` went. */
export const ApiReminder = z.object({
  id: z.uuid(),
  about_member_id: z.uuid(),
  about_name: z.string(),
  what: z.string(),
  due_date: LocalDate,
  done: z.boolean(),
});
export type ApiReminder = z.infer<typeof ApiReminder>;

export const ApiReminders = z.object({
  suggestions: z.array(ApiReminderSuggestion),
  reminders: z.array(ApiReminder),
});
export type ApiReminders = z.infer<typeof ApiReminders>;

/** "Remind me to ask": the fact the reminder is made from. */
export const CreateReminder = z.strictObject({ fact_id: z.uuid() });
export type CreateReminder = z.infer<typeof CreateReminder>;

/** "Done": no body, the reminder is in the path. */
export const FinishReminder = z.strictObject({});
export type FinishReminder = z.infer<typeof FinishReminder>;

export const ApiReminderDone = z.object({ id: z.uuid(), done: z.literal(true) });
export type ApiReminderDone = z.infer<typeof ApiReminderDone>;

/**
 * Away mode (spec §8): set by any member of her family. From `from` (her today or later) until
 * `until`, or until she is back (null). Arrivals continue; repeats and quiet notices stop.
 */
export const SetAway = z
  .strictObject({ from: LocalDate, until: LocalDate.nullable() })
  .refine((away) => away.until === null || away.until >= away.from, {
    message: "an away ends on or after its first day",
    path: ["until"],
  });
export type SetAway = z.infer<typeof SetAway>;

export const ApiAway = z.object({
  id: z.uuid(),
  member_id: z.uuid(),
  from: LocalDate,
  until: LocalDate.nullable(),
  ended: z.boolean(),
});
export type ApiAway = z.infer<typeof ApiAway>;

/** "She's back": no body, the away period is in the path. */
export const EndAway = z.strictObject({});
export type EndAway = z.infer<typeof EndAway>;

/** "She has died" (spec §19): no body, she is in the path. */
export const MarkDeceased = z.strictObject({});
export type MarkDeceased = z.infer<typeof MarkDeceased>;

export const ApiDeceased = z.object({ member_id: z.uuid(), status: z.literal("deceased") });
export type ApiDeceased = z.infer<typeof ApiDeceased>;

/** Withdraw an ask before her morning is prepared: no body, the ask is in the path. */
export const WithdrawAsk = z.strictObject({});
export type WithdrawAsk = z.infer<typeof WithdrawAsk>;

export const ApiWithdrawn = z.object({ id: z.uuid(), state: z.literal("withdrawn") });
export type ApiWithdrawn = z.infer<typeof ApiWithdrawn>;
