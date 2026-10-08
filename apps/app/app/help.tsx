import { Trans, useLingui } from "@lingui/react/macro";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SUPPORT_EMAIL, SUPPORT_URL } from "../src/api/support.ts";
import { ScreenHeading } from "../src/components/brand/experience.tsx";
import { ServiceStatus } from "../src/components/service-status.tsx";
import { Card, SecondaryButton, Words } from "../src/components/ui.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

export default function HelpScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  const contact = async () => {
    setFailed(false);
    try {
      await Linking.openURL(SUPPORT_URL);
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingHorizontal: space.margin,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.xl,
        }}
      >
        <SecondaryButton
          label={t`Back`}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
        <ScreenHeading title={<Trans>Help</Trans>} />
        <Card>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Vela status</Trans>
          </Words>
          <ServiceStatus />
        </Card>
        <Card>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Trouble signing in?</Trans>
          </Words>
          <Words tone="ink2">
            <Trans>
              Check that you are using the email address you joined with. If a code does not arrive,
              check your spam folder and try again.
            </Trans>
          </Words>
        </Card>
        <Card>
          <Words variant="heading" accessibilityRole="header">
            <Trans>A morning message is missing</Trans>
          </Words>
          <Words tone="ink2">
            <Trans>
              Check Today and your parent's usual chat. If the message still has not arrived,
              contact Vela support. You can always contact your family directly.
            </Trans>
          </Words>
        </Card>
        <Card>
          <Words variant="heading" accessibilityRole="header">
            <Trans>About a quiet notice</Trans>
          </Words>
          <Words tone="ink2">
            <Trans>
              A quiet notice means Vela has not recorded an answer. Call or message your parent
              yourself. Vela cannot visit your parent or send help.
            </Trans>
          </Words>
        </Card>
        <Card>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Get help or request your data</Trans>
          </Words>
          <Words tone="ink2">
            <Trans>
              Describe what went wrong and when it happened. Never send passwords, sign-in codes,
              private family messages or photos.
            </Trans>
          </Words>
          <SecondaryButton label={t`Email Vela support`} onPress={() => void contact()} />
          <Words selectable>{SUPPORT_EMAIL}</Words>
          {failed ? (
            <Words tone="ink2">
              <Trans>That link could not open. Use the address above to contact the founder.</Trans>
            </Words>
          ) : null}
          <Words variant="caption" tone="ink2">
            <Trans>
              Ask the founder for access, correction, deletion, or to withdraw consent. Never
              include private family content in a support message.
            </Trans>
          </Words>
        </Card>
      </ScrollView>
    </>
  );
}
