import { plural, t } from "@lingui/core/macro";
import type { ApiWeeklyRead, WeekDayState } from "@vela/contracts";
import type { LightState } from "../components/light.tsx";
import { shortDayName } from "./format.ts";

/**
 * The weekly read (spec §13, A9) in the screen's own idiom: seven small lights with their day names,
 * the count lines already worded, then the founder's notes and one suggestion. The counts are words
 * the app builds from numbers the API stored, never the model's, and say what the Telegram read says.
 */

export interface WeekLight {
  date: string;
  /** "Mon", "週一". */
  day: string;
  state: LightState;
  /** The time she answered under the light, "8:30", or nothing. */
  note: string;
  /** Answered only after that morning's quiet notice opened: marked "late" under its time. */
  late: boolean;
}

export interface WeeklyRead {
  name: string;
  /** False while a Vela Light trial or plan covers her: everything shows. */
  locked: boolean;
  /** Null until the first read of hers has been sent. */
  week: {
    lights: WeekLight[];
    /** The count lines; none when locked. */
    counts: string[];
    notes: string[];
    suggestion: string | null;
  } | null;
}

/** A day as one of the seven lights: lit when answered, resting otherwise, never quiet or red. */
function lightOf(state: WeekDayState): LightState {
  return state === "answered" || state === "late" ? "lit" : "resting";
}

/** The count lines, as `renderWeeklyRead` words them for Telegram (spec §13, "Counts, from numbers"). */
export function countLines(
  name: string,
  counts: { answered: number; days: number; hellos: number; asks: number },
): string[] {
  const { answered, days, hellos, asks } = counts;
  const lines = [
    plural(days, {
      one: `${name} answered ${answered} of # day.`,
      other: `${name} answered ${answered} of # days.`,
    }),
  ];
  if (asks === 0) {
    lines.push(t`Nobody in the family asked ${name} anything this week.`);
  } else if (hellos > 0) {
    lines.push(
      plural(hellos, {
        one: `On # morning nobody in the family asked, so Vela sent ${name} a hello.`,
        other: `On # mornings nobody in the family asked, so Vela sent ${name} a hello.`,
      }),
    );
  }
  return lines;
}

export function toWeeklyRead(api: ApiWeeklyRead): WeeklyRead {
  const name = api.display_name;
  const read = api.read;
  return {
    name,
    locked: api.locked,
    week:
      read === null
        ? null
        : {
            lights: read.days.map((day) => ({
              date: day.date,
              day: shortDayName(day.date),
              state: lightOf(day.state),
              note: day.answered_at ?? "",
              late: day.state === "late",
            })),
            counts:
              read.counts === null
                ? []
                : countLines(name, {
                    answered: read.counts.answered_days,
                    days: read.counts.counted_days,
                    hellos: read.counts.hello_mornings,
                    asks: read.counts.family_asks,
                  }),
            notes: read.notes ?? [],
            suggestion: read.suggestion,
          },
  };
}

/** The example week, shown when the app has no API, in the language active when it is read. */
export function weeklyFixture(): WeeklyRead {
  const name = t`Mom`;
  const dates = [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ];
  const times = ["8:12", "8:30", "13:05", "8:05", null, "9:40", "8:20"];
  return {
    name,
    locked: false,
    week: {
      // Wednesday answered after its quiet notice opened; Friday not at all.
      lights: dates.map((date, index) => {
        const at = times[index] ?? null;
        return {
          date,
          day: shortDayName(date),
          state: at === null ? lightOf("unanswered") : lightOf("answered"),
          note: at ?? "",
          late: index === 2,
        };
      }),
      counts: countLines(name, { answered: 6, days: 7, hellos: 1, asks: 6 }),
      notes: [
        t`She told you about the garden on three mornings: the tomatoes, the seeds, the new bed by the fence.`,
        t`On Saturday she answered later than usual, after the market.`,
      ],
      suggestion: t`Ask her which seeds she wants to keep for next spring.`,
    },
  };
}
