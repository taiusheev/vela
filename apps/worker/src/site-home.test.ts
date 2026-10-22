import { describe, expect, it } from "vitest";
import { approvedCopy, approvedHome } from "./site-home.ts";

describe("the homepage audience label", () => {
  it("welcomes adult children without calling them busy", () => {
    expect(approvedCopy("en").tagline).toBe("FOR ADULT CHILDREN. FOR AGING PARENTS.");
    const body = approvedHome("en", null).body.markup;
    expect(body).toContain("FOR ADULT CHILDREN. FOR AGING PARENTS.");
    expect(body).not.toContain("FOR BUSY ADULT CHILDREN.");
  });

  it("uses the same welcoming wording in Traditional Chinese", () => {
    expect(approvedCopy("zh-TW").tagline).toBe("給你，也給年歲漸長的爸媽。");
    const body = approvedHome("zh-TW", null).body.markup;
    expect(body).toContain("給你，也給年歲漸長的爸媽。");
    expect(body).not.toContain("給生活忙碌的你，也給年歲漸長的爸媽。</p>");
  });
});
