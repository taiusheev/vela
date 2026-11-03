/**
 * Where her family is in its first days (founder, 3 November 2026), for the guide on Today
 * (`components/first-days.tsx`): her yes, the first morning question, her first answer.
 */

export type FirstDayStep = "yes" | "ask" | "answer";
export type StepState = "done" | "now" | "later";

/** Where the family is in its first days: each step done, the first one not done "now". */
export function firstDaysSteps(input: {
  invited: boolean;
  askedForTomorrow: boolean;
  answered: boolean;
}): Record<FirstDayStep, StepState> {
  const done: Record<FirstDayStep, boolean> = {
    yes: !input.invited,
    // Once she has answered, a first question is behind them, asked or Vela's hello.
    ask: input.askedForTomorrow || input.answered,
    answer: input.answered,
  };
  let current: FirstDayStep | null = null;
  const states = {} as Record<FirstDayStep, StepState>;
  for (const step of ["yes", "ask", "answer"] as const) {
    if (done[step]) states[step] = "done";
    else if (current === null) {
      current = step;
      states[step] = "now";
    } else states[step] = "later";
  }
  return states;
}

/** Whether the guide still has something to show: until she has answered a first morning. */
export function showsFirstDays(input: { invited: boolean; answered: boolean }): boolean {
  return input.invited || !input.answered;
}
