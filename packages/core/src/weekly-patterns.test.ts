import { FamilyPattern, WeeklyNotePattern } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { addDays } from "./time.ts";
import {
  answerLengthOf,
  detectWeeklyPatterns,
  PATTERNS,
  type PatternDay,
  recurringHealthWords,
  type WeeklyPatternInput,
} from "./weekly-patterns.ts";

/** Monday 12 October 2026 starts the week; the read is drafted for Sunday the 18th. */
const WEEK_START = "2026-10-12";

/** An ordinary answered morning: 08:00, a few words, asked by Anna, replied to. */
function day(date: string, overrides: Partial<PatternDay> = {}): PatternDay {
  return {
    date,
    delivered: true,
    away: false,
    answerMinute: 480,
    afterSecond: false,
    forms: ["words"],
    words: 12,
    voiceSeconds: null,
    mentions: [],
    askType: "question",
    askerName: "Anna",
    familyReplies: 1,
    ...overrides,
  };
}

function quiet(date: string, overrides: Partial<PatternDay> = {}): PatternDay {
  return day(date, { answerMinute: null, forms: [], words: null, familyReplies: 0, ...overrides });
}

/** `count` days ending the day before `end`, built by `make`. */
function daysBefore(
  end: string,
  count: number,
  make: (date: string, index: number) => PatternDay,
): PatternDay[] {
  return Array.from({ length: count }, (_, index) => make(addDays(end, index - count), index));
}

function week(make: (date: string, index: number) => PatternDay = (date) => day(date)) {
  return Array.from({ length: 7 }, (_, index) => make(addDays(WEEK_START, index), index));
}

function history(make: (date: string, index: number) => PatternDay = (date) => day(date)) {
  return daysBefore(WEEK_START, PATTERNS.historyDays, make);
}

function detect(input: WeeklyPatternInput) {
  const found = detectWeeklyPatterns(input);
  // Whatever is found is a pattern the contracts accept, so it can be stored and sent to the model.
  for (const note of found.notes) {
    expect(WeeklyNotePattern.parse(note)).toEqual(note);
  }
  for (const pattern of found.family) {
    expect(FamilyPattern.parse(pattern)).toEqual(pattern);
  }
  return found;
}

function notesOf(input: WeeklyPatternInput, kind: WeeklyNotePattern["kind"]) {
  return detect(input).notes.filter((note) => note.kind === kind);
}

function familyOf(input: WeeklyPatternInput, kind: FamilyPattern["kind"]) {
  return detect(input).family.filter((pattern) => pattern.kind === kind);
}

/** The week's dates, Monday 12 to Sunday 18 October 2026. */
const D = Array.from({ length: 7 }, (_, index) => addDays(WEEK_START, index));

