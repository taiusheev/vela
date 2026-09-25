import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppLocale } from "../i18n/locale.ts";
import { clockTime, dayMonth, dayName, listOf, timeOfDay, weekday } from "./format.ts";

// The reader's zone decides the clock time; the samples are read in Taipei.
process.env.TZ = "Asia/Taipei";

function inLocale<T>(locale: AppLocale, read: () => T): T {
  i18n.activate(locale);
  return read();
}

beforeAll(() => {
  i18n.load({ en: {}, "zh-TW": {} });
});

const EARLY = "2026-10-12T00:12:00Z"; // 08:12 on Monday 12 October in Taipei
const LATE = "2026-10-12T14:05:00Z"; // 22:05
const MIDNIGHT = "2026-10-11T16:05:00Z"; // 00:05 on the 12th

describe("format in English", () => {
  it("writes times, dates, days and lists as en-GB", () => {
    expect(
      inLocale("en", () => [
        timeOfDay(EARLY),
        timeOfDay(LATE),
        dayMonth(EARLY),
        weekday(EARLY),
        dayName("2026-10-15"),
        listOf(["Lena", "Petro", "Igor"]),
      ]),
    ).toEqual(["8:12", "22:05", "12 Oct", "Monday", "Thursday", "Lena, Petro, Igor"]);
  });

  it("writes an example day's clock time as it writes a real one", () => {
    expect(inLocale("en", () => [clockTime(8, 12), clockTime(9, 5), clockTime(22, 5)])).toEqual([
      "8:12",
      "9:05",
      "22:05",
    ]);
  });
});

describe("format in Traditional Chinese", () => {
  it("writes times on the 24-hour clock with two-digit hours", () => {
    expect(
      inLocale("zh-TW", () => [timeOfDay(EARLY), timeOfDay(LATE), timeOfDay(MIDNIGHT)]),
    ).toEqual(["08:12", "22:05", "00:05"]);
  });

  it("writes an example day's clock time as it writes a real one", () => {
    expect(inLocale("zh-TW", () => [clockTime(8, 12), clockTime(9, 5), clockTime(0, 5)])).toEqual([
      "08:12",
      "09:05",
      "00:05",
    ]);
  });

  it("writes dates, days and lists as Taiwan does", () => {
    expect(
      inLocale("zh-TW", () => [
        dayMonth(EARLY),
        weekday(EARLY),
        dayName("2026-10-15"),
        listOf(["Lena", "Petro", "Igor"]),
      ]),
    ).toEqual(["10月12日", "星期一", "星期四", "Lena、Petro、Igor"]);
  });
});

describe("format with nothing to read", () => {
  it("writes nothing for an instant that is not one, and keeps a date it cannot name", () => {
    for (const locale of ["en", "zh-TW"] as const) {
      expect(
        inLocale(locale, () => [
          timeOfDay("soon"),
          dayMonth(""),
          weekday("x"),
          dayName("someday"),
          listOf([]),
        ]),
      ).toEqual(["", "", "", "someday", ""]);
    }
  });
});
