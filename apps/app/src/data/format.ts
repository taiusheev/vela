/**
 * Times and dates as the app's English copy says them: "8:12", "12 Oct", "Thursday". They are
 * written in English whatever the device's language, so a sentence never mixes an English verb
 * with another language's month; each language's own forms come with its copy (Lingui, build plan
 * 3.1).
 */
const LOCALE = "en-GB";

function valid(instant: string): Date | null {
  const at = new Date(instant);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** "8:12": the clock time of an instant, in the reader's own zone. */
export function timeOfDay(instant: string): string {
  const at = valid(instant);
  return at === null ? "" : at.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
}

/** "12 Oct". */
export function dayMonth(instant: string): string {
  const at = valid(instant);
  return at === null ? "" : at.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

/** "Thursday": the weekday of an instant, in the reader's own zone. */
export function weekday(instant: string): string {
  const at = valid(instant);
  return at === null ? "" : at.toLocaleDateString(LOCALE, { weekday: "long" });
}

/** A local date as the day it names, for copy that must not say "tomorrow" about Thursday. */
export function dayName(date: string): string {
  const day = valid(`${date}T00:00:00Z`);
  return day === null ? date : day.toLocaleDateString(LOCALE, { weekday: "long", timeZone: "UTC" });
}
