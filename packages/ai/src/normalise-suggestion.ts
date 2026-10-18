import type { SuggestInput, Suggestion } from "./types.ts";

const normalise = (text: string) =>
  text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();

/** A verbatim supplied event cannot be attributed to an ungrounded rotation. Never change wording. */
export function normaliseSuggestion(value: Suggestion, input: SuggestInput): Suggestion {
  if (value.source !== "rotation") return value;
  const text = normalise(value.text);
  const usesDate = input.familyDates.some(({ label }) => {
    const event = normalise(label);
    if (event.length < 3) return false;
    const index = text.indexOf(event);
    if (index < 0) return false;
    // Avoid matching short Latin labels inside other words. CJK phrases need no word boundary.
    const before = text[index - 1] ?? "";
    const after = text[index + event.length] ?? "";
    return (
      !(/^[a-z0-9]/.test(event) && /[a-z0-9]/.test(before)) &&
      !(/[a-z0-9]$/.test(event) && /[a-z0-9]/.test(after))
    );
  });
  return usesDate ? { ...value, source: "date" } : value;
}
