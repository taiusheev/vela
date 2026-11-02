import { describe, expect, it, vi } from "vitest";
import type { TodayLight } from "../data/today.ts";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray) => strings.join(""),
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const { widgetSnapshot, writeWidget } = await import("./widget.ts");

const light = (over: Partial<TodayLight>): TodayLight => ({
  memberId: "m1",
  displayName: "Mom",
  state: "lit",
  stateText: "answered 8:12",
  localDate: "2026-11-02",
  timeZone: "Asia/Taipei",
  ...over,
});

describe("the home screen widget", () => {
  it("shows each parent's name, lit or not, and the line in the reader's language", () => {
    const now = new Date("2026-11-02T01:00:00Z");
    expect(
      widgetSnapshot(
        [
          light({}),
          light({ memberId: "m2", displayName: "Dad", state: "resting", stateText: "resting" }),
        ],
        now,
      ),
    ).toEqual({
      lights: [
        { name: "Mom", lit: true, line: "answered 8:12", date: "2026-11-02", tz: "Asia/Taipei" },
        { name: "Dad", lit: false, line: "resting", date: "2026-11-02", tz: "Asia/Taipei" },
      ],
      waiting: "No word yet today",
      at: "2026-11-02T01:00:00.000Z",
    });
  });

  it("never shows her Not okay on the lock screen, only to open Vela", () => {
    const [mom] = widgetSnapshot(
      [light({ notOkayAt: "9:05", stateText: "said she is not okay" })],
      new Date(),
    ).lights;
    expect(mom).toMatchObject({ lit: false, line: "Open Vela" });
  });

  it("leaves out a parent still invited, and keeps at most two", () => {
    const lights = widgetSnapshot(
      [
        light({ invited: true }),
        light({ displayName: "A" }),
        light({ displayName: "B" }),
        light({ displayName: "C" }),
      ],
      new Date(),
    ).lights;
    expect(lights.map((row) => row.name)).toEqual(["A", "B"]);
  });

  it("does nothing where there is no widget, such as the web", () => {
    expect(() => writeWidget(widgetSnapshot([light({})], new Date()))).not.toThrow();
  });
});
