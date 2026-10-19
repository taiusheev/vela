import { afterEach, describe, expect, it } from "vitest";
import {
  answered,
  CHAPTERS,
  chapterOf,
  firstQuestion,
  initialDraft,
  type OnboardingDraft,
  previousStep,
  QUESTION_STEPS,
  readDraft,
  resetDraft,
  updateDraft,
} from "./onboarding-draft.ts";

const draft = (change: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  ...initialDraft(),
  ...change,
});

afterEach(() => resetDraft());

describe("the onboarding draft", () => {
  it("keeps its answers across reads until it starts over, with a new run for its keys", () => {
    const run = readDraft().run;
    updateDraft({ callName: "Mẹ", step: "where" });
    expect(readDraft()).toMatchObject({ callName: "Mẹ", step: "where", run });
    resetDraft();
    expect(readDraft()).toMatchObject({ callName: "", step: "night" });
    expect(readDraft().run).not.toBe(run);
  });

  it("puts every question in exactly one of three chapters", () => {
    expect(CHAPTERS.flat()).toEqual([...QUESTION_STEPS]);
    expect(chapterOf("who")).toEqual({ chapter: 1, index: 0, size: 4 });
    expect(chapterOf("first")).toEqual({ chapter: 2, index: 2, size: 4 });
    expect(chapterOf("photo")).toEqual({ chapter: 3, index: 1, size: 2 });
  });

  it("goes back from the first question to the story's last scene, and never before the story", () => {
    expect(previousStep("who")).toBe("quiet");
    expect(previousStep("night")).toBeNull();
    expect(previousStep("plan")).toBe("build");
  });
});

describe("answered", () => {
  it("needs both names", () => {
    expect(answered("who", draft({ callName: "Mom" }))).toBe(false);
    expect(answered("who", draft({ callName: "Mom", you: " " }))).toBe(false);
    expect(answered("who", draft({ callName: "Mom", you: "Mia" }))).toBe(true);
  });

  it("needs a messenger, at least one topic, and who signs on quiet days", () => {
    expect(answered("messenger", draft())).toBe(false);
    expect(answered("messenger", draft({ messenger: "line" }))).toBe(true);
    expect(answered("world", draft())).toBe(false);
    expect(answered("world", draft({ interests: ["garden"] }))).toBe(true);
    expect(answered("nobody", draft())).toBe(false);
    expect(answered("nobody", draft({ nobody: "vela" }))).toBe(true);
  });

  it("counts the honest none as an answer: not sure yet, no one nearby, no photo", () => {
    expect(answered("replies", draft())).toBe(false);
    expect(answered("replies", draft({ unsure: true }))).toBe(true);
    expect(answered("replies", draft({ replyWays: ["voice"] }))).toBe(true);
    expect(answered("nearby", draft())).toBe(false);
    expect(answered("nearby", draft({ noneNearby: true }))).toBe(true);
    expect(answered("nearby", draft({ people: [{ name: "Lan", relation: "Neighbour" }] }))).toBe(
      true,
    );
    expect(answered("photo", draft())).toBe(false);
    expect(answered("photo", draft({ photo: { kind: "initials" } }))).toBe(true);
  });

  it("takes the organiser's own first question over a picked one", () => {
    expect(answered("first", draft())).toBe(false);
    expect(firstQuestion(draft({ firstPick: "What did you cook?", own: "  " }))).toBe(
      "What did you cook?",
    );
    expect(firstQuestion(draft({ firstPick: "What did you cook?", own: "Hi Mom!" }))).toBe(
      "Hi Mom!",
    );
    expect(answered("first", draft({ own: "Hi Mom!" }))).toBe(true);
  });
});

describe("private setup session lifecycle", () => {
  it("keeps an explicitly accepted unsaved preview through its intended sign-in, then clears it on sign-out or another account", async () => {
    const { activateOnboardingSession } = await import("./onboarding-draft.ts");
    activateOnboardingSession("guest");
    updateDraft({ step: "save", privacyAccepted: true, callName: "Mom" });
    const run = readDraft().run;
    activateOnboardingSession("account-a:session-a");
    expect(readDraft()).toMatchObject({ run, callName: "Mom", privacyAccepted: true });
    activateOnboardingSession("account-b:session-b");
    expect(readDraft()).toMatchObject({ callName: "", privacyAccepted: false });
    updateDraft({ callName: "Dad" });
    activateOnboardingSession("guest");
    expect(readDraft().callName).toBe("");
  });
  it("discards replaced, abandoned and late-returning portraits without applying an old draft to a new account", async () => {
    const { registerOnboardingPhotoCleanup, updateDraftForRun } = await import(
      "./onboarding-draft.ts"
    );
    const removed: string[] = [];
    registerOnboardingPhotoCleanup((source) => removed.push(source));
    updateDraft({ photo: { kind: "picked", source: "first" } });
    const run = readDraft().run;
    updateDraft({ photo: { kind: "picked", source: "second" } });
    expect(removed).toEqual(["first"]);
    resetDraft();
    expect(removed).toEqual(["first", "second"]);
    expect(updateDraftForRun(run, { photo: { kind: "picked", source: "late" } })).toBe(false);
    expect(removed).toEqual(["first", "second", "late"]);
    expect(readDraft().photo).toBeNull();
    registerOnboardingPhotoCleanup(() => {});
  });
});
