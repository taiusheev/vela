import { describe, expect, it } from "vitest";
import { money, PRICES, pricesFor, yearPerMonth, yearSaving } from "./plans.ts";

describe("plans", () => {
  it("shows New Taiwan dollars in Taiwan and US dollars elsewhere", () => {
    expect(pricesFor("TW").currency).toBe("TWD");
    expect(pricesFor("tw").currency).toBe("TWD");
    expect(pricesFor("US").currency).toBe("USD");
    expect(pricesFor(null).currency).toBe("USD");
  });

  it("writes the currency the same way in every language", () => {
    expect(money(2490, "TWD")).toBe("NT$2,490");
    expect(money(79, "USD")).toBe("$79");
    expect(money(9.99, "USD")).toBe("$9.99");
  });

  it("says what the year comes to each month and what it saves", () => {
    expect(yearPerMonth(PRICES.TWD)).toBe(208);
    expect(yearSaving(PRICES.TWD)).toBe(28);
    expect(yearPerMonth(PRICES.USD)).toBe(6.58);
    expect(yearSaving(PRICES.USD)).toBe(34);
  });
});
