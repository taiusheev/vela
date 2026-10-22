import { describe, expect, it } from "vitest";
import { approvedCopy, approvedHome } from "./site-home.ts";

describe("the homepage audience label", () => {
  it("welcomes adult children without calling them busy", () => {
    expect(approvedCopy("en").tagline).toBe("FOR ADULT CHILDREN. FOR AGING PARENTS.");
    const body = approvedHome("en", null).body.markup;
    expect(body).toContain("FOR ADULT CHILDREN. FOR AGING PARENTS.");
    expect(body).not.toContain("FOR BUSY ADULT CHILDREN.");
  });
});
