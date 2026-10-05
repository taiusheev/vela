import { afterEach, describe, expect, it, vi } from "vitest";
import { callingNumber } from "./calling-number.ts";
import { demoDataAllowed, sessionScope } from "./live-state.ts";
import { countries } from "./onboarding.ts";

vi.mock("@lingui/core/macro", () => ({
  msg: (message: TemplateStringsArray | { message: string }) => ({
    message: Array.isArray(message) ? message.join("") : (message as { message: string }).message,
  }),
}));

describe("live session boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("requires an explicit demo flag even during development", () => {
    vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "");
    vi.stubGlobal("__DEV__", true);
    expect(demoDataAllowed(false, false)).toBe(false);
    vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "true");
    expect(demoDataAllowed(false, false)).toBe(true);
    vi.unstubAllGlobals();
  });
  it("examples require both backend and account configuration to be absent", () => {
    expect(demoDataAllowed(false, false, true)).toBe(true);
    expect(demoDataAllowed(false, false, false)).toBe(false);
    expect(demoDataAllowed(true, false, true)).toBe(false);
    expect(demoDataAllowed(false, true, true)).toBe(false);
    expect(demoDataAllowed(true, true, true)).toBe(false);
  });
  it("isolates a different account and a renewed session even on the same phone", () => {
    const account = { ready: true, signedIn: true, userId: "a", sessionId: "one" };
    expect(sessionScope(account)).not.toBe(sessionScope({ ...account, userId: "b" }));
    expect(sessionScope(account)).not.toBe(sessionScope({ ...account, sessionId: "two" }));
    expect(sessionScope({ ...account, ready: false })).toBe("loading");
  });
});

it("offers Vietnam with the correct morning zone", () => {
  expect(countries.find((country) => country.code === "VN")?.zones[0]?.zone).toBe(
    "Asia/Ho_Chi_Minh",
  );
});

describe("optional direct calling", () => {
  it("accepts international numbers but rejects empty, local-only or dial-injection values", () => {
    expect(callingNumber("+84 (90) 123-4567")).toBe("+84901234567");
    expect(callingNumber("+886 912 345 678")).toBe("+886912345678");
    for (const invalid of [
      "",
      "tel:",
      "0901234567",
      "+084901234567",
      "+84901234567;123",
      "+84901234567#",
      "+1234567890123456",
    ])
      expect(callingNumber(invalid)).toBeNull();
  });
});
