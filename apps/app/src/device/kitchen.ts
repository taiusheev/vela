import type { ApiDeviceMessage } from "@vela/contracts";

/**
 * Kitchen-table mode (spec §14.2 P6), apart from the screen: when her phone or tablet shows it, the
 * photos it cycles, and the clock and date in her language.
 */

/**
 * A woken screen goes back to the table after this long without a touch: longer than her longest
 * recording (five minutes), so the table never takes the screen from her while she speaks.
 */
export const IDLE_MS = 6 * 60 * 1_000;
/** Each photo stays this long before the next. */
export const CYCLE_MS = 12 * 1_000;

/**
 * Her screen is the kitchen table when it is held on its side: wider than tall by a clear margin,
 * as a tablet on its stand or a phone propped against the fruit bowl is.
 */
export function isKitchenTable(width: number, height: number): boolean {
  return width > height * 1.2;
}

/** The family's photos in her latest messages, newest first and each once, for the table to cycle. */
export function photosToCycle(messages: readonly Pick<ApiDeviceMessage, "photos">[]): string[] {
  return [...new Set(messages.flatMap((message) => message.photos))];
}

/** The photo shown at `elapsedMs` into the cycle, or undefined when there are none. */
export function photoAt(photos: readonly string[], elapsedMs: number): string | undefined {
  if (photos.length === 0) return undefined;
  return photos[Math.floor(Math.max(elapsedMs, 0) / CYCLE_MS) % photos.length];
}

function localeOf(language: string): string {
  return language === "zh-TW" ? "zh-TW" : "en-GB";
}

/** The time on the table's clock, in her language: 08:05 or 上午08:05. */
export function tableClock(at: Date, language: string): string {
  return at.toLocaleTimeString(localeOf(language), { hour: "2-digit", minute: "2-digit" });
}

/** The table's date, in her language: Monday 12 October, or 10月12日 星期一. */
export function tableDate(at: Date, language: string): string {
  return at.toLocaleDateString(localeOf(language), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
