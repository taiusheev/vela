import { describe, expect, it } from "vitest";
import { portraitInitials, portraitLightOn } from "./portrait-lamp.ts";
import type { TodayLight } from "./today.ts";

const light: TodayLight = {
  memberId: "parent",
  displayName: "Mom",
  state: "resting",
  stateText: "No word yet today",
};
describe("portrait answer light", () => {
  it("uses answer evidence, including an answer during away or pause, without interpreting a quiet notice as an answer", () => {
    for (const state of ["resting", "quiet", "away", "paused"] as const)
      expect(portraitLightOn({ ...light, state })).toBe(false);
    expect(portraitLightOn({ ...light, state: "lit" })).toBe(true);
    expect(portraitLightOn({ ...light, state: "away", answerReceived: true })).toBe(true);
    expect(portraitLightOn({ ...light, state: "paused", answerReceived: true })).toBe(true);
  });
  it("makes a real-name placeholder without assigning a stock person to a family", () => {
    expect(portraitInitials("  Lin Chen  ")).toBe("LC");
    expect(portraitInitials("媽媽")).toBe("媽");
    expect(portraitInitials("")).toBe("");
  });
});
