import type { AppStateStatus } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { applyPendingWhenLeaving, runningUpdateLabel } from "./apply-pending.ts";

function fakeAppState() {
  let listener: ((state: AppStateStatus) => void) | undefined;
  const remove = vi.fn();
  return {
    appState: {
      addEventListener: (_: "change", next: (state: AppStateStatus) => void) => {
        listener = next;
        return { remove };
      },
    },
    move: (state: AppStateStatus) => listener?.(state),
    remove,
  };
}

describe("applyPendingWhenLeaving", () => {
  it("reloads once when Vela goes to the background, never while in front", async () => {
    const fake = fakeAppState();
    const reload = vi.fn(async () => {});
    const stop = applyPendingWhenLeaving(fake.appState, reload);
    fake.move("active");
    fake.move("inactive");
    expect(reload).not.toHaveBeenCalled();
    fake.move("background");
    fake.move("background");
    expect(reload).toHaveBeenCalledOnce();
    stop();
    expect(fake.remove).toHaveBeenCalledOnce();
  });

  it("tries again on the next leave when a reload failed", async () => {
    const fake = fakeAppState();
    const reload = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    applyPendingWhenLeaving(fake.appState, reload);
    fake.move("background");
    await Promise.resolve();
    await Promise.resolve();
    fake.move("background");
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("runningUpdateLabel", () => {
  it("names a downloaded update by its first eight characters", () => {
    expect(runningUpdateLabel("d02decdd-1865-4720-850e-98aa42e3f4a7", false)).toBe("d02decdd");
    expect(runningUpdateLabel("d02decdd-1865", true)).toBeNull();
    expect(runningUpdateLabel(null, false)).toBeNull();
  });
});
