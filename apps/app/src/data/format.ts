import { i18n } from "@lingui/core";

/**
 * Times, dates and lists in the app's language, so a sentence never mixes an English verb with
 * another language's month. English stays en-GB: "8:12", "12 Oct", "Thursday", "Lena, Petro".
 * Traditional Chinese reads "08:12", "10月12日", "星期四", "Lena、Petro", its times on the 24-hour
 * clock as the bot writes them (`packages/core/src/time.ts`). Each reads the language active when
 * it is called, which is while a screen renders.
 */

function chinese(): boolean {
  return i18n.locale === "zh-TW";
}

function dateLocale(): string {
  return chinese() ? "zh-TW" : "en-GB";
}

function valid(instant: string): Date | null {
  const at = new Date(instant);
  return Number.isFinite(at.getTime()) ? at : null;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** "8:12", or "08:12" in Chinese: the clock time of an instant, in the reader's own zone. */
export function timeOfDay(instant: string): string {
  const at = valid(instant);
  if (at === null) return "";
  // Written out rather than asked of Intl: plain zh-TW formats as 上午8:12, and whether an engine
  // honours a 24-hour cycle for it differs between Hermes and the browsers.
  if (chinese()) return clockTime(at.getHours(), at.getMinutes());
  return at.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

/**
 * "8:12", or "08:12" in Chinese: a time on the clock with no instant behind it, written as
 * `timeOfDay` writes one. The example days use it, so they read like a real day in either language.
 */
export function clockTime(hour: number, minute: number): string {
  return `${chinese() ? twoDigits(hour) : hour}:${twoDigits(minute)}`;
}

/** "12 Oct", or "10月12日". */
export function dayMonth(instant: string): string {
  const at = valid(instant);
  return at === null ? "" : at.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });
}

/** "Thursday", or "星期四": the weekday of an instant, in the reader's own zone. */
export function weekday(instant: string): string {
  const at = valid(instant);
  return at === null ? "" : at.toLocaleDateString(dateLocale(), { weekday: "long" });
}

/** A local date as the day it names, for copy that must not say "tomorrow" about Thursday. */
export function dayName(date: string): string {
  const day = valid(`${date}T00:00:00Z`);
  return day === null
    ? date
    : day.toLocaleDateString(dateLocale(), { weekday: "long", timeZone: "UTC" });
}

/**
 * Names as one list: "Lena, Petro, Igor", or "Lena、Petro、Igor" with the Chinese enumeration
 * comma. Joined by hand because Hermes has no `Intl.ListFormat`.
 */
export function listOf(items: readonly string[]): string {
  return items.join(chinese() ? "、" : ", ");
}
