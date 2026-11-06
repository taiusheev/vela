import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activateOnboardingSession,
  readDraft,
  resetDraft,
  updateDraft,
  useOnboardingDraft,
} from "./onboarding-draft.ts";
import { OnboardingSession } from "./onboarding-session.tsx";

const { renderToString } = createRequire(import.meta.url)("react-dom/server") as {
  renderToString(node: ReactNode): string;
};

let renderer: ReactTestRenderer | undefined;
const reads: { scope: string; name: string }[] = [];
function AccountScreen({ scope }: { scope: string }) {
  const draft = useOnboardingDraft();
  reads.push({ scope, name: draft.callName });
  return createElement("account-screen", { scope, name: draft.callName });
}
function screen(scope: string) {
  return createElement(OnboardingSession, { scope }, createElement(AccountScreen, { scope }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  activateOnboardingSession("guest");
  resetDraft();
  reads.length = 0;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

it("changes accounts without notifying a mounted screen during render or reading another account's draft", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => {
    renderer = create(screen("account-a:session-a"));
  });
  await act(async () => updateDraft({ callName: "Synthetic A", step: "who" }));
  reads.length = 0;
  await act(async () => renderer?.update(screen("account-b:session-b")));
  expect(reads.filter((read) => read.scope === "account-b:session-b").length).toBeGreaterThan(0);
  expect(
    reads.filter((read) => read.scope === "account-b:session-b").every((read) => read.name === ""),
  ).toBe(true);
  expect(
    errors.mock.calls.filter((args) => String(args[0]).includes("Cannot update a component")),
  ).toEqual([]);
  await act(async () => updateDraft({ callName: "Synthetic B" }));
  reads.length = 0;
  await act(async () => renderer?.update(screen("guest")));
  expect(reads.filter((read) => read.scope === "guest").every((read) => read.name === "")).toBe(
    true,
  );
});

it("preserves the explicitly accepted guest preview only for its intended sign-in", async () => {
  await act(async () => {
    renderer = create(screen("guest"));
  });
  await act(async () =>
    updateDraft({ step: "save", privacyAccepted: true, callName: "Synthetic preview" }),
  );
  const run = readDraft().run;
  await act(async () => renderer?.update(screen("account-a:session-a")));
  expect(readDraft()).toMatchObject({
    run,
    step: "save",
    privacyAccepted: true,
    callName: "Synthetic preview",
  });
  await act(async () => renderer?.update(screen("account-b:session-b")));
  expect(readDraft()).toMatchObject({ step: "welcome", privacyAccepted: false, callName: "" });
});

it("does not discard the active draft in a render that never commits effects", () => {
  activateOnboardingSession("account-a:session-a");
  updateDraft({ callName: "Synthetic uncommitted", step: "who" });
  const draft = readDraft();
  renderToString(screen("account-b:session-b"));
  expect(readDraft()).toBe(draft);
});
