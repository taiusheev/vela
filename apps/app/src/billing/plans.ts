/**
 * Vela Light through the App Store, by way of RevenueCat (founder, 25 Oct 2026). This file holds the
 * plain decisions, so they are tested without a phone; `useBilling.ts` talks to the store.
 */

/** RevenueCat's access level that Vela Light grants (project "Vela Light"). */
export const VELA_LIGHT_ENTITLEMENT = "vela_light_pro";

/** The one subscriber attribute Vela sends: which parent the plan keeps the light on for. */
export const PARENT_ATTRIBUTE = "vela_member_id";

/** A plan as the store sells it, in the reader's own currency, priced by Apple. */
export interface StorePlan {
  /** RevenueCat's package id: "$rc_annual" or "$rc_monthly". */
  id: string;
  period: "year" | "month";
  /** Apple's own price text, such as "NT$2,490" or "$79.00". */
  price: string;
}

/** The packages a store offering lists, as much of them as this file reads. */
export interface OfferedPackage {
  identifier: string;
  packageType: string;
  product: { priceString: string };
}

/** The yearly plan, then the monthly one; anything else the offering lists is not sold here. */
export function storePlans(packages: readonly OfferedPackage[]): StorePlan[] {
  const year = packages.find((item) => item.packageType === "ANNUAL");
  const month = packages.find((item) => item.packageType === "MONTHLY");
  return [
    ...(year === undefined
      ? []
      : [{ id: year.identifier, period: "year" as const, price: year.product.priceString }]),
    ...(month === undefined
      ? []
      : [{ id: month.identifier, period: "month" as const, price: month.product.priceString }]),
  ];
}

/** Whether the store says this reader's Vela Light is paid for now. */
export function lightPaid(info: { entitlements: { active: Record<string, unknown> } }): boolean {
  return info.entitlements.active[VELA_LIGHT_ENTITLEMENT] !== undefined;
}

/**
 * Purchases run only where they can be real: on an iPhone, with a store key built in, and where
 * the server sells Vela Light (its `billing` capability; the pilot never does), or in the example
 * build, which buys from RevenueCat's practice store.
 */
export function billingAvailable(input: {
  platform: string;
  key: string | undefined;
  serverSells: boolean;
  demo: boolean;
}): boolean {
  if (input.platform !== "ios") return false;
  if (input.key === undefined || input.key.length === 0) return false;
  return input.serverSells || input.demo;
}
