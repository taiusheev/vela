import { describe, expect, it } from "vitest";
import {
  channelLabel,
  clockMinutesBetween,
  formatAwayDate,
  formatNearbyContacts,
  formatTime,
  medianTimeAround,
  reactionKindOf,
  reactionKindsOf,
} from "./format.ts";

describe("formatTime", () => {
  it("shows the wall clock of the zone the reader thinks in", () => {
    const instant = new Date("2026-09-14T00:05:00Z");
    expect(formatTime(instant, "Asia/Taipei")).toBe("08:05");
    expect(formatTime(instant, "Europe/Berlin")).toBe("02:05");
  });
});

describe("clockMinutesBetween", () => {
  it("goes the short way round the clock, across midnight either way", () => {
    expect(clockMinutesBetween("08:30", "09:00")).toBe(30);
    expect(clockMinutesBetween("09:00", "08:30")).toBe(-30);
    expect(clockMinutesBetween("23:55", "00:05")).toBe(10);
    expect(clockMinutesBetween("00:05", "23:55")).toBe(-10);
    expect(clockMinutesBetween("08:00", "20:00")).toBe(-720);
    expect(clockMinutesBetween("08:00", "19:59")).toBe(719);
  });
});

describe("medianTimeAround", () => {
  /** Instants at the given Taipei wall-clock times (UTC+8, no daylight saving). */
  function taipei(...times: string[]): Date[] {
    return times.map((time, index) => {
      const [hour, minute] = time.split(":");
      return new Date(Date.UTC(2026, 7, 1 + index, Number(hour) - 8, Number(minute)));
    });
  }

  it("gives a time near midnight for answers on both sides of it", () => {
    const answers = taipei(...Array(7).fill("23:50"), ...Array(7).fill("00:10"));
    expect(medianTimeAround(answers, "Asia/Taipei", "23:00")).toBe("00:00");
    expect(
      medianTimeAround(taipei("23:40", "23:55", "00:05", "00:15", "00:20"), "Asia/Taipei", "23:00"),
    ).toBe("00:05");
  });

  it("orders an answer before her arrival before the ones after it", () => {
    expect(
      medianTimeAround(taipei("07:30", "07:40", "08:20", "08:30"), "Asia/Taipei", "08:00"),
    ).toBe("08:00");
    expect(medianTimeAround(taipei("09:00", "09:30", "10:00"), "Asia/Taipei", "08:00")).toBe(
      "09:30",
    );
  });

  it("has no usual time without an answer", () => {
    expect(medianTimeAround([], "Asia/Taipei", "08:00")).toBeNull();
  });
});

describe("formatAwayDate", () => {
  // The flows' example date, "Sunday 21 September", is 21 September 2025; in 2026 it is a Monday.
  it("writes the date the way each catalog's sentence carries it", () => {
    expect(formatAwayDate("2025-09-21", "en")).toBe("Sunday 21 September");
    expect(formatAwayDate("2025-09-21", "zh-TW")).toBe("9月21日（星期日）");
    expect(formatAwayDate("2026-09-21", "en")).toBe("Monday 21 September");
    expect(formatAwayDate("2026-12-05", "en")).toBe("Saturday 5 December");
    expect(formatAwayDate("2026-12-05", "zh-TW")).toBe("12月5日（星期六）");
  });

  it("gives languages without their own catalog the English date, as their copy is English", () => {
    expect(formatAwayDate("2025-09-21", "ja")).toBe("Sunday 21 September");
    expect(formatAwayDate("2025-09-21", "ru")).toBe("Sunday 21 September");
  });

  it("refuses a date that is not a calendar date", () => {
    expect(() => formatAwayDate("2026-02-30", "en")).toThrow();
    expect(() => formatAwayDate("tomorrow", "en")).toThrow();
  });
});

describe("formatNearbyContacts", () => {
  it("lists names and numbers as plain text in the language's list style", () => {
    const contacts = [
      { name: "Anna", phone: "+886912000001" },
      { name: " Bob ", phone: "+886912000002 " },
    ];
    expect(formatNearbyContacts("en", contacts)).toBe("Anna +886912000001, Bob +886912000002");
    expect(formatNearbyContacts("zh-TW", contacts)).toBe("Anna +886912000001、Bob +886912000002");
  });
});

describe("channelLabel", () => {
  it("names the platform as people know it", () => {
    expect(channelLabel("telegram")).toBe("Telegram");
    expect(channelLabel("line")).toBe("LINE");
    expect(channelLabel("whatsapp")).toBe("WhatsApp");
  });
});

describe("reaction emoji", () => {
  it("maps the listed emoji to a reply kind, with or without the variation selector", () => {
    expect(reactionKindOf("❤️")).toBe("heart");
    expect(reactionKindOf("❤")).toBe("heart");
    expect(reactionKindOf("👍")).toBe("heart");
    expect(reactionKindOf("🙏")).toBe("heart");
    expect(reactionKindOf("😂")).toBe("laugh");
    expect(reactionKindOf("😆")).toBe("laugh");
    expect(reactionKindOf("🤗")).toBe("hug");
    expect(reactionKindOf("🫂")).toBe("hug");
  });

  it("ignores emoji that do not count", () => {
    expect(reactionKindOf("👎")).toBeNull();
    expect(reactionKindOf("🔥")).toBeNull();
    expect(reactionKindOf("")).toBeNull();
  });

  it("reduces a member's reaction set to its distinct kinds in a fixed order", () => {
    expect(reactionKindsOf(["🤗", "😂", "❤️", "👍", "🔥", "🤣"])).toEqual(["heart", "laugh", "hug"]);
    expect(reactionKindsOf(["🔥"])).toEqual([]);
    expect(reactionKindsOf([])).toEqual([]);
  });
});
