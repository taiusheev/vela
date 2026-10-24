import { describe, expect, it } from "vitest";
import { noticeUrl, PRODUCTION_NOTICE_ORIGIN } from "./support.ts";

describe("noticeUrl", () => {
  it("opens the real Vela's notices on its own address", () => {
    expect(noticeUrl("/privacy", PRODUCTION_NOTICE_ORIGIN)).toBe("https://vela-light.com/privacy");
  });

  it("opens vela-light.com when the build has no server", () => {
    expect(noticeUrl("/terms", undefined)).toBe("https://vela-light.com/terms");
  });

  it("keeps the test copy's own notices", () => {
    const staging = "https://vela.vela-light-staging.workers.dev";
    expect(noticeUrl("/privacy", staging)).toBe(`${staging}/privacy`);
  });
});
