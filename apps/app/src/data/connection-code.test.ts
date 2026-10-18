import { describe, expect, it } from "vitest";
import { connectionCode } from "./connection-code.ts";

describe("pasting a Telegram connection code", () => {
  it("removes copied spacing without changing the case-sensitive characters", () => {
    expect(connectionCode(" \nAbC_def-123\u00a0GhiJKL456789\n")).toBe("AbC_def-123GhiJKL456789");
  });
  it("takes the code out of the bot's whole message, as Telegram's Copy pastes it", () => {
    expect(
      connectionCode(
        "Enter this code in Vela to connect your Telegram account: Xy7_kP-2mQ9rT4vW1zA8bC\nKeep it private; it expires soon.",
      ),
    ).toBe("Xy7_kP-2mQ9rT4vW1zA8bC");
    expect(
      connectionCode(
        "請在 Vela 輸入這個代碼，連結您的 Telegram 帳號：Xy7_kP-2mQ9rT4vW1zA8bC\n請保密。",
      ),
    ).toBe("Xy7_kP-2mQ9rT4vW1zA8bC");
  });
  it("does not truncate an invalid longer code into a valid-looking one", () => {
    const long = "a".repeat(30);
    expect(connectionCode(long)).toBe(long);
  });
});

it("never guesses between two different codes or cuts a longer token into one", () => {
  expect(connectionCode(`First Xy7_kP-2mQ9rT4vW1zA8bC second ${"Z".repeat(22)}`)).not.toBe(
    "Xy7_kP-2mQ9rT4vW1zA8bC",
  );
  expect(connectionCode("Xy7_kP-2mQ9rT4vW1zA8bCextra")).toHaveLength(27);
});
