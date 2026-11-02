import { Trans, useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { noticeUrl, SUPPORT_EMAIL } from "../src/api/support.ts";
import { BackButton } from "../src/components/back-button.tsx";
import { SettingsNote, SettingsRow, SettingsSection } from "../src/components/settings-list.tsx";
import { Words } from "../src/components/ui.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * Privacy, terms and security, opened from one row in Settings: the four public pages a family may
 * want to read, each opening on vela-light.com. Settings itself stays short.
 */
export default function LegalScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  const open = async (path: string) => {
    setFailed(false);
    try {
      await Linking.openURL(noticeUrl(path));
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t`Privacy, terms and security`,
          headerLeft: () => <BackButton />,
        }}
      />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingHorizontal: space.margin,
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.xl,
        }}
      >
        <SettingsSection
          footer={
            failed ? (
              <>
                <SettingsNote tone="ink2">
                  <Trans>That page could not open. Write to Vela support instead.</Trans>
                </SettingsNote>
                <Words variant="caption" tone="ink2" selectable>
                  {SUPPORT_EMAIL}
                </Words>
              </>
            ) : undefined
          }
        >
          <SettingsRow
            icon="privacy"
            title={t`Read the privacy notice`}
            onPress={() => void open("/privacy")}
          />
          <SettingsRow icon="book" title={t`Service terms`} onPress={() => void open("/terms")} />
          <SettingsRow icon="check" title={t`Security`} onPress={() => void open("/security")} />
          <SettingsRow
            icon="trash"
            title={t`Your data and deletion`}
            onPress={() => void open("/data-rights")}
          />
        </SettingsSection>
      </ScrollView>
    </>
  );
}
