import type {
  AvoidTopic,
  InterestTopic,
  KeptLightRelationship,
  ReplyWay,
  TalkRhythm,
} from "@vela/contracts";
import { useSyncExternalStore } from "react";

/**
 * Onboarding v2, "One road" (founder, 5 November 2026), one screen at a time: her window lighting up,
 * seven screens of questions in three chapters, her first week, then saving (privacy and email on one
 * screen), the invitation and the ready window. Nothing can be skipped; where the honest answer is
 * "none" ("no one nearby yet", "nothing to avoid", "not sure yet"), that answer is what is kept.
 * "How do you and Mom talk?" (`talk`) is asked only where the server keeps it (`talk_setup`).
 */
export const STORY_STEPS = ["welcome"] as const;
export const QUESTION_STEPS = [
  "who",
  "mornings",
  "messenger",
  "world",
  "talk",
  "first",
  "around",
] as const;
export const AFTER_STEPS = ["build", "plan", "save", "invite", "ready"] as const;
export type StoryStep = (typeof STORY_STEPS)[number];
export type QuestionStep = (typeof QUESTION_STEPS)[number];
export type OnboardingStep = StoryStep | QuestionStep | (typeof AFTER_STEPS)[number];

/** The three chapters of questions; her first week is the fourth pane. */
export const CHAPTERS: readonly (readonly QuestionStep[])[] = [
  ["who", "mornings", "messenger"],
  ["world", "talk", "first"],
  ["around"],
];

export type Messenger = "telegram" | "line" | "phone";

export interface NearbyPerson {
  name: string;
  relation: string;
}

/** What creating her family gave back, kept so a retry or a remount carries on from it. */
export interface CreatedFamily {
  familyId: string;
  memberId: string;
  arrival: string;
  invite: { text: string; lineText: string | null; lineUrl: string | null };
}

export interface OnboardingDraft {
  privacyAccepted: boolean;
  step: OnboardingStep;
  /** One random run per draft: every write's idempotency key starts with it, so a retry repeats. */
  run: string;
  relationship: KeptLightRelationship;
  callName: string;
  you: string;
  country: string;
  zone: string;
  language: "en" | "zh-TW";
  /** Once the organiser picks her language, changing her country no longer changes it. */
  languageChosen: boolean;
  wake: string;
  messenger: Messenger | null;
  interests: InterestTopic[];
  replyWays: ReplyWay[];
  unsure: boolean;
  /** "How do you and Mom talk?": how often, and what Vela should never bring up. */
  talkRhythm: TalkRhythm | null;
  avoidTopics: AvoidTopic[];
  avoidWords: string[];
  nothingToAvoid: boolean;
  firstPick: string | null;
  own: string;
  nobody: "me" | "vela" | null;
  people: NearbyPerson[];
  noneNearby: boolean;
  /** A picked portrait waits here (a file in the cache, or a data URL on the web) until saved. */
  photo: { kind: "picked"; source: string } | { kind: "initials" } | null;
  /** The seven mornings the organiser saw and saved, first question first. */
  week: string[];
  created: CreatedFamily | null;
  /** How far saving got: the asks and nearby people sent so far, and the extras done. */
  saved: { asks: number; nearby: number; sendAsMe: boolean; portrait: boolean };
}

function freshRun(): string {
  return Math.random().toString(36).slice(2, 12);
}

export function initialDraft(): OnboardingDraft {
  return {
    privacyAccepted: false,
    step: "welcome",
    run: freshRun(),
    relationship: "mother",
    callName: "",
    you: "",
    country: "TW",
    zone: "Asia/Taipei",
    language: "zh-TW",
    languageChosen: false,
    wake: "07:30",
    messenger: null,
    interests: [],
    replyWays: [],
    unsure: false,
    talkRhythm: null,
    avoidTopics: [],
    avoidWords: [],
    nothingToAvoid: false,
    firstPick: null,
    own: "",
    nobody: null,
    people: [],
    noneNearby: false,
    photo: null,
    week: [],
    created: null,
    saved: { asks: 0, nearby: 0, sendAsMe: false, portrait: false },
  };
}

/**
 * The draft lives outside React, in memory only, so it outlasts the remount that signing in causes
 * (each session gets its own query tree) and is gone when the app is closed. It never reaches a
 * server until it is saved, and holds only what the organiser typed and chose.
 */
