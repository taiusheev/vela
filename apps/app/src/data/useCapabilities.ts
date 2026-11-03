import { useQuery } from "@tanstack/react-query";
import { apiConfigured, fetchCapabilities } from "../api/client.ts";
import { englishTrialBuild, requiresEnglish, trialCapabilities } from "../api/trial.ts";

export function useCapabilities() {
  const query = useQuery({
    queryKey: ["capabilities"],
    enabled: apiConfigured(),
    queryFn: fetchCapabilities,
    staleTime: 60_000,
    // Read once at sign-in and on opening the app, when the phone's connection may still be waking:
    // tried again quietly, a few seconds apart, before anything says it could not be reached.
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
  });
  return {
    ...query,
    capabilities: trialCapabilities(query.data),
    pilot: englishTrialBuild || query.data?.pilot === true,
    englishOnly: requiresEnglish(apiConfigured(), query.data?.english_only),
  };
}
