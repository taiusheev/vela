import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  formatLocalTime,
  isValidTimeZone,
  localDateOf,
  localTimeOf,
  minutesBetween,
  weekdayOf,
  zonedInstant,
} from "./time.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function wallOf(instant: Date, zone: string): string {
  return `${localDateOf(instant, zone)}T${localTimeOf(instant, zone)}`;
}

function offsetMinutes(ms: number, zone: string): number {
  const wallAsUtc = Date.parse(`${wallOf(new Date(ms), zone)}:00Z`);
  return (wallAsUtc - Math.floor(ms / MINUTE) * MINUTE) / MINUTE;
}

const SWEEP_START = Date.parse("2026-01-01T00:00:00Z");
const SWEEP_END = Date.parse("2027-01-01T00:00:00Z");

/** Six-hourly samples across 2026 at which the zone's offset differs from the previous sample. */
function offsetChanges(zone: string): number[] {
  const changes: number[] = [];
  let previous = offsetMinutes(SWEEP_START, zone);
  for (let ms = SWEEP_START; ms < SWEEP_END; ms += 6 * HOUR) {
    const offset = offsetMinutes(ms, zone);
    if (offset !== previous) {
      changes.push(ms);
      previous = offset;
    }
  }
  return changes;
}

/**
 * Instants across 2026: a sparse sweep, plus every five minutes around each offset change, so every
 * gap and every repeated hour is exercised.
 */
function instantsAroundTransitions(zone: string): number[] {
  const instants: number[] = [];
  for (let ms = SWEEP_START; ms < SWEEP_END; ms += 24 * HOUR + 67 * MINUTE) {
    instants.push(ms);
  }
  for (const change of offsetChanges(zone)) {
    for (let dense = change - 9 * HOUR; dense <= change + 3 * HOUR; dense += 5 * MINUTE) {
      instants.push(dense);
    }
  }
  return instants;
}

/** Every fifth local date of 2026, plus the local dates either side of each offset change. */
function datesAroundTransitions(zone: string): string[] {
  const dates = new Set<string>();
  for (let date = "2026-01-01"; date < "2027-01-01"; date = addDays(date, 5)) {
    dates.add(date);
  }
  for (const change of offsetChanges(zone)) {
    const date = localDateOf(new Date(change - 6 * HOUR), zone);
    for (const shift of [-1, 0, 1, 2]) {
      dates.add(addDays(date, shift));
    }
  }
  return [...dates];
}

const ZONES = [
  "UTC",
  "America/New_York",
  "America/St_Johns",
  "America/Santiago",
  "America/Sao_Paulo",
  "Europe/Berlin",
  "Europe/London",
  "Africa/Casablanca",
  "Asia/Tehran",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Taipei",
  "Australia/Adelaide",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
] as const;

function iso(instant: Date): string {
  return instant.toISOString();
}

