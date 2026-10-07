import { Trans, useLingui } from "@lingui/react/macro";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "../src/components/back-button.tsx";
import { NearbyEditor } from "../src/components/nearby-editor.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { selectedLight } from "../src/data/selected-light.ts";
import { useNearby } from "../src/data/useNearby.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * People nearby (spec A3, A12), opened from You: who could look in on her if a morning goes quiet,
 * for the family's organisers. `member` names her; without it, the first light Today shows.
 */
export default function NearbyScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { member } = useLocalSearchParams<{ member?: string }>();
  const day = useToday();
  const { today, familyId, organiser } = day;
  const her = selectedLight(today.lights, member);
  const name = her?.displayName ?? t`Mom`;
  const nearby = useNearby(familyId, her?.memberId);

  useFocusEffect(
    useCallback(() => {
      day.refresh();
      nearby.refresh();
    }, [day.refresh, nearby.refresh]),
  );

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`People nearby`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        {day.loading ? (
          <Words variant="body">
            <Trans>Loading your family…</Trans>
          </Words>
        ) : day.trouble ? (
          <SecondaryButton label={t`Try again`} onPress={day.refresh} />
        ) : her === undefined ? (
          <>
            <Words variant="body">
              <Trans>Choose a parent from You before changing the people nearby.</Trans>
            </Words>
            <SecondaryButton label={t`Go to You`} onPress={() => router.replace("/(tabs)/you")} />
          </>
        ) : organiser ? (
          <>
            <Words variant="body" tone="ink2">
              <Trans>
                Up to two people who live close to {name} and could look in if a morning goes quiet.
                Send each one a link with Ask on Telegram: Vela writes to them only once they open
                it, and asks them in your name. Until they say yes, you can call them yourself.
              </Trans>
            </Words>
            <NearbyEditor name={name} nearby={nearby} />
          </>
        ) : (
          <Words variant="body" tone="ink2">
            <Trans>The family's organisers choose the people nearby.</Trans>
          </Words>
        )}
      </ScrollView>
    </>
  );
}
