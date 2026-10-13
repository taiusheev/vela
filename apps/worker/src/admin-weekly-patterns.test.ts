import { describe, expect, it } from "vitest";
import { describePattern } from "./admin-pages.ts";

describe("describePattern", () => {
  it("states each pattern as a plain fact for the founder checking the draft", () => {
    expect([
      describePattern({ kind: "answer_time", direction: "later", minutes: 45, secondWeek: true }),
      describePattern({
        kind: "answer_time",
        direction: "earlier",
        minutes: 35,
        secondWeek: false,
      }),
      describePattern({ kind: "answer_form", more: "taps", fewer: "words" }),
      describePattern({ kind: "answer_form", more: null, fewer: "voice" }),
      describePattern({ kind: "answer_length", direction: "shorter" }),
      describePattern({ kind: "voice_length", direction: "longer" }),
      describePattern({ kind: "drew_out", askType: "photo_choice" }),
      describePattern({ kind: "came_back_to", text: "the garden", span: "weeks", times: 3 }),
      describePattern({ kind: "came_back_to", text: "tomatoes", span: "days", times: 2 }),
      describePattern({ kind: "mentions_level", direction: "fewer" }),
    ]).toEqual([
      "Answered later than usual, by about 45 minutes, for a second week.",
      "Answered earlier than usual, by about 35 minutes.",
      "More taps and fewer written answers than usual.",
      "Fewer voice messages than usual.",
      "Answers shorter than usual.",
      "Voice messages longer than usual.",
      "Fullest answers came to photo choices.",
      '"the garden" came up 3 weeks in a row.',
      'Came back to "tomatoes" on 2 days.',
      "Fewer people, places and plans came up than usual.",
    ]);
  });
});
