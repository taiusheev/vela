import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ApiPersonalQuestionDraft,
  ApiQuestionProfile,
  DraftPersonalQuestion,
  QuestionProfileSettings as ProfileSettings,
  QuestionPersonalization,
} from "@vela/contracts";
import { QUESTION_PROFILE_NOTICE_VERSION, QuestionProfileSettings } from "@vela/contracts";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  apiConfigured,
  askConflict,
  composeAsk,
  draftPersonalQuestion,
  questionProfileChanged,
} from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { MorningCalendar, type MorningMark } from "../src/components/morning-calendar.tsx";
import { ParentChooser } from "../src/components/parent-chooser.tsx";
import {
  QuestionDisclosure,
  QuestionPage,
  QuestionPaper,
  QuestionProgress,
} from "../src/components/questions/flow.tsx";
import { Chip, PrimaryButton, SecondaryButton, TextField, Words } from "../src/components/ui.tsx";
import { finishQuestionSave } from "../src/data/finish-question-save.ts";
import { demoDataAllowed, sessionScope } from "../src/data/live-state.ts";
import {
  currentQuestionProfile,
  profileLines,
  profileSettingsOf,
} from "../src/data/question-profile.ts";
import { questionDates } from "../src/data/question-schedule.ts";
import { selectedLight } from "../src/data/selected-light.ts";
import { tomorrowIn } from "../src/data/story.ts";
import type { TodayLight } from "../src/data/today.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { usePlannedQuestions } from "../src/data/usePlannedQuestions.ts";
import { useQuestionProfile } from "../src/data/useQuestionProfile.ts";
import { useToday } from "../src/data/useToday.ts";
import { space } from "../src/theme/tokens.ts";

const UNKNOWN_CHOICE = "unsure";

/** Unsaved notes are component state; saved notes are private to the signed-in child and parent. */
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
  const profileAccess = !demo && caps.capabilities?.personal_question_profiles === true && day.live;
  const demoProfiles = useRef(new Map<string, ApiQuestionProfile>());
  const chooser = (
    <ParentChooser
      lights={lights}
      selected={parent?.memberId}
      onSelect={(recipient) => router.setParams({ recipient })}
    />
  );
  if ((!available && !profileAccess) || parent === undefined)
    return (
      <QuestionPage
        title={t`Back to questions`}
        onBack={() =>
          router.replace({ pathname: "/questions", params: { recipient: parent?.memberId } })
        }
      >
        {chooser}
        <Words tone="ink2">
          <Trans>Personal drafts are not available here yet.</Trans>
        </Words>
      </QuestionPage>
    );
  return (
    <PersonalSetup
      key={`${sessionScope(account)}:${day.familyId}:${parent.memberId}`}
      familyId={day.familyId}
      parent={parent}
      demo={demo}
      drafting={available}
      profileAccess={profileAccess}
      demoProfiles={demoProfiles.current}
      chooser={chooser}
    />
  );
}

