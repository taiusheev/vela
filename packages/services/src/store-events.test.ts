import { describe, expect, it } from "vitest";
import { intervalOf, newerThanStored, type StoreEvent, storeChange } from "./store-events.ts";

const END = new Date("2027-10-25T00:00:00Z");

function event(type: string, extra: Partial<StoreEvent> = {}): StoreEvent {
  return {
    id: "evt-1",
    type,
    appUserId: "user_example",
    memberId: "0190a0b0-0000-7000-8000-000000000001",
    expiresAt: END,
    graceUntil: null,
    periodType: "NORMAL",
    productId: "vela_light_yearly",
    price: 2490,
    currency: "TWD",
    originalTransactionId: "2000000000000001",
    ...extra,
  };
}

describe("storeChange", () => {
  it("turns a purchase or renewal into an active year, priced in the payer's currency", () => {
    expect(storeChange(event("INITIAL_PURCHASE"))).toEqual({
      status: "active",
      currentPeriodEnd: END,
      graceUntil: null,
      planInterval: "year",
      priceCents: 249000,
      currency: "TWD",
      externalId: "2000000000000001",
    });
    expect(storeChange(event("RENEWAL"))?.status).toBe("active");
  });

  it("keeps a cancelled plan to the end of its period, and lapses it at expiry", () => {
    expect(storeChange(event("CANCELLATION"))?.status).toBe("cancelled");
    expect(storeChange(event("CANCELLATION"))?.currentPeriodEnd).toEqual(END);
    expect(storeChange(event("EXPIRATION"))?.status).toBe("lapsed");
  });

  it("gives a billing issue Apple's grace period", () => {
    const grace = new Date("2026-11-10T00:00:00Z");
    expect(storeChange(event("BILLING_ISSUE", { graceUntil: grace }))).toMatchObject({
      status: "grace",
      graceUntil: grace,
    });
  });

  it("ignores events that change nothing here", () => {
    expect(storeChange(event("TEST"))).toBeNull();
    expect(storeChange(event("TRANSFER"))).toBeNull();
  });
});

describe("intervalOf", () => {
  it("reads the plan's length from the product id", () => {
    expect(intervalOf("vela_light_yearly")).toBe("year");
    expect(intervalOf("monthly")).toBe("month");
    expect(intervalOf("something")).toBeNull();
    expect(intervalOf(null)).toBeNull();
  });
});

describe("newerThanStored", () => {
  const change = storeChange(event("RENEWAL"));
  if (change === null) throw new Error("renewal must change the row");

  it("lets a later or equal period end overwrite the row", () => {
    expect(newerThanStored(change, new Date("2026-10-25T00:00:00Z"))).toBe(true);
    expect(newerThanStored(change, END)).toBe(true);
    expect(newerThanStored(change, null)).toBe(true);
  });

  it("drops older news that arrives late", () => {
    expect(newerThanStored(change, new Date("2028-10-25T00:00:00Z"))).toBe(false);
    expect(newerThanStored({ ...change, currentPeriodEnd: null }, END)).toBe(false);
  });
});
