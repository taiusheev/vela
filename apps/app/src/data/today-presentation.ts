import type { Today, TodayExchange, TodayLight } from "./today.ts";

export interface TodayParentRow {
  recipientId: string;
  recipient: string;
  light?: TodayLight;
  exchanges: TodayExchange[];
}

/** Keep every parent and every exchange, including a delivered exchange without a light. */
export function todayParentRows(today: Today): TodayParentRow[] {
  const rows = today.lights.map(
    (light): TodayParentRow => ({
      recipientId: light.memberId,
      recipient: light.displayName,
      light,
      exchanges: [],
    }),
  );
  const byRecipient = new Map(rows.map((row) => [row.recipientId, row]));
  for (const exchange of today.exchanges) {
    let row = byRecipient.get(exchange.recipientId);
    if (row === undefined) {
      row = {
        recipientId: exchange.recipientId,
        recipient: exchange.recipient,
        exchanges: [],
      };
      rows.push(row);
      byRecipient.set(exchange.recipientId, row);
    }
    row.exchanges.push(exchange);
  }
  return rows;
}

/** A consent invitation cannot become an answered window because of stale answer metadata. */
export function parentAnsweredToday(light: TodayLight): boolean {
  return light.invited !== true && (light.state === "lit" || light.answerReceived === true);
}

/** Pending arrivals have no delivered detail resource, even if another exchange can be opened. */
export function openableExchange(row: TodayParentRow): TodayExchange | undefined {
  return row.exchanges.find((exchange) => exchange.deliveryPending !== true);
}
