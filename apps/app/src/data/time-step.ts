/** A morning time moves in quarter hours, the way a phone's own clock picker offers it. */
export const STEP_MINUTES = 15;
const DAY = 24 * 60;

function minutesOf(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null) return 8 * 60;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return 8 * 60;
  return hours * 60 + minutes;
}

function clockOf(total: number): string {
  const wrapped = ((total % DAY) + DAY) % DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * The next quarter hour later (`direction` 1) or earlier (-1). A time between quarters, such as
 * 08:10, moves to the nearest quarter in that direction first; past midnight it wraps.
 */
export function stepTime(time: string, direction: 1 | -1): string {
  const now = minutesOf(time);
  const offQuarter = now % STEP_MINUTES;
  if (offQuarter !== 0) {
    return clockOf(direction === 1 ? now + (STEP_MINUTES - offQuarter) : now - offQuarter);
  }
  return clockOf(now + direction * STEP_MINUTES);
}
