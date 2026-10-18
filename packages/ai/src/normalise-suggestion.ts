import { INPUT_SCHEMAS, OUTPUT_SCHEMAS, type SuggestInput, type Suggestion } from "./types.ts";

const normalise = (text: string) =>
  text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();

/** A verbatim supplied event cannot be attributed to an ungrounded rotation. Never change wording. */
export function normaliseSuggestion(value: Suggestion, input: SuggestInput): Suggestion {
  if (value.source !== "rotation") return value;
  const text = normalise(value.text);
  const usesDate = input.familyDates.some(({ label }) => containsLabel(text, label, 3));
  return usesDate ? { ...value, source: "date" } : value;
}

/** A date-priority draft must retain an explicitly supplied event, or use the existing safe fallback. */
export function suggestionDateGrounded(rawInput: unknown, rawValue: unknown): boolean {
  const input = INPUT_SCHEMAS.suggest.parse(rawInput);
  const value = OUTPUT_SCHEMAS.suggest.parse(rawValue);
  const arrival = Date.parse(input.forDate);
  const near = input.familyDates.filter(({ date }) => {
    const days = (Date.parse(date) - arrival) / 86_400_000;
    return days >= 0 && days <= 2;
  });
  if (near.length === 0) return true;
  return (
    value.source === "date" &&
    near.some(({ label }) => containsLabel(normalise(value.text), label, 1))
  );
}

function containsLabel(text: string, label: string, minimum: number): boolean {
  const event = normalise(label);
  if (event.length < minimum) return false;
  const index = text.indexOf(event);
  if (index < 0) return false;
  // Short Latin labels must not match inside another word; CJK phrases need no boundary.
  const before = text[index - 1] ?? "";
  const after = text[index + event.length] ?? "";
  return (
    !(/^[a-z0-9]/.test(event) && /[a-z0-9]/.test(before)) &&
    !(/[a-z0-9]$/.test(event) && /[a-z0-9]/.test(after))
  );
}
