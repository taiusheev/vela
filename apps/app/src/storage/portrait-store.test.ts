import { describe, expect, it } from "vitest";
import { type PortraitFiles, PortraitStore, portraitKey, portraitPath } from "./portrait-store.ts";

function disk() {
  const values = new Map<string, string>();
  let fail = false;
  const key = (scope: string, person: string) => JSON.stringify([scope, person]);
  const files: PortraitFiles = {
    read: (s, p) => values.get(key(s, p)) ?? null,
    save: (s, p, u) => {
      if (fail) throw new Error("disk full");
      values.set(key(s, p), u);
      return u;
    },
    remove: (s, p) => {
      values.delete(key(s, p));
    },
    clear: (s) => {
      for (const k of values.keys()) if ((JSON.parse(k) as string[])[0] === s) values.delete(k);
    },
  };
  return {
    files,
    values,
    fail: () => {
      fail = true;
    },
  };
}
describe("private parent portraits", () => {
  it("survives restart for the same session while isolating accounts, families and parents", () => {
    const { files } = disk();
    const first = new PortraitStore(files);
    first.save("session-a", "family-a", "mom", "local-photo");
    const restarted = new PortraitStore(files);
    expect(restarted.read("session-a", "family-a", "mom")).toBe("local-photo");
    expect(restarted.read("session-b", "family-a", "mom")).toBeNull();
    expect(restarted.read("session-a", "family-b", "mom")).toBeNull();
    expect(restarted.read("session-a", "family-a", "dad")).toBeNull();
  });
  it("clears unopened photos on sign-out and rejects a picker that returns after sign-out", () => {
    const { files, values } = disk();
    const store = new PortraitStore(files);
    store.save("s", "f", "mom", "photo");
    store.save("s", "f", "dad", "other");
    store.clear("s");
    expect(values.size).toBe(0);
    expect(store.read("s", "f", "mom")).toBeNull();
    expect(() => store.save("s", "f", "mom", "late picker")).toThrow("session ended");
  });
  it("keeps the existing portrait when a replacement cannot be stored", () => {
    const diskState = disk();
    const store = new PortraitStore(diskState.files);
    store.save("s", "f", "mom", "original");
    diskState.fail();
    expect(() => store.save("s", "f", "mom", "replacement")).toThrow();
    expect(store.read("s", "f", "mom")).toBe("original");
  });
  it("removes only the selected parent and creates path-safe collision-free keys", () => {
    const { files } = disk();
    const store = new PortraitStore(files);
    store.save("s", "f", "mom", "one");
    store.save("s", "f", "dad", "two");
    store.remove("s", "f", "mom");
    expect(store.read("s", "f", "dad")).toBe("two");
    expect(store.read("s", "f", "mom")).toBeNull();
    expect(portraitKey("a:b", "c")).not.toBe(portraitKey("a", "b:c"));
    expect(portraitPath("../媽媽/")).toMatch(/^[a-f0-9-]+$/);
    expect(portraitPath("😀")).not.toBe(portraitPath("😁"));
  });
});
