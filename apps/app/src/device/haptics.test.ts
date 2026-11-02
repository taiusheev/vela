import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ OS: "ios" }));
const haptics = vi.hoisted(() => ({
  notificationAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
}));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("expo-haptics", () => ({
  ...haptics,
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}));

const { tapLanded, tapLight } = await import("./haptics.ts");

describe("the gentle taps", () => {
  beforeEach(() => {
    platform.OS = "ios";
    haptics.notificationAsync.mockClear();
    haptics.impactAsync.mockClear();
  });

  it("tap once on a phone when something landed, and lightly for a reaction", () => {
    tapLanded();
    tapLight();
    expect(haptics.notificationAsync).toHaveBeenCalledWith("success");
    expect(haptics.impactAsync).toHaveBeenCalledWith("light");
  });

  it("stay still on the web", () => {
    platform.OS = "web";
    tapLanded();
    tapLight();
    expect(haptics.notificationAsync).not.toHaveBeenCalled();
    expect(haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("never throw when the phone cannot tap", async () => {
    haptics.notificationAsync.mockRejectedValueOnce(new Error("unavailable"));
    expect(() => tapLanded()).not.toThrow();
    await Promise.resolve();
  });
});
