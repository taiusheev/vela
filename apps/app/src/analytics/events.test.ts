import { describe, expect, it } from "vitest";
import { type AnalyticsScreen, screenName, type UsageEvent, usagePayload } from "./events.ts";

describe("content-free app counts", () => {
  it("maps only known navigation and drops unknown routes and private ids", () => {
    expect(screenName(["(tabs)"])).toBe("today");
    expect(screenName(["conversation", "synthetic-family-id"])).toBe("conversation");
    expect(screenName(["private-family-route"])).toBeNull();
  });
  it("rejects unknown screen names, event names and family identifiers", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(usagePayload("family-id", "screen_viewed", "today")).toBeNull();
    expect(usagePayload(id, "$snapshot" as UsageEvent)).toBeNull();
    expect(usagePayload(id, "screen_viewed", "private words" as AnalyticsScreen)).toBeNull();
  });
  it("reconstructs bounded metadata without arbitrary caller properties", () => {
    expect(
      usagePayload("11111111-1111-4111-8111-111111111111", "screen_active_time", "today", 9000),
    ).toEqual({
      distinct_id: "11111111-1111-4111-8111-111111111111",
      event: "screen_active_time",
      properties: {
        surface: "app",
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: null,
        screen: "today",
        seconds: 1800,
      },
    });
  });
});
