import { useQuery } from "@tanstack/react-query";
import { apiConfigured, fetchCapabilities } from "../api/client.ts";
import { englishTrialBuild, requiresEnglish, trialCapabilities } from "../api/trial.ts";

export function useCapabilities() {
  const query = useQuery({
    queryKey: ["capabilities"],
    enabled: apiConfigured(),
    queryFn: fetchCapabilities,
    staleTime: 60_000,
  });
  return {
    ...query,
    capabilities: trialCapabilities(query.data),
    pilot: englishTrialBuild || query.data?.pilot === true,
    englishOnly: requiresEnglish(apiConfigured(), query.data?.english_only),
  };
}
