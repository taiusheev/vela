/**
 * Idempotency keys for outbound rows (`outbound.idempotency_key`, unique). The gateway inserts with
 * `ON CONFLICT DO NOTHING`, so a key must name one intended message: the same message computed twice
 * (a replayed tick, a redelivered webhook) gets the same key, and two messages that must both go
 * out get different keys.
 *
 * Format: `<kind>:<part>:<part>[:<suffix>]`, with the parts each kind needs in a fixed order. Ids are
 * lower-cased uuids, dates are `YYYY-MM-DD`, and free text (conversation ids, suffixes) is
 * percent-encoded, so no part can contain the separator and the key splits back into its parts.
 */
import { LocalDate, type OutboundKind } from "@vela/contracts";
import { isUuid } from "./buttons.ts";

export interface OutboundKeyParts {
  memberId?: string;
  date?: LocalDate;
  exchangeId?: string;
  quietEventId?: string;
  conversationId?: string;
  suffix?: string;
}

type IdentifyingPart = Exclude<keyof OutboundKeyParts, "suffix">;

interface KeyShape {
  readonly parts: readonly IdentifyingPart[];
  /**
   * `none`: the parts alone name the message, and a suffix would let a second copy through.
   * `required`: several messages legitimately share the parts, and the suffix tells them apart.
   */
  readonly suffix: "none" | "required";
}

/**
 * What identifies one message of each kind. Parts a kind does not list are ignored, so a caller can
 * pass the whole row context.
 */
export const OUTBOUND_KEY_SHAPES: Readonly<Record<OutboundKind, KeyShape>> = {
  /** Her morning: member and her local date. */
  arrival: { parts: ["memberId", "date"], suffix: "none" },
  repeat: { parts: ["memberId", "date"], suffix: "none" },
  /** The evening prompt: the kept-light member the turn is with, and the date the turn is for. */
  turn_prompt: { parts: ["memberId", "date"], suffix: "none" },
  answer_receipt: { parts: ["exchangeId"], suffix: "none" },
  answer_post: { parts: ["exchangeId"], suffix: "none" },
  /** Per quiet event and organiser; the suffix is the notification round, so "wait" re-notifies. */
  quiet_notice: { parts: ["quietEventId", "memberId"], suffix: "required" },
  /** Per quiet event and each member who was told. */
  quiet_resolved: { parts: ["quietEventId", "memberId"], suffix: "none" },
  /** Whose week (the kept-light member), the week's last date, and the reader's conversation. */
  weekly_read: { parts: ["memberId", "date", "conversationId"], suffix: "none" },
  ack: { parts: ["memberId", "date"], suffix: "none" },
  /** Per quiet event and the nearby contact's conversation (architecture §5). */
  nearby_ask: { parts: ["quietEventId", "conversationId"], suffix: "none" },
  /** Per exchange and reader; the suffix is the flagged answer, as one exchange can take several. */
  flag: { parts: ["exchangeId", "conversationId"], suffix: "required" },
  /** Replies to a person's action; the suffix is the inbound event (and step) that caused them. */
  consent: { parts: ["conversationId"], suffix: "required" },
  onboarding: { parts: ["conversationId"], suffix: "required" },
  system: { parts: ["conversationId"], suffix: "required" },
};

/** `OutboundMessage.idempotencyKey` allows at most 200 characters. */
export const OUTBOUND_KEY_MAX_LENGTH = 200;

function partValue(kind: OutboundKind, name: IdentifyingPart, parts: OutboundKeyParts): string {
  const value = parts[name];
  if (value === undefined) {
    throw new RangeError(`outbound key for ${kind} needs ${name}`);
  }
  switch (name) {
    case "memberId":
    case "exchangeId":
    case "quietEventId":
      if (!isUuid(value)) {
        throw new RangeError(`outbound key for ${kind}: ${name} must be a uuid: ${value}`);
      }
      return value.toLowerCase();
    case "date":
      if (!LocalDate.safeParse(value).success) {
        throw new RangeError(`outbound key for ${kind}: date must be a YYYY-MM-DD date: ${value}`);
      }
      return value;
    case "conversationId":
      if (value.length === 0) {
        throw new RangeError(`outbound key for ${kind}: conversationId must not be empty`);
      }
      return encodeURIComponent(value);
  }
}

/** Throws `RangeError` when a required part is missing or malformed, or the key would be too long. */
export function outboundKey(kind: OutboundKind, parts: OutboundKeyParts): string {
  if (!Object.hasOwn(OUTBOUND_KEY_SHAPES, kind)) {
    throw new RangeError(`unknown outbound kind: ${kind}`);
  }
  const shape = OUTBOUND_KEY_SHAPES[kind];
  const segments: string[] = [kind];
  for (const name of shape.parts) {
    segments.push(partValue(kind, name, parts));
  }
  if (shape.suffix === "required") {
    if (parts.suffix === undefined || parts.suffix.length === 0) {
      throw new RangeError(`outbound key for ${kind} needs a suffix`);
    }
    segments.push(encodeURIComponent(parts.suffix));
  } else if (parts.suffix !== undefined) {
    throw new RangeError(`outbound key for ${kind} takes no suffix: its parts name one message`);
  }
  const key = segments.join(":");
  if (key.length > OUTBOUND_KEY_MAX_LENGTH) {
    throw new RangeError(`outbound key for ${kind} is longer than ${OUTBOUND_KEY_MAX_LENGTH}`);
  }
  return key;
}
