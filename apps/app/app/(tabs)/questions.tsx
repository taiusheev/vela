import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiPlannedAsk } from "@vela/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, View } from "react-native";
import { apiConfigured, withdrawAsk } from "../../src/api/client.ts";
import { useIdempotencyKey } from "../../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../../src/auth/clerk.tsx";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { LoadingLight } from "../../src/components/loading-light.tsx";
import { MorningCalendar } from "../../src/components/morning-calendar.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { SoftCard } from "../../src/components/today-hero.tsx";
import {
  ActionGroup,
  ActionRow,
  Eyebrow,
  Hairline,
  PrimaryButton,
  SecondaryButton,
  Words,
} from "../../src/components/ui.tsx";
import { WarmPage } from "../../src/components/warm.tsx";
import { dayName, localDayMonth } from "../../src/data/format.ts";
import { demoDataAllowed } from "../../src/data/live-state.ts";
import { questionDates } from "../../src/data/question-schedule.ts";
import { selectedLight } from "../../src/data/selected-light.ts";
import { tomorrowIn } from "../../src/data/story.ts";
import { usePlannedQuestions } from "../../src/data/usePlannedQuestions.ts";
import { useToday } from "../../src/data/useToday.ts";
import { space } from "../../src/theme/tokens.ts";

