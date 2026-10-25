import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiAskConflict, ComposeAsk } from "@vela/contracts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findNodeHandle,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, askConflict, composeAsk, editQuestion } from "../src/api/client.ts";
import { photoRefusal, uploadVoice } from "../src/api/upload.ts";
import type { Recorded } from "../src/audio/useRecording.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { type AskIdea, AskIdeas } from "../src/components/ask-ideas.tsx";
import { CancelButton, SHEET } from "../src/components/back-button.tsx";
import { MorningCalendar } from "../src/components/morning-calendar.tsx";
import { PhotoSlots, useAskPhotos } from "../src/components/photo-slots.tsx";
import { PushOffer } from "../src/components/push-offer.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import { Chip, PrimaryButton, SecondaryButton, TextField, Words } from "../src/components/ui.tsx";
import { VoiceRecorder } from "../src/components/voice-recorder.tsx";
import { freshVoteOptions, type VoteOption, VoteOptions } from "../src/components/vote-options.tsx";
import { type AskType, composableType } from "../src/data/ask.ts";
import { askRecipient, canAsk } from "../src/data/ask-target.ts";
import { localDayMonth } from "../src/data/format.ts";
import { demoDataAllowed, sessionScope } from "../src/data/live-state.ts";
import { questionsFor } from "../src/data/onboarding.ts";
import { askExtras } from "../src/data/photos.ts";
import { editablePlannedQuestion, questionDates } from "../src/data/question-schedule.ts";
import { tomorrowIn } from "../src/data/story.ts";
import type { TodayLight, TomorrowSuggestion } from "../src/data/today.ts";
import { usePlannedQuestions } from "../src/data/usePlannedQuestions.ts";
import { dayName, type TodayView, useToday } from "../src/data/useToday.ts";
import { usePush } from "../src/push/provider.tsx";
import { readFlag, writeFlag } from "../src/storage/flags.ts";
import { useDraft } from "../src/storage/useDraft.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type When = "tomorrow" | "another_day" | "whenever" | "date";

/** Remembered once notifications have been offered after an ask, so they are offered only once. */
const OFFERED_AFTER_ASK = "push-offered.after-ask";
/** A draft storage key before a family is linked, never visible copy. */
const UNLINKED_FAMILY = "pending";
const NEW_QUESTION = "new";

type AskParams = {
  recipient?: string;
  suggestion?: string;
  text?: string;
  kind?: string;
  edit?: string;
  /** A free morning chosen on the Questions calendar, to start the question on. */
  date?: string;
};

/** The kinds the chat's "+" can open Ask on; anything else opens on a question. */
const OPENING_KINDS: readonly string[] = ["question", "two_photos", "voice_note"];

export default function AskScreen() {
  const scope = sessionScope(useAccount());
  const view = useToday();
  const params = useLocalSearchParams<AskParams>();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const lights = demo || view.live ? view.today.lights : [];
  const recipient = askRecipient(lights, params.recipient);
  const schedule = usePlannedQuestions(view.familyId);
  const editing = editablePlannedQuestion(
    schedule.data?.questions ?? [],
    params.edit,
    recipient?.memberId,
  );
  const composerKey = `${scope}:${view.familyId ?? UNLINKED_FAMILY}:${recipient?.memberId ?? UNLINKED_FAMILY}:${params.edit ?? NEW_QUESTION}`;
  const initialEdit = useRef<{ scope: string; id: string; text: string } | null>(null);
  if (initialEdit.current?.scope !== composerKey) initialEdit.current = null;
  if (editing && initialEdit.current?.id !== editing.id)
    initialEdit.current = { scope: composerKey, id: editing.id, text: editing.text };
  const draft = useDraft(
    params.edit
      ? `ask.${view.familyId ?? UNLINKED_FAMILY}.edit.${params.edit}`
      : `ask.${view.familyId ?? UNLINKED_FAMILY}`,
    params.text ?? (initialEdit.current?.id === params.edit ? initialEdit.current?.text : "") ?? "",
    params.edit === undefined,
  );
  // A different parent starts a fresh media/when/suggestion state. Written words remain in the
  // family's existing encrypted draft, including the identity of any unconfirmed send.
  return (
    <AskComposer
      key={composerKey}
      view={view}
      params={params}
      lights={lights}
      recipient={recipient}
      draft={draft}
      demo={demo}
    />
  );
}

