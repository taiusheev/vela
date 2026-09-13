import type { LocalDate, LocalTime, MemberStatus } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import {
  type DayState,
  type DueAction,
  decideSchedule,
  SCHEDULE,
  type ScheduleDecision,
} from "./schedule.ts";
import { addDays, addMinutes, zonedInstant } from "./time.ts";

const ZONE = "Asia/Taipei";
/** A Wednesday. */
const TODAY = "2026-09-16";
const YESTERDAY = "2026-09-15";
const TOMORROW = "2026-09-17";
const SUNDAY = "2026-09-20";

interface Scenario {
  now: Date;
  zone?: string;
  arrivalTime?: LocalTime;
  status?: MemberStatus;
  lightOn?: boolean;
  quietAfterMinutes?: number;
  startsOn?: LocalDate | null;
  learningUntil?: LocalDate | null;
  turnsEnabled?: boolean;
  days?: DayState[];
  prepared?: boolean;
  turnPromptSent?: boolean;
  away?: LocalDate[];
  weeklyReadsDone?: LocalDate[];
}

function decide(scenario: Scenario): ScheduleDecision {
  return decideSchedule({
    now: scenario.now,
    member: {
      timeZone: scenario.zone ?? ZONE,
      arrivalTime: scenario.arrivalTime ?? "08:00",
      status: scenario.status ?? "active",
      lightOn: scenario.lightOn ?? true,
      quietAfterMinutes: scenario.quietAfterMinutes ?? 360,
      startsOn: scenario.startsOn ?? null,
      learningUntil: scenario.learningUntil ?? null,
    },
    family: { turnsEnabled: scenario.turnsEnabled ?? true },
    days: scenario.days ?? [],
    tomorrow: {
      prepared: scenario.prepared ?? false,
      turnPromptSent: scenario.turnPromptSent ?? false,
    },
    awayOn: (date) => (scenario.away ?? []).includes(date),
    weeklyReadDoneFor: (weekEnd) => (scenario.weeklyReadsDone ?? []).includes(weekEnd),
  });
}

function taipei(time: LocalTime, date: LocalDate = TODAY): Date {
  return zonedInstant(date, time, ZONE);
}

function day(date: LocalDate, fields: Partial<Omit<DayState, "date">> = {}): DayState {
  return {
    date,
    prepared: true,
    deliveredAt: null,
    deliveryFailed: false,
    answeredAt: null,
    repeatSentAt: null,
    quiet: null,
    ...fields,
  };
}

/** Today delivered at 08:00, unanswered, with the repeat already sent. */
function deliveredToday(fields: Partial<Omit<DayState, "date">> = {}): DayState {
  return day(TODAY, { deliveredAt: taipei("08:00"), repeatSentAt: taipei("10:30"), ...fields });
}

function quiet(fields: Partial<NonNullable<DayState["quiet"]>> = {}): DayState["quiet"] {
  return {
    openedAt: taipei("14:00"),
    lastNotifiedAt: taipei("14:00"),
    waitUntil: null,
    resolvedAt: null,
    ...fields,
  };
}

function iso(instant: Date | null): string | null {
  return instant === null ? null : instant.toISOString();
}

describe("inactive members", () => {
  it("decides nothing and never wakes while the light is off", () => {
    expect(decide({ now: taipei("08:00"), lightOn: false })).toEqual({ due: [], nextWakeAt: null });
  });

  it("decides nothing and never wakes for members who are not active", () => {
    for (const status of ["invited", "paused", "left", "deceased"] as const) {
      const decision = decide({
        now: taipei("23:00"),
        status,
        days: [day(TODAY, { deliveredAt: taipei("08:00") })],
      });
      expect(decision).toEqual({ due: [], nextWakeAt: null });
    }
  });
});

