import { describe, expect, it, vi } from "vitest";
import { completePasswordSignIn } from "./password.ts";

describe("password sign-in", () => {
  it("activates only Clerk's completed session and preserves the exact password", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ status: "complete", createdSessionId: "session_demo" });
    const activate = vi.fn().mockResolvedValue(undefined);
    expect(
      await completePasswordSignIn(create, activate, " demo@example.test ", " spaces matter "),
    ).toBe("complete");
    expect(create).toHaveBeenCalledWith({
      identifier: "demo@example.test",
      password: " spaces matter ",
    });
    expect(activate).toHaveBeenCalledExactlyOnceWith({ session: "session_demo" });
  });

  it.each(["needs_first_factor", "needs_second_factor", "needs_new_password", null])(
    "never activates an unfinished %s challenge even if a session id is present",
    async (status) => {
      const activate = vi.fn();
      expect(
        await completePasswordSignIn(
          async () => ({ status, createdSessionId: "pending" }),
          activate,
          "demo@example.test",
          "synthetic-only",
        ),
      ).toBe("verification_required");
      expect(activate).not.toHaveBeenCalled();
    },
  );

  it("does not activate when Clerk has no session or refuses a password", async () => {
    const activate = vi.fn();
    expect(
      await completePasswordSignIn(
        async () => ({ status: "complete", createdSessionId: null }),
        activate,
        "demo@example.test",
        "synthetic-only",
      ),
    ).toBe("verification_required");
    const refusal = { errors: [{ code: "form_password_incorrect" }] };
    await expect(
      completePasswordSignIn(
        async () => {
          throw refusal;
        },
        activate,
        "demo@example.test",
        "synthetic-only",
      ),
    ).rejects.toBe(refusal);
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not report success when session activation fails", async () => {
    await expect(
      completePasswordSignIn(
        async () => ({ status: "complete", createdSessionId: "session_demo" }),
        async () => {
          throw new Error("offline");
        },
        "demo@example.test",
        "synthetic-only",
      ),
    ).rejects.toThrow("offline");
  });
});
