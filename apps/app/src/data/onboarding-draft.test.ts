import { afterEach, describe, expect, it } from "vitest";
import {
  answered,
  CHAPTERS,
  chapterOf,
  firstQuestion,
  initialDraft,
  nextQuestion,
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
    updateDraft({ callName: "Mẹ", step: "mornings" });
    expect(readDraft()).toMatchObject({ callName: "Mẹ", step: "mornings", run });
    resetDraft();
    expect(readDraft()).toMatchObject({ callName: "", step: "welcome" });
    expect(readDraft().run).not.toBe(run);
  });

  it("puts every question in exactly one of three chapters", () => {
    expect(CHAPTERS.flat()).toEqual([...QUESTION_STEPS]);
    expect(chapterOf("who")).toEqual({ chapter: 1, index: 0, size: 3 });
    expect(chapterOf("first")).toEqual({ chapter: 2, index: 2, size: 3 });
    expect(chapterOf("around")).toEqual({ chapter: 3, index: 0, size: 1 });
  });

  it("goes back from the first question to the welcome, and never before it", () => {
    expect(previousStep("who")).toBe("welcome");
    expect(previousStep("welcome")).toBeNull();
    expect(previousStep("plan")).toBe("build");
  });

  it("asks how the family talks only where the server keeps it", () => {
    expect(nextQuestion("world")).toBe("talk");
    expect(nextQuestion("world", false)).toBe("first");
    expect(previousStep("first", false)).toBe("world");
    expect(previousStep("first")).toBe("talk");
    expect(nextQuestion("around")).toBe("build");
  });
});

describe("answered", () => {
  it("needs both names", () => {
    expect(answered("who", draft({ callName: "Mom" }))).toBe(false);
    expect(answered("who", draft({ callName: "Mom", you: " " }))).toBe(false);
    expect(answered("who", draft({ callName: "Mom", you: "Mia" }))).toBe(true);
  });

  it("needs a messenger, and both halves of her world", () => {
    expect(answered("messenger", draft())).toBe(false);
    expect(answered("messenger", draft({ messenger: "line" }))).toBe(true);
    expect(answered("world", draft({ interests: ["garden"] }))).toBe(false);
    expect(answered("world", draft({ interests: ["garden"], unsure: true }))).toBe(true);
    expect(answered("world", draft({ replyWays: ["voice"] }))).toBe(false);
  });

  it("needs how often they talk and what to avoid, with nothing to avoid as an answer", () => {
    expect(answered("talk", draft())).toBe(false);
    expect(answered("talk", draft({ talkRhythm: "often" }))).toBe(false);
    expect(answered("talk", draft({ talkRhythm: "often", nothingToAvoid: true }))).toBe(true);
    expect(answered("talk", draft({ talkRhythm: "rarely", avoidTopics: ["money"] }))).toBe(true);
    expect(answered("talk", draft({ talkRhythm: "sometimes", avoidWords: ["Grandpa Lin"] }))).toBe(
      true,
    );
  });

  it("counts the honest none as an answer: no one nearby, no photo", () => {
    expect(answered("around", draft())).toBe(false);
    expect(answered("around", draft({ noneNearby: true }))).toBe(false);
    expect(answered("around", draft({ noneNearby: true, photo: { kind: "initials" } }))).toBe(true);
    expect(
      answered(
        "around",
        draft({ people: [{ name: "Lan", relation: "Neighbour" }], photo: { kind: "initials" } }),
      ),
    ).toBe(true);
  });

  it("takes the organiser's own first question over a picked one, and needs who signs quiet days", () => {
    expect(answered("first", draft())).toBe(false);
    expect(firstQuestion(draft({ firstPick: "What did you cook?", own: "  " }))).toBe(
      "What did you cook?",
    );
    expect(firstQuestion(draft({ firstPick: "What did you cook?", own: "Hi Mom!" }))).toBe(
      "Hi Mom!",
    );
    expect(answered("first", draft({ own: "Hi Mom!" }))).toBe(false);
    expect(answered("first", draft({ own: "Hi Mom!", nobody: "vela" }))).toBe(true);
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