describe("arrival", () => {
  it("delivers today's arrival exactly at her arrival time", () => {
    expect(decide({ now: taipei("08:00") }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
    ]);
  });

  it("delivers nothing one minute before her arrival time and wakes at it", () => {
    const decision = decide({ now: taipei("07:59") });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("08:00")));
  });

  it("is not marked late at exactly three hours", () => {
    expect(decide({ now: taipei("11:00") }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
    ]);
  });

  it("is marked late one minute past three hours", () => {
    expect(decide({ now: taipei("11:01") }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: true },
    ]);
  });

  it("still delivers one minute before the prepare time", () => {
    expect(decide({ now: taipei("21:59"), turnPromptSent: true }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: true },
    ]);
  });

  it("skips the day at the prepare time", () => {
    const due = decide({ now: taipei("22:00") }).due;
    expect(due.map((action) => action.kind)).not.toContain("deliver_arrival");
  });

  it("never delivers twice in a day", () => {
    const decision = decide({ now: taipei("08:01"), days: [deliveredToday()] });
    expect(decision.due).toEqual([]);
  });

  it("does not retry a delivery that failed", () => {
    const decision = decide({ now: taipei("09:00"), days: [day(TODAY, { deliveryFailed: true })] });
    expect(decision.due).toEqual([]);
  });

  it("wakes for the repeat of the arrival it is delivering now", () => {
    const decision = decide({ now: taipei("08:00") });
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("10:30")));
  });

  it("does not wake for the ladder of an arrival that will not need one", () => {
    const away = decide({ now: taipei("08:00"), away: [TODAY] });
    expect(away.due).toEqual([{ kind: "deliver_arrival", date: TODAY, late: false }]);
    expect(iso(away.nextWakeAt)).toBe(iso(taipei("19:00")));
    const answeredEarly = decide({
      now: taipei("08:00"),
      days: [day(TODAY, { answeredAt: taipei("07:00") })],
    });
    expect(answeredEarly.due).toEqual([{ kind: "deliver_arrival", date: TODAY, late: false }]);
    expect(iso(answeredEarly.nextWakeAt)).toBe(iso(taipei("19:00")));
  });

  it("delivers an arrival time at or after the prepare time until the end of her day", () => {
    const base = { arrivalTime: "22:30", prepared: true } as const;
    expect(decide({ ...base, now: taipei("22:29") }).due).toEqual([]);
    expect(iso(decide({ ...base, now: taipei("22:29") }).nextWakeAt)).toBe(iso(taipei("22:30")));
    expect(decide({ ...base, now: taipei("22:30") }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
    ]);
    expect(decide({ ...base, now: taipei("23:59") }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
    ]);
  });

  it("delivers at 03:00 when 02:30 does not exist (America/New_York spring forward)", () => {
    const zone = "America/New_York";
    const before = decide({ zone, arrivalTime: "02:30", now: new Date("2026-03-08T06:59:00Z") });
    expect(before.due).toEqual([]);
    expect(iso(before.nextWakeAt)).toBe("2026-03-08T07:00:00.000Z");
    const at = decide({ zone, arrivalTime: "02:30", now: new Date("2026-03-08T07:00:00Z") });
    expect(at.due).toEqual([{ kind: "deliver_arrival", date: "2026-03-08", late: false }]);
  });

  it("delivers once, at the first 02:30, when 02:30 happens twice (Europe/Berlin fall back)", () => {
    const zone = "Europe/Berlin";
    const first = decide({ zone, arrivalTime: "02:30", now: new Date("2026-10-25T00:30:00Z") });
    expect(first.due).toEqual([{ kind: "deliver_arrival", date: "2026-10-25", late: false }]);
    const second = decide({
      zone,
      arrivalTime: "02:30",
      now: new Date("2026-10-25T01:30:00Z"),
      days: [day("2026-10-25", { deliveredAt: new Date("2026-10-25T00:30:00Z") })],
    });
    expect(second.due).toEqual([]);
  });

  it("wakes for the next 08:00 arrival across a spring-forward night, 23 hours after the last", () => {
    const decision = decide({
      zone: "America/New_York",
      now: new Date("2026-03-08T03:30:00Z"),
      prepared: true,
      days: [
        day("2026-03-07", {
          deliveredAt: new Date("2026-03-07T13:00:00Z"),
          answeredAt: new Date("2026-03-07T13:30:00Z"),
        }),
      ],
    });
    expect(iso(decision.nextWakeAt)).toBe("2026-03-08T12:00:00.000Z");
  });
});

