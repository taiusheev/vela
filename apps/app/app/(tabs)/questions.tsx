import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { StoryDay } from "../../src/components/story-day.tsx";
import { Card, Eyebrow, PrimaryButton, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { selectedLight } from "../../src/data/selected-light.ts";
import { useToday } from "../../src/data/useToday.ts";
import { useWeeklyRead } from "../../src/data/useWeeklyRead.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

/** The central + keeps composing and story planning together; Sunday is for the week's report. */
export default function QuestionsScreen() {
  const { t } = useLingui();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const day = useToday();
  const [selected, select] = useState<string>();
  const parent = selectedLight(day.today.lights, selected);
  const turn = day.today.tomorrow.find((item) => item.recipientId === parent?.memberId);
  const parentName = parent?.displayName ?? "";
  const fromName = turn?.asked?.by ?? "";
  useFocusEffect(
    useCallback(() => {
      day.refresh();
    }, [day.refresh]),
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={day.loading} onRefresh={day.refresh} />}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      <ScreenHeading title={<Trans>Questions</Trans>} />
      <Words variant="body" tone="ink2">
        <Trans>
          A little something to ask. Write your own, choose an idea, or plan a story for Sunday.
        </Trans>
      </Words>
      <ParentChooser lights={day.today.lights} selected={parent?.memberId} onSelect={select} />
      {day.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Loading your family…</Trans>
        </Words>
      ) : day.trouble ? (
        <>
          <Words variant="body" tone="ink2">
            <Trans>
              Your family could not be reached just now. Your saved questions are unchanged.
            </Trans>
          </Words>
          <SecondaryButton label={t`Try again`} onPress={day.refresh} />
        </>
      ) : parent === undefined ? (
        <>
          <Words variant="body" tone="ink2">
            <Trans>Connect your family before adding a question.</Trans>
          </Words>
          <PrimaryButton label={t`Connect my family`} onPress={() => router.push("/onboarding")} />
        </>
      ) : (
        <>
          <PrimaryButton
            icon="ask"
            label={t`Write a question for ${parentName}`}
            onPress={() =>
              router.push({ pathname: "/ask", params: { recipient: parent.memberId } })
            }
          />
          {turn?.asked ? (
            <Card>
              <Eyebrow>
                <Trans>Planned for tomorrow</Trans>
              </Eyebrow>
              <Words variant="voice">{turn.asked.text}</Words>
              <Words
                variant="caption"
                tone="ink2"
              >{t`From ${fromName} · Saved for their morning`}</Words>
            </Card>
          ) : turn?.suggestion ? (
            <Card>
              <Eyebrow>
                <Trans>Vela suggests</Trans>
              </Eyebrow>
              <Words variant="voice">{turn.suggestion.text}</Words>
              <SecondaryButton
                icon="check"
                label={t`Use this suggestion`}
                onPress={() =>
                  router.push({
                    pathname: "/ask",
                    params: { recipient: parent.memberId, suggestion: turn.suggestion?.id },
                  })
                }
              />
            </Card>
          ) : null}
          <StoryDay
            key={`story:${day.familyId}:${parent.memberId}`}
            memberId={parent.memberId}
            primary={false}
          />
          {day.organiser ? (
            <WeeklyQuestion
              key={`weekly:${day.familyId}:${parent.memberId}`}
              memberId={parent.memberId}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function WeeklyQuestion({ memberId }: { memberId: string }) {
  const view = useWeeklyRead(memberId);
  const suggestion = view.read.week?.suggestion;
  if (view.loading || view.trouble || view.read.locked || !suggestion) return null;
  return (
    <Card>
      <Eyebrow>
        <Trans>Something to ask next week</Trans>
      </Eyebrow>
      <Words variant="voice" tone="action">
        {suggestion}
      </Words>
    </Card>
  );
}
