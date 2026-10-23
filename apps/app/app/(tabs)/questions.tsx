import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiPlannedAsk } from "@vela/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, withdrawAsk } from "../../src/api/client.ts";
import { useIdempotencyKey } from "../../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../../src/auth/clerk.tsx";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { Card, Eyebrow, PrimaryButton, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { dayName, localDayMonth } from "../../src/data/format.ts";
import { demoDataAllowed } from "../../src/data/live-state.ts";
import { selectedLight } from "../../src/data/selected-light.ts";
import { usePlannedQuestions } from "../../src/data/usePlannedQuestions.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function QuestionsScreen() {
  const { t } = useLingui();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const day = useToday();
  const params = useLocalSearchParams<{ recipient?: string; saved?: string }>();
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
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={day.loading} onRefresh={refresh} />}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.l,
      }}
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
        onSelect={(recipient) => router.setParams({ recipient, saved: undefined })}
      />
      {day.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Loading your family…</Trans>
        </Words>
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
          <Words variant="caption" tone="ink2">
            <Trans>
              Write it, choose a morning, then save. You can change it here before it is prepared
              for delivery.
            </Trans>
          </Words>
          <View style={{ gap: space.m }}>
            <Words variant="heading">
              <Trans>Planned questions</Trans>
            </Words>
            {schedule.isError ? (
              <>
                <Words variant="body" tone="ink2">
                  <Trans>
                    Your schedule could not be loaded. Your saved questions are unchanged.
                  </Trans>
                </Words>
                <SecondaryButton
                  label={t`Reload schedule`}
                  onPress={() => void schedule.refetch()}
                />
              </>
            ) : schedule.isFetching && schedule.data === undefined && day.live ? (
              <Words variant="body" tone="ink2">
                <Trans>Loading your schedule…</Trans>
              </Words>
            ) : questions.length > 0 ? (
              questions.map((question) => <PlannedQuestion key={question.id} question={question} />)
            ) : turn?.asked ? (
              <Card>
                <Eyebrow>
                  <Trans>Tomorrow morning</Trans>
                </Eyebrow>
                <Words variant="voice">{turn.asked.text}</Words>
                <Words variant="caption" tone="ink2">
                  {t`From ${fromName}`}
                </Words>
              </Card>
            ) : (
              <Words variant="body" tone="ink2">
                <Trans>
                  No questions planned yet. Start with one; there is no need to fill every day.
                </Trans>
              </Words>
            )}
          </View>
          {turn?.suggestion ? (
            <Card>
              <Eyebrow>
                <Trans>A starting point</Trans>
              </Eyebrow>
              <Words variant="voice">{turn.suggestion.text}</Words>
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
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function PlannedQuestion({ question }: { question: ApiPlannedAsk }) {
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
    <Card>
      <Eyebrow>
        {question.date === null
          ? t`Next free morning`
          : `${dayName(question.date)}, ${localDayMonth(question.date)}`}
      </Eyebrow>
      <Words variant="bodyMedium">{question.text}</Words>
      <Words variant="caption" tone="ink2">{t`From ${askerName}`}</Words>
      {question.editable ? (
        <>
          {confirm ? (
            <>
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
            </>
          ) : (
            <View style={{ gap: space.s }}>
              <SecondaryButton
                icon="ask"
                label={t`Edit question or day`}
                onPress={() =>
                  router.push({
                    pathname: "/ask",
                    params: { recipient: question.recipient_id, edit: question.id },
                  })
                }
              />
              <SecondaryButton label={t`Remove question`} onPress={() => setConfirm(true)} />
            </View>
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
    </Card>
  );
}
