import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AnswerPanel, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { ConnectionWindows } from "../../src/components/connection-windows.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { StoryOfTheWeek } from "../../src/components/story-day.tsx";
import { Card, Eyebrow, Hairline, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { localDayMonth } from "../../src/data/format.ts";
import { selectedLight } from "../../src/data/selected-light.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { type TodayView, useToday } from "../../src/data/useToday.ts";
import { useWeeklyRead } from "../../src/data/useWeeklyRead.ts";
import { useWeeklyReadOpened } from "../../src/data/useWeeklyReadOpened.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

/**
 * Sunday (spec §13, A9): this week's windows first, then her latest weekly read the founder sent:
 * the count lines from the week's numbers; up to four notes in Literata; and
 * the story of the week from the family book. Question planning lives on Questions. The windows are the page's one row of lights
 * (founder, 17 October 2026: "one streak is enough"), so the read keeps its days to its count lines.
 * Without Vela Light the rest waits behind the trial. Organisers only, since the read carries the
 * counts of her days.
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
  const windowsFor = selectedLight(day.today.lights, view.memberId ?? selected);
  const first = read.week?.lights[0]?.date;
  const lastDay = read.week?.lights.at(-1)?.date;
  const range =
    first === undefined || lastDay === undefined
      ? ""
      : `${localDayMonth(first)} – ${localDayMonth(lastDay)}`;

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
      <ScreenHeading title={<Trans context="tab">Sunday</Trans>} />
      <ParentChooser lights={day.today.lights} selected={view.memberId} onSelect={select} />
      {/* This week first: the windows the family lit, Monday to Sunday (consumer flow row 93). */}
      {windowsFor === undefined ? null : <ConnectionWindows light={windowsFor} />}
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
          <Trans>The weekly read starts after a yes and a week of mornings.</Trans>
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
          <View style={{ gap: space.xs }}>
            <Eyebrow>
              <Trans>{name}'s week</Trans>
            </Eyebrow>
            {range.length === 0 ? null : (
              <Words variant="caption" tone="ink3">
                {t`The weekly read · ${range}`}
              </Words>
            )}
          </View>
          {read.locked && capabilities?.billing !== true ? (
            <Words variant="body" tone="ink2">
              <Trans>The weekly read could not be reached just now.</Trans>
            </Words>
          ) : read.locked ? (
            <Card
              style={{
                backgroundColor: palette.lightSoft,
                borderColor: palette.lightSoft,
                padding: space.l,
              }}
            >
              <Words variant="bodyMedium">
                <Trans>Vela Light shows you the read</Trans>
              </Words>
              <Words variant="body" tone="ink2">
                <Trans>
                  What {name} told you this week, what came up twice, and something to ask {name}{" "}
                  next. The first 30 days are free.
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
                      <Words key={note} variant="story">
                        {note}
                      </Words>
                    ))}
                  </AnswerPanel>
                </>
              )}
              <StoryOfTheWeek
                from={read.week.lights[0]?.date ?? ""}
                to={read.week.lights.at(-1)?.date ?? ""}
                {...(view.memberId === undefined ? {} : { memberId: view.memberId })}
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
