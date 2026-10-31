import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ApiPersonalQuestionDraft,
  DraftPersonalQuestion,
  QuestionPersonalization,
} from "@vela/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  apiConfigured,
  askConflict,
  composeAsk,
  draftPersonalQuestion,
} from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { ScreenHeading } from "../src/components/brand/experience.tsx";
import { MorningCalendar, type MorningMark } from "../src/components/morning-calendar.tsx";
import { ParentChooser } from "../src/components/parent-chooser.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import {
  Chip,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import { WarmPage } from "../src/components/warm.tsx";
import { finishQuestionSave } from "../src/data/finish-question-save.ts";
import { demoDataAllowed, sessionScope } from "../src/data/live-state.ts";
import { questionDates } from "../src/data/question-schedule.ts";
import { selectedLight } from "../src/data/selected-light.ts";
import { tomorrowIn } from "../src/data/story.ts";
import type { TodayLight } from "../src/data/today.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { usePlannedQuestions } from "../src/data/usePlannedQuestions.ts";
import { useToday } from "../src/data/useToday.ts";
import { space } from "../src/theme/tokens.ts";

/** Notes are component state only. Account, family and recipient changes destroy the whole form. */
export default function PersonalQuestionScreen() {
  const { t } = useLingui();
  const account = useAccount();
  const day = useToday();
  const params = useLocalSearchParams<{ recipient?: string }>();
  const caps = useCapabilities();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const lights = demo || day.live ? day.today.lights : [];
  const parent = selectedLight(lights, params.recipient);
  const available = demo || (caps.capabilities?.personal_questions === true && day.live);
  return (
    <WarmPage gap={space.l}>
      <ScreenHeading title={<Trans>A question in your words</Trans>} />
      <ParentChooser
        lights={lights}
        selected={parent?.memberId}
        onSelect={(recipient) => router.setParams({ recipient })}
      />
      {!available || parent === undefined ? (
        <Words tone="ink2">
          <Trans>Personal drafts are not available here yet.</Trans>
        </Words>
      ) : (
        <PersonalDraft
          key={`${sessionScope(account)}:${day.familyId}:${parent.memberId}`}
          familyId={day.familyId}
          parent={parent}
          demo={demo}
        />
      )}
      <SecondaryButton label={t`Back to questions`} onPress={() => router.replace("/questions")} />
    </WarmPage>
  );
}

