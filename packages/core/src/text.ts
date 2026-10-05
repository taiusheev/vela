/**
 * Fitting rendered text into one outbound message, shared by the renderers. Internal to the package:
 * the index does not export it.
 */

/** `OutboundMessage.text` allows at most 4000 characters. */
export const TEXT_MAX_LENGTH = 4000;

/**
 * The text cut to at most `maxLength` characters, ending in an ellipsis when anything was cut. Cuts
 * fall between code points so no half of a surrogate pair is left behind.
 */
export function shorten(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > maxLength - 1) {
      break;
    }
    kept += character;
  }
  return `${kept.trimEnd()}…`;
}

/**
 * The largest length every line can be cut to so that all of them together fit `room`, or `Infinity`
 * when they already fit. Shorter lines stay whole and the longest ones share what is left.
 */
export function lineCap(lines: readonly string[], room: number): number {
  const lengths = lines.map((line) => line.length).sort((a, b) => a - b);
  let rest = room;
  for (const [index, length] of lengths.entries()) {
    const cap = Math.floor(rest / (lengths.length - index));
    if (length > cap) {
      return Math.max(1, cap);
    }
    rest -= length;
  }
  return Number.POSITIVE_INFINITY;
}
