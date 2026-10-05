import { describe, expect, it } from "vitest";
import { type PrivateStorage, PrivateStore } from "./private-store.ts";

function disk() {
  const values = new Map<string, string>();
  const storage: PrivateStorage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
  return { values, storage };
}

describe("private device values", () => {
  it("restores the same failed-write identity after an app restart, separately for each session", async () => {
    const { storage } = disk();
    const first = new PrivateStore(storage, "test");
    await first.write(
      "account-a:session-a",
      "ask.family-a",
      JSON.stringify({
        text: "How was breakfast?",
        attempt: { key: "unchanged-write", body: '{"text":"How was breakfast?"}' },
      }),
    );
    const restarted = new PrivateStore(storage, "test");
    const restored = JSON.parse(
      (await restarted.read("account-a:session-a", "ask.family-a")) ?? "null",
    );
    expect(restored.attempt.key).toBe("unchanged-write");
    expect(await restarted.read("account-b:session-b", "ask.family-a")).toBeNull();
  });
  it("sign-out removes unopened reply drafts and optional calling numbers from encrypted storage", async () => {
    const { storage, values } = disk();
    const before = new PrivateStore(storage, "test");
    await before.write("account-a:session-a", "reply.exchange-a", "private reply");
    await before.write("account-a:session-a", "call.family-a.parent-a", "+84901234567");
    const restarted = new PrivateStore(storage, "test");
    await restarted.clear("account-a:session-a");
    expect(values.size).toBe(0);
    expect(await restarted.read("account-a:session-a", "reply.exchange-a")).toBeNull();
    await expect(
      restarted.write("account-a:session-a", "reply.exchange-a", "late write"),
    ).rejects.toThrow("session ended");
  });
  it("a late read cannot repopulate a cleared session", async () => {
    let finish: (value: string | null) => void = () => {};
    const store = new PrivateStore(
      {
        get: (key) =>
          key.endsWith("69-6e-64-65-78")
            ? Promise.resolve(null)
            : new Promise((resolve) => {
                finish = resolve;
              }),
        set: async () => {},
        remove: async () => {},
      },
      "test",
    );
    const read = store.read("a", "answer");
    await store.clear("a");
    finish("private answer");
    expect(await read).toBeNull();
    expect(await store.read("a", "answer")).toBeNull();
  });
});
