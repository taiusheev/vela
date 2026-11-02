import { useQuery } from "@tanstack/react-query";
import { apiConfigured, fetchWeeklySupport } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";

/** Ephemeral reports are never persisted. Errors hide stale quotes rather than showing old grants. */
export function useWeeklySupport(familyId?: string, memberId?: string) {
  const account = useAccount();
  return useQuery({
    queryKey: ["weekly-support", account.userId, familyId, memberId],
    enabled: apiConfigured() && account.signedIn && !!familyId && !!memberId,
    queryFn: async () => fetchWeeklySupport(familyId ?? "", memberId ?? "", await account.token()),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30000,
  });
}
