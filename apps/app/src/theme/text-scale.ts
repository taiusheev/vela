/** The largest a scaled title may grow, in points: about the phone's own largest title. */
export const LARGEST_TEXT = 48;
/** Body text may grow to twice its size and no further, so a line still holds a few words. */
export const MOST_SCALE = 2;

/**
 * How far the reader's text size may scale text of `fontSize` points: twice for body text, and less
 * for large text so it stops at `LARGEST_TEXT`. Text with no size scales as body text.
 */
export function maxTextScale(fontSize: number | undefined): number {
  if (fontSize === undefined || fontSize <= 0) return MOST_SCALE;
  return Math.max(1, Math.min(MOST_SCALE, LARGEST_TEXT / fontSize));
}
