import { aiCalls, flags } from "@vela/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordEvent } from "./events.ts";
import { opsAlerts, opsDigest } from "./ops.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

const ADMIN = "9001";
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const toFounder = () => h.telegram.sentTo(ADMIN).map((entry) => entry.message.text ?? "");

async function happened(name: Parameters<typeof recordEvent>[1]["name"], times = 1) {
  for (let i = 0; i < times; i += 1) await recordEvent(h.db, { name }, h.clock.now());
}

async function aiCall(ok: boolean, costUsd = 0.01) {
  await h.db.insert(aiCalls).values({
    call: "understand",
    promptVersion: "test",
    model: "gpt-5",
    inputRef: {},
    ok,
    costUsd,
    at: h.clock.now(),
  });
}

describe("opsAlerts", () => {
  it("tells the founder of failed arrivals once an hour, with the count so far", async () => {
    await happened("arrival_delivery_failed", 2);
    expect(await opsAlerts(h.deps)).toBe(1);
    expect(toFounder()).toHaveLength(1);
    expect(toFounder()[0]).toMatch(/^2 morning arrivals could not be delivered since \d\d:00 UTC/);

    await happened("arrival_delivery_failed");
    h.clock.advance(15 * 60 * 1000);
    expect(await opsAlerts(h.deps)).toBe(0);
    expect(toFounder()).toHaveLength(1);
  });

  it("stays quiet when nothing went wrong, and says nothing without an admin chat", async () => {
    expect(await opsAlerts(h.deps)).toBe(0);
    await happened("gateway_dropped");
    const configured = h.config.adminConversationId;
    h.config.adminConversationId = null;
    try {
      expect(await opsAlerts(h.deps)).toBe(0);
    } finally {
      h.config.adminConversationId = configured;
    }
    expect(toFounder()).toEqual([]);
    // Nothing was claimed, so the chat hears once it exists.
    expect(await opsAlerts(h.deps)).toBe(1);
  });

  it("tells the founder when over a fifth of the last hour's AI calls failed, with enough calls", async () => {
    for (const ok of [true, true, true, false]) await aiCall(ok);
    expect(await opsAlerts(h.deps)).toBe(0);
    await aiCall(false);
    expect(await opsAlerts(h.deps)).toBe(1);
    expect(toFounder()[0]).toMatch(/^AI calls are failing: 2 of 5 in the last hour/);
  });
});

describe("opsDigest", () => {
  it("sums the last 24 hours once a day, content-free", async () => {
    await happened("arrival_delivered", 3);
    await happened("answer_recorded", 2);
    await happened("quiet_notice_sent");
    await aiCall(true, 0.25);
    await aiCall(false, 0);

    expect(await opsDigest(h.deps)).toBe(true);
    expect(await opsDigest(h.deps)).toBe(false);
    const [digest] = toFounder();
    expect(digest).toContain("3 mornings delivered, 0 failed; 2 answers");
    expect(digest).toContain("1 quiet notices");
    expect(digest).toContain("AI 2 calls, 1 failed, US$0.25");
  });

  it("clears its own claims after a week, and no one else's", async () => {
    await opsDigest(h.deps);
    await h.db.insert(flags).values({ key: "line:quota:x", value: {}, updatedAt: h.clock.now() });
    h.clock.advance(8 * 24 * 60 * 60 * 1000);
    await opsDigest(h.deps);
    const kept = await h.db.select().from(flags).where(like(flags.key, "%"));
    expect(kept.map((row) => row.key).sort()).toEqual(
      ["line:quota:x", `ops:digest:${h.clock.now().toISOString().slice(0, 10)}`].sort(),
    );
  });
});
