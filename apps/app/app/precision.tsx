import { Trans, useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Eyebrow, Words } from "../src/components/ui.tsx";
import type { PrecisionMonth } from "../src/data/precision.ts";
import { usePrecision } from "../src/data/usePrecision.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/** A month as a card: its name, then its sentences. */
function Month({ month }: { month: PrecisionMonth }) {
  return (
    <Card>
      <Words variant="heading">{month.label}</Words>
      <View style={{ gap: space.xs }}>
        {month.lines.map((line) => (
          <Words key={line} variant="body" tone="ink2">
            {line}
          </Words>
        ))}
      </View>
    </Card>
  );
}

/**
 * How Vela is doing (spec §8 "Precision accounting", build plan 5.4), opened from You: how the
 * family's quiet notices ended, month by month, and Vela's across every family, for the months with
 * enough notices that no one family can be read out of them. Organisers only, as they are the ones
 * told. It says plainly that most notices end with a late answer or a day away.
 */
export default function PrecisionScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const view = usePrecision();
  const { precision } = view;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t`How Vela is doing` }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        {view.loading ? (
          <Words variant="body" tone="ink2">
            <Trans>Loading the quiet notices…</Trans>
          </Words>
        ) : !view.organiser ? (
          <Words variant="body" tone="ink2">
            <Trans>This page is for the family's organisers, who are told of quiet mornings.</Trans>
          </Words>
        ) : view.trouble ? (
          <Words variant="body" tone="ink2">
            <Trans>This page could not be reached just now.</Trans>
          </Words>
        ) : (
          <>
            <Words variant="body" tone="ink2">
              <Trans>
                When a morning stays quiet, Vela tells you. Here is how those notices ended. Most
                end with an answer that came later, or a day away.
              </Trans>
            </Words>

            <View style={{ gap: space.m }}>
              <Eyebrow>
                <Trans>Your family</Trans>
              </Eyebrow>
              {precision.family.length === 0 ? (
                <Words variant="body" tone="ink2">
                  <Trans>No quiet notice in the last 12 months.</Trans>
                </Words>
              ) : (
                precision.family.map((month) => <Month key={month.month} month={month} />)
              )}
            </View>

            <View style={{ gap: space.m }}>
              <Eyebrow>
                <Trans>Across Vela</Trans>
              </Eyebrow>
              {precision.vela.length === 0 ? (
                <Words variant="body" tone="ink2">
                  <Trans>Not enough notices yet to show a month.</Trans>
                </Words>
              ) : (
                precision.vela.map((month) => <Month key={month.month} month={month} />)
              )}
              <Words variant="caption" tone="ink3">
                {precision.velaRule}
              </Words>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
