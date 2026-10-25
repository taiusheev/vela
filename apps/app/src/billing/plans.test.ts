import { describe, expect, it } from "vitest";
import { billingAvailable, lightPaid, storePlans } from "./plans.ts";

describe("storePlans", () => {
  it("lists the yearly plan first, then the monthly one, at Apple's prices", () => {
    expect(
      storePlans([
        { identifier: "$rc_monthly", packageType: "MONTHLY", product: { priceString: "NT$290" } },
        { identifier: "$rc_annual", packageType: "ANNUAL", product: { priceString: "NT$2,490" } },
        {
          identifier: "$rc_lifetime",
          packageType: "LIFETIME",
          product: { priceString: "NT$9,990" },
        },
      ]),
    ).toEqual([
      { id: "$rc_annual", period: "year", price: "NT$2,490" },
      { id: "$rc_monthly", period: "month", price: "NT$290" },
    ]);
  });

  it("lists nothing when the store offers neither", () => {
    expect(storePlans([])).toEqual([]);
  });
});

describe("lightPaid", () => {
  it("is paid only while the Vela Light access is active", () => {
    expect(lightPaid({ entitlements: { active: { vela_light_pro: {} } } })).toBe(true);
    expect(lightPaid({ entitlements: { active: {} } })).toBe(false);
  });
});

describe("billingAvailable", () => {
  const base = {
    platform: "ios",
    key: "appl_x",
    serverSells: true,
    demo: false,
    development: false,
  };

  it("runs on an iPhone with a key where the server sells Vela Light", () => {
    expect(billingAvailable(base)).toBe(true);
  });

  it("never runs in the pilot, on the web, or without a key", () => {
    expect(billingAvailable({ ...base, serverSells: false })).toBe(false);
    expect(billingAvailable({ ...base, platform: "web" })).toBe(false);
    expect(billingAvailable({ ...base, key: undefined })).toBe(false);
  });

  it("runs in the example build against the practice store", () => {
    expect(billingAvailable({ ...base, serverSells: false, demo: true })).toBe(true);
  });

  it("keeps the practice-store key out of finished apps, which RevenueCat would close", () => {
    expect(billingAvailable({ ...base, key: "test_x" })).toBe(false);
    expect(billingAvailable({ ...base, key: "test_x", development: true })).toBe(true);
  });
});
