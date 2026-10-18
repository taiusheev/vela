import { useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "../src/components/back-button.tsx";
import { ParentLinkSettings } from "../src/components/parent-link-settings.tsx";
import { ParentPhotoSettings } from "../src/components/parent-photo-settings.tsx";
import { Words } from "../src/components/ui.tsx";
import { selectedLight } from "../src/data/selected-light.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

export default function ParentSettingsScreen() {
  const { t } = useLingui();
  const { member } = useLocalSearchParams<{ member?: string }>();
  const day = useToday();
  const parent = selectedLight(day.today.lights, member);
  const familyId = day.familyId ?? (!day.live && parent !== undefined ? "example" : undefined);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Parent settings`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: p.bg }}
        contentContainerStyle={{
          paddingTop: space.l,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.l,
        }}
      >
        {parent && familyId ? (
          <>
            <Words variant="title">{parent.displayName}</Words>
            <ParentPhotoSettings
              key={`photo:${familyId}:${parent.memberId}`}
              familyId={familyId}
              memberId={parent.memberId}
              name={parent.displayName}
            />
            {day.organiser ? (
              <ParentLinkSettings
                key={`link:${familyId}:${parent.memberId}`}
                familyId={familyId}
                memberId={parent.memberId}
                name={parent.displayName}
                live={day.live}
              />
            ) : null}
          </>
        ) : (
          <Words variant="body" tone="ink2">
            {day.loading
              ? t`Loading your family…`
              : t`This parent is no longer available. Go back to Settings and choose your family again.`}
          </Words>
        )}
      </ScrollView>
    </>
  );
}
