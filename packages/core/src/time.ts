/**
 * Local calendar arithmetic in a member's IANA time zone, built only on `Intl` and `Date` so it runs
 * unchanged in Workers and Node. Instants are `Date` (UTC); calendar values are `LocalDate`
 * (`YYYY-MM-DD`) and `LocalTime` (`HH:MM`) strings interpreted in a zone.
 */
import type { LocalDate, LocalTime } from "@vela/contracts";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

// Building a DateTimeFormat costs far more than using one, and every schedule decision resolves
// several instants in the same zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

function wallClockOf(epochMs: number, timeZone: string): WallClock {
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    switch (part.type) {
      case "year":
        year = Number(part.value);
        break;
      case "month":
        month = Number(part.value);
        break;
      case "day":
        day = Number(part.value);
        break;
      case "hour":
        hour = Number(part.value);
        break;
      case "minute":
        minute = Number(part.value);
        break;
      case "second":
        second = Number(part.value);
        break;
    }
  }
  return { year, month, day, hour, minute, second };
}

/** Milliseconds of a wall-clock reading as if it were UTC; `Date.UTC` alone maps years 0–99 to 19xx. */
function wallMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute, second));
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

/** The zone's UTC offset in milliseconds at an instant, to the second (historical zones use seconds). */
function offsetAt(epochMs: number, timeZone: string): number {
  const wall = wallClockOf(epochMs, timeZone);
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  return wallMs(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second) - wholeSecond;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_PATTERN.exec(date);
  if (match !== null) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(wallMs(year, month, day));
    // An impossible month or day rolls the probe into a neighbouring month.
    if (probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day) {
      return { year, month, day };
    }
  }
  throw new RangeError(`not a local date (YYYY-MM-DD): ${date}`);
}

function parseLocalTime(time: LocalTime): { hour: number; minute: number } {
  const match = LOCAL_TIME_PATTERN.exec(time);
  if (match !== null) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour <= 23 && minute <= 59) {
      return { hour, minute };
    }
  }
  throw new RangeError(`not a local time (HH:MM): ${time}`);
}

/** The calendar date an instant falls on in the zone. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const wall = wallClockOf(instant.getTime(), timeZone);
  return formatDate(wall.year, wall.month, wall.day);
}

/** The wall-clock time an instant shows in the zone, truncated to the minute. */
export function localTimeOf(instant: Date, timeZone: string): LocalTime {
  const wall = wallClockOf(instant.getTime(), timeZone);
  return `${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`;
}

/**
 * The instant a local date and time names in the zone.
 *
 * A nonexistent local time (spring-forward gap) resolves to the first valid minute after the gap, so
 * an arrival still happens that day. A repeated local time (fall-back) resolves to the earlier
 * instant, so the day's gate is reached at the first occurrence.
 */
export function zonedInstant(date: LocalDate, time: LocalTime, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const { hour, minute } = parseLocalTime(time);
  const target = wallMs(year, month, day, hour, minute);

  // Offsets in effect a day either side of the target cover both sides of any transition that could
  // touch this wall time (no zone is more than 14 hours from UTC). From each probe, iterate
  // "instant = target − offset" until the offset stops changing. The map records, for each offset
  // estimate, the offset actually in effect at the instant it implies: the round trip.
  const roundTrip = new Map<number, number>();
  for (const probe of [target - DAY_MS, target, target + DAY_MS]) {
    let estimate = offsetAt(probe, timeZone);
    while (!roundTrip.has(estimate)) {
      const actual = offsetAt(target - estimate, timeZone);
      roundTrip.set(estimate, actual);
      estimate = actual;
    }
  }

  let earliestValid: number | null = null;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const [estimate, actual] of roundTrip) {
    lowest = Math.min(lowest, estimate);
    highest = Math.max(highest, estimate);
    if (estimate === actual) {
      const candidate = target - estimate;
      earliestValid = earliestValid === null ? candidate : Math.min(earliestValid, candidate);
    }
  }
  if (earliestValid !== null) {
    return new Date(earliestValid);
  }

  // The wall time falls in a gap. The transition lies between reading the target with the larger
  // offset and with the smaller one; find the first whole minute whose wall clock reaches the target.
  let low = Math.floor((target - highest) / MINUTE_MS);
  let high = Math.ceil((target - lowest) / MINUTE_MS);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const wall = wallClockOf(middle * MINUTE_MS, timeZone);
    const reached =
      wallMs(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second) >= target;
    if (reached) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return new Date(low * MINUTE_MS);
}

/** Calendar arithmetic on a local date; `days` may be negative. */
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be an integer: ${days}`);
  }
  const { year, month, day } = parseLocalDate(date);
  const shifted = new Date(wallMs(year, month, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday. A calendar date has the same weekday in every zone. */
export function weekdayOf(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(wallMs(year, month, day)).getUTCDay();
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS);
}

/** Whole minutes from `from` to `to`, floored, so it is negative whenever `to` is before `from`. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);
}

/**
 * True for a named zone the runtime's time zone data recognises. Fixed offsets such as `+08:00` are
 * refused even though `Intl` accepts them: a member stored with an offset would silently lose
 * daylight saving and receive her morning an hour off for half the year.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
    return !/^[+-]/.test(resolved);
  } catch {
    return false;
  }
}

/**
 * The time as shown in copy (`{time}`, `{sent}`, `{usual}`): the same 24-hour wall clock the
 * scheduler uses, so what the family reads matches when things happened.
 */
export function formatLocalTime(instant: Date, timeZone: string): LocalTime {
  return localTimeOf(instant, timeZone);
}
