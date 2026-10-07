import { describe, expect, it } from "vitest";
import { askRecipient, canAsk } from "./ask-target.ts";
import type { TodayLight } from "./today.ts";

const mom: TodayLight = {
  memberId: "mom",
  displayName: "Mom",
  state: "paused",
  stateText: "paused",
};
const dad: TodayLight = {
  memberId: "dad",
  displayName: "Dad",
  state: "lit",
  stateText: "answered",
};

describe("whose morning an ask belongs to", () => {
  it("keeps an explicitly requested paused parent instead of sending their words to another", () => {
    expect(askRecipient([mom, dad], "mom")).toBe(mom);
    expect(canAsk(mom)).toBe(false);
  });
  it("does not substitute another parent for an unknown requested recipient", () => {
    expect(askRecipient([mom, dad], "another-family-member")).toBeUndefined();
  });
  it("defaults to the first parent who can receive an ask, skipping pending consent", () => {
    expect(askRecipient([{ ...mom, state: "resting", invited: true }, dad])).toBe(dad);
    expect(askRecipient([mom, dad])).toBe(dad);
  });
});
