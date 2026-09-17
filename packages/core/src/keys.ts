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
 * What identifies one message of each kind. Parts a kind does not list are ignored. The parts name
 * the message, which is not always the outbound row's own member and date: build them from what each
 * kind's comment says, never by copying the row.
 */
export const OUTBOUND_KEY_SHAPES: Readonly<Record<OutboundKind, KeyShape>> = {
  /** Her morning: member and her local date. */
  arrival: { parts: ["memberId", "date"], suffix: "none" },
  repeat: { parts: ["memberId", "date"], suffix: "none" },
  /**
   * The evening prompt: the kept-light member the turn is with (not the holder the row is addressed
   * to) and the date the turn is for (not the holder's today). The holder can change between two
   * computations of the same prompt, and a key built from the holder would let a second prompt out.
   */
  turn_prompt: { parts: ["memberId", "date"], suffix: "none" },
  answer_receipt: { parts: ["exchangeId"], suffix: "none" },
  /**
   * Per exchange; the suffix is the answer posted, as one exchange can take several (a heart, then a
   * voice story) and each is posted to the group.
   */
  answer_post: { parts: ["exchangeId"], suffix: "required" },
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
  /**
   * Replies to a person's action; the suffix is the inbound event (and step) that caused them. The
   * health-words question is the exception: its suffix is `health_words:<member id>`, so it is asked
   * once per member whichever tap or retry enqueues it (flows §3.2).
   */
  consent: { parts: ["conversationId"], suffix: "required" },
  onboarding: { parts: ["conversationId"], suffix: "required" },
  /**
   * The suffix names what the message is about: the inbound event, or a row such as an answer or an
   * invite (`invite:<invite id>` for the link `create_invite` sends the organiser, flows §3.17).
   */
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
