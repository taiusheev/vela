import { t as translate } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "../src/components/back-button.tsx";
import { CallingNumberEditor } from "../src/components/calling-number-editor.tsx";
import { Light } from "../src/components/light.tsx";
import { LoadingLight } from "../src/components/loading-light.tsx";
import { Portrait } from "../src/components/portrait-lamp.tsx";
import { SetUpPhone } from "../src/components/set-up-phone.tsx";
import { SettingsRow, SettingsSection } from "../src/components/settings-list.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { useFamily } from "../src/data/useFamily.ts";
import { usePortrait } from "../src/data/usePortrait.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * One parent's page, opened by tapping her on You or under Parents in Settings: everything about
 * her light in one place (spec §8), so the reader looks for her, not for a menu that holds her.
 */
export default function KeptLightScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { member } = useLocalSearchParams<{ member?: string }>();
  const day = useToday();
  const { capabilities, pilot } = useCapabilities();
  const { family, refresh, live, loading } = useFamily(day.familyId, day.familyId !== undefined);
  const her = family.keptLight.find((row) => row.memberId === member) ?? undefined;
  const photo = usePortrait(day.familyId ?? "", her?.memberId ?? "");
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const name = her?.name ?? "";
  const organiser = family.me.organiser;
  const nearby = organiser && her !== undefined ? (her.nearby ?? family.nearby) : undefined;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: name, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.l,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.l,
          gap: space.xxl,
        }}
      >
        {her === undefined ? (
          loading || day.loading ? (
            <LoadingLight label={t`Loading your family…`} />
          ) : (
            <View style={{ gap: space.l }}>
              <Words variant="body">
                <Trans>This parent is no longer in this family.</Trans>
              </Words>
              <SecondaryButton
                label={t`Go to Settings`}
                onPress={() => router.replace("/settings")}
              />
            </View>
          )
        ) : (
          <>
            {/* Her face and where her light stands, as You shows her, before anything to change. */}
            <View style={{ alignItems: "center", gap: space.s }}>
              <Portrait uri={photo.uri} name={name} width={72} height={72} round />
              <Words variant="title" accessibilityRole="header">
                {name}
              </Words>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
                <Light state={her.paused ? "paused" : "resting"} height={16} />
                <Words variant="caption" tone="ink2">
                  {pilot && her.light === "on" ? t`Free pilot` : her.line}
                </Words>
              </View>
            </View>

            <SettingsSection>
              <SettingsRow
                icon="photo"
                title={t`Photo and parent link`}
                testID={`parent-settings-${her.memberId}`}
                onPress={() =>
                  router.push({ pathname: "/parent-settings", params: { member: her.memberId } })
                }
              />
              {organiser ? (
                <SettingsRow
                  icon="time"
                  title={morningTitle(name)}
                  testID={`morning-settings-${her.memberId}`}
                  onPress={() =>
                    router.push({ pathname: "/morning-settings", params: { member: her.memberId } })
                  }
                />
              ) : null}
              {nearby === undefined ? null : (
                <SettingsRow
                  icon="nearby"
                  title={t`People near ${name}`}
                  detail={nearby.line}
                  onPress={() =>
                    router.push({ pathname: "/nearby", params: { member: her.memberId } })
                  }
                />
              )}
              {/* Away mode (spec §8): any member may say she is away. */}
              {her.paused ? null : (
                <SettingsRow
                  icon="calendar"
                  title={awayTitle(name)}
                  onPress={() =>
                    router.push({ pathname: "/away", params: { member: her.memberId } })
                  }
                />
              )}
              {capabilities?.billing === true && organiser && her.light === "on" ? (
                <SettingsRow
                  icon="heart"
                  title="Vela Light"
                  detail={her.line}
                  onPress={() =>
                    router.push({ pathname: "/vela-light", params: { member: her.memberId } })
                  }
                />
              ) : null}
            </SettingsSection>
            {live && organiser ? (
              <CallingNumberEditor familyId={family.familyId} memberId={her.memberId} name={name} />
            ) : null}
            {capabilities?.parent_app === true && organiser ? (
              <SettingsSection title={t`${name}'s phone`}>
                <View style={{ padding: space.l }}>
                  <SetUpPhone familyId={family.familyId} memberId={her.memberId} name={name} />
                </View>
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function morningTitle(name: string) {
  return translate`Change ${name}'s morning`;
}

function awayTitle(name: string) {
  return translate`Is ${name} away?`;
}
