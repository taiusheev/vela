import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { View } from "react-native";
import { space } from "../theme/tokens.ts";
import { SectionTitle, SoftCard } from "./today-hero.tsx";
import { SecondaryButton, Words } from "./ui.tsx";

/** General, optional family support; no inferred condition or health data processing. */
export function WeeklySupport({ name, memberId }: { name: string; memberId: string }) {
  const { t } = useLingui();
  const offer = (suggestion: string) =>
    router.push({ pathname: "/conversation", params: { recipient: memberId, suggestion } });
  return (
    <View style={{ gap: space.m }}>
      <SectionTitle title={t`What would help this week?`} />
      <Words variant="body" tone="ink2">
        <Trans>General ways to offer support. Let {name} choose what feels helpful.</Trans>
      </Words>
      <SoftCard>
        <Words variant="heading">
          <Trans>Time together</Trans>
        </Words>
        <Words variant="body">
          <Trans>Offer a call or some company. Make room to listen to how the week has felt.</Trans>
        </Words>
        <SecondaryButton
          label={t`Offer some time together`}
          onPress={() =>
            offer(t`Would you like a call or some company this week? When would suit you?`)
          }
        />
      </SoftCard>
      <SoftCard>
        <Words variant="heading">
          <Trans>A little practical help</Trans>
        </Words>
        <Words variant="body">
          <Trans>
            Offer help with a meal, an errand or getting somewhere. Ask what would make the week
            easier.
          </Trans>
        </Words>
        <SecondaryButton
          label={t`Offer practical help`}
          onPress={() =>
            offer(
              t`Could I help with a meal, an errand or getting somewhere this week? Tell me what would make things easier.`,
            )
          }
        />
      </SoftCard>
      <Words variant="caption" tone="ink2">
        <Trans>Choose an offer to edit it before sending.</Trans>
      </Words>
    </View>
  );
}