describe("detectWeeklyPatterns", () => {
  it("finds no note in an ordinary week like her usual ones, and says who asked", () => {
    expect(detect({ week: week(), history: history() })).toEqual({
      notes: [],
      family: [{ kind: "asks_by", askers: [{ name: "Anna", asks: 7 }], none: [] }],
    });
  });

  it("finds nothing without a week", () => {
    expect(detect({ week: [], history: history() })).toEqual({ notes: [], family: [] });
  });

  it("compares nothing in a first week, with no history, and still reports the family's part", () => {
    const found = detect({
      week: week((date, index) =>
        index < 3 ? day(date, { familyReplies: 0, answerMinute: 700 }) : day(date),
      ),
      history: [],
      familyNames: ["Anna", "Minh"],
    });
    expect(found.notes).toEqual([]);
    expect(found.family).toEqual([
      { kind: "no_reply", dates: [D[0], D[1], D[2]], of: 7 },
      { kind: "asks_by", askers: [{ name: "Anna", asks: 7 }], none: ["Minh"] },
    ]);
  });

  describe("answer time", () => {
    it("gives her usual time, this week's, and the day that stood out", () => {
      const input = {
        week: week((date, index) => day(date, { answerMinute: index === 3 ? 615 : 527 })),
        history: history(),
      };
      expect(notesOf(input, "answer_time")).toEqual([
        {
          kind: "answer_time",
          direction: "later",
          usual: "08:00",
          thisWeek: "08:45",
          secondWeek: false,
          standout: { date: D[3], time: "10:15" },
        },
      ]);
    });

    it("names no standout when every day moved alike, and reports earlier answers too", () => {
      const input = { week: week((date) => day(date, { answerMinute: 420 })), history: history() };
      expect(notesOf(input, "answer_time")).toEqual([
        {
          kind: "answer_time",
          direction: "earlier",
          usual: "08:00",
          thisWeek: "07:00",
          secondWeek: false,
          standout: null,
        },
      ]);
    });

    it("stays quiet at exactly 30 minutes", () => {
      const input = { week: week((date) => day(date, { answerMinute: 510 })), history: history() };
      expect(notesOf(input, "answer_time")).toEqual([]);
    });

    it("says when the week before moved the same way", () => {
      // Three weeks at 08:00, then last week at 09:00 and this week at 09:30: both later than usual,
      // this week against the three weeks before it, last week among them.
      const input = {
        week: week((date) => day(date, { answerMinute: 570 })),
        history: history((date, index) => day(date, { answerMinute: index >= 21 ? 540 : 480 })),
      };
      expect(notesOf(input, "answer_time")).toMatchObject([
        { direction: "later", usual: "08:00", thisWeek: "09:30", secondWeek: true },
      ]);
    });

    it("needs three answered days this week and six in her usual", () => {
      const fewThisWeek = {
        week: week((date, index) => (index < 2 ? day(date, { answerMinute: 600 }) : quiet(date))),
        history: history(),
      };
      expect(notesOf(fewThisWeek, "answer_time")).toEqual([]);
      const shortHistory = {
        week: week((date) => day(date, { answerMinute: 600 })),
        history: daysBefore(WEEK_START, 5, (date) => day(date)),
      };
      expect(notesOf(shortHistory, "answer_time")).toEqual([]);
    });

    it("reads her usual from the three weeks before, not the fourth", () => {
      const input = {
        week: week(),
        history: history((date, index) => day(date, { answerMinute: index < 7 ? 300 : 480 })),
      };
      expect(notesOf(input, "answer_time")).toEqual([]);
    });
  });

  describe("how she answers", () => {
    it("reports more taps and fewer written answers, with the days she tapped", () => {
      const input = {
        week: week((date, index) =>
          day(date, index < 5 ? { forms: ["taps"], words: null } : { forms: ["words"] }),
        ),
        history: history(),
      };
      expect(notesOf(input, "answer_form")).toEqual([
        { kind: "answer_form", more: "taps", fewer: "words", moreDates: D.slice(0, 5) },
      ]);
    });

    it("reports more voice on its own when nothing fell by as much", () => {
      const input = {
        week: week((date, index) =>
          day(date, { forms: index < 4 ? ["voice", "words"] : ["words"], voiceSeconds: 20 }),
        ),
        history: history(),
      };
      expect(notesOf(input, "answer_form")).toEqual([
        { kind: "answer_form", more: "voice", fewer: null, moreDates: D.slice(0, 4) },
      ]);
    });

    it("stays quiet below 40 points", () => {
      const input = {
        week: week((date, index) => day(date, index < 2 ? { forms: ["taps"], words: null } : {})),
        history: history(),
      };
      expect(notesOf(input, "answer_form")).toEqual([]);
    });

    it("counts shares over her answered days only", () => {
      // Three answered days, all taps, four quiet ones: the share is of the answered three.
      const input = {
        week: week((date, index) =>
          index < 3 ? day(date, { forms: ["taps"], words: null }) : quiet(date),
        ),
        history: history(),
      };
      expect(notesOf(input, "answer_form")).toEqual([
        { kind: "answer_form", more: "taps", fewer: "words", moreDates: D.slice(0, 3) },
      ]);
    });
  });

  describe("length", () => {
    it("reads lengths as a reader would put them", () => {
      expect([1, 2, 3, 8, 9, 30, 31, 80, 81].map(answerLengthOf)).toEqual([
        "word",
        "word",
        "few_words",
        "few_words",
        "sentence",
        "sentence",
        "few_sentences",
        "few_sentences",
        "long",
      ]);
    });

    it("reports shorter answers when they read differently: a few words, usually a sentence or two", () => {
      const input = { week: week((date) => day(date, { words: 6 })), history: history() };
      expect(notesOf(input, "answer_length")).toEqual([
        { kind: "answer_length", direction: "shorter", usual: "sentence", thisWeek: "few_words" },
      ]);
    });

    it("says nothing when the change would read the same, a sentence or two both weeks", () => {
      // 12 words to 20 is two thirds more, and still a sentence or two.
      const input = { week: week((date) => day(date, { words: 20 })), history: history() };
      expect(notesOf(input, "answer_length")).toEqual([]);
    });

    it("reports longer answers", () => {
      const input = { week: week((date) => day(date, { words: 45 })), history: history() };
      expect(notesOf(input, "answer_length")).toEqual([
        {
          kind: "answer_length",
          direction: "longer",
          usual: "sentence",
          thisWeek: "few_sentences",
        },
      ]);
    });

    it("says nothing about length when her usual answer is a word or two", () => {
      const input = {
        week: week((date) => day(date, { words: 1 })),
        history: history((date) => day(date, { words: 3 })),
      };
      expect(notesOf(input, "answer_length")).toEqual([]);
    });

    it("gives voice messages' seconds, rounded to five, from two this week and three before", () => {
      const voice = (seconds: number) => ({ forms: ["voice" as const], voiceSeconds: seconds });
      const input = {
        week: week((date, index) => day(date, index < 2 ? voice(12) : {})),
        history: history((date, index) => day(date, index % 7 === 0 ? voice(41) : {})),
      };
      expect(notesOf(input, "voice_length")).toEqual([
        { kind: "voice_length", direction: "shorter", usualSeconds: 40, thisWeekSeconds: 10 },
      ]);
    });

    it("needs two voice messages this week", () => {
      const input = {
        week: week((date, index) =>
          day(date, index === 0 ? { forms: ["voice"], voiceSeconds: 10 } : {}),
        ),
        history: history((date) => day(date, { forms: ["voice"], voiceSeconds: 40 })),
      };
      expect(notesOf(input, "voice_length")).toEqual([]);
    });
  });

  describe("what drew her out", () => {
    it("names the ask type whose answers were fullest, and the days of those asks", () => {
      const input = {
        week: week((date, index) =>
          day(
            date,
            index === 1 || index === 4 ? { askType: "photo_choice", words: 30 } : { words: 10 },
          ),
        ),
        history: [],
      };
      expect(notesOf(input, "drew_out")).toEqual([
        { kind: "drew_out", askType: "photo_choice", dates: [D[1], D[4]] },
      ]);
    });

    it("needs two answered asks of that type", () => {
      const input = {
        week: week((date, index) =>
          day(date, index === 0 ? { askType: "photo_choice", words: 30 } : { words: 10 }),
        ),
        history: [],
      };
      expect(notesOf(input, "drew_out")).toEqual([]);
    });

    it("leaves Vela's own mornings out, and a week of one kind of ask has nothing to compare", () => {
      const input = {
        week: week((date, index) =>
          day(
            date,
            index < 3
              ? { askType: "hello", askerName: null, words: 40 }
              : { askType: "question", words: 10 },
          ),
        ),
        history: [],
      };
      expect(notesOf(input, "drew_out")).toEqual([]);
    });

    it("stays quiet when the lead is under half again", () => {
      const input = {
        week: week((date, index) =>
          day(date, index < 3 ? { askType: "voice_note", words: 14 } : { words: 10 }),
        ),
        history: [],
      };
      expect(notesOf(input, "drew_out")).toEqual([]);
    });
  });

  describe("what she came back to", () => {
    it("reports something said on two days of the week, in her first spelling, with the days", () => {
      const input = {
        week: week((date, index) =>
          day(date, { mentions: index === 1 ? ["Tomatoes"] : index === 4 ? ["tomatoes "] : [] }),
        ),
        history: [],
      };
      expect(notesOf(input, "came_back_to")).toEqual([
        { kind: "came_back_to", text: "Tomatoes", span: "days", times: 2, dates: [D[1], D[4]] },
      ]);
    });

    it("reports a person who came up weeks in a row, before anything said on two days", () => {
      const input = {
        week: week((date, index) =>
          day(date, { mentions: index === 0 ? ["Anna", "market"] : index === 2 ? ["market"] : [] }),
        ),
        history: history((date, index) => day(date, { mentions: index % 7 === 3 ? ["anna"] : [] })),
      };
      expect(notesOf(input, "came_back_to")).toEqual([
        { kind: "came_back_to", text: "Anna", span: "weeks", times: 5, dates: [D[0]] },
        { kind: "came_back_to", text: "market", span: "days", times: 2, dates: [D[0], D[2]] },
      ]);
    });

    it("stops counting weeks at the first week it did not come up", () => {
      const input = {
        week: week((date, index) => day(date, { mentions: index === 0 ? ["choir"] : [] })),
        history: history((date, index) => day(date, { mentions: index === 25 ? ["choir"] : [] })),
      };
      expect(notesOf(input, "came_back_to")).toEqual([]);
    });

    it("keeps at most five", () => {
      const input = {
        week: week((date, index) =>
          day(date, { mentions: index < 2 ? ["a", "b", "c", "d", "e", "f"] : [] }),
        ),
        history: [],
      };
      expect(notesOf(input, "came_back_to")).toHaveLength(PATTERNS.maxComebacks);
    });
  });

  describe("what was missing, and what was new", () => {
    // Her usual weeks: the market on Mondays and Wednesdays, Anna on Fridays, the temple once.
    const usualWeeks = history((date, index) =>
      day(date, {
        mentions: [
          ...(index % 7 === 0 || index % 7 === 2 ? ["the market"] : []),
          ...(index % 7 === 4 ? ["Anna"] : []),
          ...(index === 20 ? ["the temple"] : []),
        ],
      }),
    );

    it("names what was part of her usual weeks and did not come up, most said first", () => {
      const input = {
        week: week((date, index) => day(date, { mentions: index === 2 ? ["Lan"] : [] })),
        history: usualWeeks,
      };
      expect(notesOf(input, "usual_absent")).toEqual([
        { kind: "usual_absent", items: ["the market", "Anna"] },
      ]);
    });

    it("leaves out what came up only once or in one week, and what came up this week", () => {
      const input = {
        week: week((date, index) => day(date, { mentions: index === 0 ? ["The Market"] : [] })),
        history: usualWeeks,
      };
      expect(notesOf(input, "usual_absent")).toEqual([{ kind: "usual_absent", items: ["Anna"] }]);
    });

    it("says nothing is missing from a week with too few answers to tell", () => {
      const input = {
        week: week((date, index) => (index < 2 ? day(date) : quiet(date))),
        history: usualWeeks,
      };
      expect(notesOf(input, "usual_absent")).toEqual([]);
    });

    it("names what came up for the first time in four weeks, leaving out what she came back to", () => {
      const input = {
        week: week((date, index) =>
          day(date, {
            mentions:
              index === 1 ? ["Vung Tau", "the market"] : index === 3 ? ["Vung Tau", "Lan"] : [],
          }),
        ),
        history: usualWeeks,
      };
      expect(notesOf(input, "new_mentions")).toEqual([{ kind: "new_mentions", items: ["Lan"] }]);
      expect(notesOf(input, "came_back_to")).toContainEqual(
        expect.objectContaining({ text: "Vung Tau", span: "days" }),
      );
    });

    it("calls nothing new without enough earlier weeks to know", () => {
      const input = {
        week: week((date, index) => day(date, { mentions: index === 1 ? ["Lan"] : [] })),
        history: daysBefore(WEEK_START, 4, (date) => day(date)),
      };
      expect(notesOf(input, "new_mentions")).toEqual([]);
    });
  });

  describe("for organisers", () => {
    it("names the days her answers got no reply or reaction", () => {
      const input = {
        week: week((date, index) =>
          index === 6 ? quiet(date) : day(date, { familyReplies: index < 2 ? 0 : 2 }),
        ),
        history: history(),
      };
      expect(familyOf(input, "no_reply")).toEqual([
        { kind: "no_reply", dates: [D[0], D[1]], of: 6 },
      ]);
    });

    it("lists who asked, most first, and who takes turns but asked nothing", () => {
      const askers = ["Minh", "Anna", "Anna", null, "Anna", "Minh", "Lan"];
      const input = {
        week: week((date, index) => {
          const name = askers[index] ?? null;
          return day(
            date,
            name === null ? { askType: "hello", askerName: null } : { askerName: name },
          );
        }),
        history: history(),
        familyNames: ["Anna", "Minh", "Lan", "Huy", "Bao"],
      };
      expect(familyOf(input, "asks_by")).toEqual([
        {
          kind: "asks_by",
          askers: [
            { name: "Anna", asks: 3 },
            { name: "Minh", asks: 2 },
            { name: "Lan", asks: 1 },
          ],
          none: ["Bao", "Huy"],
        },
      ]);
    });

    it("names the days she answered after the second message, against her usual week", () => {
      const input = {
        week: week((date, index) =>
          day(date, { afterSecond: index === 0 || index === 2 || index === 5 }),
        ),
        history: history((date, index) => day(date, { afterSecond: index % 7 === 0 })),
      };
      expect(familyOf(input, "after_second")).toEqual([
        { kind: "after_second", dates: [D[0], D[2], D[5]], usual: 1 },
      ]);
    });

    it("leaves out answers after the second message when that is her usual", () => {
      const input = {
        week: week((date, index) => day(date, { afterSecond: index < 2 })),
        history: history((date, index) => day(date, { afterSecond: index % 7 < 3 })),
      };
      expect(familyOf(input, "after_second")).toEqual([]);
    });

    it("reports them without a usual in a first week", () => {
      const input = {
        week: week((date, index) => day(date, { afterSecond: index < 2 })),
        history: [],
      };
      expect(familyOf(input, "after_second")).toEqual([
        { kind: "after_second", dates: [D[0], D[1]], usual: null },
      ]);
    });

    it("reports a weekday quiet three weeks in a row", () => {
      // 14 October 2026 is a Wednesday.
      const isWednesday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 3;
      const input = {
        week: week((date) => (isWednesday(date) ? quiet(date) : day(date))),
        history: history((date, index) =>
          isWednesday(date) && index >= 14 ? quiet(date) : day(date),
        ),
      };
      expect(familyOf(input, "quiet_weekday")).toEqual([
        { kind: "quiet_weekday", weekday: 3, weeks: 3 },
      ]);
    });

    it("never counts an away day or an undelivered morning as quiet", () => {
      const isWednesday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 3;
      const away = {
        week: week((date) => (isWednesday(date) ? quiet(date) : day(date))),
        history: history((date, index) => {
          if (!isWednesday(date)) return day(date);
          return index >= 21 ? quiet(date, { away: true }) : quiet(date);
        }),
      };
      expect(familyOf(away, "quiet_weekday")).toEqual([]);
      const undelivered = {
        week: week((date) => (isWednesday(date) ? quiet(date) : day(date))),
        history: history((date, index) => {
          if (!isWednesday(date)) return day(date);
          return index >= 21 ? quiet(date, { delivered: false }) : quiet(date);
        }),
      };
      expect(familyOf(undelivered, "quiet_weekday")).toEqual([]);
    });
  });

  it("never puts a quiet day into a note: every date in a note is a day she answered", () => {
    const input = {
      week: week((date, index) =>
        index % 2 === 1
          ? quiet(date)
          : day(date, {
              answerMinute: 560 + index * 10,
              forms: ["taps"],
              words: null,
              askType: index === 0 || index === 4 ? "photo_choice" : "question",
              mentions: index < 4 ? ["Lan"] : [],
            }),
      ),
      history: history((date) => day(date, { mentions: ["the market"] })),
    };
    const found = detect(input);
    expect(found.notes.length).toBeGreaterThan(0);
    const answeredDates = new Set(
      input.week.filter((entry) => entry.answerMinute !== null).map((entry) => entry.date),
    );
    const datesIn = (value: unknown): string[] =>
      JSON.stringify(value).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    for (const date of datesIn(found.notes)) {
      expect(answeredDates.has(date), date).toBe(true);
    }
  });
});

describe("recurringHealthWords (ADR-47)", () => {
  it("names her health words said on two or more days, most days first, in her first spelling", () => {
    expect(
      recurringHealthWords([
        { date: "2026-10-12", words: ["knee hurts", "tired"] },
        { date: "2026-10-12", words: ["Knee hurts"] },
        { date: "2026-10-14", words: ["slept badly"] },
        { date: "2026-10-15", words: ["knee hurts ", "slept badly"] },
        { date: "2026-10-17", words: ["Knee hurts", "dizzy"] },
      ]),
    ).toEqual([
      { words: "knee hurts", dates: [D[0], D[3], D[5]] },
      { words: "slept badly", dates: [D[2], D[3]] },
    ]);
  });

  it("names nothing said on one day only, twice that day included", () => {
    expect(recurringHealthWords([{ date: "2026-10-13", words: ["fell", "fell"] }])).toEqual([]);
  });

  it("keeps at most three", () => {
    const words = ["a", "b", "c", "d"];
    expect(
      recurringHealthWords([
        { date: "2026-10-12", words },
        { date: "2026-10-13", words },
      ]),
    ).toHaveLength(PATTERNS.maxHealthWords);
  });
});
