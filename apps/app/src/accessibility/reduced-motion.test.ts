import { expect, it, vi } from "vitest";
import { type MotionPreferences, watchReducedMotion } from "./reduced-motion.ts";

function setup() {
  let resolve!: (enabled: boolean) => void;
  let reject!: (error: Error) => void;
  let change!: (enabled: boolean) => void;
  const remove = vi.fn();
  const update = vi.fn();
  const unavailable = vi.fn();
  const preferences: MotionPreferences = {
    isReduceMotionEnabled: () =>
      new Promise<boolean>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    addEventListener: (_event, listener) => {
      change = listener;
      return { remove };
    },
  };
  const stop = watchReducedMotion(preferences, update, unavailable);
  return { resolve, reject, change, remove, update, unavailable, stop };
}

it("reads the startup preference and follows subsequent changes", async () => {
  const state = setup();
  state.resolve(false);
  await Promise.resolve();
  state.change(true);
  expect(state.update.mock.calls).toEqual([[false], [true]]);
  state.stop();
  expect(state.remove).toHaveBeenCalledOnce();
});

it("cannot undo a new Reduce Motion setting with a stale startup result", async () => {
  const state = setup();
  state.change(true);
  state.resolve(false);
  await Promise.resolve();
  expect(state.update.mock.calls).toEqual([[true]]);
});

it("ignores startup completion and queued changes after unmount", async () => {
  const state = setup();
  state.stop();
  state.resolve(false);
  state.change(false);
  await Promise.resolve();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.remove).toHaveBeenCalledOnce();
});

it("retains the safe default on read failure and still accepts a later event", async () => {
  const state = setup();
  state.reject(new Error("Preference unavailable"));
  await Promise.resolve();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.unavailable).toHaveBeenCalledOnce();
  state.change(false);
  expect(state.update).toHaveBeenCalledWith(false);
  state.stop();
});

it("does not report a failed startup read once a live change has arrived", async () => {
  const state = setup();
  state.change(false);
  state.reject(new Error("Preference unavailable"));
  await Promise.resolve();
  expect(state.unavailable).not.toHaveBeenCalled();
});
