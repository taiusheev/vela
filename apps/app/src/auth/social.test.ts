import { describe, expect, it, vi } from "vitest";
import { completeSocialSignIn } from "./social.ts";

describe("social sign-in session boundary", () => {
  it("reports unavailable activation instead of pretending the user cancelled", async () => {
    expect(await completeSocialSignIn({ createdSessionId: "session_test" }, () => true)).toBe(
      "unavailable",
    );
  });
  it("activates only the session returned by Clerk", async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    expect(
      await completeSocialSignIn({ createdSessionId: "session_test", setActive }, () => true),
    ).toBe("complete");
    expect(setActive).toHaveBeenCalledExactlyOnceWith({ session: "session_test" });
  });
  it.each(["cancel", "dismiss"])(
    "treats %s as cancellation even if stale session data exists",
    async (type) => {
      const setActive = vi.fn();
      expect(
        await completeSocialSignIn(
          { createdSessionId: "stale", setActive, authSessionResult: { type } },
          () => true,
        ),
      ).toBe("cancelled");
      expect(setActive).not.toHaveBeenCalled();
    },
  );
  it("never activates a result after leaving the screen", async () => {
    const setActive = vi.fn();
    expect(await completeSocialSignIn({ createdSessionId: "old", setActive }, () => false)).toBe(
      "cancelled",
    );
    expect(setActive).not.toHaveBeenCalled();
  });
  it.each(["needs_second_factor", "needs_new_password"])(
    "does not mistake %s for a signed-in session",
    async (status) => {
      expect(
        await completeSocialSignIn({ createdSessionId: null, signIn: { status } }, () => true),
      ).toBe("needs_more");
    },
  );
  it("keeps incomplete registration out of the app", async () => {
    expect(
      await completeSocialSignIn(
        { createdSessionId: null, signUp: { status: "missing_requirements" } },
        () => true,
      ),
    ).toBe("needs_more");
  });
  it("leaves activation failure available for retry", async () => {
    const setActive = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      completeSocialSignIn({ createdSessionId: "test", setActive }, () => true),
    ).rejects.toThrow("offline");
  });
  it("handles a blocked browser without claiming cancellation or sign-in", async () => {
    expect(
      await completeSocialSignIn(
        { createdSessionId: null, authSessionResult: { type: "locked" } },
        () => true,
      ),
    ).toBe("unavailable");
  });
});
