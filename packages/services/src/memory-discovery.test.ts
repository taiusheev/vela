import { createFakeAi, fakeRecord } from "@vela/ai";
import { answers, consents, memoryCandidates } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { discoverMemories, hasSensitiveWords, screenForMemories } from "./memory-discovery.ts";
import { RICH_MEMORY_CONSENT_VERSION } from "./rich-memories.ts";
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

async function yes(at: Date) {
  await h.db.insert(consents).values({
    memberId: seed.member.id,
    subjectRef: `member:${seed.member.id}`,
    kind: "rich_memories",
    answer: "yes",
    textVersion: RICH_MEMORY_CONSENT_VERSION,
    lang: "en",
    channel: "app",
    givenAt: at,
  });
}
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
const picks = () => h.ai.calls.filter((call) => call.call === "memory_pick");

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

describe("discoverMemories", () => {
  it("proposes her exact words as a private candidate after her yes", async () => {
    await yes(new Date(h.clock.now().getTime() - 1000));
    const ctx = await answer(WORDS);
    const proposed = await discoverMemories(h.deps, ctx, {
      understanding: understanding(),
      flag: noFlag,
    });
    expect(proposed).toBe(1);
    const [candidate] = await h.db.select().from(memoryCandidates);
    expect(candidate).toMatchObject({ memberId: seed.member.id, sourceAnswerId: ctx.answer.id });
    expect(WORDS.slice(candidate?.start ?? 0, candidate?.end ?? 0)).toBe(
      "We took the night train to the sea.",
    );
  });

  it("keeps nothing the model made up or changed", async () => {
    await yes(new Date(h.clock.now().getTime() - 1000));
    h.deps.ai = createFakeAi({
      memoryPick: async () => ({
        ok: true,
        value: { picks: [{ quote: "We loved the seaside trip", kind: "story" }] },
        record: fakeRecord("memory_pick"),
      }),
    });
    const ctx = await answer(WORDS);
    expect(
      await discoverMemories(h.deps, ctx, { understanding: understanding(), flag: noFlag }),
    ).toBe(0);
    expect(await h.db.select().from(memoryCandidates)).toEqual([]);
  });

  it("sends nothing to the model without her yes, before it, or with the switch off", async () => {
    let ctx = await answer(WORDS);
    await discoverMemories(h.deps, ctx, { understanding: understanding(), flag: noFlag });
    expect(picks()).toHaveLength(0);

    await yes(new Date(h.clock.now().getTime() + 60_000));
    ctx = await answer(WORDS);
    await discoverMemories(h.deps, ctx, { understanding: understanding(), flag: noFlag });
    expect(picks()).toHaveLength(0);

    await yes(new Date(h.clock.now().getTime() - 1000));
    h.config.memoryDiscovery = false;
    await discoverMemories(h.deps, ctx, { understanding: understanding(), flag: noFlag });
    expect(picks()).toHaveLength(0);
  });

  it("sends nothing to the model for an answer with sensitive words", async () => {
    await yes(new Date(h.clock.now().getTime() - 1000));
    const ctx = await answer("The garden is lovely but my back aches");
    await discoverMemories(h.deps, ctx, { understanding: understanding(), flag: noFlag });
    expect(picks()).toHaveLength(0);
    expect(await h.db.select().from(memoryCandidates)).toEqual([]);
  });

  it("never throws: a broken step is logged and proposes nothing", async () => {
    await yes(new Date(h.clock.now().getTime() - 1000));
    h.deps.ai = createFakeAi({
      memoryPick: async () => {
        throw new Error("synthetic failure");
      },
    });
    const ctx = await answer(WORDS);
    expect(
      await discoverMemories(h.deps, ctx, { understanding: understanding(), flag: noFlag }),
    ).toBe(0);
  });
});
