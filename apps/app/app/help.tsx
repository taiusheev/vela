import { Trans, useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { type ReactNode, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SUPPORT_EMAIL, SUPPORT_URL } from "../src/api/support.ts";
import { BackButton } from "../src/components/back-button.tsx";
import { BrandIcon } from "../src/components/brand/icon.tsx";
import { ServiceStatus } from "../src/components/service-status.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import { Hairline, PrimaryButton, Words } from "../src/components/ui.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { hitSlop, space } from "../src/theme/tokens.ts";

/** One common question: tap it and its answer opens under it, as a phone's own help lists do. */
function Question({ title, children }: { title: string; children: ReactNode }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={hitSlop}
        onPress={() => setOpen((now) => !now)}
        style={({ pressed }) => ({
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <Words variant="bodyMedium">{title}</Words>
        </View>
        <View style={{ transform: [{ rotate: open ? "270deg" : "90deg" }] }}>
          <BrandIcon name="chevron" color={palette.ink3} size={18} strokeWidth={2} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ paddingBottom: space.m }}>
          <Words tone="ink2">{children}</Words>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Help, opened from You and Settings: the common questions first, each opening in place, then one
 * way to reach a person at Vela, then whether Vela itself is running.
 */
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
      <Stack.Screen
        options={{ headerShown: true, title: t`Help`, headerLeft: () => <BackButton /> }}
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
        <View style={{ gap: space.s }}>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Common questions</Trans>
          </Words>
          <SoftCard>
            <Question title={t`Trouble signing in?`}>
              <Trans>
                Check that you are using the email address you joined with. If a code does not
                arrive, check your spam folder and try again.
              </Trans>
            </Question>
            <Hairline />
            <Question title={t`A morning message is missing`}>
              <Trans>
                Check Today and your parent's usual chat. If the message still has not arrived,
                contact Vela support. You can always contact your family directly.
              </Trans>
            </Question>
            <Hairline />
            <Question title={t`About a quiet notice`}>
              <Trans>
                A quiet notice means Vela has not recorded an answer. Call or message your parent
                yourself. Vela cannot visit your parent or send help.
              </Trans>
            </Question>
          </SoftCard>
        </View>

        <View style={{ gap: space.s }}>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Get help or request your data</Trans>
          </Words>
          <SoftCard>
            <Words tone="ink2">
              <Trans>
                Describe what went wrong and when it happened. Never send passwords, sign-in codes,
                private family messages or photos.
              </Trans>
            </Words>
            <PrimaryButton
              icon="mail"
              label={t`Email Vela support`}
              onPress={() => void contact()}
            />
            <Words variant="caption" tone="ink2" selectable>
              {SUPPORT_EMAIL}
            </Words>
            {failed ? (
              <Words tone="ink2">
                <Trans>Your email app did not open. Write to the address above instead.</Trans>
              </Words>
            ) : null}
            <Words variant="caption" tone="ink3">
              <Trans>
                Write to Vela support for a copy of your data, a correction, deletion, or to
                withdraw consent. Never include private family content in a support message.
              </Trans>
            </Words>
          </SoftCard>
        </View>

        <View style={{ gap: space.s }}>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Vela status</Trans>
          </Words>
          <ServiceStatus compact />
        </View>
      </ScrollView>
    </>
  );
}
