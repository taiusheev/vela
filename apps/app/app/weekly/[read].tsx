import { useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams } from "expo-router";
import { LoadingShapes } from "../../src/components/loading-shapes.tsx";
import { SecondaryButton, Words } from "../../src/components/ui.tsx";
import { WarmPage } from "../../src/components/warm.tsx";
import { WeeklyReadCard } from "../../src/components/weekly-read-card.tsx";
import { useWeeklyRead } from "../../src/data/useWeeklyRead.ts";
import { useWeeklyReadOpened } from "../../src/data/useWeeklyReadOpened.ts";

/**
 * One of her earlier weekly reads, as it was sent, opened from the Sunday tab's earlier weeks. The
 * same card as this week's: what to ask, why, from which morning, then her week and the counts.
 */
export default function EarlierWeeklyRead() {
  const { t } = useLingui();
  const { read: readId, member } = useLocalSearchParams<{ read: string; member?: string }>();
  const view = useWeeklyRead(member, readId);
  const { read } = view;
  useWeeklyReadOpened(
    view.live && !view.loading && view.organiser && read.week !== null && !read.locked
      ? view.readId
      : undefined,
  );
  return (
    <WarmPage>
      <Stack.Screen options={{ title: read.week?.range ?? t`Earlier week` }} />
      {view.loading ? (
        <LoadingShapes label={t`Opening the week`} />
      ) : view.trouble || read.week === null ? (
        <>
          <Words variant="body" tone="ink2">
            {t`This week's read could not be opened just now.`}
          </Words>
          <SecondaryButton label={t`Try again`} onPress={() => void view.refresh()} />
        </>
      ) : read.locked ? (
        <Words variant="body" tone="ink2">
          {t`This week's read could not be opened just now.`}
        </Words>
      ) : (
        <WeeklyReadCard
          id={`week-${readId}`}
          name={read.name}
          week={read.week}
          memberId={view.memberId}
          live={view.live}
        />
      )}
    </WarmPage>
  );
}