describe("start date", () => {
  it("delivers no arrival on a day before her start date, all through the arrival window", () => {
    for (const time of ["08:00", "11:01", "21:59"] as const) {
      const decision = decide({ now: taipei(time), startsOn: TOMORROW, turnPromptSent: true });
      expect(decision.due).toEqual([]);
    }
  });

  it("does not wake for an arrival time before her start date", () => {
    const decision = decide({ now: taipei("07:59"), startsOn: TOMORROW });
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("19:00")));
  });

  it("delivers from her start date itself at her arrival time", () => {
    expect(decide({ now: taipei("08:00"), startsOn: TODAY }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
    ]);
    const eve = decide({ now: taipei("22:01"), startsOn: TOMORROW, prepared: true });
    expect(iso(eve.nextWakeAt)).toBe(iso(taipei("08:00", TOMORROW)));
    expect(decide({ now: taipei("08:00", TOMORROW), startsOn: TOMORROW }).due).toEqual([
      { kind: "deliver_arrival", date: TOMORROW, late: false },
    ]);
  });

  it("wakes for the first arrival on her start date, not for a morning before it", () => {
    const startsOn = addDays(TODAY, 2);
    const decision = decide({
      now: taipei("22:01"),
      startsOn,
      prepared: true,
      turnsEnabled: false,
    });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("22:00", TOMORROW)));
    const lastEve = decide({
      now: taipei("22:01", TOMORROW),
      startsOn,
      prepared: true,
      turnsEnabled: false,
    });
    expect(iso(lastEve.nextWakeAt)).toBe(iso(taipei("08:00", startsOn)));
  });

  it("neither repeats nor turns quiet for an exchange delivered before her start date", () => {
    const early = day(TODAY, { deliveredAt: taipei("08:00") });
    const decision = decide({ now: taipei("16:00"), startsOn: TOMORROW, days: [early] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("19:00")));
    const yesterday = day(YESTERDAY, { deliveredAt: taipei("08:00", YESTERDAY) });
    expect(decide({ now: taipei("07:00"), startsOn: TODAY, days: [yesterday] }).due).toEqual([]);
  });
});

describe("repeat", () => {
  const unansweredToday = day(TODAY, { deliveredAt: taipei("08:00") });

  it("sends the repeat exactly 150 minutes after delivery", () => {
    expect(decide({ now: taipei("10:30"), days: [unansweredToday] }).due).toEqual([
      { kind: "send_repeat", date: TODAY },
    ]);
  });

  it("sends no repeat one minute before and wakes for it", () => {
    const decision = decide({ now: taipei("10:29"), days: [unansweredToday] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("10:30")));
  });

  it("counts from delivery, not from the arrival time", () => {
    const lateDelivery = day(TODAY, { deliveredAt: taipei("09:00") });
    expect(decide({ now: taipei("10:30"), days: [lateDelivery] }).due).toEqual([]);
    expect(decide({ now: taipei("11:30"), days: [lateDelivery] }).due).toEqual([
      { kind: "send_repeat", date: TODAY },
    ]);
  });

  it("sends no repeat once she has answered", () => {
    const answered = day(TODAY, { deliveredAt: taipei("08:00"), answeredAt: taipei("10:00") });
    expect(decide({ now: taipei("10:30"), days: [answered] }).due).toEqual([]);
  });

  it("sends the repeat only once", () => {
    expect(decide({ now: taipei("12:00"), days: [deliveredToday()] }).due).toEqual([]);
  });

  it("sends no repeat and does not wake for one on a day whose delivery failed", () => {
    const failed = day(TODAY, { deliveredAt: taipei("08:00"), deliveryFailed: true });
    expect(decide({ now: taipei("10:30"), days: [failed] }).due).toEqual([]);
    const before = decide({ now: taipei("10:29"), days: [failed] });
    expect(iso(before.nextWakeAt)).toBe(iso(taipei("19:00")));
    const yesterdayFailed = day(YESTERDAY, {
      deliveredAt: taipei("08:00", YESTERDAY),
      deliveryFailed: true,
    });
    expect(decide({ now: taipei("07:00"), days: [yesterdayFailed] }).due).toEqual([]);
  });
});

