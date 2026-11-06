import { type ReactNode, useEffect, useState } from "react";
import { activateOnboardingSession } from "./onboarding-draft.ts";

/** The onboarding draft follows the account before any account screens can read it. */
export function OnboardingSession({ children, scope }: { children?: ReactNode; scope: string }) {
  const [activeScope, setActiveScope] = useState<string | null>(null);
  useEffect(() => {
    activateOnboardingSession(scope);
    setActiveScope(scope);
  }, [scope]);
  // Resetting the external store can notify the old screen. Do it after its unmount commits,
  // and keep the new account's screens from reading the previous draft in the meantime.
  return activeScope === scope ? children : null;
}
