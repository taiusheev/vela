/**
 * Button payloads (`Button.id`, returned as `InboundEvent.buttonData`). Telegram allows 1–64 bytes
 * of callback data, and a tap's payload arrives from the client, so decoding treats it as untrusted.
 *
 * Wire format: `<code>:<head>:<tail>`, ASCII only.
 *
 * | Action       | Payload                                   |
 * |--------------|-------------------------------------------|
 * | answer       | `a:<id>:f` (fine) · `a:<id>:h` (heart)    |
 * | chip         | `c:<id>:<index>`                          |
 * | pick         | `p:<id>:<index>`                          |
 * | vote         | `v:<id>:<index>`                          |
 * | consent      | `k:<id>:y` · `k:<id>:n`                   |
 * | health_words | `h:<id>:y` · `h:<id>:n`                   |
 * | quiet_fine   | `q:<id>:f`                                |
 * | quiet_wait   | `q:<id>:w`                                |
 * | onboarding   | `o:<step>:<value>`                        |
 * | notice_read  | `n:<id>:r`                                |
 *
 * `<id>` is the uuid as 32 lowercase hex digits without dashes, so an id-bearing payload is 36 bytes.
 * Every payload has exactly one encoding and `decodeButton` accepts only that encoding, so a decoded
 * action always re-encodes to the bytes that were tapped.
 */

export type ButtonAction =
  | { type: "answer"; exchangeId: string; answer: "fine" | "heart" }
  | { type: "chip"; exchangeId: string; index: number }
  | { type: "pick"; exchangeId: string; index: number }
  | { type: "vote"; exchangeId: string; index: number }
  | { type: "consent"; memberId: string; accept: boolean }
  /** Her answer to the separate health-words question sent after her yes (flows §3.2). */
  | { type: "health_words"; memberId: string; accept: boolean }
  | { type: "quiet_fine"; quietEventId: string }
  | { type: "quiet_wait"; quietEventId: string }
  | { type: "onboarding"; step: string; value: string }
  /**
   * "I've read it" under Vela's first group message, tapped by each adult in the group; the id is
   * the `family_channels` row the message was posted for (flows §3.3).
   */
  | { type: "notice_read"; familyChannelId: string };

export const BUTTON_DATA_MAX_BYTES = 64;

/**
 * Indexes are one digit. An arrival shows at most three chips, two photos, and as many vote options
 * as fit the message's button rows, all well under ten.
 */
export const MAX_BUTTON_INDEX = 9;

/** Onboarding steps are short snake_case names such as `language` or `wake`. */
const ONBOARDING_STEP = /^[a-z][a-z0-9_]{0,15}$/;
/**
 * Onboarding values are codes, not labels: `zh-TW`, `TW`, `America/Argentina/Buenos_Aires`, `07:30`.
 * With the longest step the payload is exactly 64 bytes.
 */
const ONBOARDING_VALUE = /^[A-Za-z0-9_+\-./:]{1,45}$/;

/** RFC 9562 uuids of versions 1–8, the shape Postgres `uuidv7()` and Zod's `z.uuid()` produce. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPACT_UUID = /^[0-9a-f]{12}[1-8][0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const INDEX = /^[0-9]$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function compactId(id: string, field: string): string {
  if (!isUuid(id)) {
    throw new RangeError(`button ${field} must be a uuid: ${id}`);
  }
  return id.replaceAll("-", "").toLowerCase();
}

function expandId(compact: string): string | null {
  if (!COMPACT_UUID.test(compact)) {
    return null;
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function indexField(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > MAX_BUTTON_INDEX) {
    throw new RangeError(`button index must be an integer from 0 to ${MAX_BUTTON_INDEX}: ${index}`);
  }
  return String(index);
}

/** Throws `RangeError` for an action that cannot be a valid payload; that is a programming error. */
export function encodeButton(action: ButtonAction): string {
  switch (action.type) {
    case "answer":
      return `a:${compactId(action.exchangeId, "exchangeId")}:${action.answer === "fine" ? "f" : "h"}`;
    case "chip":
      return `c:${compactId(action.exchangeId, "exchangeId")}:${indexField(action.index)}`;
    case "pick":
      return `p:${compactId(action.exchangeId, "exchangeId")}:${indexField(action.index)}`;
    case "vote":
      return `v:${compactId(action.exchangeId, "exchangeId")}:${indexField(action.index)}`;
    case "consent":
      return `k:${compactId(action.memberId, "memberId")}:${action.accept ? "y" : "n"}`;
    case "health_words":
      return `h:${compactId(action.memberId, "memberId")}:${action.accept ? "y" : "n"}`;
    case "quiet_fine":
      return `q:${compactId(action.quietEventId, "quietEventId")}:f`;
    case "quiet_wait":
      return `q:${compactId(action.quietEventId, "quietEventId")}:w`;
    case "onboarding":
      if (!ONBOARDING_STEP.test(action.step)) {
        throw new RangeError(
          `onboarding button step is not a short snake_case name: ${action.step}`,
        );
      }
      if (!ONBOARDING_VALUE.test(action.value)) {
        throw new RangeError(`onboarding button value is not a short code: ${action.value}`);
      }
      return `o:${action.step}:${action.value}`;
    case "notice_read":
      return `n:${compactId(action.familyChannelId, "familyChannelId")}:r`;
  }
}

/** The action a payload names, or `null` for anything that is not exactly a payload we encode. */
export function decodeButton(data: string): ButtonAction | null {
  // Every valid payload is ASCII, where characters and bytes coincide; a longer string cannot be
  // valid, and non-ASCII characters are refused by the patterns below.
  if (data.length > BUTTON_DATA_MAX_BYTES) {
    return null;
  }
  const first = data.indexOf(":");
  const second = data.indexOf(":", first + 1);
  if (first === -1 || second === -1) {
    return null;
  }
  const code = data.slice(0, first);
  const head = data.slice(first + 1, second);
  const tail = data.slice(second + 1);

  if (code === "o") {
    return ONBOARDING_STEP.test(head) && ONBOARDING_VALUE.test(tail)
      ? { type: "onboarding", step: head, value: tail }
      : null;
  }

  const id = expandId(head);
  if (id === null) {
    return null;
  }
  switch (code) {
    case "a":
      if (tail === "f") return { type: "answer", exchangeId: id, answer: "fine" };
      if (tail === "h") return { type: "answer", exchangeId: id, answer: "heart" };
      return null;
    case "c":
    case "p":
    case "v": {
      if (!INDEX.test(tail)) {
        return null;
      }
      const index = Number(tail);
      if (code === "c") return { type: "chip", exchangeId: id, index };
      if (code === "p") return { type: "pick", exchangeId: id, index };
      return { type: "vote", exchangeId: id, index };
    }
    case "k":
      if (tail === "y") return { type: "consent", memberId: id, accept: true };
      if (tail === "n") return { type: "consent", memberId: id, accept: false };
      return null;
    case "h":
      if (tail === "y") return { type: "health_words", memberId: id, accept: true };
      if (tail === "n") return { type: "health_words", memberId: id, accept: false };
      return null;
    case "n":
      return tail === "r" ? { type: "notice_read", familyChannelId: id } : null;
    case "q":
      if (tail === "f") return { type: "quiet_fine", quietEventId: id };
      if (tail === "w") return { type: "quiet_wait", quietEventId: id };
      return null;
    default:
      return null;
  }
}
