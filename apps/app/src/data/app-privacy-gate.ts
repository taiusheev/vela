export type PrivacyGateDecision = "pass" | "loading" | "unavailable" | "ask" | "save";

/** One permission decision: a pending/error account read is never a new request for consent. */
export function privacyGateDecision(input: {
  enabled: boolean;
  accepted?: boolean;
  loading: boolean;
  missing: boolean;
  failed: boolean;
  localAccepted: boolean;
  knownMissing?: boolean;
}): PrivacyGateDecision {
  if (!input.enabled || input.accepted === true) return "pass";
  // A confirmed new account may keep setting up while its own save refreshes /me in the
  // background. Only its explicit local agreement permits this; resolved server failures still
  // stop the gate below, and a new session has no remembered missing-account result.
  if (input.loading) return input.knownMissing === true && input.localAccepted ? "pass" : "loading";
  if (input.failed && !input.missing) return "unavailable";
  if (input.localAccepted) return input.missing ? "pass" : "save";
  return "ask";
}
