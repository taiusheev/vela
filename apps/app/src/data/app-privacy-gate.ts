export type PrivacyGateDecision = "pass" | "loading" | "unavailable" | "ask" | "save";

/** One permission decision: a pending/error account read is never a new request for consent. */
export function privacyGateDecision(input: {
  enabled: boolean;
  accepted?: boolean;
  loading: boolean;
  missing: boolean;
  failed: boolean;
  localAccepted: boolean;
}): PrivacyGateDecision {
  if (!input.enabled || input.accepted === true) return "pass";
  if (input.loading) return "loading";
  if (input.failed && !input.missing) return "unavailable";
  if (input.localAccepted) return input.missing ? "pass" : "save";
  return "ask";
}
