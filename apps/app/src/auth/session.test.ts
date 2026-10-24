import { describe, expect, it } from "vitest";
import { sessionScope, signedInToken } from "./session.ts";

describe("the session", () => {
  it("is named by the account and its session once known", () => {
    expect(sessionScope({ ready: false, signedIn: false, userId: null })).toBe("loading");
    expect(sessionScope({ ready: true, signedIn: false, userId: null })).toBe("signed-out");
    expect(sessionScope({ ready: true, signedIn: true, userId: "u", sessionId: "s" })).toBe("u:s");
  });
});

describe("a signed-in person's token", () => {
  it("is asked for once more, skipping the cache, when Clerk has none yet after a sign-in", async () => {
    const asked: unknown[] = [];
    const tokens = [null, "token"];
    const token = await signedInToken(
      async (options) => {
        asked.push(options);
        return tokens.shift() ?? null;
      },
      true,
      false,
    );
    expect(token).toBe("token");
    expect(asked).toEqual([undefined, { skipCache: true }]);
  });

  it("is not asked for again for someone signed out, or when a fresh one was already asked", async () => {
    let asked = 0;
    const none = async () => {
      asked += 1;
      return null;
    };
    expect(await signedInToken(none, false, false)).toBeNull();
    expect(await signedInToken(none, true, true)).toBeNull();
    expect(asked).toBe(2);
  });
});
