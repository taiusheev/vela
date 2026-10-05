import { ApiWeeklyRead } from "@vela/contracts";
import { describe, expect, it, vi } from "vitest";
import { countLines, toWeeklyRead } from "./weekly.ts";

// The macros compile away when the app is bundled. Here they read as English: `t` joins its parts,
// and `plural` takes the branch English would and puts the count where `#` is.
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (line, part, index) => `${line}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));

const MEMBER = "11111111-1111-7111-8111-111111111111";

function apiRead(locked: boolean): ApiWeeklyRead {
  return ApiWeeklyRead.parse({
    member_id: MEMBER,
    display_name: "Mom",
    locked,
    read: {
      id: "22222222-2222-7222-8222-222222222222",
      week_start: "2026-09-07",
      week_end: "2026-09-13",
      sent_at: "2026-09-13T12:00:00.000Z",
      days: [
        { date: "2026-09-07", state: "not_counted", answered_at: null },
        { date: "2026-09-08", state: "answered", answered_at: "08:30" },
        { date: "2026-09-09", state: "late", answered_at: "13:00" },
        { date: "2026-09-10", state: "unanswered", answered_at: null },
        { date: "2026-09-11", state: "answered", answered_at: "08:10" },
        { date: "2026-09-12", state: "answered", answered_at: "08:40" },
        { date: "2026-09-13", state: "answered", answered_at: "09:00" },
      ],
      counts: locked
        ? null
        : { counted_days: 6, answered_days: 5, hello_mornings: 2, family_asks: 4 },
      notes: locked ? null : ["She told you about the garden twice."],
      suggestion: locked ? null : "Ask her which seeds she kept.",
    },
  });
}

describe("the weekly read's count lines", () => {
  it("say how many of the counted days she answered, and the mornings nobody asked", () => {
    expect(countLines("Mom", { answered: 5, days: 6, hellos: 2, asks: 4 })).toEqual([
      "Mom answered 5 of 6 days.",
      "On 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
    ]);
  });

  it("say one day and one morning in the singular", () => {
    expect(countLines("Mom", { answered: 1, days: 1, hellos: 1, asks: 1 })).toEqual([
      "Mom answered 1 of 1 day.",
      "On 1 morning nobody in the family asked, so Vela sent Mom a hello.",
    ]);
  });

  it("say plainly that nobody asked anything, rather than counting hellos", () => {
    expect(countLines("Mom", { answered: 7, days: 7, hellos: 7, asks: 0 })).toEqual([
      "Mom answered 7 of 7 days.",
      "Nobody in the family asked Mom anything this week.",
    ]);
  });

  it("leave out the mornings line when someone asked every morning", () => {
    expect(countLines("Mom", { answered: 7, days: 7, hellos: 0, asks: 7 })).toEqual([
      "Mom answered 7 of 7 days.",
    ]);
  });
});

describe("the weekly read on Sunday", () => {
  it("lights answered days, marks a late one, and never draws a day quiet", () => {
    const week = toWeeklyRead(apiRead(false)).week;
    expect(week?.lights.map(({ state, note, late }) => ({ state, note, late }))).toEqual([
      { state: "resting", note: "", late: false },
      { state: "lit", note: "08:30", late: false },
      { state: "lit", note: "13:00", late: true },
      { state: "resting", note: "", late: false },
      { state: "lit", note: "08:10", late: false },
      { state: "lit", note: "08:40", late: false },
      { state: "lit", note: "09:00", late: false },
    ]);
    expect(week?.counts).toEqual([
      "Mom answered 5 of 6 days.",
      "On 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
    ]);
    expect(week?.notes).toEqual(["She told you about the garden twice."]);
    expect(week?.suggestion).toBe("Ask her which seeds she kept.");
  });

  it("keeps the seven days and nothing else when the read is locked", () => {
    const read = toWeeklyRead(apiRead(true));
    expect(read.locked).toBe(true);
    expect(read.week?.lights).toHaveLength(7);
    expect(read.week).toMatchObject({ counts: [], notes: [], suggestion: null });
  });

  it("has no week until the first read has been sent", () => {
    expect(
      toWeeklyRead({ member_id: MEMBER, display_name: "Mom", locked: false, read: null }).week,
    ).toBeNull();
  });
});
