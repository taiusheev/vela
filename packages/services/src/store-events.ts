import { members, subscriptions, users } from "@vela/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { isKeptLightMember } from "./group.ts";

/**
 * A purchase of Vela Light reported by RevenueCat's webhook (ADR-20; founder chose RevenueCat on
 * 25 Oct 2026). RevenueCat knows the payer only by their auth subject (`app_user_id`) and the parent
 * only by her member id, which the app sets as the `vela_member_id` attribute before Apple's sheet
 * opens. No family words reach RevenueCat or come back from it.
 */
export interface StoreEvent {
  /** RevenueCat's event id. */
  id: string;
  type: string;
  appUserId: string;
  /** The parent's member id, from the `vela_member_id` attribute; null when the app sent none. */
  memberId: string | null;
  /** When the paid period ends, as RevenueCat reports it; null for events without one. */
  expiresAt: Date | null;
  /** The end of Apple's billing grace period, for a billing issue. */
  graceUntil: Date | null;
  periodType: string | null;
  productId: string | null;
  /** What the payer paid, in their own currency. */
  price: number | null;
  currency: string | null;
  originalTransactionId: string | null;
}

/** What a store event makes of the parent's subscription row. */
export interface StoreChange {
  status: "active" | "cancelled" | "grace" | "lapsed";
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  planInterval: "month" | "year" | null;
  priceCents: number | null;
  currency: string | null;
  externalId: string | null;
}

const ACTIVE = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
]);

/** "vela_light_yearly" and RevenueCat's practice "yearly" are a year; "…monthly" a month. */
export function intervalOf(productId: string | null): "month" | "year" | null {
  if (productId === null) return null;
  if (/year|annual/i.test(productId)) return "year";
  if (/month/i.test(productId)) return "month";
  return null;
}

/**
 * The row a store event asks for, or null for an event that changes nothing here (a test ping, a
 * transfer, a one-off purchase). Cancelling stops renewal but keeps the light on to the period's
 * end, so it is `cancelled` with that end; an expiry is `lapsed`.
 */
export function storeChange(event: StoreEvent): StoreChange | null {
  const status = ACTIVE.has(event.type)
    ? "active"
    : event.type === "CANCELLATION"
      ? "cancelled"
      : event.type === "BILLING_ISSUE"
        ? "grace"
        : event.type === "EXPIRATION"
          ? "lapsed"
          : null;
  if (status === null) return null;
  return {
    status,
    currentPeriodEnd: event.expiresAt,
    graceUntil: status === "grace" ? (event.graceUntil ?? event.expiresAt) : null,
    planInterval: intervalOf(event.productId),
    priceCents:
      event.price === null || !Number.isFinite(event.price) ? null : Math.round(event.price * 100),
    currency: event.currency,
    externalId: event.originalTransactionId,
  };
}

/**
 * Whether an event may overwrite the row it finds. RevenueCat may deliver late or twice; a renewal
 * moves the period end later, so an event whose period ends before the stored one is older news and
 * is dropped. An event with no end never overwrites an end already known.
 */
export function newerThanStored(change: StoreChange, storedEnd: Date | null): boolean {
  if (storedEnd === null) return true;
  if (change.currentPeriodEnd === null) return false;
  return change.currentPeriodEnd.getTime() >= storedEnd.getTime();
}

export type StoreEventOutcome =
  | "applied"
  | "ignored_type"
  | "stale"
  | "unknown_payer"
  | "unknown_member"
  | "not_organiser";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies one store event to the parent's subscription row. Her member row is locked first, as
 * "Start the 30 days" locks it, so two deliveries of the same or of crossing events are applied one
 * after the other and the later period end wins. Only an organiser of her family may pay for her;
 * anything else is answered as done and changes nothing, so RevenueCat stops retrying.
 */
export async function applyStoreEvent(
  deps: Pick<Deps, "db" | "clock">,
  event: StoreEvent,
): Promise<StoreEventOutcome> {
  const change = storeChange(event);
  if (change === null) return "ignored_type";
  if (event.memberId === null || !UUID.test(event.memberId)) return "unknown_member";
  const herId = event.memberId.toLowerCase();
  const now = deps.clock.now();

  return deps.db.transaction(async (tx) => {
    const [payer] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authSubject, event.appUserId))
      .limit(1);
    if (payer === undefined) return "unknown_payer";
    const [her] = await tx.select().from(members).where(eq(members.id, herId)).for("update");
    if (her === undefined || her.leftAt !== null || !isKeptLightMember(her))
      return "unknown_member";
    const [organiser] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.familyId, her.familyId),
          eq(members.userId, payer.id),
          eq(members.role, "organiser"),
          inArray(members.status, ["active", "paused"]),
        ),
      )
      .limit(1);
    if (organiser === undefined) return "not_organiser";

    const [existing] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.memberId, her.id))
      .limit(1);
    const row = {
      payerUserId: payer.id,
      provider: "revenuecat" as const,
      status: change.status,
      planInterval: change.planInterval,
      currency: change.currency,
      priceCents: change.priceCents,
      currentPeriodEnd: change.currentPeriodEnd,
      graceUntil: change.graceUntil,
      externalId: change.externalId,
    };
    if (existing === undefined) {
      await tx
        .insert(subscriptions)
        .values({ familyId: her.familyId, memberId: her.id, createdAt: now, ...row });
    } else {
      // The 30-day trial's row becomes the paid one; a store row is overwritten only by newer news.
      if (existing.provider === "revenuecat" && !newerThanStored(change, existing.currentPeriodEnd))
        return "stale";
      await tx.update(subscriptions).set(row).where(eq(subscriptions.id, existing.id));
    }
    // The plan's start and end are counted, as the trial's start is; a renewal or a cancelled
    // renewal is not a new start.
    const started =
      change.status === "active" &&
      (existing === undefined ||
        existing.provider !== "revenuecat" ||
        existing.status !== "active");
    if (started || change.status === "lapsed") {
      await recordEvent(
        tx,
        {
          name: started ? "plan_started" : "plan_lapsed",
          familyId: her.familyId,
          memberId: her.id,
          surface: "app",
          props: { source: "revenuecat", interval: change.planInterval ?? "unknown" },
        },
        now,
      );
    }
    return "applied";
  });
}
