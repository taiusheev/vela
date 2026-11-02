import type { ApiPlannedAsk } from "@vela/contracts";

/** Calendar arithmetic uses the recipient's dates, never this phone's daylight-saving clock. */
export function questionDates(tomorrow: string): string[] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = new Date(`${tomorrow}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

/**
 * The fourteen mornings laid out as a calendar's weeks, Monday first, as the week's windows on Today
 * are. Days before the first morning and after the last one fill out their weeks, so every row has
 * seven days; they are drawn faint and cannot be chosen.
 */
export function calendarWeeks(dates: readonly string[]): string[][] {
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined) return [];
  const shift = (date: string, days: number) => {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
  };
  const monday = shift(first, -((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weeks: string[][] = [];
  for (let start = monday; start <= last; start = shift(start, 7))
    weeks.push(Array.from({ length: 7 }, (_, index) => shift(start, index)));
  return weeks;
}

/** An edit link may only load the owned question for the parent named on the editor. */
export function editablePlannedQuestion(
  questions: readonly ApiPlannedAsk[],
  id: string | undefined,
  recipientId: string | undefined,
): ApiPlannedAsk | undefined {
  if (id === undefined || recipientId === undefined) return undefined;
  return questions.find(
    (question) => question.id === id && question.editable && question.recipient_id === recipientId,
  );
}