let draft: OnboardingDraft = initialDraft();
const listeners = new Set<() => void>();
let photoCleanup: (source: string) => void = () => {};
let owner: string | null = null;
export function registerOnboardingPhotoCleanup(cleanup: (source: string) => void): void {
  photoCleanup = cleanup;
}
export function activateOnboardingSession(scope: string): void {
  if (owner !== null && owner !== scope) {
    const signingInToSave =
      owner === "guest" &&
      scope !== "guest" &&
      draft.step === "save" &&
      draft.privacyAccepted &&
      draft.created === null;
    if (!signingInToSave) resetDraft();
  }
  owner = scope;
}
export function updateDraftForRun(run: string, change: Partial<OnboardingDraft>): boolean {
  if (draft.run !== run) {
    if (change.photo?.kind === "picked") photoCleanup(change.photo.source);
    return false;
  }
  updateDraft(change);
  return true;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function readDraft(): OnboardingDraft {
  return draft;
}

export function updateDraft(change: Partial<OnboardingDraft>): void {
  if (
    change.photo !== undefined &&
    draft.photo?.kind === "picked" &&
    (change.photo === null ||
      change.photo.kind !== "picked" ||
      change.photo.source !== draft.photo.source)
  )
    photoCleanup(draft.photo.source);
  draft = { ...draft, ...change };
  emit();
}

/** Starts over: after the window is ready, or when the organiser begins again. */
export function resetDraft(): void {
  if (draft.photo?.kind === "picked") photoCleanup(draft.photo.source);
  draft = initialDraft();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnboardingDraft(): OnboardingDraft {
  return useSyncExternalStore(subscribe, readDraft, readDraft);
}

/** The steps in order, "How do you and Mom talk?" only where it is asked. */
function order(talk: boolean): readonly OnboardingStep[] {
  return [
    ...STORY_STEPS,
    ...QUESTION_STEPS.filter((step) => talk || step !== "talk"),
    "build",
    "plan",
  ];
}

/** The screen before this one, the welcome before the first question. */
export function previousStep(step: OnboardingStep, talk = true): OnboardingStep | null {
  const steps = order(talk);
  const at = steps.indexOf(step);
  return at <= 0 ? null : (steps[at - 1] ?? null);
}

/** The question after this one, or "build" after the last. */
export function nextQuestion(step: QuestionStep, talk = true): QuestionStep | "build" {
  const steps = order(talk);
  const next = steps[steps.indexOf(step) + 1];
  return next !== undefined && (QUESTION_STEPS as readonly string[]).includes(next)
    ? (next as QuestionStep)
    : "build";
}

/** The chapter a question is in (1 to 3) and its place in it, for the panes. */
export function chapterOf(step: QuestionStep): { chapter: number; index: number; size: number } {
  const chapter = CHAPTERS.findIndex((steps) => steps.includes(step));
  const steps = CHAPTERS[chapter] ?? [];
  return { chapter: chapter + 1, index: steps.indexOf(step), size: steps.length };
}

/** Each screen needs every answer on it before Continue, "none" counting where it is offered. */
export function answered(step: QuestionStep, at: OnboardingDraft): boolean {
  switch (step) {
    case "who":
      return at.callName.trim().length > 0 && at.you.trim().length > 0;
    case "mornings":
      return true;
    case "messenger":
      return at.messenger !== null;
    case "world":
      return at.interests.length > 0 && (at.replyWays.length > 0 || at.unsure);
    case "talk":
      return (
        at.talkRhythm !== null &&
        (at.avoidTopics.length > 0 || at.avoidWords.length > 0 || at.nothingToAvoid)
      );
    case "first":
      return (
        (at.own.trim().length > 0 ? at.own.trim() : (at.firstPick ?? "")).length > 0 &&
        at.nobody !== null
      );
    case "around":
      return (at.people.length > 0 || at.noneNearby) && at.photo !== null;
  }
}

/** The first question as it will be sent: their own words if they wrote some, else the pick. */
export function firstQuestion(at: OnboardingDraft): string {
  const own = at.own.trim();
  return own.length > 0 ? own : (at.firstPick ?? "");
}
