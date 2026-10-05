import { describe, expect, it } from "vitest";
import { learningUntil, quietAfterMinutes, TUNING } from "./tuning.ts";

/** Fourteen answered days whose median latency is `median` minutes. */
function fortnight(median: number): number[] {
  return [-65, -55, -45, -35, -25, -15, -5, 5, 15, 25, 35, 45, 55, 65].map(
    (offset) => median + offset,
  );
}

describe("quietAfterMinutes", () => {
  it("starts at six hours before her rhythm is known", () => {
    expect(quietAfterMinutes([])).toBe(360);
    expect(quietAfterMinutes([200, 210, 220, 230, 240, 250, 260])).toBe(360);
    expect(quietAfterMinutes(fortnight(230).slice(0, 13))).toBe(360);
  });

  it("uses the median plus two hours from the fourteenth answered day", () => {
    expect(quietAfterMinutes(fortnight(230))).toBe(350);
  });

  it("takes the median of unsorted samples without reordering the caller's array", () => {
    const latencies = [260, 200, 250, 210, 240, 220, 230, 190, 270, 180, 280, 170, 290, 160, 300];
    const copy = [...latencies];
    expect(quietAfterMinutes(latencies)).toBe(350);
    expect(latencies).toEqual(copy);
  });

  it("averages the two middle samples of an even count and rounds up to a whole minute", () => {
    expect(quietAfterMinutes(fortnight(235))).toBe(355);
    expect(
      quietAfterMinutes([200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213]),
    ).toBe(327);
  });

  it("never goes below four hours", () => {
    expect(quietAfterMinutes(fortnight(40))).toBe(240);
    expect(quietAfterMinutes(fortnight(120))).toBe(240);
    expect(quietAfterMinutes(fortnight(121))).toBe(241);
  });

  it("never goes above ten hours", () => {
    expect(quietAfterMinutes(fortnight(479))).toBe(599);
    expect(quietAfterMinutes(fortnight(480))).toBe(600);
    expect(quietAfterMinutes(fortnight(700))).toBe(600);
  });

  it("counts an answer before delivery as an answered day", () => {
    expect(
      quietAfterMinutes([-30, 290, 295, 300, 305, 310, 315, 325, 330, 335, 340, 345, 350, 355]),
    ).toBe(440);
    expect(
      quietAfterMinutes([-90, -80, -70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40]),
    ).toBe(240);
  });

  it("rejects latencies that are not finite numbers", () => {
    expect(() => quietAfterMinutes([...fortnight(200), Number.NaN])).toThrow(RangeError);
    expect(() => quietAfterMinutes([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  describe("on Sundays and holidays", () => {
    const sundays = [400, 410, 420];

    it("uses the Sunday median when it differs by more than an hour", () => {
      expect(quietAfterMinutes(fortnight(230), { sunday: true, sundayLatencies: sundays })).toBe(
        530,
      );
      expect(
        quietAfterMinutes(fortnight(230), { sunday: true, sundayLatencies: [160, 169, 170] }),
      ).toBe(289);
    });

    it("keeps the overall median when the Sunday median differs by exactly an hour", () => {
      expect(quietAfterMinutes(fortnight(350), { sunday: true, sundayLatencies: sundays })).toBe(
        470,
      );
      expect(quietAfterMinutes(fortnight(349), { sunday: true, sundayLatencies: sundays })).toBe(
        530,
      );
    });

    it("ignores the Sunday samples on other days", () => {
      expect(quietAfterMinutes(fortnight(230), { sundayLatencies: sundays })).toBe(350);
      expect(quietAfterMinutes(fortnight(230), { sunday: false, sundayLatencies: sundays })).toBe(
        350,
      );
    });

    it("needs at least three Sundays before overriding the overall rhythm", () => {
      expect(quietAfterMinutes(fortnight(230), { sunday: true, sundayLatencies: [400, 410] })).toBe(
        350,
      );
      expect(quietAfterMinutes(fortnight(230), { sunday: true })).toBe(350);
    });

    it("stays at six hours while the overall rhythm is unknown", () => {
      expect(quietAfterMinutes([230], { sunday: true, sundayLatencies: sundays })).toBe(360);
      expect(
        quietAfterMinutes(fortnight(230).slice(0, 13), { sunday: true, sundayLatencies: sundays }),
      ).toBe(360);
    });

    it("clamps the Sunday threshold like any other", () => {
      expect(
        quietAfterMinutes(fortnight(230), { sunday: true, sundayLatencies: [700, 710, 720] }),
      ).toBe(600);
    });
  });

  it("keeps its parameters aligned with spec §8", () => {
    expect(TUNING).toMatchObject({
      defaultQuietAfterMinutes: 360,
      floorMinutes: 240,
      capMinutes: 600,
      marginMinutes: 120,
      minSamples: 14,
      minSundaySamples: 3,
      learningDays: 14,
    });
  });
});

describe("learningUntil", () => {
  it("is the consent date plus 14 days", () => {
    expect(learningUntil("2026-09-13")).toBe("2026-09-27");
  });

  it("crosses month and year ends", () => {
    expect(learningUntil("2026-12-25")).toBe("2027-01-08");
    expect(learningUntil("2028-02-20")).toBe("2028-03-05");
  });
});
