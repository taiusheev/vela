import { Trans, useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NearbyEditor } from "../src/components/nearby-editor.tsx";
import { Words } from "../src/components/ui.tsx";
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
  const { today, familyId, organiser } = useToday();
  const her = today.lights.find((light) => light.memberId === member) ?? today.lights[0];
  const name = her?.displayName ?? t`Mom`;
  const nearby = useNearby(familyId, her?.memberId);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t`People nearby` }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        {organiser ? (
          <>
            <Words variant="body" tone="ink2">
              <Trans>
                Up to two people who live close to {name} and could look in if a morning goes quiet.
                Vela asks each of them first. Until they say yes, you can call them yourself.
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
