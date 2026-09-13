/**
 * What goes into one morning (spec §4.2): the ask a person scheduled for that date, else the oldest
 * "whenever" ask, else the story question on story day, else the fallback hello.
 */
import type { ExchangeState, LocalDate, WhenRule } from "@vela/contracts";

export interface AskCandidate {
  id: string;
  whenRule: WhenRule;
  scheduledFor: LocalDate | null;
  createdAt: Date;
  state: ExchangeState;
}

export interface SelectAskInput {
  date: LocalDate;
  candidates: AskCandidate[];
  isStoryDay: boolean;
  storyQuestionAvailable: boolean;
}

export type AskSelection =
  | { source: "scheduled"; exchangeId: string }
  | { source: "whenever"; exchangeId: string }
  | { source: "story" }
  | { source: "hello" };

/**
 * States in which an ask has not reached her yet. A withdrawn ask is gone, and one already delivered
 * (or further along) belongs to the morning it was delivered on, so neither can fill this morning.
 */
const UNDELIVERED: ReadonlySet<ExchangeState> = new Set<ExchangeState>(["composed", "scheduled"]);

/** Oldest first; the id breaks ties so the choice never depends on the order rows were read in. */
function oldest(candidates: readonly AskCandidate[]): AskCandidate | undefined {
  let best: AskCandidate | undefined;
  for (const candidate of candidates) {
    if (
      best === undefined ||
      candidate.createdAt.getTime() < best.createdAt.getTime() ||
      (candidate.createdAt.getTime() === best.createdAt.getTime() && candidate.id < best.id)
    ) {
      best = candidate;
    }
  }
  return best;
}

export function selectAsk(input: SelectAskInput): AskSelection {
  const scheduled = oldest(
    input.candidates.filter(
      (candidate) => candidate.scheduledFor === input.date && UNDELIVERED.has(candidate.state),
    ),
  );
  if (scheduled !== undefined) {
    return { source: "scheduled", exchangeId: scheduled.id };
  }

  // A whenever ask that already carries a date has been claimed for that morning, so only unclaimed
  // ones can fill this one.
  const whenever = oldest(
    input.candidates.filter(
      (candidate) =>
        candidate.whenRule === "whenever" &&
        candidate.scheduledFor === null &&
        candidate.state === "composed",
    ),
  );
  if (whenever !== undefined) {
    return { source: "whenever", exchangeId: whenever.id };
  }

  if (input.isStoryDay && input.storyQuestionAvailable) {
    return { source: "story" };
  }
  return { source: "hello" };
}
