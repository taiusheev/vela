import { FamilyPattern, WeeklyNotePattern } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { addDays } from "./time.ts";
import {
  detectWeeklyPatterns,
  PATTERNS,
  type PatternDay,
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

describe("detectWeeklyPatterns", () => {
  it("finds no note in an ordinary week like her usual ones, and says who asked", () => {
    expect(detect({ week: week(), history: history() })).toEqual({
      notes: [],
      family: [{ kind: "asks_by", askers: [{ name: "Anna", asks: 7 }] }],
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
    });
    expect(found.notes).toEqual([]);
    expect(found.family).toEqual([
      { kind: "no_reply", answers: 3, of: 7 },
      { kind: "asks_by", askers: [{ name: "Anna", asks: 7 }] },
    ]);
  });

  describe("answer time", () => {
    it("reports a move of more than 30 minutes against her usual, rounded to five minutes", () => {
      const input = {
        week: week((date) => day(date, { answerMinute: 480 + 47 })),
        history: history(),
      };
      expect(notesOf(input, "answer_time")).toEqual([
        { kind: "answer_time", direction: "later", minutes: 45, secondWeek: false },
      ]);
    });

    it("reports earlier answers too", () => {
      const input = { week: week((date) => day(date, { answerMinute: 420 })), history: history() };
      expect(notesOf(input, "answer_time")).toEqual([
        { kind: "answer_time", direction: "earlier", minutes: 60, secondWeek: false },
      ]);
    });

    it("stays quiet at exactly 30 minutes", () => {
      const input = { week: week((date) => day(date, { answerMinute: 510 })), history: history() };
      expect(notesOf(input, "answer_time")).toEqual([]);
    });

    it("says when the week before moved the same way", () => {
      // Three weeks at 08:00, then last week at 09:00 and this week at 09:30: both later than usual,
      // this week by 90 minutes against the three weeks before it, last week among them.
      const input = {
        week: week((date) => day(date, { answerMinute: 570 })),
        history: history((date, index) => day(date, { answerMinute: index >= 21 ? 540 : 480 })),
      };
      expect(notesOf(input, "answer_time")).toEqual([
        { kind: "answer_time", direction: "later", minutes: 90, secondWeek: true },
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
    it("reports more taps and fewer words when the shares move by 40 points or more", () => {
      const input = {
        week: week((date, index) =>
          day(date, index < 5 ? { forms: ["taps"], words: null } : { forms: ["words"] }),
        ),
        history: history(),
      };
      expect(notesOf(input, "answer_form")).toEqual([
        { kind: "answer_form", more: "taps", fewer: "words" },
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
        { kind: "answer_form", more: "voice", fewer: null },
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
        { kind: "answer_form", more: "taps", fewer: "words" },
      ]);
    });
  });

  describe("length", () => {
    it("reports shorter answers at 40 percent fewer words than usual", () => {
      const input = { week: week((date) => day(date, { words: 7 })), history: history() };
      expect(notesOf(input, "answer_length")).toEqual([
        { kind: "answer_length", direction: "shorter" },
      ]);
    });

    it("reports longer answers at 40 percent more", () => {
      const input = { week: week((date) => day(date, { words: 17 })), history: history() };
      expect(notesOf(input, "answer_length")).toEqual([
        { kind: "answer_length", direction: "longer" },
      ]);
    });

    it("says nothing about length when her usual answer is a word or two", () => {
      const input = {
        week: week((date) => day(date, { words: 1 })),
        history: history((date) => day(date, { words: 3 })),
      };
      expect(notesOf(input, "answer_length")).toEqual([]);
    });

    it("reports voice messages shorter than usual from two this week and three before", () => {
      const voice = (seconds: number) => ({ forms: ["voice" as const], voiceSeconds: seconds });
      const input = {
        week: week((date, index) => day(date, index < 2 ? voice(10) : {})),
        history: history((date, index) => day(date, index % 7 === 0 ? voice(40) : {})),
      };
      expect(notesOf(input, "voice_length")).toEqual([
        { kind: "voice_length", direction: "shorter" },
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
    it("names the ask type whose answers were fullest, by half again over the rest", () => {
      const input = {
        week: week((date, index) =>
          day(date, index < 2 ? { askType: "photo_choice", words: 30 } : { words: 10 }),
        ),
        history: [],
      };
      expect(notesOf(input, "drew_out")).toEqual([{ kind: "drew_out", askType: "photo_choice" }]);
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
    it("reports something said on two days of the week, in her first spelling", () => {
      const input = {
        week: week((date, index) =>
          day(date, { mentions: index === 1 ? ["Tomatoes"] : index === 4 ? ["tomatoes "] : [] }),
        ),
        history: [],
      };
      expect(notesOf(input, "came_back_to")).toEqual([
        { kind: "came_back_to", text: "Tomatoes", span: "days", times: 2 },
      ]);
    });

    it("reports a person who came up three weeks in a row, before anything said on two days", () => {
      const input = {
        week: week((date, index) =>
          day(date, { mentions: index === 0 ? ["Anna", "market"] : index === 2 ? ["market"] : [] }),
        ),
        history: history((date, index) => day(date, { mentions: index % 7 === 3 ? ["anna"] : [] })),
      };
      expect(notesOf(input, "came_back_to")).toEqual([
        { kind: "came_back_to", text: "Anna", span: "weeks", times: 5 },
        { kind: "came_back_to", text: "market", span: "days", times: 2 },
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

  describe("how much came up", () => {
    const busy = (date: string) => day(date, { mentions: ["Anna", "market"] });

    it("reports fewer people, places and plans at half her usual per answered day", () => {
      const input = {
        week: week((date, index) => day(date, { mentions: index === 0 ? ["Anna"] : [] })),
        history: history(busy),
      };
      expect(notesOf(input, "mentions_level")).toEqual([
        { kind: "mentions_level", direction: "fewer" },
      ]);
    });

    it("reports more at twice her usual", () => {
      const input = {
        week: week((date) => day(date, { mentions: ["Anna", "market", "temple", "lunch"] })),
        history: history(busy),
      };
      expect(notesOf(input, "mentions_level")).toEqual([
        { kind: "mentions_level", direction: "more" },
      ]);
    });

    it("says nothing when little usually comes up", () => {
      const input = {
        week: week(),
        history: history((date, index) => day(date, { mentions: index % 4 === 0 ? ["Anna"] : [] })),
      };
      expect(notesOf(input, "mentions_level")).toEqual([]);
    });
  });

  describe("for organisers", () => {
    it("counts her answers that got no reply or reaction", () => {
      const input = {
        week: week((date, index) =>
          index === 6 ? quiet(date) : day(date, { familyReplies: index < 2 ? 0 : 2 }),
        ),
        history: history(),
      };
      expect(familyOf(input, "no_reply")).toEqual([{ kind: "no_reply", answers: 2, of: 6 }]);
    });

    it("lists who asked, most first, leaving out Vela's own mornings", () => {
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
      };
      expect(familyOf(input, "asks_by")).toEqual([
        {
          kind: "asks_by",
          askers: [
            { name: "Anna", asks: 3 },
            { name: "Minh", asks: 2 },
            { name: "Lan", asks: 1 },
          ],
        },
      ]);
    });

    it("counts answers after the second message against her usual week", () => {
      const input = {
        week: week((date, index) => day(date, { afterSecond: index < 3 })),
        history: history((date, index) => day(date, { afterSecond: index % 7 === 0 })),
      };
      expect(familyOf(input, "after_second")).toEqual([
        { kind: "after_second", answers: 3, usual: 1 },
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
        { kind: "after_second", answers: 2, usual: null },
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

  it("never puts a quiet day into a note: the notes are the same with or without them", () => {
    const answeredDays = week((date, index) =>
      day(date, { answerMinute: 560, forms: index < 4 ? ["taps"] : ["words"] }),
    ).slice(0, 4);
    const withQuiet = [...answeredDays, ...week((date) => quiet(date)).slice(4)];
    expect(detect({ week: withQuiet, history: history() }).notes).toEqual(
      detect({ week: answeredDays, history: history() }).notes,
    );
  });
});
