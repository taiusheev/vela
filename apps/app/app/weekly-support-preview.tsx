import { Trans, useLingui } from "@lingui/react/macro";
import type { WeeklySupportKind } from "@vela/core/weekly-support";
import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { apiConfigured } from "../src/api/client.ts";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { ScreenHeading } from "../src/components/brand/experience.tsx";
import { Text } from "../src/components/scaled-text.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { WarmPage } from "../src/components/warm.tsx";
import { localDayMonth } from "../src/data/format.ts";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { weeklySupportPreview } from "../src/data/weekly-support-preview.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space, type } from "../src/theme/tokens.ts";

/** Unlinked review surface: only a demo build without accounts or an API may mount it. */
export default function WeeklySupportPreviewScreen() {
  if (!demoDataAllowed(apiConfigured(), accountsConfigured())) return <Redirect href="/" />;
  return <ExampleWeek />;
}
function ExampleWeek() {
  const { t } = useLingui();
  const palette = usePalette();
  const [removed, setRemoved] = useState(false);
  const [corrected, setCorrected] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const [chosen, setChosen] = useState<WeeklySupportKind | null>(null);
  const { suggestions } = weeklySupportPreview({
    removed,
    corrected,
    withdrawn,
  });
  const offers: Record<WeeklySupportKind, { title: string; why: string; message: string }> = {
    shared_interest: {
      title: t`Make time for something Dad enjoys`,
      why: t`Dad wanted to share the flowers. Offer a little time to enjoy them together.`,
      message: t`I'd love to see the flowers. Would you like to show me on a call this week?`,
    },
    company: {
      title: t`Join a plan Dad mentioned`,
      why: t`Dad asked for company at the market. Check whether next Saturday still suits.`,
      message: t`I'd like to come to the market with you. Does next Saturday still work?`,
    },
    practical_help: {
      title: t`Help with something Dad asked for`,
      why: t`Dad asked for help carrying groceries. Offer to help bring them home.`,
      message: t`I can help bring the groceries home. What time next Friday would suit you?`,
    },
  };
  return (
    <WarmPage>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeading
        title={t`What would help this week?`}
        subtitle={t`Example report · Dad · 19–25 October`}
      />
      <Words variant="caption" tone="ink2">
        <Trans>Review draft with example messages. Nothing is sent.</Trans>
      </Words>
      <Words variant="body">
        <Trans>Small offers based on what Dad chose to share. Dad decides what would help.</Trans>
      </Words>
      {suggestions.map((suggestion) => {
        const offer = offers[suggestion.kind];
        const date = localDayMonth(suggestion.source.occurredAt.toISOString().slice(0, 10));
        return (
          <SoftCard key={suggestion.id}>
            <View style={{ gap: space.m }}>
              <Words variant="heading">{offer.title}</Words>
              <Words variant="caption" tone="ink2">
                <Trans>Dad's words · {date}</Trans>
              </Words>
              <Text
                style={[type.story, { color: palette.ink }]}
              >{`“${suggestion.source.quote}”`}</Text>
              <Words variant="body" tone="ink2">
                {offer.why}
              </Words>
              <SecondaryButton
                label={t`Preview this offer`}
                onPress={() => setChosen(suggestion.kind)}
              />
              {chosen === suggestion.kind ? <Words variant="body">{offer.message}</Words> : null}
            </View>
          </SoftCard>
        );
      })}
      {suggestions.length === 0 ? (
        <Words variant="body">
          <Trans>No suggestions are available from the messages currently shared.</Trans>
        </Words>
      ) : null}
      <View style={{ gap: space.s }}>
        <Words variant="caption" tone="ink2">
          <Trans>Example controls</Trans>
        </Words>
        <SecondaryButton
          label={removed ? t`Restore example message` : t`Remove practical-help example message`}
          onPress={() => setRemoved(!removed)}
        />
        <SecondaryButton
          label={corrected ? t`Restore example review` : t`Correct the market message`}
          onPress={() => setCorrected(!corrected)}
        />
        <SecondaryButton
          label={withdrawn ? t`Restore example permission` : t`Withdraw example permission`}
          onPress={() => setWithdrawn(!withdrawn)}
        />
      </View>
    </WarmPage>
  );
}