export default function QuestionsScreen() {
  const { t } = useLingui();
  const day = useToday();
  const params = useLocalSearchParams<{ recipient?: string; saved?: string; day?: string }>();
  const schedule = usePlannedQuestions(day.familyId);
  const parent = selectedLight(day.today.lights, params.recipient);
  const turn = day.today.tomorrow.find((item) => item.recipientId === parent?.memberId);
  const name = parent?.displayName ?? "";
  const fromName = turn?.asked?.by ?? "";
  const questions =
    schedule.data?.questions.filter((item) => item.recipient_id === parent?.memberId) ?? [];
  const refresh = useCallback(async () => {
    await day.refresh();
    if (day.familyId !== undefined) await schedule.refetch();
  }, [day.refresh, day.familyId, schedule.refetch]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return (
    <WarmPage
      gap={space.l}
      refreshControl={<RefreshControl refreshing={day.loading} onRefresh={refresh} />}
    >
      <ScreenHeading title={<Trans>Questions</Trans>} />
      <Words variant="body" tone="ink2">
        <Trans>A few words from you can start a whole conversation.</Trans>
      </Words>
      {params.saved === "1" ? (
        <View accessibilityLiveRegion="polite">
          <Words variant="caption" tone="action">
            <Trans>Question saved. You can adjust it below.</Trans>
          </Words>
        </View>
      ) : null}
      <ParentChooser
        lights={day.today.lights}
        selected={parent?.memberId}
        onSelect={(recipient) => router.setParams({ recipient, saved: undefined, day: undefined })}
      />
      {day.loading ? (
        <LoadingLight label={t`Loading your family…`} />
      ) : day.trouble ? (
        <SecondaryButton label={t`Try again`} onPress={refresh} />
      ) : parent === undefined ? (
        <PrimaryButton label={t`Connect my family`} onPress={() => router.push("/onboarding")} />
      ) : (
        <>
          <PrimaryButton
            icon="ask"
            label={t`Write a question for ${name}`}
            onPress={() =>
              router.push({ pathname: "/ask", params: { recipient: parent.memberId } })
            }
          />
          {schedule.isError ? (
            <>
              <Words variant="body" tone="ink2">
                <Trans>
                  Your schedule could not be loaded. Your saved questions are unchanged.
                </Trans>
              </Words>
              <SecondaryButton label={t`Reload schedule`} onPress={() => void schedule.refetch()} />
            </>
          ) : schedule.isFetching && schedule.data === undefined && day.live ? (
            <LoadingLight label={t`Loading your schedule…`} />
          ) : (
            <MorningPlan
              key={parent.memberId}
              recipientId={parent.memberId}
              timeZone={parent.timeZone}
              questions={questions}
              focus={params.day}
            />
          )}
          {questions.length === 0 && turn?.asked ? (
            <SoftCard>
              <Eyebrow>
                <Trans>Tomorrow morning</Trans>
              </Eyebrow>
              <Words variant="preview">{turn.asked.text}</Words>
              <Words variant="caption" tone="ink2">
                {t`From ${fromName}`}
              </Words>
            </SoftCard>
          ) : null}
          {turn?.suggestion ? (
            <SoftCard tone="paper">
              <Eyebrow>
                <Trans>A starting point</Trans>
              </Eyebrow>
              <Words variant="preview">{turn.suggestion.text}</Words>
              <SecondaryButton
                icon="ask"
                label={t`Make it mine`}
                onPress={() =>
                  router.push({
                    pathname: "/ask",
                    params: { recipient: parent.memberId, suggestion: turn.suggestion?.id },
                  })
                }
              />
              <Words variant="caption" tone="ink2">
                <Trans>Change any words before you send.</Trans>
              </Words>
            </SoftCard>
          ) : null}
        </>
      )}
    </WarmPage>
  );
}

/**
 * The next two weeks as one calendar with the chosen morning under it, so a family sees the whole
 * plan at a glance and opens one question at a time, instead of scrolling a card per question
 * (founder, 24 Oct 2026). Questions waiting for any free morning have no day, so they follow below.
 */
function MorningPlan({
  recipientId,
  timeZone,
  questions,
  focus,
}: {
  recipientId: string;
  timeZone: string | undefined;
  questions: readonly ApiPlannedAsk[];
  focus: string | undefined;
}) {
  const { t } = useLingui();
  const tomorrow = tomorrowIn(new Date(), timeZone);
  const dates = questionDates(tomorrow);
  const onDay = new Map(
    questions.flatMap((question) =>
      question.date !== null && dates.includes(question.date) ? [[question.date, question]] : [],
    ),
  );
  const waiting = questions.filter(
    (question) => question.date === null || !dates.includes(question.date),
  );
  const firstPlanned = dates.find((date) => onDay.has(date));
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const chosen = [picked, focus, firstPlanned, tomorrow].find(
    (date): date is string => date !== undefined && dates.includes(date),
  );
  const question = chosen === undefined ? undefined : onDay.get(chosen);
  const planned = new Map(Array.from(onDay.keys(), (date) => [date, "planned" as const]));
  const count = onDay.size;
  return (
    <>
      <SoftCard>
        <View style={{ gap: space.xs }}>
          <Words variant="heading" accessibilityRole="header">
            <Trans>Planned questions</Trans>
          </Words>
          <Words variant="caption" tone="ink2">
            {count === 0 ? t`Nothing planned yet` : t`${count} of the next 14 mornings`}
          </Words>
        </View>
        <MorningCalendar
          dates={dates}
          selected={chosen}
          marks={planned}
          tomorrow={tomorrow}
          onSelect={setPicked}
        />
        <Hairline />
        {chosen === undefined ? null : question === undefined ? (
          <FreeMorning recipientId={recipientId} date={chosen} tomorrow={tomorrow} />
        ) : (
          <PlannedQuestion question={question} tomorrow={tomorrow} />
        )}
      </SoftCard>
      {waiting.map((item) => (
        <SoftCard key={item.id}>
          <PlannedQuestion question={item} tomorrow={tomorrow} />
        </SoftCard>
      ))}
    </>
  );
}

/** "Tomorrow · Sunday, 25 Oct": the chosen morning, named so nobody has to count. */
function morningName(date: string | null, tomorrow: string, nextFree: string, soon: string) {
  if (date === null) return nextFree;
  const named = `${dayName(date)}, ${localDayMonth(date)}`;
  return date === tomorrow ? `${soon} · ${named}` : named;
}

function FreeMorning({
  recipientId,
  date,
  tomorrow,
}: {
  recipientId: string;
  date: string;
  tomorrow: string;
}) {
  const { t } = useLingui();
  const day = dayName(date);
  return (
    <View style={{ gap: space.m }}>
      <Eyebrow>{morningName(date, tomorrow, t`Next free morning`, t`Tomorrow`)}</Eyebrow>
      <Words variant="body" tone="ink2">
        <Trans>Nothing planned for this morning. Vela sends a gentle hello on open days.</Trans>
      </Words>
      <SecondaryButton
        icon="plus"
        label={t`Plan a question for ${day}`}
        onPress={() => router.push({ pathname: "/ask", params: { recipient: recipientId, date } })}
      />
    </View>
  );
}

function PlannedQuestion({ question, tomorrow }: { question: ApiPlannedAsk; tomorrow: string }) {
  const { t } = useLingui();
  const account = useAccount();
  const askerName = question.asker_name;
  const queries = useQueryClient();
  const keyFor = useIdempotencyKey("remove-planned-question");
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: async () => {
      if (demoDataAllowed(apiConfigured(), accountsConfigured())) {
        queries.setQueriesData<import("@vela/contracts").ApiPlannedQuestions>(
          { queryKey: ["planned-questions"] },
          (data) =>
            data ? { questions: data.questions.filter((item) => item.id !== question.id) } : data,
        );
        return;
      }
      return withdrawAsk(question.id, keyFor({ id: question.id }), await account.token());
    },
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["planned-questions"] }),
        queries.invalidateQueries({ queryKey: ["today"] }),
        queries.invalidateQueries({ queryKey: ["book"] }),
      ]);
    },
  });
  return (
    <View style={{ gap: space.m }}>
      <Eyebrow>{morningName(question.date, tomorrow, t`Next free morning`, t`Tomorrow`)}</Eyebrow>
      <Words variant="preview">{question.text}</Words>
      <Words variant="caption" tone="ink2">{t`From ${askerName}`}</Words>
      {question.editable ? (
        <>
          {confirm ? (
            <View style={{ gap: space.s }}>
              <Words variant="body">
                <Trans>Remove this planned question?</Trans>
              </Words>
              <SecondaryButton
                label={t`Yes, remove question`}
                disabled={remove.isPending}
                onPress={() => remove.mutate()}
              />
              <SecondaryButton
                label={t`Keep question`}
                disabled={remove.isPending}
                onPress={() => setConfirm(false)}
              />
            </View>
          ) : (
            <ActionGroup>
              <ActionRow
                first
                icon="ask"
                label={t`Edit question or day`}
                onPress={() =>
                  router.push({
                    pathname: "/ask",
                    params: { recipient: question.recipient_id, edit: question.id },
                  })
                }
              />
              <ActionRow
                icon="trash"
                careful
                label={t`Remove question`}
                onPress={() => setConfirm(true)}
              />
            </ActionGroup>
          )}
          {remove.isError ? (
            <Words variant="body" tone="ink2">
              <Trans>
                This question may already be preparing for delivery. Reload the schedule before
                trying again.
              </Trans>
            </Words>
          ) : null}
        </>
      ) : (
        <Words variant="caption" tone="ink2">
          {question.preparing ? (
            <Trans>Preparing for delivery. This question can no longer be changed.</Trans>
          ) : (
            <Trans>The person who wrote this question can change it.</Trans>
          )}
        </Words>
      )}
    </View>
  );
}