describe("away", () => {
  it("neither repeats nor turns quiet on a day she is away", () => {
    const unanswered = day(TODAY, { deliveredAt: taipei("08:00") });
    const decision = decide({ now: taipei("18:00"), days: [unanswered], away: [TODAY] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("19:00")));
  });

  it("still delivers the arrival on a day she is away", () => {
    expect(decide({ now: taipei("08:00"), away: [TODAY] }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
    ]);
  });

  it("sends no waited quiet notice once she is away", () => {
    const waited = deliveredToday({ quiet: quiet({ waitUntil: taipei("16:00") }) });
    expect(decide({ now: taipei("16:00"), days: [waited], away: [TODAY] }).due).toEqual([]);
  });
});

describe("quiet", () => {
  it("opens quiet with a notice exactly quietAfterMinutes after delivery", () => {
    expect(decide({ now: taipei("14:00"), days: [deliveredToday()] }).due).toEqual([
      { kind: "open_quiet", date: TODAY, notify: true },
    ]);
  });

  it("does not open quiet one minute before and wakes for it", () => {
    const decision = decide({ now: taipei("13:59"), days: [deliveredToday()] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("14:00")));
  });

  it("uses the member's tuned threshold", () => {
    const tuned = { days: [deliveredToday()], quietAfterMinutes: 420 };
    expect(decide({ ...tuned, now: taipei("14:59") }).due).toEqual([]);
    expect(decide({ ...tuned, now: taipei("15:00") }).due).toEqual([
      { kind: "open_quiet", date: TODAY, notify: true },
    ]);
  });

  it("counts no time before a late delivery", () => {
    const late = day(TODAY, { deliveredAt: taipei("11:30"), repeatSentAt: taipei("14:00") });
    expect(decide({ now: taipei("17:29"), days: [late] }).due).toEqual([]);
    expect(decide({ now: taipei("17:30"), days: [late] }).due).toEqual([
      { kind: "open_quiet", date: TODAY, notify: true },
    ]);
  });

  it("never opens quiet on a day whose delivery failed", () => {
    const failed = day(TODAY, { deliveryFailed: true });
    expect(decide({ now: taipei("21:00"), turnPromptSent: true, days: [failed] }).due).toEqual([]);
    const failedAfterSending = deliveredToday({ deliveryFailed: true });
    const decision = decide({ now: taipei("18:00"), days: [failedAfterSending] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("19:00")));
  });

  it("never notifies a quiet on a day whose delivery failed", () => {
    const failed = deliveredToday({
      deliveryFailed: true,
      quiet: quiet({ lastNotifiedAt: null, waitUntil: taipei("15:00") }),
    });
    expect(decide({ now: taipei("16:00"), days: [failed] }).due).toEqual([]);
  });

  it("does not open quiet once she has answered", () => {
    const answered = deliveredToday({ answeredAt: taipei("13:59") });
    expect(decide({ now: taipei("14:00"), days: [answered] }).due).toEqual([]);
  });

  it("does not open quiet twice", () => {
    const opened = deliveredToday({ quiet: quiet() });
    const decision = decide({ now: taipei("15:00"), days: [opened] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("19:00")));
  });
});

