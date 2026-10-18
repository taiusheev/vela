import type { InboundEvent } from "@vela/contracts";
import type { Answer } from "@vela/db";

const MESSAGE_KINDS = new Set(["text", "voice", "photo", "sticker"]);

type TimedAnswer = Pick<
  Answer,
  "id" | "payload" | "receivedAt" | "channel" | "externalId" | "kind"
>;

/** Preserve sender chronology without changing the receipt used for consent, quiet and retention. */
export function answerSourceTime(
  event: Pick<InboundEvent, "at">,
  receivedAt: Date,
): Record<string, string> {
  const at = Date.parse(event.at);
  return Number.isFinite(at) && at < receivedAt.getTime()
    ? { source_at: new Date(at).toISOString() }
    : {};
}

/** Old rows and malformed or future metadata retain their original receipt-time behavior. */
export function answerMessageTime(answer: Pick<Answer, "payload" | "receivedAt">): Date {
  const source = answer.payload.source_at;
  const at =
    typeof source === "string" && /^\d{4}-\d{2}-\d{2}T/.test(source) ? Date.parse(source) : NaN;
  return Number.isFinite(at) && at <= answer.receivedAt.getTime()
    ? new Date(at)
    : answer.receivedAt;
}

export function compareAnswerMessages(a: TimedAnswer, b: TimedAnswer): number {
  const time = answerMessageTime(a).getTime() - answerMessageTime(b).getTime();
  if (time !== 0) return time;
  // Telegram message dates have second precision; message ids order ordinary messages in a chat.
  // Button answers refer to the arrival's id, so their ids cannot order a later tap.
  if (
    a.channel === "telegram" &&
    b.channel === "telegram" &&
    MESSAGE_KINDS.has(a.kind) &&
    MESSAGE_KINDS.has(b.kind)
  ) {
    const left = a.externalId?.match(/:(\d{1,30})$/)?.[1];
    const right = b.externalId?.match(/:(\d{1,30})$/)?.[1];
    if (left !== undefined && right !== undefined) {
      const first = BigInt(left),
        second = BigInt(right);
      if (first !== second) return first < second ? -1 : 1;
    }
  }
  return a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id);
}
