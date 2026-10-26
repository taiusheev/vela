import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { ConnectionWindows } from "../../src/components/connection-windows.tsx";
import { FirstWeek } from "../../src/components/first-week.tsx";
import { LoadingShapes } from "../../src/components/loading-shapes.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { PrivateReportEntry } from "../../src/components/private-report-entry.tsx";
import { SectionTitle, SoftCard } from "../../src/components/today-hero.tsx";
import { Card, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { WarmPage } from "../../src/components/warm.tsx";
import { WeeklyReadCard } from "../../src/components/weekly-read-card.tsx";
import { WeeklySupport } from "../../src/components/weekly-support.tsx";
import { localDayMonth } from "../../src/data/format.ts";
import { selectedLight } from "../../src/data/selected-light.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { usePullRefresh } from "../../src/data/usePullRefresh.ts";
import { type TodayView, useToday } from "../../src/data/useToday.ts";
import { useEarlierWeeks, useWeeklyRead } from "../../src/data/useWeeklyRead.ts";
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
  const { t } = useLingui();
  const [selected, select] = useState<string | undefined>();
  const view = useWeeklyRead(selected);
  const pull = usePullRefresh(view.refresh);
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

  return (
    <WarmPage
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.refresh} />}
    >
      {/* The tab's own name: Chinese calls the tab 週日, and a weekday 星期日. */}
      <ScreenHeading title={<Trans context="tab">Week</Trans>} />
      <ParentChooser lights={day.today.lights} selected={view.memberId} onSelect={select} />
      {/* This week first: the windows the family lit, Monday to Sunday (consumer flow row 93). */}
      {windowsFor === undefined ? null : <ConnectionWindows light={windowsFor} />}
      {view.trouble ? <SecondaryButton label={t`Try again`} onPress={view.refresh} /> : null}
      {view.loading ? (
        <LoadingShapes label={t`Opening the week`} />
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
      ) : read.week === null && windowsFor !== undefined ? (
        // Before the first read: when it comes, her words so far, an example, and a way to ask.
        <FirstWeek light={windowsFor} />
      ) : read.week === null && name.length > 0 ? (
        <Words variant="body" tone="ink2">
          <Trans>
            {name}'s first weekly read comes on a Sunday, after a week of their mornings.
          </Trans>
        </Words>
      ) : read.week === null ? null : (
        <>
          <SectionTitle title={t`${name}'s week`} />
          {read.locked && capabilities?.billing !== true ? (
            <Words variant="body" tone="ink2">
              <Trans>The weekly read could not be reached just now.</Trans>
            </Words>
          ) : read.locked ? (
            <SoftCard tone="paper">
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
            </SoftCard>
          ) : (
            <>
              <WeeklyReadCard
                id={`week-${view.readId ?? name}`}
                name={name}
                week={read.week}
                memberId={view.memberId}
                live={view.live}
              />
              <EarlierWeeks memberId={view.memberId} latestId={view.readId} />
            </>
          )}
        </>
      )}
      <PrivateReportEntry
        familyId={day.familyId}
        memberId={day.organiser ? view.memberId : day.memberId}
      />
      {view.organiser && windowsFor !== undefined && windowsFor.invited !== true ? (
        <WeeklySupport name={windowsFor.displayName} memberId={windowsFor.memberId} />
      ) : null}
    </WarmPage>
  );
}

/**
 * Her earlier weeks, newest first, each opening its read as it was sent (founder, 26 October 2026:
 * "where can I read previous reports"). Nothing shows before a second read exists.
 */
function EarlierWeeks({ memberId, latestId }: { memberId?: string; latestId?: string }) {
  const { t } = useLingui();
  const palette = usePalette();
  const { weeks } = useEarlierWeeks(memberId, latestId);
  if (weeks.length === 0 || memberId === undefined) return null;
  return (
    <View style={{ gap: space.s }}>
      <SectionTitle title={t`Earlier weeks`} />
      <Card>
        {weeks.map((week, index) => (
          <Pressable
            key={week.id}
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/weekly/[read]",
                params: { read: week.id, member: memberId },
              })
            }
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: space.m,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: palette.rule,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Words variant="body">
              {`${localDayMonth(week.weekStart)} – ${localDayMonth(week.weekEnd)}`}
            </Words>
            <Words variant="body" tone="ink3">
              ›
            </Words>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
