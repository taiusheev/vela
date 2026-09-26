import { describe, expect, it } from "vitest";
import { LINE_RETRY_KEY_NAMESPACE, lineRetryKey, uuidV5 } from "./retry-key.ts";

const KEY = "arrival:0f4c2b9e-7d1a-4e3b-9c8f-5a6b7c8d9e0f:2026-09-27";
/** Lowercase with dashes, version 5, variant 10 (RFC 9562). */
const V5_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidV5", () => {
  it("gives the published version-5 UUIDs for the DNS and URL namespaces", async () => {
    await expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).resolves.toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
    await expect(
      uuidV5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", "https://www.example.com/"),
    ).resolves.toBe("3d3ed9d2-aa3d-5fa6-90e8-ed662e90f559");
  });

  it("refuses a namespace that is not a lowercase UUID", async () => {
    await expect(uuidV5("6BA7B810-9DAD-11D1-80B4-00C04FD430C8", "x")).rejects.toThrow(TypeError);
    await expect(uuidV5("not a uuid", "x")).rejects.toThrow(TypeError);
  });
});

describe("lineRetryKey", () => {
  it("keeps the keys it has always given, so a retry across a deploy is still a retry to LINE", async () => {
    expect(LINE_RETRY_KEY_NAMESPACE).toBe("4bb5ce48-b344-4a40-ba0d-47ccf5a221c2");
    await expect(lineRetryKey(KEY, 0)).resolves.toBe("8a1bef97-4963-5200-aac8-9904f060f50b");
    await expect(lineRetryKey(KEY, 1)).resolves.toBe("113e1ee6-f715-5795-a915-295cb9b1cbba");
    await expect(lineRetryKey(KEY, 2)).resolves.toBe("2ce450cf-e531-5ec8-98bc-3d674fab9ea5");
  });

  it("gives the same key for the same message and request every time", async () => {
    const [first, second] = await Promise.all([lineRetryKey(KEY, 0), lineRetryKey(KEY, 0)]);
    expect(first).toBe(second);
    expect(first).toMatch(V5_UUID);
  });

  it("gives each request of a message and each message a key of its own", async () => {
    const keys = await Promise.all([
      lineRetryKey(KEY, 0),
      lineRetryKey(KEY, 1),
      lineRetryKey(`${KEY}x`, 0),
      lineRetryKey("repeat:0f4c2b9e-7d1a-4e3b-9c8f-5a6b7c8d9e0f:2026-09-27", 0),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(V5_UUID);
  });
});