type ProfileControls = {
  save(settings: ProfileSettings, revision: string | null): Promise<ApiQuestionProfile>;
  forget(): Promise<ApiQuestionProfile>;
  reload(): Promise<ApiQuestionProfile>;
  clearLocal(): void;
};
function PersonalSetup({
  familyId,
  parent,
  demo,
  drafting,
  profileAccess,
  demoProfiles,
  chooser,
}: {
  familyId: string | undefined;
  parent: TodayLight;
  demo: boolean;
  drafting: boolean;
  profileAccess: boolean;
  demoProfiles: Map<string, ApiQuestionProfile>;
  chooser: ReactNode;
}) {
  const { t } = useLingui();
  const profile = useQuestionProfile(familyId, parent.memberId, profileAccess);
  const empty: ApiQuestionProfile = { revision: null, profile: null, saving_available: demo };
  const demoView = () => demoProfiles.get(parent.memberId) ?? empty;
  const demoControls: ProfileControls = {
    reload: async () => demoView(),
    clearLocal: () => {
      demoProfiles.delete(parent.memberId);
    },
    save: async (settings) => {
      const view: ApiQuestionProfile = {
        revision: randomUUID(),
        saving_available: true,
        profile: {
          settings,
          saved_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          notice_version: QUESTION_PROFILE_NOTICE_VERSION,
        },
      };
      demoProfiles.set(parent.memberId, view);
      return view;
    },
    forget: async () => {
      const view = { ...empty, revision: randomUUID() };
      demoProfiles.set(parent.memberId, view);
      return view;
    },
  };
  if (profileAccess && !profile.data)
    return (
      <QuestionPage
        title={t`Back to questions`}
        onBack={() =>
          router.replace({ pathname: "/questions", params: { recipient: parent?.memberId } })
        }
      >
        {chooser}
        <Words tone="ink2">
          {profile.isError
            ? t`Your saved choices could not be loaded. Reload before continuing.`
            : t`Loading your private choices…`}
        </Words>
        {profile.isError ? (
          <SecondaryButton
            label={t`Reload saved choices`}
            onPress={() => void profile.reload().catch(() => {})}
          />
        ) : null}
      </QuestionPage>
    );
  return (
    <PersonalDraft
      familyId={familyId}
      parent={parent}
      demo={demo}
      drafting={drafting}
      chooser={chooser}
      initialProfile={demo ? demoView() : (profile.data ?? empty)}
      profiles={demo ? demoControls : profileAccess ? profile : undefined}
    />
  );
}

