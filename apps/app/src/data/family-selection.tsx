import { createContext, type ReactNode, useContext, useState } from "react";

const FamilySelection = createContext<{
  familyId: string | undefined;
  select: (familyId: string) => void;
}>({ familyId: undefined, select: () => {} });

/** Mounted inside the keyed account session: family choice never follows a different sign-in. */
export function FamilySelectionProvider({ children }: { children: ReactNode }) {
  const [familyId, select] = useState<string | undefined>();
  return (
    <FamilySelection.Provider value={{ familyId, select }}>{children}</FamilySelection.Provider>
  );
}

export function useFamilySelection() {
  return useContext(FamilySelection);
}
