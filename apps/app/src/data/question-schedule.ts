import type { ApiPlannedAsk } from "@vela/contracts";

/** Calendar arithmetic uses the recipient's dates, never this phone's daylight-saving clock. */
export function questionDates(tomorrow: string): string[] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = new Date(`${tomorrow}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
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
