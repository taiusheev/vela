import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AnswerPanel, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { FamilyScene } from "../../src/components/brand/scene.tsx";
import { Light } from "../../src/components/light.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { StoryDay, StoryOfTheWeek } from "../../src/components/story-day.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  PrimaryButton,
  SecondaryButton,
  Words,
} from "../../src/components/ui.tsx";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { type TodayView, useToday } from "../../src/data/useToday.ts";
import { useWeeklyRead } from "../../src/data/useWeeklyRead.ts";
import { useWeeklyReadOpened } from "../../src/data/useWeeklyReadOpened.ts";
import type { WeekLight } from "../../src/data/weekly.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

/** Seven small lights, Monday to Sunday, each with its day and the time she answered (A9). */
function WeekRow({ lights }: { lights: WeekLight[] }) {
  const { t } = useLingui();
  const { width, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(width - space.margin * 4 - 2);
  // Keep calendar columns aligned when the phone or text size needs a second row.
  const columns =
    available >= 40 * fontScale * 7
      ? 7
      : available >= 40 * fontScale * 4
        ? 4
        : available >= 40 * fontScale * 2
          ? 2
          : 1;
  return (
    <View
      onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        rowGap: space.l,
      }}
    >
      {lights.map((light) => {
        const day = light.day;
        const time = light.note;
        return (
          <View
            key={light.date}
            accessible
            accessibilityLabel={[
              light.note.length > 0 ? t`${day}: answered at ${time}` : t`${day}: no answer`,
              light.late ? t`late` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            style={{ alignItems: "center", gap: space.xs, width: `${100 / columns}%` }}
          >
            <Light state={light.state} height={28} />
            <Words variant="caption" tone="ink2">
              {light.day}
            </Words>
            <Words variant="caption" tone="ink3">
              {light.note || "—"}
            </Words>
            {light.late ? (
              <Words variant="caption" tone="ink3">
                <Trans>late</Trans>
              </Words>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Sunday (spec §13, A9): her latest weekly read the founder sent. Seven lights for her week, with a
 * late day marked; the count lines from the week's numbers; up to four notes in Literata; one
 * suggestion in action colour; the story of the week from the family book. Without Vela Light the lights show and the rest waits behind the
 * trial. Organisers only, since the read carries the counts of her days.
 */
export default function SundayScreen() {
  const day = useToday();
  return <FamilySunday key={day.familyId ?? ""} day={day} />;
}

function FamilySunday({ day }: { day: TodayView }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const [selected, select] = useState<string | undefined>();
  const view = useWeeklyRead(selected);
  useFocusEffect(
    useCallback(() => {
      view.refresh();
    }, [view.refresh]),
  );
  const { capabilities } = useCapabilities();
  const { read } = view;
  useWeeklyReadOpened(
    view.live &&
      !view.loading &&
      view.organiser &&
      !view.nobody &&
      !view.trouble &&
      read.week !== null &&
      !read.locked
      ? view.readId
      : undefined,
  );
  const name = read.name;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={view.refreshing} onRefresh={view.refresh} />}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      {/* The tab's own name: Chinese calls the tab 週日, and a weekday 星期日. */}
      <ScreenHeading
        title={<Trans context="tab">Sunday</Trans>}
        illustration={<FamilyScene kind="book" width={94} />}
      />
      <ParentChooser lights={day.today.lights} selected={view.memberId} onSelect={select} />
      {view.trouble ? <SecondaryButton label={t`Try again`} onPress={view.refresh} /> : null}
      {view.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>One moment…</Trans>
        </Words>
      ) : !view.organiser ? (
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
      ) : read.week === null && name.length > 0 ? (
        <Words variant="body" tone="ink2">
          <Trans>
            {name}'s first weekly read comes on a Sunday, after a week of their mornings.
          </Trans>
        </Words>
      ) : read.week === null ? null : (
        <>
          <Card>
            <Eyebrow>
              <Trans>{name}'s week</Trans>
            </Eyebrow>
            <WeekRow lights={read.week.lights} />
          </Card>
          {read.locked && capabilities?.billing !== true ? (
            <Words variant="body" tone="ink2">
              <Trans>The weekly read could not be reached just now.</Trans>
            </Words>
          ) : read.locked ? (
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
                  <AnswerPanel>
                    {read.week.notes.map((note) => (
                      <Words key={note} variant="voice">
                        {note}
                      </Words>
                    ))}
                  </AnswerPanel>
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
              <StoryOfTheWeek
                from={read.week.lights[0]?.date ?? ""}
                to={read.week.lights.at(-1)?.date ?? ""}
                {...(view.memberId === undefined ? {} : { memberId: view.memberId })}
              />
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
      <StoryDay key={`${day.familyId}:${view.memberId}`} memberId={view.memberId} />
    </ScrollView>
  );
}
