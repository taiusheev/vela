/**
 * Append-only product and operational events (spec §18). Events carry kinds, types, durations,
 * and outcomes: never message content, transcripts, or names.
 */
import { z } from "zod";

export const EVENT_NAMES = [
  // lifecycle
  "family_created",
  "member_joined",
  "invite_accepted",
  "consent_given",
  "consent_declined",
  "stop_said",
  "start_said",
  "member_marked_deceased",
  // the exchange
  "ask_composed",
  "ask_withdrawn",
  "exchange_prepared",
  "arrival_delivered",
  "arrival_delivery_failed",
  "arrival_seen",
  "answer_recorded",
  "reply_posted",
  "readback_delivered",
  "readback_played",
  "repeat_sent",
  "turn_prompt_sent",
  // the light
  "quiet_notice_sent",
  "quiet_notice_resolved",
  "ask_to_check_sent",
  "away_set",
  "away_ended",
  "flag_raised",
  "weekly_read_drafted",
  "weekly_read_opened",
  "story_saved",
  // plans
  "trial_started",
  "plan_started",
  "plan_lapsed",
  // operations
  "scheduler_missed",
  "scheduler_tick",
  "gateway_dropped",
  "retention_deleted",
] as const;
export const EventName = z.enum(EVENT_NAMES);
export type EventName = z.infer<typeof EventName>;

const PropValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

export const DomainEvent = z.object({
  name: EventName,
  familyId: z.uuid().optional(),
  memberId: z.uuid().optional(),
  exchangeId: z.uuid().optional(),
  surface: z.string().optional(),
  /** Flat, content-free properties. */
  props: z.record(z.string(), PropValue).default({}),
});
export type DomainEvent = z.input<typeof DomainEvent>;
