/** How long Today keeps teaching what its windows mean, counted from the first time it is opened. */
export const TEACHING_DAYS = 7;
/** Where the device remembers the day Today was first opened. */
export const FIRST_OPENED_SETTING = "today-first-opened";

/** Whether `firstOpened` (an ISO date) is still inside the teaching week on `now`. */
export function inFirstWeek(firstOpened: string | null, now: Date): boolean {
  if (firstOpened === null) return true;
  const start = Date.parse(firstOpened);
  if (Number.isNaN(start)) return true;
  return now.getTime() - start < TEACHING_DAYS * 24 * 60 * 60 * 1000;
}
