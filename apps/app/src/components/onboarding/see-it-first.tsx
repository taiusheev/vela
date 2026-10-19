import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiMe } from "@vela/contracts";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { apiConfigured } from "../../api/client.ts";
import { accountsConfigured, useAccount } from "../../auth/clerk.tsx";
import { relationships } from "../../data/onboarding.ts";
import {
  QUESTION_STEPS,
  type QuestionStep,
  resetDraft,
  STORY_STEPS,
  type StoryStep,
  updateDraft,
  useOnboardingDraft,
} from "../../data/onboarding-draft.ts";
import { AppPrivacy, acceptLocalPrivacy } from "../app-privacy.tsx";
import { Invite, Notify, Ready, Save } from "./finish.tsx";
import { Build, Plan } from "./plan.tsx";
import { nameFor, Questions } from "./questions.tsx";
import { Story } from "./story.tsx";

const isStory = (step: string): step is StoryStep =>
  (STORY_STEPS as readonly string[]).includes(step);
const isQuestion = (step: string): step is QuestionStep =>
  (QUESTION_STEPS as readonly string[]).includes(step);

/**
 * The See It First onboarding (founder, 19 October 2026; reports/Vela onboarding research.md):
 * twenty seconds of what Vela does, ten questions with nothing skipped, her first week built from
 * the answers, and only then an account, to save it. Where accounts exist and the organiser has
 * none yet, saving opens sign-in and carries on here once they are in.
 */
export function SeeItFirst() {
  const { t, i18n } = useLingui();
  const draft = useOnboardingDraft();
  const account = useAccount();
  const queries = useQueryClient();
  const alreadyAccepted =
    account.signedIn && queries.getQueryData<ApiMe>(["me"])?.privacy_accepted === true;
  const needsAccount = apiConfigured() && accountsConfigured() && !account.signedIn;
  const relationship = relationships.find((choice) => choice.value === draft.relationship);
  const name = nameFor(draft, relationship === undefined ? t`them` : i18n._(relationship.label));
  const step = draft.step;

  const screen =
    step === "save" && !draft.privacyAccepted ? (
      <AppPrivacy
        onAccept={() => {
          acceptLocalPrivacy();
          if (needsAccount) router.push("/sign-in");
        }}
        onDecline={() => resetDraft()}
      />
    ) : isStory(step) ? (
      <Story step={step} signedIn={!needsAccount} />
    ) : isQuestion(step) ? (
      <Questions draft={draft} step={step} />
    ) : step === "build" ? (
      <Build draft={draft} name={name} />
    ) : step === "plan" || (step === "save" && needsAccount) ? (
      <Plan
        draft={draft}
        name={name}
        onSave={() => {
          updateDraft({ step: "save", ...(alreadyAccepted ? { privacyAccepted: true } : {}) });
          if (draft.privacyAccepted && needsAccount) router.push("/sign-in");
        }}
      />
    ) : step === "save" ? (
      <Save name={name} />
    ) : step === "invite" ? (
      <Invite draft={draft} name={name} />
    ) : step === "notify" ? (
      <Notify name={name} />
    ) : (
      <Ready draft={draft} name={name} />
    );

  return (
    <>
      <StatusBar style="light" />
      {screen}
    </>
  );
}
