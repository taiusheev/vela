import { fakeRecord } from "@vela/ai";
import { answers } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasSensitiveWords, screenForMemories } from "./memory-discovery.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const WORDS = "We took the night train to the sea. Nobody minded the wind.";
beforeAll(async () => {
  h = await createHarness({ config: { richMemories: true, memoryDiscovery: true } });
}, 60_000);
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  h.config.richMemories = true;
  h.config.memoryDiscovery = true;
  seed = await seedFamily(h.db, { now: h.clock.now() });
  day = 0;
});

let day = 0;
async function answer(text: string) {
  day += 1;
  const exchange = await seedExchange(h.db, seed, {
    date: `2026-09-${String(10 + day).padStart(2, "0")}`,
  });
  const [row] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text },
      receivedAt: h.clock.now(),
    })
    .returning();
  if (!row) throw new Error("Missing synthetic answer");
  return { answer: row, member: seed.member, exchange };
}
const understanding = (health: string[] = []) => ({
  ok: true as const,
  value: {
    summary: "",
    moodWords: [],
    mentions: { people: [], places: [], plans: [], health, dates: [] },
    away: null,
    dated: [],
    language: "en",
  },
  record: fakeRecord("understand"),
});
const noFlag = {
  ok: true as const,
  value: { flag: false, category: null, severity: null, evidenceQuote: null },
  record: fakeRecord("flag"),
};

describe("the screen before any words reach the memory model", () => {
  it("keeps health, body, money and loss words out, in English and Traditional Chinese", () => {
    for (const text of [
      "My knee hurts today",
      "Went to the doctor",
      "Took my pills",
      "Paid the bank",
      "Uncle passed away",
      "膝蓋很痛",
      "今天去醫院",
      "血壓有點高",
    ])
      expect(hasSensitiveWords(text), text).toBe(true);
    for (const text of [WORDS, "陽台上的黃色菊花開了", "We made dumplings with cabbage"])
      expect(hasSensitiveWords(text), text).toBe(false);
  });

  it("refuses a flagged answer, a health mention, or one not understood", async () => {
    const ctx = await answer(WORDS);
    expect(screenForMemories(ctx.answer, { understanding: understanding(), flag: noFlag })).toBe(
      null,
    );
    expect(
      screenForMemories(ctx.answer, {
        understanding: understanding(),
        flag: { ...noFlag, value: { ...noFlag.value, flag: true } },
      }),
    ).toBe("flagged");
    expect(
      screenForMemories(ctx.answer, { understanding: understanding(["back"]), flag: noFlag }),
    ).toBe("health_mentioned");
    expect(
      screenForMemories(ctx.answer, {
        understanding: { ...understanding(), ok: false } as never,
        flag: noFlag,
      }),
    ).toBe("not_understood");
  });
});
