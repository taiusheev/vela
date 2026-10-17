export interface WeekWindow {
  date: string;
  hasMessage: boolean;
  /** A day of this week still to come: drawn faint, and never counted as quiet. */
  ahead: boolean;
  today: boolean;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Her week from Monday to Sunday, on her own calendar, from the seven days ending today that Today
 * reads (`connection_days`): every day from this Monday to today is among them, and the days after
 * today are still ahead. So the windows fill from the left as the week goes, and start again on
 * Monday, where the rolling seven days lit from the right (founder, 17 October 2026).
 */
export function weekWindows(days: readonly { date: string; hasMessage: boolean }[]): WeekWindow[] {
  const today = days.at(-1)?.date;
  if (today === undefined) return [];
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  const lit = new Set(days.filter((day) => day.hasMessage).map((day) => day.date));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return { date, hasMessage: lit.has(date), ahead: date > today, today: date === today };
  });
}
