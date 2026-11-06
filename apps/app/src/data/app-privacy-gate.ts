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

/** The steps after a family is saved, where setup goes on while the founder checks it (ADR-52). */
const AFTER_SAVE = ["save", "invite", "ready"];

/**
 * Whether a family still waiting for approval may see this screen. Only setup's own last steps,
 * on the onboarding screen itself: every other screen needs an approved family and would sit
 * there unable to load or send, so it gets the waiting page instead.
 */
export function waitingMayContinue(input: {
  step: string;
  saved: boolean;
  onOnboarding: boolean;
}): boolean {
  return input.onOnboarding && input.saved && AFTER_SAVE.includes(input.step);
}

/** Whether the waiting page offers the way back to the invitation still open in this session. */
export function waitingCanReturn(input: { step: string; saved: boolean }): boolean {
  return input.saved && AFTER_SAVE.includes(input.step) && input.step !== "save";
}
