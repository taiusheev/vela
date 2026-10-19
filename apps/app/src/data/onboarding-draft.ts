import type { InterestTopic, KeptLightRelationship, ReplyWay } from "@vela/contracts";
import { useSyncExternalStore } from "react";

/**
 * The See It First onboarding (founder, 19 October 2026), one screen at a time: the story, ten
 * questions in three chapters, her first week, then saving, the invitation, notifications and the
 * lit window. Nothing can be skipped; where the honest answer is "none" ("no one nearby yet", "no
 * photo", "not sure yet"), that answer is what is kept.
 */
export const STORY_STEPS = ["night", "send", "answer", "quiet"] as const;
export const QUESTION_STEPS = [
  "who",
  "where",
  "wake",
  "messenger",
  "world",
  "replies",
  "first",
  "nobody",
  "nearby",
  "photo",
] as const;
export const AFTER_STEPS = ["build", "plan", "save", "invite", "notify", "ready"] as const;
export type StoryStep = (typeof STORY_STEPS)[number];
export type QuestionStep = (typeof QUESTION_STEPS)[number];
export type OnboardingStep = StoryStep | QuestionStep | (typeof AFTER_STEPS)[number];

/** The three chapters of questions; the story already lit the window's first pane. */
export const CHAPTERS: readonly (readonly QuestionStep[])[] = [
  ["who", "where", "wake", "messenger"],
  ["world", "replies", "first", "nobody"],
  ["nearby", "photo"],
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
    step: "night",
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

/** The question asked before this one, the last story scene before the first question. */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const order: readonly OnboardingStep[] = [...STORY_STEPS, ...QUESTION_STEPS, "build", "plan"];
  const at = order.indexOf(step);
  return at <= 0 ? null : (order[at - 1] ?? null);
}

/** The chapter a question is in (1 to 3) and its place in it, for the window and the dots. */
export function chapterOf(step: QuestionStep): { chapter: number; index: number; size: number } {
  const chapter = CHAPTERS.findIndex((steps) => steps.includes(step));
  const steps = CHAPTERS[chapter] ?? [];
  return { chapter: chapter + 1, index: steps.indexOf(step), size: steps.length };
}

/** Each question needs an answer before Continue, "none" counting as one where it is offered. */
export function answered(step: QuestionStep, at: OnboardingDraft): boolean {
  switch (step) {
    case "who":
      return at.callName.trim().length > 0 && at.you.trim().length > 0;
    case "where":
    case "wake":
      return true;
    case "messenger":
      return at.messenger !== null;
    case "world":
      return at.interests.length > 0;
    case "replies":
      return at.replyWays.length > 0 || at.unsure;
    case "first":
      return (at.own.trim().length > 0 ? at.own.trim() : (at.firstPick ?? "")).length > 0;
    case "nobody":
      return at.nobody !== null;
    case "nearby":
      return at.people.length > 0 || at.noneNearby;
    case "photo":
      return at.photo !== null;
  }
}

/** The first question as it will be sent: their own words if they wrote some, else the pick. */
export function firstQuestion(at: OnboardingDraft): string {
  const own = at.own.trim();
  return own.length > 0 ? own : (at.firstPick ?? "");
}
