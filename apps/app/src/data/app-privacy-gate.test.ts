import { describe, expect, it } from "vitest";
import { privacyGateDecision, waitingCanReturn, waitingMayContinue } from "./app-privacy-gate.ts";

const known = {
  enabled: true,
  accepted: false,
  loading: false,
  missing: false,
  failed: false,
  localAccepted: false,
};
describe("one app permission decision", () => {
  it("does not flash another consent request while fetching an accepted account", () => {
    expect(privacyGateDecision({ ...known, loading: true })).toBe("loading");
    expect(privacyGateDecision({ ...known, accepted: true })).toBe("pass");
    expect(privacyGateDecision({ ...known, accepted: true, loading: true })).toBe("pass");
  });
  it("saves the same onboarding agreement for the intended signed-in existing account without asking twice", () => {
    expect(privacyGateDecision({ ...known, localAccepted: true })).toBe("save");
    expect(privacyGateDecision({ ...known, localAccepted: true, accepted: true })).toBe("pass");
  });
  it("lets a new account provision its already accepted agreement together with its name", () => {
    expect(
      privacyGateDecision({ ...known, localAccepted: true, missing: true, failed: true }),
    ).toBe("pass");
    expect(privacyGateDecision({ ...known, missing: true, failed: true })).toBe("ask");
  });
  it("does not turn an outage into another consent request or bypass consent on a different account", () => {
    expect(privacyGateDecision({ ...known, failed: true })).toBe("unavailable");
    expect(privacyGateDecision(known)).toBe("ask");
    expect(privacyGateDecision({ ...known, enabled: false })).toBe("pass");
  });
  it("keeps only an explicitly accepted, previously confirmed new-account setup open during refresh", () => {
    expect(
      privacyGateDecision({ ...known, loading: true, knownMissing: true, localAccepted: true }),
    ).toBe("pass");
    expect(privacyGateDecision({ ...known, loading: true, knownMissing: true })).toBe("loading");
    expect(privacyGateDecision({ ...known, loading: true, localAccepted: true })).toBe("loading");
    expect(
      privacyGateDecision({ ...known, failed: true, knownMissing: true, localAccepted: true }),
    ).toBe("unavailable");
    expect(privacyGateDecision({ ...known, knownMissing: true, localAccepted: true })).toBe("save");
  });
});

describe("a waiting family", () => {
  it("continues only setup's last steps, and only on the onboarding screen", () => {
    expect(waitingMayContinue({ step: "invite", saved: true, onOnboarding: true })).toBe(true);
    expect(waitingMayContinue({ step: "ready", saved: true, onOnboarding: true })).toBe(true);
    expect(waitingMayContinue({ step: "invite", saved: true, onOnboarding: false })).toBe(false);
    expect(waitingMayContinue({ step: "invite", saved: false, onOnboarding: true })).toBe(false);
    expect(waitingMayContinue({ step: "welcome", saved: true, onOnboarding: true })).toBe(false);
  });

  it("goes back to an invitation still open in this session, never to an unsaved setup", () => {
    expect(waitingCanReturn({ step: "invite", saved: true })).toBe(true);
    expect(waitingCanReturn({ step: "ready", saved: true })).toBe(true);
    expect(waitingCanReturn({ step: "save", saved: true })).toBe(false);
    expect(waitingCanReturn({ step: "invite", saved: false })).toBe(false);
  });
});
