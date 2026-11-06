import { useQuery } from "@tanstack/react-query";
import { apiConfigured } from "../api/client.ts";
import { FAMILY_WAITING_RECHECK_MS, isFamilyWaiting } from "../api/family-waiting.ts";
import { readMe } from "../api/read-me.ts";
import { useAccount } from "../auth/clerk.tsx";

/**
 * Whether the founder has approved this family yet (ADR-52): a closed-test family set up in the app
 * waits, and the invitation stays here until then. Looked at again every 30 seconds while waiting.
 */
export function useFamilyApproval(familyId: string, liveFamily = true): "approved" | "waiting" {
  const account = useAccount();
  const check = useQuery({
    queryKey: ["family-approved", familyId, account.userId],
    enabled: apiConfigured() && liveFamily,
    queryFn: async () => {
      try {
        await readMe(account);
        return "approved" as const;
      } catch (error) {
        if (isFamilyWaiting(error)) return "waiting" as const;
        throw error;
      }
    },
    refetchInterval: (query) =>
      query.state.data === "approved" ? false : FAMILY_WAITING_RECHECK_MS,
    retry: 2,
  });
  return !apiConfigured() || !liveFamily || check.data === "approved" ? "approved" : "waiting";
}