describe("zonedInstant", () => {
  it("round-trips every instant's local date and time back to that instant, or to the earlier of a repeated time", () => {
    const failures: string[] = [];
    for (const zone of ZONES) {
      for (const ms of instantsAroundTransitions(zone)) {
        const instant = new Date(ms);
        const wall = wallOf(instant, zone);
        const [date = "", time = ""] = wall.split("T");
        const resolved = zonedInstant(date, time, zone);
        const earlierBy = Math.floor(ms / MINUTE) * MINUTE - resolved.getTime();
        if (wallOf(resolved, zone) !== wall || earlierBy < 0 || earlierBy > 2 * HOUR) {
          failures.push(`${zone} ${iso(instant)} (${wall}) → ${iso(resolved)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("maps every local wall time to an instant showing that time, or to the first minute after a gap", () => {
    const failures: string[] = [];
    for (const zone of ZONES) {
      for (const date of datesAroundTransitions(zone)) {
        for (const time of ["00:00", "00:30", "01:45", "02:15", "02:30", "03:00", "23:59"]) {
          const wanted = `${date}T${time}`;
          const resolved = zonedInstant(date, time, zone);
          const shown = wallOf(resolved, zone);
          if (shown === wanted) {
            continue;
          }
          const before = wallOf(addMinutes(resolved, -1), zone);
          if (!(shown > wanted && before < wanted)) {
            failures.push(`${zone} ${wanted} → ${shown} (a minute earlier: ${before})`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("sweeps instants inside repeated local hours, not only around them", () => {
    const repeated = instantsAroundTransitions("America/New_York").filter((ms) => {
      const wall = wallOf(new Date(ms), "America/New_York");
      const [date = "", time = ""] = wall.split("T");
      return (
        zonedInstant(date, time, "America/New_York").getTime() < Math.floor(ms / MINUTE) * MINUTE
      );
    });
    expect(repeated.length).toBeGreaterThan(0);
  });

  it("resolves the America/New_York spring-forward gap to 03:00", () => {
    const zone = "America/New_York";
    expect(iso(zonedInstant("2026-03-08", "01:59", zone))).toBe("2026-03-08T06:59:00.000Z");
    expect(iso(zonedInstant("2026-03-08", "02:00", zone))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(zonedInstant("2026-03-08", "02:30", zone))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(zonedInstant("2026-03-08", "02:59", zone))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(zonedInstant("2026-03-08", "03:00", zone))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(zonedInstant("2026-03-08", "08:00", zone))).toBe("2026-03-08T12:00:00.000Z");
  });

  it("resolves the America/New_York fall-back repeat to the earlier instant", () => {
    const zone = "America/New_York";
    expect(iso(zonedInstant("2026-11-01", "00:59", zone))).toBe("2026-11-01T04:59:00.000Z");
    expect(iso(zonedInstant("2026-11-01", "01:00", zone))).toBe("2026-11-01T05:00:00.000Z");
    expect(iso(zonedInstant("2026-11-01", "01:30", zone))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(zonedInstant("2026-11-01", "02:00", zone))).toBe("2026-11-01T07:00:00.000Z");
    expect(iso(zonedInstant("2026-11-01", "08:00", zone))).toBe("2026-11-01T13:00:00.000Z");
  });

  it("handles both Europe/Berlin transitions", () => {
    const zone = "Europe/Berlin";
    expect(iso(zonedInstant("2026-03-29", "01:59", zone))).toBe("2026-03-29T00:59:00.000Z");
    expect(iso(zonedInstant("2026-03-29", "02:30", zone))).toBe("2026-03-29T01:00:00.000Z");
    expect(iso(zonedInstant("2026-03-29", "03:00", zone))).toBe("2026-03-29T01:00:00.000Z");
    expect(iso(zonedInstant("2026-10-25", "02:30", zone))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(zonedInstant("2026-10-25", "03:00", zone))).toBe("2026-10-25T02:00:00.000Z");
    expect(iso(zonedInstant("2026-10-25", "01:59", zone))).toBe("2026-10-24T23:59:00.000Z");
  });

  it("handles Australia/Lord_Howe's 30-minute shifts", () => {
    const zone = "Australia/Lord_Howe";
    // Spring forward on 2026-10-04: 02:00 +10:30 becomes 02:30 +11:00.
    expect(iso(zonedInstant("2026-10-04", "01:59", zone))).toBe("2026-10-03T15:29:00.000Z");
    expect(iso(zonedInstant("2026-10-04", "02:15", zone))).toBe("2026-10-03T15:30:00.000Z");
    expect(iso(zonedInstant("2026-10-04", "02:30", zone))).toBe("2026-10-03T15:30:00.000Z");
    // Fall back on 2026-04-05: 02:00 +11:00 becomes 01:30 +10:30, so 01:30–01:59 happen twice.
    expect(iso(zonedInstant("2026-04-05", "01:29", zone))).toBe("2026-04-04T14:29:00.000Z");
    expect(iso(zonedInstant("2026-04-05", "01:45", zone))).toBe("2026-04-04T14:45:00.000Z");
    expect(iso(zonedInstant("2026-04-05", "02:00", zone))).toBe("2026-04-04T15:30:00.000Z");
  });

  it("uses a fixed offset in Asia/Taipei all year", () => {
    const zone = "Asia/Taipei";
    expect(iso(zonedInstant("2026-01-15", "08:00", zone))).toBe("2026-01-15T00:00:00.000Z");
    expect(iso(zonedInstant("2026-07-15", "08:00", zone))).toBe("2026-07-15T00:00:00.000Z");
    expect(iso(zonedInstant("2026-09-13", "00:00", zone))).toBe("2026-09-12T16:00:00.000Z");
  });

  it("handles Asia/Kolkata's half-hour offset", () => {
    const zone = "Asia/Kolkata";
    expect(iso(zonedInstant("2026-09-13", "08:00", zone))).toBe("2026-09-13T02:30:00.000Z");
    expect(iso(zonedInstant("2026-01-01", "00:15", zone))).toBe("2025-12-31T18:45:00.000Z");
  });

  it("rejects malformed dates and times", () => {
    expect(() => zonedInstant("2026-02-30", "08:00", "UTC")).toThrow(RangeError);
    expect(() => zonedInstant("2026-9-13", "08:00", "UTC")).toThrow(RangeError);
    expect(() => zonedInstant("2026-09-13", "24:00", "UTC")).toThrow(RangeError);
    expect(() => zonedInstant("2026-09-13", "8:00", "UTC")).toThrow(RangeError);
    expect(() => zonedInstant("2026-09-13", "08:00", "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("localDateOf and localTimeOf", () => {
  it("read the wall clock in the zone, not in UTC", () => {
    const instant = new Date("2026-09-12T16:30:45Z");
    expect(localDateOf(instant, "Asia/Taipei")).toBe("2026-09-13");
    expect(localTimeOf(instant, "Asia/Taipei")).toBe("00:30");
    expect(localDateOf(instant, "America/New_York")).toBe("2026-09-12");
    expect(localTimeOf(instant, "America/New_York")).toBe("12:30");
    expect(localTimeOf(new Date("2026-01-01T00:00:00Z"), "Asia/Kolkata")).toBe("05:30");
  });

  it("show midnight as 00:00, never 24:00", () => {
    expect(localTimeOf(new Date("2026-09-13T16:00:00Z"), "Asia/Taipei")).toBe("00:00");
  });

  it("truncate rather than round to the minute", () => {
    expect(localTimeOf(new Date("2026-09-13T00:59:59.999Z"), "UTC")).toBe("00:59");
  });

  it("formatLocalTime shows the scheduler's wall clock", () => {
    expect(formatLocalTime(new Date("2026-03-08T07:00:00Z"), "America/New_York")).toBe("03:00");
  });
});

describe("addDays", () => {
  it("crosses month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses year ends in both directions", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-09-13", 365)).toBe("2027-09-13");
  });

  it("follows leap-year rules", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("returns the same date for zero days", () => {
    expect(addDays("2026-09-13", 0)).toBe("2026-09-13");
  });

  it("rejects fractional days and impossible dates", () => {
    expect(() => addDays("2026-09-13", 0.5)).toThrow(RangeError);
    expect(() => addDays("2026-02-29", 1)).toThrow(RangeError);
    expect(() => addDays("2026-13-01", 1)).toThrow(RangeError);
  });
});

describe("weekdayOf", () => {
  it("numbers Sunday as 0 through Saturday as 6", () => {
    expect(weekdayOf("2026-09-13")).toBe(0);
    expect(weekdayOf("2026-09-14")).toBe(1);
    expect(weekdayOf("2026-09-19")).toBe(6);
    expect(weekdayOf("2028-02-29")).toBe(2);
    expect(weekdayOf("2027-01-01")).toBe(5);
  });
});

describe("addMinutes", () => {
  it("adds elapsed minutes regardless of the wall clock", () => {
    expect(iso(addMinutes(new Date("2026-03-08T06:30:00Z"), 60))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(addMinutes(new Date("2026-03-08T06:30:00Z"), -90))).toBe("2026-03-08T05:00:00.000Z");
  });
});

describe("minutesBetween", () => {
  const from = new Date("2026-09-13T08:00:00Z");

  it("is positive when to is after from", () => {
    expect(minutesBetween(from, new Date("2026-09-13T09:30:00Z"))).toBe(90);
  });

  it("floors partial minutes", () => {
    expect(minutesBetween(from, new Date("2026-09-13T08:00:59.999Z"))).toBe(0);
    expect(minutesBetween(from, new Date("2026-09-13T08:01:00Z"))).toBe(1);
  });

  it("is negative when to is before from, flooring towards minus infinity", () => {
    expect(minutesBetween(from, new Date("2026-09-13T07:59:59.999Z"))).toBe(-1);
    expect(minutesBetween(from, new Date("2026-09-13T07:59:00Z"))).toBe(-1);
    expect(minutesBetween(from, new Date("2026-09-13T07:58:59Z"))).toBe(-2);
  });

  it("is zero for the same instant", () => {
    expect(minutesBetween(from, new Date(from.getTime()))).toBe(0);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zone names", () => {
    expect(isValidTimeZone("Asia/Taipei")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects unknown names, empty strings, and fixed offsets", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("+08:00")).toBe(false);
  });
});
