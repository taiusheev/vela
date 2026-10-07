import { describe, expect, it } from "vitest";
import {
  preferredCodeFactor,
  resendDelay,
  unknownIdentity,
  validVerificationCode,
  verificationCode,
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