function PersonalDraft({
  familyId,
  parent,
  demo,
  drafting,
  initialProfile,
  profiles,
  chooser,
}: {
  familyId: string | undefined;
  parent: TodayLight;
  demo: boolean;
  drafting: boolean;
  initialProfile: ApiQuestionProfile;
  profiles: ProfileControls | undefined;
  chooser: ReactNode;
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
  const profileEpoch = useRef(0);
  const [profileView, setProfileView] = useState(initialProfile);
  const initialSettings = currentQuestionProfile(initialProfile)?.settings;
  const [profileBasis, setProfileBasis] = useState(
    initialSettings ? initialProfile.revision : null,
  );
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [secondExample, setSecondExample] = useState(Boolean(initialSettings?.writing_examples[1]));
  const [profileDetails, setProfileDetails] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<unknown>(null);
  const [profileNotice, setProfileNotice] = useState<"saved" | "forgotten" | "expired" | null>(
    null,
  );
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [connection, setConnection] = useState<QuestionPersonalization["connection"]>(
    initialSettings?.context.connection ?? UNKNOWN_CHOICE,
  );
  const [contact, setContact] = useState<QuestionPersonalization["talking_rhythm"]>(
    initialSettings?.context.talking_rhythm ?? UNKNOWN_CHOICE,
  );
  const [address, setAddress] = useState(initialSettings?.address_form ?? parent.displayName);
  const [intent, setIntent] = useState("");
  const [example1, setExample1] = useState(initialSettings?.writing_examples[0] ?? "");
  const [example2, setExample2] = useState(initialSettings?.writing_examples[1] ?? "");
  const [avoid, setAvoid] = useState(initialSettings?.context.avoid_topics.join("\n") ?? "");
  const [never, setNever] = useState(initialSettings?.context.never_say.join("\n") ?? "");
  const [language, setLanguage] = useState<"en" | "zh-TW">(
    initialSettings?.language ?? (i18n.locale === "zh-TW" ? "zh-TW" : "en"),
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
    ...(profileBasis ? { profile_revision: profileBasis } : {}),
    language,
    address_form: address.trim(),
    context: {
      intent: intent.trim(),
      connection,
      talking_rhythm: contact,
      avoid_topics: profileLines(avoid),
      never_say: profileLines(never),
    },
    writing_examples: [example1.trim(), example2.trim()].filter(Boolean),
  };
  const generate = useMutation({
    gcTime: 0,
    onMutate: () => ({ epoch: profileEpoch.current }),
    mutationFn: async () => {
      if (connection === "quiet") return { state: "not_drafted", reason: "quiet" } as const;
      if (demo) {
        const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
        if (
          [...profileLines(avoid), ...profileLines(never)]
            .filter(Boolean)
            .some((term) => normalize(intent).includes(normalize(term)))
        )
          return { state: "not_drafted", reason: "boundary" } as const;
        // Explicit preview of the person's supplied words; no pretend model or family facts.
        const ownWords = intent.trim().replace(/[?？]+$/u, "");
        return {
          state: "review",
          ...(profileBasis ? { profile_revision: profileBasis } : {}),
          language,
          text: language === "zh-TW" ? `${address}，${ownWords}？` : `${address}, ${ownWords}?`,
        } as const;
      }
      return draftPersonalQuestion(familyId ?? "", draftKey(input), input, await account.token());
    },
    onSuccess: (next, _variables, context) => {
      if (!mounted.current || context?.epoch !== profileEpoch.current) return;
      setExampleFinished(false);
      setResult(next);
      setWords(next.state === "review" ? next.text : "");
      setConfirmed(false);
      setStep(2);
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
        ...(result.profile_revision ? { personal_profile_revision: result.profile_revision } : {}),
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
  const settings = QuestionProfileSettings.safeParse(profileSettingsOf(input));
  const hydrate = useCallback(
    (view: ApiQuestionProfile) => {
      if (!mounted.current) return;
      profileEpoch.current += 1;
      const saved = currentQuestionProfile(view)?.settings;
      setProfileView(view);
      setProfileBasis(saved ? view.revision : null);
      setAddress(saved?.address_form ?? parent.displayName);
      setConnection(saved?.context.connection ?? UNKNOWN_CHOICE);
      setContact(saved?.context.talking_rhythm ?? UNKNOWN_CHOICE);
      setExample1(saved?.writing_examples[0] ?? "");
      setExample2(saved?.writing_examples[1] ?? "");
      setAvoid(saved?.context.avoid_topics.join("\n") ?? "");
      setNever(saved?.context.never_say.join("\n") ?? "");
      setLanguage(saved?.language ?? (i18n.locale === "zh-TW" ? "zh-TW" : "en"));
      setResult(null);
      setWords("");
      setConfirmed(false);
      setStep(1);
      generate.reset();
      save.reset();
    },
    [parent.displayName, i18n.locale, generate.reset, save.reset],
  );
  async function changeProfile(action: "save" | "forget" | "reload") {
    if (!profiles || profileBusy) return;
    setProfileBusy(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const view =
        action === "save" && settings.success
          ? await profiles.save(settings.data, profileView.revision)
          : action === "forget"
            ? await profiles.forget()
            : await profiles.reload();
      hydrate(view);
      if (mounted.current)
        setProfileNotice(action === "reload" ? null : action === "save" ? "saved" : "forgotten");
    } catch (error) {
      if (mounted.current) setProfileError(error);
    } finally {
      if (mounted.current) setProfileBusy(false);
    }
  }
  useEffect(() => {
    const expires = profileView.profile?.expires_at;
    if (!expires) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = Date.parse(expires) - Date.now();
      if (remaining > 0) {
        timer = setTimeout(check, Math.min(remaining, 86400000));
        return;
      }
      profiles?.clearLocal();
      hydrate({ ...profileView, profile: null });
      setProfileNotice("expired");
    };
    check();
    return () => clearTimeout(timer);
    // The deadline is fixed; re-arming after an edit never extends it.
  }, [profileView, hydrate, profiles?.clearLocal]);
  const expiresOn = profileView.profile
    ? new Date(profileView.profile.expires_at).toLocaleDateString(i18n.locale)
    : "";
  const name = parent.displayName;
  const blockedParent = parent.invited || parent.state === "resting";
  const busy = generate.isPending || save.isPending || profileBusy;
  const changed =
    questionProfileChanged(generate.error) ||
    questionProfileChanged(save.error) ||
    questionProfileChanged(profileError);
  return (
    <QuestionPage
      title={t`Back to questions`}
      onBack={() =>
        router.replace({ pathname: "/questions", params: { recipient: parent?.memberId } })
      }
      resetKey={`${step}:${profileView.revision}:${profileNotice}:${profileError !== null}`}
    >
      {chooser}
      {profileNotice ? (
        <View accessibilityLiveRegion="polite">
          <Words tone="action">
            {profileNotice === "saved"
              ? t`Your choices are saved.`
              : profileNotice === "forgotten"
                ? t`Your saved choices were forgotten.`
                : t`Your saved choices expired. Start fresh or reload.`}
          </Words>
        </View>
      ) : null}
      {profileError ? (
        <Words tone="error">
          {changed
            ? t`Your saved choices changed elsewhere. Reload before continuing.`
            : t`The change was not confirmed. Reload your saved choices before trying again.`}
        </Words>
      ) : null}
      {changed && profiles ? (
        <SecondaryButton
          label={t`Reload saved choices`}
          disabled={busy}
          onPress={() => void changeProfile("reload")}
        />
      ) : null}
      {step === 1 || result?.state === "review" ? <QuestionProgress step={step} /> : null}
      {step === 1 ? (
        <>
          <View style={{ gap: space.s }}>
            <Words
              variant="title"
              accessibilityRole="header"
            >{t`What would you like to ask ${name}?`}</Words>
            <Words tone="ink2">
              <Trans>One ordinary thing you would love to hear about.</Trans>
            </Words>
          </View>
          <TextField
            label={t`Your starting point`}
            value={intent}
            onChangeText={setIntent}
            placeholder={t`Something from their day, or a little thing on your mind…`}
            multiline
            editorial
            maxLength={120}
            disabled={busy}
          />
          <QuestionDisclosure
            title={t`Make it sound like you`}
            detail={
              connection === "quiet"
                ? t`Some space for now`
                : profileBasis
                  ? t`Your saved choices are loaded. Change them anytime.`
                  : t`Optional · your tone, usual wording, and topics to leave out`
            }
            expanded={preferencesOpen}
            disabled={profileBusy || save.isPending}
            onPress={() => setPreferencesOpen(!preferencesOpen)}
          />
          {preferencesOpen ? (
            <View style={{ gap: space.l }}>
              <TextField
                label={t`What do you call ${name}?`}
                value={address}
                onChangeText={setAddress}
                maxLength={40}
                disabled={busy}
              />
              <Words variant="bodyMedium">
                <Trans>What feels comfortable between you?</Trans>
              </Words>
              <Options<QuestionPersonalization["connection"]>
                value={connection}
                onChange={setConnection}
                disabled={busy}
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
                disabled={busy}
                options={[
                  ["often", t`Often`],
                  ["sometimes", t`Sometimes`],
                  ["rarely", t`Rarely`],
                  ["unsure", t`Not sure yet`],
                ]}
              />
              <TextField
                label={t`A message you would write to ${name} (optional)`}
                value={example1}
                onChangeText={setExample1}
                maxLength={180}
                multiline
                disabled={busy}
                helper={t`Use only your own words to this person. Leave out private details and other people's messages.`}
              />
              {secondExample || example2 ? (
                <TextField
                  label={t`Another example (optional)`}
                  value={example2}
                  onChangeText={setExample2}
                  maxLength={180}
                  multiline
                  disabled={busy}
                />
              ) : (
                <SecondaryButton
                  label={t`Add another example`}
                  disabled={busy}
                  onPress={() => setSecondExample(true)}
                />
              )}
              <TextField
                label={t`A topic to leave out (optional)`}
                value={avoid}
                onChangeText={setAvoid}
                maxLength={204}
                multiline
                disabled={busy}
                helper={t`One topic per line, up to 5 topics of 40 characters each.`}
              />
              <TextField
                label={t`Words you would never use (optional)`}
                value={never}
                onChangeText={setNever}
                maxLength={182}
                multiline
                disabled={busy}
                helper={t`One phrase per line, up to 3 phrases of 60 characters each.`}
              />
              <Words variant="bodyMedium">
                <Trans>Language of this question</Trans>
              </Words>
              <Options<"en" | "zh-TW">
                value={language}
                onChange={setLanguage}
                disabled={busy}
                options={[
                  ["en", "English"],
                  ["zh-TW", "繁體中文"],
                ]}
              />
              <Words variant="caption" tone="ink2">
                <Trans>
                  These choices shape this draft only. They do not change automatic questions or
                  morning check-ins.
                </Trans>
              </Words>
              {profiles ? (
                <>
                  <Words variant="caption" tone="ink2">
                    <Trans>
                      Only you can see this setup for this parent. Saving keeps your wording
                      examples, comfort level, usual contact, and boundaries for 30 days. The
                      question you want to ask is not saved here.
                    </Trans>
                  </Words>
                  {profileView.profile ? (
                    <Words
                      variant="caption"
                      tone="ink2"
                    >{t`Saved until ${expiresOn}. Opening or using it does not extend this date.`}</Words>
                  ) : null}
                  {profileView.saving_available ? (
                    <SecondaryButton
                      label={profileBusy ? t`Saving choices…` : t`Save these choices for 30 days`}
                      disabled={busy || !settings.success || blockedParent}
                      onPress={() => void changeProfile("save")}
                    />
                  ) : (
                    <Words variant="caption" tone="ink2">
                      <Trans>
                        Saving new choices is off. You can still view or forget your saved choices.
                      </Trans>
                    </Words>
                  )}
                  <QuestionDisclosure
                    title={t`Manage saved choices`}
                    expanded={profileDetails}
                    icon="privacy"
                    disabled={profileBusy || save.isPending}
                    onPress={() => setProfileDetails(!profileDetails)}
                  />
                  {profileDetails ? (
                    <>
                      <Words variant="caption" tone="ink2">
                        <Trans>
                          Forgetting clears these choices. Questions you already approved stay in
                          your schedule.
                        </Trans>
                      </Words>
                      <SecondaryButton
                        label={t`Reload saved choices`}
                        disabled={busy}
                        onPress={() => void changeProfile("reload")}
                      />
                      {profileView.profile || profileBasis ? (
                        <SecondaryButton
                          label={t`Forget saved choices`}
                          disabled={profileBusy || save.isPending}
                          onPress={() => void changeProfile("forget")}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : (
                <Words variant="caption" tone="ink2">
                  <Trans>
                    Vela uses these notes to prepare a draft. They are kept for later only if you
                    choose to save them.
                  </Trans>
                </Words>
              )}
            </View>
          ) : null}
          {connection === "quiet" ? (
            <Words tone="ink2">
              <Trans>
                No question is needed right now. Your existing morning settings stay as they are.
              </Trans>
            </Words>
          ) : null}
          {generate.isError ? (
            <Words tone="error">
              {changed
                ? t`Your saved choices changed or expired. Reload before preparing another draft.`
                : t`The draft could not be prepared. Your words are still here.`}
            </Words>
          ) : null}
          {!settings.success ? (
            <Words tone="error">
              <Trans>Check the length and number of topics or phrases before continuing.</Trans>
            </Words>
          ) : null}
          <PrimaryButton
            label={
              generate.isPending
                ? t`Preparing your draft…`
                : connection === "quiet"
                  ? t`Leave room for now`
                  : t`Prepare a draft`
            }
            disabled={
              busy ||
              !drafting ||
              !settings.success ||
              (connection !== "quiet" && !intent.trim()) ||
              (blockedParent && connection !== "quiet")
            }
            onPress={() => generate.mutate()}
          />
          {blockedParent && connection !== "quiet" ? (
            <Words tone="ink2">
              <Trans>Drafting can begin once this person has agreed and their light is on.</Trans>
            </Words>
          ) : null}
          <Words variant="caption" tone="ink2">
            <Trans>You review every word before choosing a morning.</Trans>
          </Words>
        </>
      ) : result?.state === "review" ? (
        step === 2 ? (
          <>
            <View style={{ gap: space.s }}>
              <Words variant="title" accessibilityRole="header">
                <Trans>Make it yours.</Trans>
              </Words>
              <Words tone="ink2">
                <Trans>Check the facts, tone, and topic. Vela can get these wrong.</Trans>
              </Words>
            </View>
            <QuestionPaper>
              <TextField
                label={t`Your question`}
                value={words}
                onChangeText={(next) => {
                  setWords(next);
                  setConfirmed(false);
                }}
                editorial
                multiline
                maxLength={200}
                minHeight={128}
                disabled={busy}
              />
            </QuestionPaper>
            <Chip
              label={t`These words feel like me, and I want to ask this.`}
              selected={confirmed}
              disabled={busy}
              onPress={() => setConfirmed(!confirmed)}
            />
            <PrimaryButton
              label={t`Next: choose a morning`}
              disabled={!confirmed || !words.trim() || busy}
              onPress={() => setStep(3)}
            />
            <SecondaryButton
              label={t`Change starting points`}
              disabled={busy}
              onPress={() => {
                setResult(null);
                setStep(1);
              }}
            />
          </>
        ) : (
          <>
            <View style={{ gap: space.s }}>
              <Words variant="title" accessibilityRole="header">
                <Trans>Choose a morning.</Trans>
              </Words>
              <Words tone="ink2">
                <Trans>Your question will arrive with their morning message.</Trans>
              </Words>
            </View>
            <QuestionPaper>
              <Words variant="preview">{words}</Words>
            </QuestionPaper>
            <MorningCalendar
              dates={dates}
              selected={date}
              marks={marks}
              tomorrow={tomorrow}
              disabled={busy || (!demo && schedule.data === undefined)}
              onSelect={setDate}
            />
            {schedule.isError ? (
              <SecondaryButton label={t`Reload schedule`} onPress={() => void schedule.refetch()} />
            ) : null}
            {save.isError ? (
              <Words tone="error">
                {changed
                  ? t`Your saved choices changed or expired. Reload before saving this question.`
                  : askConflict(save.error) !== null
                    ? t`That morning already has a question. Choose another morning.`
                    : t`Saving was not confirmed. Keep this screen open and try again.`}
              </Words>
            ) : null}
            <PrimaryButton
              label={save.isPending ? t`Saving…` : demo ? t`Finish example` : t`Save this question`}
              disabled={!confirmed || !date || !words.trim() || busy}
              onPress={() => save.mutate()}
            />
            <SecondaryButton
              label={t`Edit your question`}
              disabled={busy}
              onPress={() => setStep(2)}
            />
          </>
        )
      ) : (
        <>
          <Words variant="title" accessibilityRole="header">
            {exampleFinished ? t`A little conversation, ready to begin.` : t`Leave a little room.`}
          </Words>
          <Words tone="ink2">
            {exampleFinished
              ? t`Example complete. Nothing was saved or sent.`
              : result?.state === "not_drafted" && result.reason === "quiet"
                ? t`No question is needed right now. Your existing morning settings stay as they are.`
                : t`No draft was kept. Try a different topic or write your own question.`}
          </Words>
          <PrimaryButton
            label={t`Change starting points`}
            disabled={busy}
            onPress={() => setStep(1)}
          />
        </>
      )}
      {!drafting ? (
        <Words tone="ink2">
          <Trans>Drafting is off here. Your saved choices are still yours to view or forget.</Trans>
        </Words>
      ) : null}
      {demo ? (
        <Words variant="caption" tone="ink2">
          <Trans>Example only. No AI or messages. Saved choices stay in this open example.</Trans>
        </Words>
      ) : null}
    </QuestionPage>
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
