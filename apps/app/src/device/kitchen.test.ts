import { describe, expect, it } from "vitest";
import {
  CYCLE_MS,
  isKitchenTable,
  photoAt,
  photosToCycle,
  tableClock,
  tableDate,
} from "./kitchen.ts";

process.env.TZ = "Asia/Taipei";

describe("kitchen-table mode", () => {
  it("is the screen held on its side, not a phone upright or a square window", () => {
    expect(isKitchenTable(1280, 800)).toBe(true);
    expect(isKitchenTable(812, 375)).toBe(true);
    expect(isKitchenTable(375, 812)).toBe(false);
    expect(isKitchenTable(800, 760)).toBe(false);
  });

  it("cycles the photos of her latest messages, newest first, each once", () => {
    const photos = photosToCycle([{ photos: ["c", "b"] }, { photos: [] }, { photos: ["b", "a"] }]);
    expect(photos).toEqual(["c", "b", "a"]);
    expect(photoAt(photos, 0)).toBe("c");
    expect(photoAt(photos, CYCLE_MS - 1)).toBe("c");
    expect(photoAt(photos, CYCLE_MS)).toBe("b");
    expect(photoAt(photos, 3 * CYCLE_MS)).toBe("c");
    expect(photoAt([], 5 * CYCLE_MS)).toBeUndefined();
  });

  it("tells the time and the day in her language", () => {
    const at = new Date("2026-10-12T00:05:00Z"); // 08:05 on Monday 12 October in Taipei
    expect(tableClock(at, "en")).toBe("08:05");
    expect(tableDate(at, "en")).toBe("Monday 12 October");
    expect(tableDate(at, "zh-TW")).toContain("10月12日");
    expect(tableDate(at, "zh-TW")).toContain("星期一");
    expect(tableClock(at, "zh-TW")).toContain("8:05");
  });
});
