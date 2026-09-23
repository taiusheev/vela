/**
 * Append-only product and operational events (spec §18). Events carry kinds, types, durations,
 * and outcomes: never message content, transcripts, or names.
 */
import { z } from "zod";

export const EVENT_NAMES = [
  // lifecycle
  "family_created",
  "member_joined",
  "account_linked",
  "invite_accepted",
  /** The founder created a new invite for a family on the admin page (`create_invite`). */
  "invite_created",
  "consent_given",
  "consent_declined",
  "stop_said",
  "start_said",
  /** A member became `left`: they left the family group, or the founder marked them left. */
  "member_left",
  /** An organiser or the kept-light member left the family group; their membership is unchanged. */
  "member_left_group",
  "member_marked_deceased",
  "family_deletion_requested",
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
  "nearby_contact_added",
  "nearby_contact_removed",
  "weekly_read_drafted",
  "weekly_read_sent",
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
  /** The founder opened a family's records on the admin page (`admin_access_log` action `view`). */
  "admin_page_opened",
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
