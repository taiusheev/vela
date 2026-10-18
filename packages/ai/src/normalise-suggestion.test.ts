import { expect, it } from "vitest";
import { normaliseSuggestion } from "./normalise-suggestion.ts";
import type { SuggestInput, Suggestion } from "./types.ts";

const input: SuggestInput = {
  lang: "en",
  holderName: "Leo",
  recipientAddress: "Dad",
  forDate: "2026-09-18",
  rotationType: "voice_note",
  recentMentions: [],
  familyDates: [{ date: "2026-09-19", label: "Mia's 10th birthday" }],
  holderLastAsk: null,
};
const draft: Suggestion = {
  type: "voice_note",
  text: "Dad, a voice note for Mia’s 10th birthday?",
  source: "rotation",
};
it("attributes an exact supplied birthday independently of the selected rotation format", () => {
  expect(normaliseSuggestion(draft, input)).toEqual({ ...draft, source: "date" });
});
it("keeps unsupported, partial and ambiguous matches unchanged", () => {
  expect(
    normaliseSuggestion({ ...draft, text: "Dad, what do you enjoy doing?" }, input).source,
  ).toBe("rotation");
  expect(normaliseSuggestion({ ...draft, text: "Mia remembers last summer" }, input).source).toBe(
    "rotation",
  );
  expect(
    normaliseSuggestion(
      { ...draft, text: "Maybe tell a story" },
      { ...input, familyDates: [{ date: "2026-09-19", label: "May" }] },
    ).source,
  ).toBe("rotation");
  expect(normaliseSuggestion({ ...draft, source: "mention" }, input).source).toBe("mention");
});
it("recognises a complete Chinese event label without altering its words", () => {
  const value = { ...draft, text: "媽，中秋節想怎麼過？" };
  expect(
    normaliseSuggestion(value, {
      ...input,
      familyDates: [{ date: "2026-09-19", label: "中秋節" }],
    }),
  ).toEqual({ ...value, source: "date" });
});
