/**
 * Vela Light's prices, one table per currency (plan/pricing-taiwan.md). Taiwan, the first market,
 * pays in New Taiwan dollars; everyone else sees US dollars. Apple's own price, in the reader's
 * store currency, replaces these once purchases go through the App Store.
 */
export type PlanCurrency = "TWD" | "USD";

export interface PlanPrices {
  currency: PlanCurrency;
  /** The yearly price, the plan shown first. */
  year: number;
  month: number;
}

export const PRICES: Record<PlanCurrency, PlanPrices> = {
  TWD: { currency: "TWD", year: 2490, month: 290 },
  USD: { currency: "USD", year: 79, month: 9.99 },
};

/** A device in Taiwan sees New Taiwan dollars; any other region, or none, sees US dollars. */
export function pricesFor(regionCode: string | null | undefined): PlanPrices {
  return regionCode?.toUpperCase() === "TW" ? PRICES.TWD : PRICES.USD;
}

/** Each currency's symbol, written out so a price reads the same in English and Chinese. */
const SYMBOL: Record<PlanCurrency, string> = { TWD: "NT$", USD: "$" };

/** "NT$2,490" or "$79". */
export function money(amount: number, currency: PlanCurrency): string {
  const whole = Number.isInteger(amount);
  const digits = amount.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${SYMBOL[currency]}${digits}`;
}

/** What the yearly plan comes to each month, rounded the way the currency is written. */
export function yearPerMonth(prices: PlanPrices): number {
  const each = prices.year / 12;
  return prices.currency === "TWD" ? Math.round(each) : Math.round(each * 100) / 100;
}

/** How much the yearly plan saves against twelve monthly payments, in whole percent. */
export function yearSaving(prices: PlanPrices): number {
  return Math.round((1 - prices.year / (prices.month * 12)) * 100);
}
