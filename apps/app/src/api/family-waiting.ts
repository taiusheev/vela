import { ApiError } from "./client.ts";

/**
 * The closed test's answer to an organiser whose new family the founder has not approved yet
 * (ADR-52): a 403 whose details say `family_waiting`. Everything else stays an ordinary error.
 */
export function isFamilyWaiting(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const details = error.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "reason" in details &&
    details.reason === "family_waiting"
  );
}

/** How often the waiting screen looks again on its own, so approval opens the app by itself. */
export const FAMILY_WAITING_RECHECK_MS = 30_000;
