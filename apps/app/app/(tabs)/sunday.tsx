import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Light } from "../../src/components/light.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  PrimaryButton,
  SecondaryButton,
  Words,
} from "../../src/components/ui.tsx";
import { useWeeklyRead } from "../../src/data/useWeeklyRead.ts";
import type { WeekLight } from "../../src/data/weekly.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

/** Seven small lights, Monday to Sunday, each with its day and the time she answered (A9). */
function WeekRow({ lights }: { lights: WeekLight[] }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {lights.map((light) => (
        <View key={light.date} style={{ alignItems: "center", gap: space.xs, flex: 1 }}>
          <Light state={light.state} height={28} />
          <Words variant="caption" tone="ink2">
            {light.day}
          </Words>
          <Words variant="caption" tone="ink3">
            {light.note}
          </Words>
          {light.late ? (
            <Words variant="caption" tone="ink3">
              <Trans>late</Trans>
            </Words>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Sunday (spec §13, A9): her latest weekly read the founder sent. Seven lights for her week, with a
 * late day marked; the count lines from the week's numbers; up to four notes in Literata; one
 * suggestion in action colour. Without Vela Light the lights show and the rest waits behind the
 * trial. Organisers only, since the read carries the counts of her days.
 */
export default function SundayScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const view = useWeeklyRead();
  const { read } = view;
  const name = read.name;

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      {/* The tab's own name: Chinese calls the tab 週日, and a weekday 星期日. */}
      <Words variant="title">
        <Trans context="tab">Sunday</Trans>
      </Words>
      {!view.organiser ? (
        <Words variant="body" tone="ink2">
          <Trans>The weekly read goes to the family's organisers.</Trans>
        </Words>
      ) : view.nobody ? (
        <Words variant="body" tone="ink2">
          <Trans>The weekly read starts once she has said yes and had a week of mornings.</Trans>
        </Words>
      ) : view.trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>The weekly read could not be reached just now.</Trans>
        </Words>
      ) : view.live && read.week === null ? (
        <Words variant="body" tone="ink2">
          <Trans>{name}'s first weekly read comes on a Sunday, after a week of her mornings.</Trans>
        </Words>
      ) : read.week === null ? null : (
        <>
          <Card>
            <Eyebrow>
              <Trans>{name}'s week</Trans>
            </Eyebrow>
            <WeekRow lights={read.week.lights} />
          </Card>
          {read.locked ? (
            <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
              <Words variant="bodyMedium">
                <Trans>Vela Light shows you the read</Trans>
              </Words>
              <Words variant="body" tone="ink2">
                <Trans>
                  What {name} told you this week, what came up twice, and something to ask her next.
                  The first 30 days are free.
                </Trans>
              </Words>
              <SecondaryButton
                label={t`See Vela Light`}
                onPress={() =>
                  router.push(
                    view.memberId === undefined
                      ? "/vela-light"
                      : { pathname: "/vela-light", params: { member: view.memberId } },
                  )
                }
              />
            </Card>
          ) : (
            <>
              <View style={{ gap: space.s }}>
                {read.week.counts.map((line) => (
                  <Words key={line} variant="body">
                    {line}
                  </Words>
                ))}
              </View>
              {read.week.notes.length === 0 ? null : (
                <>
                  <Hairline />
                  <View style={{ gap: space.m }}>
                    {read.week.notes.map((note) => (
                      <Words key={note} variant="voice">
                        {note}
                      </Words>
                    ))}
                  </View>
                </>
              )}
              {read.week.suggestion === null ? null : (
                <Card>
                  <Eyebrow>
                    <Trans>Something to ask next week</Trans>
                  </Eyebrow>
                  <Words variant="voice" tone="action">
                    {read.week.suggestion}
                  </Words>
                </Card>
              )}
              <PrimaryButton
                label={t`Ask ${name} something`}
                onPress={() =>
                  router.push(
                    view.memberId === undefined
                      ? "/ask"
                      : { pathname: "/ask", params: { recipient: view.memberId } },
                  )
                }
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
