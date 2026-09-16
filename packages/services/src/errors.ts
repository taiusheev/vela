/**
 * Expected domain failures as a typed error (code design §2). A code names what went wrong so the
 * worker and the tests can branch on it; the message is for logs and never carries family words.
 */

export const VELA_ERROR_CODES = [
  /** A row the flow needs does not exist: a member, an exchange, an outbound row. */
  "not_found",
  /** A request that cannot be a valid platform message: a programming error in the caller. */
  "invalid_outbound",
  /** A stored payload that no longer parses, so the row cannot be sent as recorded. */
  "invalid_payload",
  /** The member has no link on the channel the message must go through. */
  "no_channel_link",
  /** The data is in a state the flow does not allow, such as a family already linked to a group. */
  "illegal_state",
] as const;
export type VelaErrorCode = (typeof VELA_ERROR_CODES)[number];

export class VelaError extends Error {
  override readonly name = "VelaError";
  readonly code: VelaErrorCode;

  constructor(code: VelaErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.code = code;
  }
}

/** A failed query wraps the driver's error once; three levels reach past any wrapper seen so far. */
const CAUSE_DEPTH = 3;

/** An error code is an identifier (`unavailable`, `not_found`, SQLSTATE `40001`), never prose. */
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

function codeOf(error: Error): string | null {
  const code: unknown = "code" in error ? error.code : undefined;
  if (typeof code === "number" && Number.isInteger(code)) {
    return String(code);
  }
  return typeof code === "string" && ERROR_CODE.test(code) ? code : null;
}

/**
 * A caught error as a log field (code design §2): the class name of the error and of each cause,
 * each with its code when it carries one. Never a message: Drizzle's failed-query message lists the
 * query's parameters, which hold what the family wrote, and a platform's description may repeat
 * what was sent. The message stays on the thrown error, which the caller rethrows or drops.
 */
export function errorLabel(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const code = codeOf(current);
    parts.push(code === null ? current.name : `${current.name}:${code}`);
    current = current.cause;
  }
  return parts.length === 0 ? "unknown" : parts.join(" <- ");
}
