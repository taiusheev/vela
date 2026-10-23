import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { apiConfigured } from "../api/client.ts";
import { accountsConfigured } from "../auth/clerk.tsx";
import { demoDataAllowed } from "../data/live-state.ts";
import { useWeeklySupport } from "../data/useWeeklySupport.ts";
import { SecondaryButton } from "./ui.tsx";

export function PrivateReportEntry({
  familyId,
  memberId,
}: {
  familyId?: string;
  memberId?: string;
}) {
  const { t } = useLingui();
  const query = useWeeklySupport(familyId, memberId);
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  if (!demo && (query.isError || query.data === undefined)) return null;
  return (
    <SecondaryButton
      label={demo ? t`Open private report example` : t`Open the weekly support report`}
      onPress={() =>
        router.push({
          pathname: "/weekly-report",
          params: {
            ...(familyId ? { family: familyId } : {}),
            ...(memberId ? { member: memberId } : {}),
          },
        })
      }
    />
  );
}
