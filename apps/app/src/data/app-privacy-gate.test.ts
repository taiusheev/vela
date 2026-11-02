import { describe, expect, it } from "vitest";
import { privacyGateDecision } from "./app-privacy-gate.ts";

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
