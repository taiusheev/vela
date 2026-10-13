import { describe, expect, it } from "vitest";
import { describePattern } from "./admin-pages.ts";

describe("describePattern", () => {
  it("states each pattern with its specifics for the founder checking the draft", () => {
    expect([
      describePattern({
        kind: "answer_time",
        direction: "later",
        usual: "08:00",
        thisWeek: "08:45",
        secondWeek: true,
        standout: { date: "2026-10-22", time: "10:15" },
      }),
      describePattern({
        kind: "answer_time",
        direction: "earlier",
        usual: "08:00",
        thisWeek: "07:20",
        secondWeek: false,
        standout: null,
      }),
      describePattern({
        kind: "answer_form",
        more: "taps",
        fewer: "words",
        moreDates: ["2026-10-19", "2026-10-22"],
      }),
      describePattern({ kind: "answer_form", more: null, fewer: "voice", moreDates: [] }),
      describePattern({
        kind: "answer_length",
        direction: "shorter",
        usual: "sentence",
        thisWeek: "few_words",
      }),
      describePattern({
        kind: "voice_length",
        direction: "longer",
        usualSeconds: 15,
        thisWeekSeconds: 45,
      }),
      describePattern({
        kind: "drew_out",
        askType: "photo_choice",
        dates: ["2026-10-20", "2026-10-24"],
      }),
      describePattern({
        kind: "came_back_to",
        text: "the garden",
        span: "weeks",
        times: 3,
        dates: ["2026-10-20"],
      }),
      describePattern({
        kind: "came_back_to",
        text: "tomatoes",
        span: "days",
        times: 2,
        dates: ["2026-10-13", "2026-10-16"],
      }),
      describePattern({ kind: "usual_absent", items: ["the market", "Anna"] }),
      describePattern({ kind: "new_mentions", items: ["Lan"] }),
    ]).toEqual([
      "Answered later than usual: around 08:45 this week, usually 08:00, for a second week; latest Thu 22 Oct at 10:15.",
      "Answered earlier than usual: around 07:20 this week, usually 08:00.",
      "More taps (Mon 19 Oct, Thu 22 Oct) and fewer written answers than usual.",
      "Fewer voice messages than usual.",
      "Answers ran a few words this week; usually a sentence or two.",
      "Voice messages about 45 seconds this week; usually about 15.",
      "Fullest answers came to photo choices (Tue 20 Oct, Sat 24 Oct).",
      '"the garden" came up 3 weeks in a row (this week Tue 20 Oct).',
      'Came back to "tomatoes" on 2 days (Tue 13 Oct, Fri 16 Oct).',
      'Usually part of the week, not this week: "the market", "Anna".',
      'New this week, not in the four weeks before: "Lan".',
    ]);
  });
});
