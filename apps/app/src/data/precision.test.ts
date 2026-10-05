import { ApiPrecision } from "@vela/contracts";
import { describe, expect, it, vi } from "vitest";
import { monthLines, toPrecision } from "./precision.ts";

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

const NONE = { answered_late: 0, away: 0, fine_known: 0, true_concern: 0, unknown: 0 };

describe("monthLines", () => {
  it("says how many notices, how they ended, how many were real, and the verdicts", () => {
    expect(
      monthLines({
        month: "2026-09",
        notices: 12,
        open: 1,
        outcomes: { answered_late: 7, away: 2, fine_known: 1, true_concern: 1, unknown: 0 },
        useful: { yes: 8, no: 2 },
      }),
    ).toEqual([
      "12 quiet notices.",
      "How they ended: 7 answered later, 2 away, 1 fine, and the family knew why, 1 where something was wrong.",
      "1 is still open.",
      "Something was wrong in 1 of 12.",
      "The family found 8 of 10 useful.",
    ]);
  });

  it("says plainly when nothing was wrong, and leaves out what has no number", () => {
    expect(
      monthLines({
        month: "2026-09",
        notices: 1,
        open: 0,
        outcomes: { ...NONE, away: 1 },
        useful: { yes: 0, no: 0 },
      }),
    ).toEqual([
      "1 quiet notice.",
      "How they ended: 1 away.",
      "In none of them was something wrong.",
    ]);
  });

  it("says nothing of endings while every notice is still open", () => {
    expect(
      monthLines({
        month: "2026-09",
        notices: 2,
        open: 2,
        outcomes: NONE,
        useful: { yes: 0, no: 0 },
      }),
    ).toEqual(["2 quiet notices.", "2 are still open."]);
  });
});

describe("toPrecision", () => {
  it("labels each month and states Vela's rule from the API's minimum", () => {
    const precision = toPrecision(
      ApiPrecision.parse({
        family: [
          {
            month: "2026-08",
            notices: 1,
            open: 0,
            outcomes: { ...NONE, answered_late: 1 },
            useful: { yes: 1, no: 0 },
          },
        ],
        vela: [],
        vela_minimum: { notices: 10, families: 3 },
      }),
    );

    expect(precision.family.map((month) => [month.month, month.label])).toEqual([
      ["2026-08", "August 2026"],
    ]);
    expect(precision.vela).toEqual([]);
    expect(precision.velaRule).toBe(
      "Vela shows a month once it has at least 10 notices from 3 families, so no one family's morning can be read out of it.",
    );
  });
});