function AskComposer({
  view,
  params,
  lights,
  recipient,
  draft,
  demo,
}: {
  view: TodayView;
  params: AskParams;
  lights: TodayLight[];
  recipient: TodayLight | undefined;
  draft: ReturnType<typeof useDraft>;
  demo: boolean;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const inlineSend = fontScale > 1.3;
  const formRef = useRef<ScrollView>(null);
  const questionRef = useRef<TextInput>(null);
  const keepQuestionVisible = useCallback(() => {
    if (!inlineSend || Platform.OS === "web") return;
    // Placeholder wrapping and typing can resize a large editor. Measure after layout settles.
    requestAnimationFrame(() => {
      const input = questionRef.current;
      const node = input === null ? null : findNodeHandle(input);
      if (input?.isFocused() && node !== null) {
        formRef.current?.scrollResponderScrollNativeHandleToKeyboard(node, space.l, true);
      }
    });
  }, [inlineSend]);
  const { t, i18n } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const { today, familyId, live, photos: photosOn, organiser, pushSent } = view;
  const push = usePush();
  // push (A2): after a person's first ask, someone who does not organise is offered notifications
  // once, in the words of what they would hear: that she answered. Organisers are asked when they
  // set the family up, and on You.
  const [offering, setOffering] = useState(false);
  const offerAfterAsk = async (): Promise<boolean> => {
    const phone = push.phone;
    if (organiser || !pushSent || !push.availability.available) return false;
    if (phone === null || phone.permission === "granted" || !phone.canAskAgain) return false;
    if (await readFlag(OFFERED_AFTER_ASK)) return false;
    await writeFlag(OFFERED_AFTER_ASK);
    return true;
  };
  // `text` comes from a reminder's "Ask" (spec §12): the question it suggests, for the asker to edit.
  const [kind, setKind] = useState<AskType>(
    params.kind !== undefined && OPENING_KINDS.includes(params.kind)
      ? (params.kind as AskType)
      : "question",
  );
  const [showIdeas, setShowIdeas] = useState(false);
  const [date, setDate] = useState(params.date ?? "");
  const schedule = usePlannedQuestions(familyId);
  const editing = editablePlannedQuestion(
    schedule.data?.questions ?? [],
    params.edit,
    recipient?.memberId,
  );
  const [editLoaded, setEditLoaded] = useState(false);
  const { text, setText } = draft;
  const [when, setWhen] = useState<When>(
    recipient?.invited === true
      ? "whenever"
      : params.date !== undefined && params.date !== tomorrowIn(new Date(), recipient?.timeZone)
        ? "date"
        : "tomorrow",
  );
  useEffect(() => {
    if (!editing || editLoaded) return;
    setWhen(editing.date === null ? "whenever" : "date");
    setDate(editing.date ?? "");
    setEditLoaded(true);
  }, [editing, editLoaded]);
  const tomorrowDate = tomorrowIn(new Date(), recipient?.timeZone);
  const occupiedDates = new Set(
    (schedule.data?.questions ?? [])
      .filter(
        (question) => question.recipient_id === recipient?.memberId && question.id !== params.edit,
      )
      .flatMap((question) => (question.date === null ? [] : [question.date])),
  );
  const occupiedMarks = new Map(Array.from(occupiedDates, (value) => [value, "taken" as const]));
  const firstFreeDate = questionDates(tomorrowDate).find((value) => !occupiedDates.has(value));
  useEffect(() => {
    if (
      params.edit ||
      recipient?.invited === true ||
      when !== "tomorrow" ||
      firstFreeDate === tomorrowDate
    )
      return;
    if (firstFreeDate) {
      setDate(firstFreeDate);
      setWhen("date");
    }
  }, [params.edit, recipient, when, firstFreeDate, tomorrowDate]);
  const [taken, setTaken] = useState<ApiAskConflict | null>(null);
  // A vote's options and a photo ask's photos (ADR-33), and what they add to the ask when sent.
  const [options, setOptions] = useState<VoteOption[]>(freshVoteOptions);
  const photos = useAskPhotos({
    kind,
    familyId,
    demo: demoDataAllowed(apiConfigured(), accountsConfigured()),
    on: photosOn,
    known: live,
    text,
    setText,
  });
  const optionWords = options.map((option) => option.text);
  const extras = askExtras(kind, photos.slots, optionWords);
  // A photo ask names its morning (B1): "Next free morning" is not offered, and moves to the next one there is.
  // With none free in her two weeks there is no morning to move to, and the button says so below.
  useEffect(() => {
    if (photos.count === 0 || when !== "whenever") return;
    if (taken === null) setWhen("tomorrow");
    else if (taken.date_alternative !== null) setWhen("another_day");
  }, [photos.count, when, taken]);
  const noMorning = photos.count > 0 && taken !== null && taken.date_alternative === null;
  const [used, setUsed] = useState<{ id: string; recipientId: string } | undefined>(); // suggestion

  // Vela's suggestion for her own morning, and never another's (a claimed morning has none).
  const suggestion = (demo || live ? today.tomorrow : []).find(
    (turn) => turn.recipientId === recipient?.memberId && turn.asked === undefined,
  )?.suggestion;
  // suggestion: a used one goes with the ask only while its person is the one being asked.
  const usedSuggestionId =
    used !== undefined && used.recipientId === recipient?.memberId ? used.id : undefined;
  // "Use this": the suggestion's words and its kind, remembered with whose morning it was for.
  const fill = useCallback(
    (chosen: TomorrowSuggestion, recipientId: string) => {
      setText(chosen.text);
      setKind("question");
      setUsed({ id: chosen.id, recipientId });
    },
    [setText],
  );
  // Ideas to start from: Vela's suggestion from her own words first, then the bank's family wording
  // in the topics chosen for her at setup (a broad, warm set when none were), a few at a time;
  // "More ideas" turns the page.
  const bankLang = i18n.locale === "zh-TW" ? "zh-TW" : "en";
  const herInterests = recipient?.interests;
  const bank = useMemo(() => questionsFor(herInterests ?? [], 60), [herInterests]);
  const [ideaPage, setIdeaPage] = useState(0);
  const IDEAS_A_PAGE = 3;
  const pageCount = Math.max(1, Math.ceil(bank.length / IDEAS_A_PAGE));
  const ideas: AskIdea[] = [
    ...(suggestion === undefined
      ? []
      : [
          {
            key: `suggestion:${suggestion.id}`,
            text: suggestion.text,
            fromHerWords: suggestion.fromHerWords,
          },
        ]),
    ...bank
      .slice(
        (ideaPage % pageCount) * IDEAS_A_PAGE,
        (ideaPage % pageCount) * IDEAS_A_PAGE + IDEAS_A_PAGE,
      )
      .map((item) => ({ key: item.id, text: item.child[bankLang] })),
  ];

  // Today's card sends its suggestion along. The live day can arrive after the screen opens, so it
  // fills the field once, when it is there, and never over words already typed.
  const offered = useRef(false);
  const [pendingIdea, setPendingIdea] = useState(false);
  useEffect(() => {
    if (!draft.ready || offered.current || recipient === undefined || suggestion === undefined)
      return;
    if (suggestion.id !== params.suggestion) return;
    offered.current = true;
    if (text.trim().length === 0) fill(suggestion, recipient.memberId);
    else setPendingIdea(true);
  }, [draft.ready, recipient, suggestion, params.suggestion, text, fill]);
  const savedAsk = draft.savedBody<ComposeAsk>();
  const savedRecipient = lights.find((light) => light.memberId === savedAsk?.recipient_id);
  const savedElsewhere = savedAsk !== null && savedAsk.recipient_id !== recipient?.memberId;
  const savedName = savedRecipient?.displayName;
  const paused = recipient !== undefined && recipient.state === "paused";
  const invited = recipient !== undefined && recipient.invited === true;
  const ready =
    demo ||
    (live &&
      familyId !== undefined &&
      recipient !== undefined &&
      !paused &&
      (!invited || (when === "whenever" && photos.count === 0)));

  // The voice hello goes up when the ask is sent, under the recording's own key, so a retry of the
  // send uploads it again as the same recording and the ask names it (spec §4).
  const [recording, setRecording] = useState(false);
  const [hello, setHello] = useState<Recorded | null>(null);
  // It starts going up as soon as the recording stops, so Send does not wait for it. The upload is
  // keyed by the recording, so taking it again at Send, after a failure, is the same voice.
  const helloUpload = useRef<{ key: string; id: Promise<string> } | null>(null);
  const uploadHello = useCallback(
    (recorded: Recorded): Promise<string> => {
      const started = helloUpload.current;
      if (started?.key === recorded.key) return started.id;
      const id = account.token().then((token) => uploadVoice(familyId ?? "", recorded, token));
      helloUpload.current = { key: recorded.key, id };
      // A failure here is met again at Send, which uploads once more.
      id.catch(() => {
        if (helloUpload.current?.id === id) helloUpload.current = null;
      });
      return id;
    },
    [account, familyId],
  );
  useEffect(() => {
    if (hello !== null && !demo && familyId !== undefined) void uploadHello(hello).catch(() => {});
  }, [hello, demo, familyId, uploadHello]);
  // A recording names its morning, as a photo does: "Next free morning" goes when one is made.
  useEffect(() => {
    if (hello !== null && when === "whenever") setWhen("tomorrow");
  }, [hello, when]);
  // The morning now chosen, so the Questions calendar opens on it after saving.
  const chosenDate =
    when === "tomorrow"
      ? tomorrowDate
      : when === "date"
        ? date
        : when === "another_day"
          ? (taken?.date_alternative ?? undefined)
          : undefined;
  const compose = useMutation({
    mutationFn: async ({ ask, saved = false }: { ask: ComposeAsk; saved?: boolean }) => {
      const token = await account.token();
      const withHello =
        hello === null || saved ? ask : { ...ask, voice_hello_id: await uploadHello(hello) };
      if (params.edit !== undefined)
        return editQuestion(
          params.edit,
          await draft.keyFor({ id: params.edit, ...ask }),
          {
            text: ask.text,
            date:
              ask.when === "whenever"
                ? null
                : ask.when === "date"
                  ? (ask.date ?? null)
                  : tomorrowIn(new Date(), recipient?.timeZone),
          },
          token,
        );
      return composeAsk(familyId ?? "", await draft.keyFor(withHello), withHello, token);
    },
    onSuccess: async () => {
      await draft.clear();
      await queries.invalidateQueries({ queryKey: ["today"] });
      await queries.invalidateQueries({ queryKey: ["planned-questions"] });
      await queries.invalidateQueries({ queryKey: ["book", familyId] });
      if (params.edit === undefined && (await offerAfterAsk())) setOffering(true);
      else
        router.replace({
          pathname: "/questions",
          params: { recipient: recipient?.memberId, saved: "1", day: chosenDate },
        });
    },
    onError: (error: unknown) => {
      if (photos.refusedAsk(error)) return;
      const conflict = askConflict(error);
      if (conflict === null) return;
      setTaken(conflict);
      setWhen(conflict.date_alternative === null ? "whenever" : "another_day");
    },
  });

  function send() {
    if (demo) {
      const plannedDate =
        when === "whenever"
          ? null
          : when === "date"
            ? date
            : tomorrowIn(new Date(), recipient?.timeZone);
      queries.setQueryData<import("@vela/contracts").ApiPlannedQuestions>(
        ["planned-questions", familyId],
        (previous) => ({
          questions: params.edit
            ? (previous?.questions ?? []).map((question) =>
                question.id === params.edit
                  ? { ...question, text: text.trim(), date: plannedDate }
                  : question,
              )
            : [
                ...(previous?.questions ?? []),
                {
                  id: `demo-${Date.now()}`,
                  recipient_id: recipient?.memberId ?? "",
                  recipient_name: recipient?.displayName ?? "",
                  asker_name: "Mia",
                  editable: true,
                  preparing: false,
                  text: text.trim(),
                  date: plannedDate,
                },
              ],
        }),
      );
      void draft.clear();
      router.replace({
        pathname: "/questions",
        params: { recipient: recipient?.memberId, saved: "1", day: chosenDate },
      });
      return;
    }
    const type = composableType[kind];
    // Never a silent close: a screen that is not ready keeps the words and says why below.
    if (!ready || type === undefined || recipient === undefined || familyId === undefined) return;
    if (extras === undefined || noMorning) return;
    const alternative = taken?.date_alternative;
    const timing: Pick<ComposeAsk, "when" | "date"> =
      when === "date"
        ? { when: "date", date }
        : when === "another_day" && alternative !== null && alternative !== undefined
          ? { when: "date", date: alternative }
          : { when: when === "whenever" ? "whenever" : "tomorrow" };
    compose.mutate({
      ask: {
        recipient_id: recipient.memberId,
        type: hello !== null ? "voice_note" : type,
        text: text.trim().length > 0 ? text.trim() : t`Listen to my voice note.`,
        ...timing,
        ...(usedSuggestionId === undefined ? {} : { suggestion_id: usedSuggestionId }), // suggestion
        ...extras,
      },
    });
  }

  const name = recipient?.displayName ?? t({ comment: "stands in for her name", message: "her" });
  // A voice note is its recording (spec §4): it needs one, and its words may be left to the default.
  const voiceNote = kind === "voice_note";
  const written = text.trim().length > 0 || hello !== null;
  const trouble =
    compose.isError &&
    askConflict(compose.error) === null &&
    photoRefusal(compose.error) !== "missing";
  const waiting = !demo && !ready;
  const hold = waiting
    ? paused
      ? t`${name}'s light is paused just now, so nothing can be sent into her morning.`
      : invited
        ? t`${name} has not said yes yet. Once she does, her first morning is the next day.`
        : live
          ? t`Choose someone in your family, or return to Today. Your words are kept.`
          : t`Waiting for today to arrive. Your words are kept.`
    : null;
  const holder = taken?.taken_by;
  // Named, never "the day after": the next free morning can be several days out.
  const day = taken?.date_alternative == null ? null : dayName(taken.date_alternative);
  // "Tomorrow" with its weekday, in her zone, so nobody wonders which morning it is.
  const tomorrow = dayName(tomorrowIn(new Date(), recipient?.timeZone));
  const plannedDay = `${dayName(date)}, ${localDayMonth(date)}`;

  if (offering) {
    return (
      <>
        <Stack.Screen
          options={{
            ...SHEET,
            title: params.edit ? t`Edit question` : t`Ask ${name} something`,
            headerLeft: () => <CancelButton />,
          }}
        />
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: palette.bg }}
          contentContainerStyle={{
            paddingTop: space.xl,
            paddingBottom: insets.bottom + space.xxxl,
            paddingHorizontal: space.margin,
            gap: space.l,
          }}
        >
          <Words variant="title">
            <Trans>Into her morning.</Trans>
          </Words>
          <PushOffer
            reason={t`Hear it on this phone when ${name} answers.`}
            onAnswered={() => router.replace("/questions")}
          />
          <Pressable accessibilityRole="button" onPress={() => router.replace("/questions")}>
            <Words variant="button" tone="action">
              <Trans>Not now</Trans>
            </Words>
          </Pressable>
        </ScrollView>
      </>
    );
  }

  // A large fixed footer can leave no space for the editor when the keyboard opens.
  const sendControls = (
    <View
      style={{
        backgroundColor: palette.bg,
        borderTopWidth: 1,
        borderTopColor: palette.rule,
        paddingHorizontal: inlineSend ? 0 : space.margin,
        paddingTop: space.m,
        paddingBottom: insets.bottom + space.l,
        gap: space.s,
      }}
    >
      <Words variant="caption" tone="ink2">
        {`${name} · ${when === "tomorrow" ? t`Tomorrow morning, ${tomorrow}` : when === "date" ? `${dayName(date)}, ${localDayMonth(date)}` : when === "another_day" ? t`${day} morning` : t`Next free morning`}`}
      </Words>
      <PrimaryButton
        label={compose.isPending ? t`Saving…` : params.edit ? t`Save changes` : t`Save question`}
        onPress={send}
        disabled={
          compose.isPending ||
          (when === "tomorrow" && occupiedDates.has(tomorrowDate)) ||
          recording ||
          !written ||
          (params.edit !== undefined && (!editing || !editLoaded)) ||
          (when === "date" &&
            (!questionDates(tomorrowIn(new Date(), recipient?.timeZone)).includes(date) ||
              occupiedDates.has(date))) ||
          savedElsewhere ||
          !draft.ready ||
          extras === undefined ||
          noMorning ||
          (!demo &&
            (!ready || !written || (voiceNote && hello === null && params.edit === undefined)))
        }
      />
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          ...SHEET,
          title: params.edit ? t`Edit question` : t`Ask ${name} something`,
          headerLeft: () => <CancelButton />,
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          ref={formRef}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, backgroundColor: palette.bg }}
          contentContainerStyle={{
            paddingTop: space.xl,
            paddingBottom: space.xl,
            paddingHorizontal: space.margin,
            gap: space.l,
          }}
        >
          {lights.length > 1 && params.edit === undefined ? (
            <View style={{ gap: space.m }}>
              <Words variant="heading">
                <Trans>Who is this for?</Trans>
              </Words>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {lights.map((light) => (
                  <Chip
                    key={light.memberId}
                    label={light.displayName}
                    selected={recipient?.memberId === light.memberId}
                    disabled={
                      recording ||
                      params.edit !== undefined ||
                      compose.isPending ||
                      savedAsk !== null ||
                      !canAsk(light)
                    }
                    onPress={() =>
                      router.setParams({
                        recipient: light.memberId,
                        suggestion: undefined,
                        text: undefined,
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}

          {pendingIdea && suggestion && recipient ? (
            <View style={{ gap: space.s }}>
              <Words variant="caption" tone="ink2">
                <Trans>You have a draft. Keep writing, or replace it with the selected idea.</Trans>
              </Words>
              <SecondaryButton
                label={t`Use this idea instead`}
                disabled={compose.isPending || !draft.ready || savedElsewhere}
                onPress={() => {
                  fill(suggestion, recipient.memberId);
                  setPendingIdea(false);
                }}
              />
            </View>
          ) : null}
          <View style={{ gap: space.m }}>
            <Words variant="heading">{t`Your question for ${name}`}</Words>
            <TextField
              inputRef={questionRef}
              onContentSizeChange={keepQuestionVisible}
              value={text}
              onChangeText={setText}
              placeholder={t`Say it the way you would say it`}
              helper={t`Keep it short, like a message you would send yourself.`}
              multiline
              maxLength={1000}
              disabled={!draft.ready || compose.isPending || savedElsewhere}
            />
            {params.edit ? null : (
              <View>
                <VoiceRecorder
                  compact
                  label={t`Record a voice question (up to 1 minute)`}
                  maxMs={60_000}
                  onRecordingChange={setRecording}
                  sending={compose.isPending}
                  disabled={photos.count > 0 || compose.isPending || !draft.ready || savedElsewhere}
                  refusedText={t`Allow microphone access in Settings to record a question.`}
                  onRecorded={setHello}
                />
              </View>
            )}
          </View>
          <SecondaryButton
            icon="ask"
            label={showIdeas ? t`Hide ideas` : t`Help me find a question`}
            onPress={() => setShowIdeas((shown) => !shown)}
          />
          {showIdeas && kind === "question" && recipient !== undefined ? (
            <AskIdeas
              ideas={ideas}
              name={name}
              disabled={!draft.ready || compose.isPending || savedElsewhere}
              onMore={() => setIdeaPage((page) => page + 1)}
              onPick={(idea) => {
                setPendingIdea(false);
                if (
                  idea.fromHerWords !== undefined &&
                  suggestion !== undefined &&
                  idea.key === `suggestion:${suggestion.id}`
                )
                  fill(suggestion, recipient.memberId);
                else {
                  setText(idea.text);
                  setUsed(undefined);
                }
                questionRef.current?.focus();
              }}
            />
          ) : null}

          {showIdeas ? (
            <Words variant="caption" tone="ink2">
              <Trans>
                Try something from today, a shared memory, or a small thing you have always
                wondered. Make the words sound like you.
              </Trans>
            </Words>
          ) : null}

          {params.edit || photos.off ? null : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
              <Chip
                label={t`Add a photo`}
                selected={kind === "old_photo"}
                disabled={photos.off || compose.isPending || recording || hello !== null}
                onPress={() => setKind(kind === "old_photo" ? "question" : "old_photo")}
              />
            </View>
          )}
          <PhotoSlots photos={photos} />

          {kind === "vote" ? <VoteOptions options={options} onChange={setOptions} /> : null}

          <View style={{ gap: space.m }}>
            <Words variant="heading">
              <Trans>When should it arrive?</Trans>
            </Words>
            {taken === null ? null : (
              <Words variant="body" tone="ink2">
                <Trans>{holder} already has that morning.</Trans>
              </Words>
            )}
            {invited || noMorning ? null : (
              <SoftCard>
                <MorningCalendar
                  dates={questionDates(tomorrowDate)}
                  selected={chosenDate}
                  marks={occupiedMarks}
                  tomorrow={tomorrowDate}
                  disabled={compose.isPending}
                  onSelect={(value) => {
                    // Tomorrow keeps its own meaning, so its line says "tomorrow's morning message".
                    if (value === tomorrowDate && taken === null) setWhen("tomorrow");
                    else {
                      setDate(value);
                      setWhen("date");
                    }
                    setTaken(null);
                  }}
                />
              </SoftCard>
            )}
            {photos.count > 0 || hello !== null || params.edit ? null : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                <Chip
                  label={t`Next free morning`}
                  selected={when === "whenever"}
                  disabled={compose.isPending}
                  onPress={() => setWhen("whenever")}
                />
              </View>
            )}
            {/* What the chosen morning means, in one line, so no choice has to be guessed. */}
            {noMorning ? null : (
              <Words variant="caption" tone="ink2">
                {when === "tomorrow"
                  ? t`It reaches ${name} with tomorrow's morning message.`
                  : when === "date"
                    ? t`It reaches ${name} with the morning message on ${plannedDay}.`
                    : when === "another_day"
                      ? t`It reaches ${name} on ${day} morning, the first one nobody else has asked for.`
                      : invited
                        ? t`The first message waiting reaches ${name} the moment they say yes; the rest come with their mornings.`
                        : t`It waits its turn and reaches ${name} on the first morning nobody else has asked for.`}
              </Words>
            )}
            {noMorning ? (
              <Words variant="body" tone="ink2">
                <Trans>
                  No morning in the next two weeks is free for a photo ask. Send it as words, or try
                  again later.
                </Trans>
              </Words>
            ) : null}
          </View>

          {hold === null ? null : (
            <Words variant="body" tone="ink2">
              {hold}
            </Words>
          )}
          {draft.saveFailed ? (
            <Words variant="body" tone="ink2">
              <Trans>
                This iPhone could not keep a draft. Leave this screen open until your send succeeds.
              </Trans>
            </Words>
          ) : null}
          {trouble ? (
            <Words variant="body" tone="ink2">
              <Trans>
                Your changes could not be confirmed. Your words are still here. Reload the schedule
                if this question is already preparing for delivery, or retry the saved attempt.
              </Trans>
            </Words>
          ) : null}
          {savedAsk === null || savedRecipient === undefined || !canAsk(savedRecipient) ? null : (
            <SecondaryButton
              label={
                savedElsewhere ? t`Continue your saved ask to ${savedName}` : t`Retry saved ask`
              }
              disabled={compose.isPending || !draft.ready}
              onPress={() => {
                if (savedElsewhere)
                  router.setParams({
                    recipient: savedAsk.recipient_id,
                    suggestion: undefined,
                    text: undefined,
                  });
                else if (ready) compose.mutate({ ask: savedAsk, saved: true });
              }}
            />
          )}
          {inlineSend ? sendControls : null}
        </ScrollView>
        {inlineSend ? null : sendControls}
      </KeyboardAvoidingView>
    </>
  );
}