describe("learning period", () => {
  const learning = { learningUntil: TOMORROW, days: [deliveredToday()] };

  it("opens quiet in the app only and wakes for the push at 480 minutes", () => {
    const decision = decide({ ...learning, now: taipei("14:00") });
    expect(decision.due).toEqual([{ kind: "open_quiet", date: TODAY, notify: false }]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("16:00")));
  });

  it("pushes the in-app quiet exactly 480 minutes after delivery", () => {
    const inApp = deliveredToday({ quiet: quiet({ lastNotifiedAt: null }) });
    const before = decide({ learningUntil: TOMORROW, now: taipei("15:59"), days: [inApp] });
    expect(before.due).toEqual([]);
    expect(iso(before.nextWakeAt)).toBe(iso(taipei("16:00")));
    expect(decide({ learningUntil: TOMORROW, now: taipei("16:00"), days: [inApp] }).due).toEqual([
      { kind: "notify_quiet", date: TODAY },
    ]);
  });

  it("opens with a notice when the quiet is first opened after 480 minutes", () => {
    expect(decide({ ...learning, now: taipei("16:00"), quietAfterMinutes: 480 }).due).toEqual([
      { kind: "open_quiet", date: TODAY, notify: true },
    ]);
  });

  it("ends on the learningUntil date itself", () => {
    expect(decide({ ...learning, learningUntil: TODAY, now: taipei("14:00") }).due).toEqual([
      { kind: "open_quiet", date: TODAY, notify: true },
    ]);
  });

  it("lets a pending wait postpone the learning-period push", () => {
    const waiting = deliveredToday({
      quiet: quiet({ lastNotifiedAt: null, waitUntil: taipei("16:30") }),
    });
    const decision = decide({ learningUntil: TOMORROW, now: taipei("16:00"), days: [waiting] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("16:30")));
  });
});

describe("wait 2 hours", () => {
  const tappedAt = taipei("14:10");
  const waiting = deliveredToday({
    quiet: quiet({ waitUntil: addMinutes(tappedAt, SCHEDULE.waitMinutes) }),
  });

  it("re-notifies exactly when the wait runs out", () => {
    expect(decide({ now: taipei("16:10"), days: [waiting] }).due).toEqual([
      { kind: "notify_quiet", date: TODAY },
    ]);
  });

  it("does not re-notify one minute before and wakes for it", () => {
    const decision = decide({ now: taipei("16:09"), days: [waiting] });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("16:10")));
  });

  it("does not re-notify after the waited notice went out", () => {
    const renotified = deliveredToday({
      quiet: quiet({ waitUntil: taipei("16:10"), lastNotifiedAt: taipei("16:10") }),
    });
    expect(decide({ now: taipei("18:00"), days: [renotified] }).due).toEqual([]);
  });

  it("does not re-notify once she has answered", () => {
    const answered = { ...waiting, answeredAt: taipei("15:00") };
    expect(decide({ now: taipei("16:10"), days: [answered] }).due).toEqual([]);
  });

  it("does not re-notify a resolved quiet", () => {
    const resolved = deliveredToday({
      quiet: quiet({ waitUntil: taipei("16:10"), resolvedAt: taipei("15:00") }),
    });
    expect(decide({ now: taipei("16:10"), days: [resolved] }).due).toEqual([]);
  });
});

