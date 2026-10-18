import { describe, expect, it } from "vitest";
import {
  clerkErrorCodes,
  preferredCodeFactor,
  resendDelay,
  unknownIdentity,
  validEmail,
  validVerificationCode,
  verificationCode,
  verificationFailure,
} from "./code.ts";

describe("sign-in recovery", () => {
  it("accepts a spaced paste but never turns a wrong or overlong code into a valid one", () => {
    expect(validVerificationCode(verificationCode(" 123 456\n"))).toBe(true);
    for (const value of ["12345", "1234567", "123a56", "１２３４５６", "123-456"])
      expect(validVerificationCode(verificationCode(value))).toBe(false);
  });
  it("allows another send only once the cooldown has elapsed, including on foreground return", () => {
    expect(resendDelay(1000, 1000)).toBe(30);
    expect(resendDelay(1000, 30_999)).toBe(1);
    expect(resendDelay(1000, 31_000)).toBe(0);
    expect(resendDelay(1000, 100_000)).toBe(0);
  });
  it("preserves the actual delivery factor and prefers the requested channel", () => {
    const phone = { strategy: "phone_code", phoneNumberId: "p", safeIdentifier: "+***1234" };
    const email = {
      strategy: "email_code",
      emailAddressId: "e",
      safeIdentifier: "a***@example.test",
    };
    expect(preferredCodeFactor([phone, email], "email")).toBe(email);
    expect(preferredCodeFactor([email, phone], "phone")).toBe(phone);
    expect(preferredCodeFactor([email], "phone")).toBe(email);
    expect(preferredCodeFactor([{ strategy: "password" }], "email")).toBeUndefined();
  });
  it("does not create an account for outages, timeouts, or refused logins", () => {
    expect(unknownIdentity({ errors: [{ code: "form_identifier_not_found" }] })).toBe(true);
    for (const error of [
      null,
      new Error("timeout"),
      { errors: [{ code: "session_exists" }] },
      { errors: [{ code: "form_identifier_invalid" }] },
      { errors: [null] },
    ])
      expect(unknownIdentity(error)).toBe(false);
  });
});

describe("registration input and recovery", () => {
  it("accepts a trimmed email and rejects common mistakes before sending", () => {
    expect(validEmail(" mia@example.test ")).toBe(true);
    for (const email of ["mia", "mia@", "mia @example.test", "mia@@example.test", "mia@example"])
      expect(validEmail(email)).toBe(false);
  });
  it("does not blame a correct code for network errors or expired and rate-limited attempts", () => {
    expect(verificationFailure(new TypeError("network unavailable"))).toBe("network");
    expect(verificationFailure({ errors: [{ code: "verification_expired" }] })).toBe("expired");
    expect(verificationFailure({ errors: [{ code: "too_many_requests" }] })).toBe("rate_limited");
    expect(verificationFailure({ errors: [{ code: "form_code_incorrect" }] })).toBe("wrong_code");
    expect(verificationFailure({ errors: [null] })).toBe("wrong_code");
  });
});

it("keeps support codes bounded and excludes malformed entries and private provider messages", () => {
  expect(
    clerkErrorCodes({
      errors: [
        null,
        { code: "form_code_incorrect" },
        { code: "mia@example.test" },
        { code: "x".repeat(100) },
        { message: "private" },
      ],
    }),
  ).toEqual(["form_code_incorrect"]);
});
