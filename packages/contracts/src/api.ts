import { z } from "zod";
import {
  AnswerKind,
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
});
export type ApiTodayExchange = z.infer<typeof ApiTodayExchange>;

export const ApiTomorrowTurn = z.object({
  local_day: LocalDate,
  recipient_id: z.uuid(),
  recipient_name: z.string(),
  /** Null when nobody holds turns, or the holder has left. */
  holder_id: z.uuid().nullable(),
  holder_name: z.string().nullable(),
  suggestion: z.object({ id: z.uuid(), text: z.string() }).nullable(),
});
export type ApiTomorrowTurn = z.infer<typeof ApiTomorrowTurn>;

export const ApiToday = z.object({
  lights: z.array(MemberLight),
  exchanges: z.array(ApiTodayExchange),
  tomorrow: z.array(ApiTomorrowTurn),
});
export type ApiToday = z.infer<typeof ApiToday>;