describe("yesterday", () => {
  const yesterdayQuiet = day(YESTERDAY, {
    deliveredAt: taipei("08:00", YESTERDAY),
    repeatSentAt: taipei("10:30", YESTERDAY),
    quiet: {
      openedAt: taipei("14:00", YESTERDAY),
      lastNotifiedAt: taipei("23:00", YESTERDAY),
      waitUntil: taipei("01:00"),
      resolvedAt: null,
    },
  });

  it("keeps yesterday's quiet running until today's arrival is delivered", () => {
    expect(decide({ now: taipei("01:00"), days: [yesterdayQuiet] }).due).toEqual([
      { kind: "notify_quiet", date: YESTERDAY },
    ]);
  });

  it("catches up yesterday's repeat and quiet after a missed night", () => {
    const missed = day(YESTERDAY, { deliveredAt: taipei("08:00", YESTERDAY) });
    expect(decide({ now: taipei("07:00"), days: [missed] }).due).toEqual([
      { kind: "send_repeat", date: YESTERDAY },
      { kind: "open_quiet", date: YESTERDAY, notify: true },
    ]);
  });

  it("stops yesterday's repeat and quiet once today's arrival is delivered", () => {
    const unanswered = day(YESTERDAY, { deliveredAt: taipei("08:00", YESTERDAY) });
    const waited = day(YESTERDAY, {
      deliveredAt: taipei("08:00", YESTERDAY),
      repeatSentAt: taipei("10:30", YESTERDAY),
      quiet: {
        openedAt: taipei("14:00", YESTERDAY),
        lastNotifiedAt: taipei("23:00", YESTERDAY),
        waitUntil: taipei("09:00"),
        resolvedAt: null,
      },
    });
    const today = day(TODAY, { deliveredAt: taipei("08:00") });
    expect(decide({ now: taipei("09:00"), days: [unanswered] }).due).toEqual([
      { kind: "deliver_arrival", date: TODAY, late: false },
      { kind: "send_repeat", date: YESTERDAY },
      { kind: "open_quiet", date: YESTERDAY, notify: true },
    ]);
    expect(decide({ now: taipei("09:00"), days: [unanswered, today] }).due).toEqual([]);
    expect(decide({ now: taipei("09:00"), days: [waited, today] }).due).toEqual([]);
  });
});

describe("turn prompt", () => {
  const evening = { days: [deliveredToday({ answeredAt: taipei("09:00") })] };

  it("sends the turn prompt for tomorrow exactly at 19:00", () => {
    expect(decide({ ...evening, now: taipei("19:00") }).due).toEqual([
      { kind: "send_turn_prompt", forDate: TOMORROW },
    ]);
  });

  it("does not send it one minute before and wakes for it", () => {
    const decision = decide({ ...evening, now: taipei("18:59") });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("19:00")));
  });

  it("stops offering the prompt at the prepare time", () => {
    expect(decide({ ...evening, now: taipei("21:59") }).due).toEqual([
      { kind: "send_turn_prompt", forDate: TOMORROW },
    ]);
    expect(decide({ ...evening, now: taipei("22:00") }).due).toEqual([
      { kind: "prepare", forDate: TOMORROW },
    ]);
  });

  it("sends no prompt when turns are off, tomorrow is prepared, or it was already sent", () => {
    expect(decide({ ...evening, now: taipei("19:00"), turnsEnabled: false }).due).toEqual([]);
    expect(decide({ ...evening, now: taipei("19:00"), prepared: true }).due).toEqual([]);
    expect(decide({ ...evening, now: taipei("19:00"), turnPromptSent: true }).due).toEqual([]);
  });

  it("does not wake at 19:00 when turns are off", () => {
    const decision = decide({ ...evening, now: taipei("18:00"), turnsEnabled: false });
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("22:00")));
  });
});

describe("prepare", () => {
  const evening = { days: [deliveredToday({ answeredAt: taipei("09:00") })], turnPromptSent: true };

  it("prepares tomorrow exactly at 22:00", () => {
    expect(decide({ ...evening, now: taipei("22:00") }).due).toEqual([
      { kind: "prepare", forDate: TOMORROW },
    ]);
  });

  it("does not prepare one minute before and wakes for it", () => {
    const decision = decide({ ...evening, now: taipei("21:59") });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("22:00")));
  });

  it("keeps preparing due until tomorrow is prepared", () => {
    expect(decide({ ...evening, now: taipei("23:59") }).due).toEqual([
      { kind: "prepare", forDate: TOMORROW },
    ]);
  });

  it("does not prepare twice and then wakes for tomorrow's arrival", () => {
    const decision = decide({ ...evening, now: taipei("22:01"), prepared: true });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("08:00", TOMORROW)));
  });
});

