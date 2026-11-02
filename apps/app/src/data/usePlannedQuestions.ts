import { t } from "@lingui/core/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiPlannedQuestions } from "@vela/contracts";
import { apiConfigured, fetchPlannedQuestions } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { exampleNames } from "./example-names.ts";
import { demoDataAllowed } from "./live-state.ts";
import { tomorrowIn } from "./story.ts";
import { todayFixture } from "./today.ts";

export function usePlannedQuestions(familyId: string | undefined) {
  const account = useAccount();
  const queries = useQueryClient();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const fixture = todayFixture();
  const example: ApiPlannedQuestions = {
    questions: fixture.lights.map((parent, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      recipient_id: parent.memberId,
      recipient_name: parent.displayName,
      asker_name: exampleNames().mia,
      editable: true,
      preparing: false,
      date: tomorrowIn(new Date(), parent.timeZone),
      text:
        index === 0
          ? t`Mom, did you try growing basil on the balcony again?`
          : t`Dad, what have you been cooking this week?`,
    })),
  };

  return useQuery({
    queryKey: ["planned-questions", familyId],
    ...(demo ? { initialData: example } : {}),
    enabled: apiConfigured() && account.ready && account.signedIn && familyId !== undefined,
    queryFn: async () =>
      demo
        ? (queries.getQueryData<ApiPlannedQuestions>(["planned-questions", familyId]) ?? example)
        : fetchPlannedQuestions(familyId ?? "", await account.token()),
    refetchOnWindowFocus: "always",
  });
}