function PersonalDraft({
  familyId,
  parent,
  demo,
}: {
  familyId: string | undefined;
  parent: TodayLight;
  demo: boolean;
}) {
  const { t, i18n } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const schedule = usePlannedQuestions(familyId);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const draftKey = useIdempotencyKey("personal-draft");
  const saveKey = useIdempotencyKey("personal-question");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [connection, setConnection] = useState<QuestionPersonalization["connection"]>("unsure");
  const [contact, setContact] = useState<QuestionPersonalization["talking_rhythm"]>("unsure");
  const [address, setAddress] = useState(parent.displayName);
  const [intent, setIntent] = useState("");
  const [example1, setExample1] = useState("");
  const [example2, setExample2] = useState("");
  const [avoid, setAvoid] = useState("");
  const [never, setNever] = useState("");
  const [language, setLanguage] = useState<"en" | "zh-TW">(
    i18n.locale === "zh-TW" ? "zh-TW" : "en",
  );
  const [result, setResult] = useState<ApiPersonalQuestionDraft | null>(null);
  const [words, setWords] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [exampleFinished, setExampleFinished] = useState(false);
  const [date, setDate] = useState<string | undefined>();
  const tomorrow = tomorrowIn(new Date(), parent.timeZone);
  const dates = questionDates(tomorrow);
  const marks = new Map<string, MorningMark>(
    (schedule.data?.questions ?? []).flatMap((q) =>
      q.recipient_id === parent.memberId && q.date !== null ? [[q.date, "taken"] as const] : [],
    ),
  );
  const input: DraftPersonalQuestion = {
    recipient_id: parent.memberId,
    language,
    address_form: address.trim(),
    context: {
      intent: intent.trim(),
      connection,
      talking_rhythm: contact,
      avoid_topics: avoid.trim() ? [avoid.trim()] : [],
      never_say: never.trim() ? [never.trim()] : [],
    },
    writing_examples: [example1.trim(), example2.trim()].filter(Boolean),
  };
  const generate = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      if (connection === "quiet") return { state: "not_drafted", reason: "quiet" } as const;
      if (demo) {
        const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
        if (
          [avoid.trim(), never.trim()]
            .filter(Boolean)
            .some((term) => normalize(intent).includes(normalize(term)))
        )
          return { state: "not_drafted", reason: "boundary" } as const;
        // Explicit preview of the person's supplied words; no pretend model or family facts.
        const ownWords = intent.trim().replace(/[?？]+$/u, "");
        return {
          state: "review",
          language,
          text: language === "zh-TW" ? `${address}，${ownWords}？` : `${address}, ${ownWords}?`,
        } as const;
      }
      return draftPersonalQuestion(familyId ?? "", draftKey(input), input, await account.token());
    },
    onSuccess: (next) => {
      if (!mounted.current) return;
      setExampleFinished(false);
      setResult(next);
      setWords(next.state === "review" ? next.text : "");
      setConfirmed(false);
      setStep(3);
    },
  });
  const save = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      if (!confirmed || !date || result?.state !== "review" || !words.trim()) return;
      const ask = {
        recipient_id: parent.memberId,
        type: "question" as const,
        text: words.trim(),
        when: "date" as const,
        date,
        ai_assisted: true,
        text_language: result.language,
      };
      if (!demo) await composeAsk(familyId ?? "", saveKey(ask), ask, await account.token());
      if (demo) return "example";
      return "saved";
    },
    onSuccess: (outcome) => {
      if (!mounted.current) return;
      if (outcome === undefined) return;
      // Acceptance is final; an unavailable refresh must not turn success into another send.
      void finishQuestionSave(queries, familyId, async () => {});
      setWords("");
      setExample1("");
      setExample2("");
      setIntent("");
      if (outcome === "example") {
        setExampleFinished(true);
        setResult(null);
        return;
      }
      router.replace({
        pathname: "/questions",
        params: { recipient: parent.memberId, saved: "1", day: date },
      });
    },
  });
  const name = parent.displayName;
  const blockedParent = parent.invited || parent.state === "resting";
  return (
    <>
      <Words tone="ink2">
        <Trans>
          Start with something you genuinely want to ask. You choose the final words and the day.
        </Trans>
      </Words>
      <Words variant="caption" tone="ink2">
        <Trans>
          These choices shape this draft only. They do not change automatic questions or morning
          check-ins.
        </Trans>
      </Words>
      {demo ? (
        <Words variant="caption" tone="action">
          <Trans>
            Example mode: the preview uses your own words. No AI is called and nothing is saved or
            sent.
          </Trans>
        </Words>
      ) : null}
      <Eyebrow>{t`Step ${step} of 3`}</Eyebrow>
      {step === 1 ? (
        <>
          <TextField
            label={t`What do you call ${name}?`}
            value={address}
            onChangeText={setAddress}
            maxLength={40}
          />
          <Words variant="bodyMedium">
            <Trans>What feels comfortable between you?</Trans>
          </Words>
          <Options<QuestionPersonalization["connection"]>
            value={connection}
            onChange={setConnection}
            options={[
              ["everyday", t`Everyday conversation`],
              ["practical", t`Keep it practical`],
              ["reconnecting", t`Ease back into talking`],
              ["unsure", t`Not sure yet`],
              ["quiet", t`Some space for now`],
            ]}
          />
          <Words variant="bodyMedium">
            <Trans>How often do you usually talk?</Trans>
          </Words>
          <Options<QuestionPersonalization["talking_rhythm"]>
            value={contact}
            onChange={setContact}
            options={[
              ["often", t`Often`],
              ["sometimes", t`Sometimes`],
              ["rarely", t`Rarely`],
              ["unsure", t`Not sure yet`],
            ]}
          />
          <Words variant="caption" tone="ink2">
            <Trans>
              Occasional contact is okay. More personal questions are always your choice.
            </Trans>
          </Words>
          <PrimaryButton
            label={connection === "quiet" ? t`Leave room for now` : t`Next: your words`}
            disabled={!address.trim()}
            onPress={() => (connection === "quiet" ? generate.mutate() : setStep(2))}
          />
        </>
      ) : step === 2 ? (
        <>
          <TextField
            label={t`What would you like to ask?`}
            value={intent}
            onChangeText={setIntent}
            helper={t`One ordinary thing you actually want to hear about.`}
            multiline
            maxLength={120}
            disabled={generate.isPending}
          />
          <TextField
            label={t`A message you would write to ${name} (optional)`}
            value={example1}
            onChangeText={setExample1}
            maxLength={180}
            multiline
            disabled={generate.isPending}
            helper={t`Use only your own words to this person. Leave out private details and other people's messages.`}
          />
          <TextField
            label={t`Another example (optional)`}
            value={example2}
            onChangeText={setExample2}
            maxLength={180}
            multiline
            disabled={generate.isPending}
          />
          <TextField
            label={t`A topic to leave out (optional)`}
            value={avoid}
            onChangeText={setAvoid}
            maxLength={40}
            disabled={generate.isPending}
          />
          <TextField
            label={t`Words you would never use (optional)`}
            value={never}
            onChangeText={setNever}
            maxLength={60}
            disabled={generate.isPending}
          />
          <Words variant="bodyMedium">
            <Trans>Language of this question</Trans>
          </Words>
          <Options<"en" | "zh-TW">
            value={language}
            onChange={setLanguage}
            disabled={generate.isPending}
            options={[
              ["en", "English"],
              ["zh-TW", "繁體中文"],
            ]}
          />
          <Words variant="caption" tone="ink2">
            <Trans>
              Vela uses these notes to prepare a draft. They are not added to a lasting relationship
              profile.
            </Trans>
          </Words>
          {generate.isError ? (
            <Words tone="error">
              <Trans>The draft could not be prepared. Your words are still here.</Trans>
            </Words>
          ) : null}
          <PrimaryButton
            label={generate.isPending ? t`Preparing your draft…` : t`Prepare a draft`}
            disabled={generate.isPending || !intent.trim() || blockedParent}
            onPress={() => generate.mutate()}
          />
          {blockedParent ? (
            <Words tone="ink2">
              <Trans>Drafting can begin once this person has agreed and their light is on.</Trans>
            </Words>
          ) : null}
          <SecondaryButton
            label={t`Back`}
            disabled={generate.isPending}
            onPress={() => setStep(1)}
          />
        </>
      ) : result?.state === "review" ? (
        <>
          <SoftCard>
            <Eyebrow>
              <Trans>A draft for your review</Trans>
            </Eyebrow>
            <TextField
              label={t`Your question`}
              value={words}
              onChangeText={(next) => {
                setWords(next);
                setConfirmed(false);
              }}
              multiline
              maxLength={200}
              disabled={save.isPending}
            />
            <Words variant="caption" tone="ink2">
              <Trans>Check the facts, tone, and topic. Vela can get these wrong.</Trans>
            </Words>
            <Chip
              label={t`These words feel like me, and I want to ask this.`}
              selected={confirmed}
              disabled={save.isPending}
              onPress={() => setConfirmed(!confirmed)}
            />
          </SoftCard>
          <Words variant="bodyMedium">
            <Trans>Choose a morning</Trans>
          </Words>
          <MorningCalendar
            dates={dates}
            selected={date}
            marks={marks}
            tomorrow={tomorrow}
            disabled={save.isPending || (!demo && schedule.data === undefined)}
            onSelect={setDate}
          />
          {schedule.isError ? (
            <SecondaryButton label={t`Reload schedule`} onPress={() => void schedule.refetch()} />
          ) : null}
          {save.isError ? (
            <Words tone="error">
              {askConflict(save.error) !== null
                ? t`That morning already has a question. Choose another morning.`
                : t`Saving was not confirmed. Keep this screen open and try again.`}
            </Words>
          ) : null}
          <PrimaryButton
            label={save.isPending ? t`Saving…` : demo ? t`Finish example` : t`Save this question`}
            disabled={!confirmed || !date || !words.trim() || save.isPending}
            onPress={() => save.mutate()}
          />
          <SecondaryButton
            label={t`Change starting points`}
            disabled={save.isPending}
            onPress={() => {
              setResult(null);
              setStep(2);
            }}
          />
        </>
      ) : (
        <>
          <Words>
            {exampleFinished
              ? t`Example complete. Nothing was saved or sent.`
              : result?.state === "not_drafted" && result.reason === "quiet"
                ? t`No question is needed right now. Your existing morning settings stay as they are.`
                : t`No draft was kept. Try a different topic or write your own question.`}
          </Words>
          <SecondaryButton label={t`Change starting points`} onPress={() => setStep(1)} />
        </>
      )}
    </>
  );
}

function Options<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {options.map(([key, label]) => (
        <Chip
          key={key}
          label={label}
          selected={value === key}
          disabled={disabled}
          onPress={() => onChange(key)}
        />
      ))}
    </View>
  );
}