describe("weekly read", () => {
  const sundayEvening = {
    days: [
      day(SUNDAY, { deliveredAt: taipei("08:00", SUNDAY), answeredAt: taipei("09:00", SUNDAY) }),
    ],
  };

  it("drafts the weekly read at 18:00 on Sunday", () => {
    expect(decide({ ...sundayEvening, now: taipei("18:00", SUNDAY) }).due).toEqual([
      { kind: "draft_weekly_read", weekEnd: SUNDAY },
    ]);
  });

  it("does not draft it one minute before and wakes for it", () => {
    const decision = decide({ ...sundayEvening, now: taipei("17:59", SUNDAY) });
    expect(decision.due).toEqual([]);
    expect(iso(decision.nextWakeAt)).toBe(iso(taipei("18:00", SUNDAY)));
  });

  it("does not draft it twice", () => {
    const done = { ...sundayEvening, weeklyReadsDone: [SUNDAY] };
    expect(decide({ ...done, now: taipei("18:30", SUNDAY) }).due).toEqual([]);
  });

  it("does not draft it on other days", () => {
    const saturday = addDays(SUNDAY, -1);
    const days = [
      day(saturday, {
        deliveredAt: taipei("08:00", saturday),
        answeredAt: taipei("09:00", saturday),
      }),
    ];
    expect(decide({ days, now: taipei("18:00", saturday) }).due).toEqual([]);
  });
});

describe("due order and wakes", () => {
  it("returns due actions in a stable order whatever the order of the days", () => {
    const saturday = addDays(SUNDAY, -1);
    const unansweredSaturday = day(saturday, { deliveredAt: taipei("08:00", saturday) });
    const expected: DueAction[] = [
      { kind: "deliver_arrival", date: SUNDAY, late: true },
      { kind: "send_repeat", date: saturday },
      { kind: "open_quiet", date: saturday, notify: true },
      { kind: "send_turn_prompt", forDate: addDays(SUNDAY, 1) },
      { kind: "draft_weekly_read", weekEnd: SUNDAY },
    ];
    const now = taipei("21:00", SUNDAY);
    expect(decide({ now, days: [unansweredSaturday, day(SUNDAY)] }).due).toEqual(expected);
    expect(decide({ now, days: [day(SUNDAY), unansweredSaturday] }).due).toEqual(expected);
  });

  it("orders notify and prepare after arrival and repeat", () => {
    const saturday = addDays(SUNDAY, -1);
    const waitedSaturday = day(saturday, {
      deliveredAt: taipei("22:30", saturday),
      quiet: {
        openedAt: taipei("04:30", SUNDAY),
        lastNotifiedAt: taipei("04:30", SUNDAY),
        waitUntil: taipei("06:30", SUNDAY),
        resolvedAt: null,
      },
    });
    expect(
      decide({ now: taipei("22:45", SUNDAY), arrivalTime: "22:30", days: [waitedSaturday] }).due,
    ).toEqual([
      { kind: "deliver_arrival", date: SUNDAY, late: false },
      { kind: "send_repeat", date: saturday },
      { kind: "notify_quiet", date: saturday },
      { kind: "prepare", forDate: addDays(SUNDAY, 1) },
      { kind: "draft_weekly_read", weekEnd: SUNDAY },
    ]);
  });

  it("always wakes strictly after now, including at every threshold", () => {
    const states: DayState[][] = [
      [],
      [day(TODAY, { deliveredAt: taipei("08:00") })],
      [deliveredToday({ quiet: quiet({ waitUntil: taipei("16:10") }) })],
    ];
    for (const startsOn of [null, TOMORROW]) {
      for (const days of states) {
        for (let now = taipei("00:00"); now < taipei("00:00", TOMORROW); now = addMinutes(now, 5)) {
          const decision = decide({ now, days, startsOn, learningUntil: TOMORROW });
          expect(decision.nextWakeAt === null || decision.nextWakeAt > now).toBe(true);
        }
      }
    }
  });
});
