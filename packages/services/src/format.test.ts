import { describe, expect, it } from "vitest";
import {
  channelLabel,
  formatAwayDate,
  formatNearbyContacts,
  formatTime,
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
