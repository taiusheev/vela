import { useQuery } from "@tanstack/react-query";
import { router, useRootNavigationState, useSegments } from "expo-router";
import { useEffect } from "react";
import { apiConfigured, fetchMe } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { useFamilySelection } from "../data/family-selection.tsx";
import { selectedMembership } from "../data/membership.ts";
import { usePush } from "./provider.tsx";
import { hrefOf, tapTargetOf } from "./taps.ts";

/**
 * Opens the notification the reader tapped (ADR-34, A4), once it can be opened: a tap that started
 * the app is held until the account has loaded and signed in, sign-in has handed over, the
 * navigator has mounted, and the app knows which family it shows; opening it any earlier would be
 * undone by the sign-in guard or would throw. Mounted once, in the root layout.
 */
export function useOpenTapped(): void {
  const { tapped, tapOpened } = usePush();
  const account = useAccount();
  const segments = useSegments();
  const navigation = useRootNavigationState();
  const reads = apiConfigured() && account.ready && account.signedIn;
  // The same query as Today's, so react-query makes one request for both.
  const me = useQuery({
    queryKey: ["me"],
    enabled: reads,
    queryFn: async () => fetchMe(await account.token()),
  });
  const onSignIn = segments[0] === "sign-in";
  const mounted = navigation?.key !== undefined;
  const waitingForAccount = !account.ready || (accountsConfigured() && !account.signedIn);
  const waitingForFamily = reads && me.isPending;
  const selection = useFamilySelection();
  const shownFamilyId = selectedMembership(me.data?.memberships ?? [], selection.familyId)?.family
    .id;

  useEffect(() => {
    if (tapped === null || !mounted || onSignIn || waitingForAccount || waitingForFamily) return;
    // Select only an available membership, then let its queries mount before routing the tap.
    if (
      tapped.family_id !== shownFamilyId &&
      me.data?.memberships.some(({ family }) => family.id === tapped.family_id)
    ) {
      selection.select(tapped.family_id);
      return;
    }
    const href = hrefOf(tapTargetOf(tapped, shownFamilyId));
    tapOpened();
    // Today is a tab the stack already holds, so it is gone back to; the others open over it.
    if (href.pathname === "/") router.navigate(href);
    else router.push(href);
  }, [
    tapped,
    mounted,
    onSignIn,
    waitingForAccount,
    waitingForFamily,
    shownFamilyId,
    tapOpened,
    me.data,
    selection.select,
  ]);
}
