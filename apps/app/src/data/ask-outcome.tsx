import type { ApiComposedAsk } from "@vela/contracts";
import { createContext, type ReactNode, useContext, useState } from "react";

export type AskOutcome = {
  familyId: string | undefined;
  recipient: string;
  date: string | null;
  demo: boolean;
};
export function acceptedAsk(
  ask: Pick<ApiComposedAsk, "family_id" | "recipient_name" | "scheduled_for">,
): AskOutcome {
  return {
    familyId: ask.family_id,
    recipient: ask.recipient_name,
    date: ask.scheduled_for,
    demo: false,
  };
}
const Outcomes = createContext<{
  outcome: AskOutcome | null;
  remember: (outcome: AskOutcome | null) => void;
}>({ outcome: null, remember: () => {} });
/** Account-scoped, in-memory feedback; private names never travel in a route or a stored flag. */
export function AskOutcomeProvider({ children }: { children: ReactNode }) {
  const [outcome, remember] = useState<AskOutcome | null>(null);
  return <Outcomes.Provider value={{ outcome, remember }}>{children}</Outcomes.Provider>;
}
export function useAskOutcome() {
  return useContext(Outcomes);
}
