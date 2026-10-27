import { useLingui } from "@lingui/react/macro";
import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { LoadingLight } from "../src/components/loading-light.tsx";
import { ParentPhotoSettings } from "../src/components/parent-photo-settings.tsx";
import { Text } from "../src/components/scaled-text.tsx";
import { PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space, type } from "../src/theme/tokens.ts";

/**
 * Setup's last step where the family starts in Telegram: a photo of each parent, so her face is in
 * her window when her light comes on. Optional, and only on this phone, as in Settings; a family
 * with no parent yet goes straight to Today.
 */
export default function ParentPhotosScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const day = useToday();
  const parents = day.today.lights.filter((light) => light.state !== "paused");
  // The demo's example family, as Today names it, so the step can be seen without an API.
  const familyId =
    day.familyId ??
    (demoDataAllowed(apiConfigured(), accountsConfigured()) ? "example" : undefined);
  const nobody = !day.loading && (familyId === undefined || parents.length === 0);
  useEffect(() => {
    if (nobody) router.replace("/");
  }, [nobody]);
  const only = parents.length === 1 ? (parents[0]?.displayName ?? "") : "";
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: palette.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.l,
        }}
      >
        {day.loading || familyId === undefined ? (
          <LoadingLight label={t`Loading your family…`} />
        ) : (
          <>
            <View style={{ gap: space.s }}>
              <Text accessibilityRole="header" style={[type.title, { color: palette.ink }]}>
                {only === "" ? t`A photo of each parent` : t`A photo of ${only}`}
              </Text>
              <Words variant="body" tone="ink2">
                {only === ""
                  ? t`When a light comes on, you see their face in their window.`
                  : t`When ${only}’s light comes on, you see their face in the window.`}
              </Words>
            </View>
            {parents.map((light) => (
              <ParentPhotoSettings
                key={light.memberId}
                familyId={familyId}
                memberId={light.memberId}
                name={light.displayName}
              />
            ))}
            <PrimaryButton label={t`Continue`} onPress={() => router.replace("/")} />
            <SecondaryButton label={t`Not now`} onPress={() => router.replace("/")} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
