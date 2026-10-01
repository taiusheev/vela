import { describe, expect, it } from "vitest";
import { createDeviceAdapter } from "./adapter.ts";

describe("the device adapter", () => {
  it("delivers by answering a fresh message id, with nothing sent anywhere", async () => {
    let next = 0;
    const adapter = createDeviceAdapter({ messageId: () => `m-${++next}` });
    const message = { conversationId: "her-phone", text: "Good morning" } as never;

    expect(await adapter.send(message)).toEqual({
      externalMessageIds: ["m-1"],
      primaryMessageId: "m-1",
    });
    expect((await adapter.send(message)).primaryMessageId).toBe("m-2");
  });

  it("verifies no webhook and parses none, since her taps come through her own routes", async () => {
    const adapter = createDeviceAdapter();
    const input = { headers: new Headers(), rawBody: "{}" };
    expect(await adapter.verify(input)).toBe(false);
    expect(adapter.parse(input)).toEqual([]);
  });

  it("asks the gateway for no file's bytes, and holds none to fetch", async () => {
    const adapter = createDeviceAdapter();
    expect(adapter.capabilities.mediaByUrl).toBe(true);
    await expect(adapter.fetchMedia("anything")).rejects.toThrow();
  });
});
