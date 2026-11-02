/**
 * Her memories and the stories gathered from them (ADR-51): which of her answers are memories, how
 * a story is woven from her own words only, and how it fades, is kept, or goes with "memories off".
 * Synthetic family only.
 */
import { createFakeAi, type FakeAi, fakeRecord } from "@vela/ai";
import type { InboundEvent } from "@vela/contracts";
import { answers, type Exchange, keepSuggestions, members, memoryStories, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiBook } from "./book.ts";
import { keepApiAnswer, suggestKeeping } from "./memories.ts";
import { handleParentCommand } from "./parent-commands.ts";
import { saysEnough, weaveStories } from "./stories.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
let day = 0;
let ai: FakeAi;

const TOMATOES = [
  "I saved the seeds from last summer's tomatoes in an envelope by the radio.",
  "The little tomato plants are as tall as my hand now.",
  "The tomatoes finally turned. I picked three before breakfast.",
];

beforeAll(async () => {
  h = await createHarness({ config: { book: true, memoryDiscovery: true, memoryStories: true } });
}, 60_000);
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  h.config.book = true;
  h.config.memoryDiscovery = true;
  h.config.memoryStories = true;
  ai = createFakeAi();
  h.deps.ai = ai;
  day = 0;
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("expected Mia's account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});

/** One answered morning: her words to an ordinary ask, a day after the last. */
async function answered(text: string, kind: "text" | "photo" = "text"): Promise<Exchange> {
  day += 1;
  const exchange = await seedExchange(h.db, seed, {
    date: `2026-09-${String(10 + day).padStart(2, "0")}`,
  });
  await h.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: seed.member.id,
    kind,
    channel: "telegram",
    payload: kind === "text" ? { text } : {},
    receivedAt: new Date(h.clock.now().getTime() + day * 60_000),
  });
  return exchange;
}

async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (row === undefined) throw new Error("Missing her");
  return row;
}

const screen = {
  understanding: {
    ok: true as const,
    value: {
      summary: "",
      moodWords: [],
      mentions: { people: [], places: [], plans: [], health: [], dates: [] },
      away: null,
      dated: [],
      language: "en",
    },
    record: fakeRecord("understand"),
  },
  flag: {
    ok: true as const,
    value: { flag: false, category: null, severity: null, evidenceQuote: null },
    record: fakeRecord("flag"),
  },
};

/** Her answer, with the memory model's pick of her first sentence (the fake's), as a pipeline would. */
async function memory(text: string): Promise<Exchange> {
  const exchange = await answered(text);
  const [answer] = await h.db.select().from(answers).where(eq(answers.exchangeId, exchange.id));
  if (answer === undefined) throw new Error("Missing answer");
  await suggestKeeping(h.deps, { answer, member: await her(), exchange }, screen);
  return exchange;
}

const book = async () => {
  const read = await loadApiBook(h.db, mia, seed.family.id, h.clock.now());
  if (read === null) throw new Error("expected the book");
  return read;
};

describe("her memories", () => {
  it("are the phrases worth remembering, word for word, with what kind they are", async () => {
    const exchange = await memory("We took the night train to the sea. Nobody minded the wind.");
    const { moments } = await book();
    expect(moments).toEqual([
      expect.objectContaining({
        exchange_id: exchange.id,
        quote: "We took the night train to the sea.",
        words: "We took the night train to the sea. Nobody minded the wind.",
        kind: "moment",
        kept: false,
        story_id: null,
      }),
    ]);
    expect(moments[0]?.fades_at).not.toBeNull();
  });

  it("leave out a greeting, and anything about health or a sensitive subject", async () => {
    await answered("Good morning, all fine here.");
    await answered("The garden is lovely this week but my knee hurts when I bend to the beans.");
    await answered(
      "I went to the temple with Mrs Lee and we lit a candle for the new year together.",
    );
    expect((await book()).moments).toEqual([]);
  });

  it("include an answer that says enough, and her photo, without a phrase picked", async () => {
    const long = await answered(
      "We walked along the river after lunch and counted the boats until it was time for tea.",
    );
    const photo = await answered("", "photo");
    const ids = (await book()).moments.map((moment) => moment.exchange_id);
    expect(ids).toContain(long.id);
    // A photo answer without a stored file is not shown as a photo memory.
    expect(ids).not.toContain(photo.id);
  });

  it("show who kept one, and stop fading once kept", async () => {
    const exchange = await memory("Grandpa sang on the boat. Everyone joined the second verse.");
    await keepApiAnswer(h.deps, mia, "keep-1", exchange.id);
    const [moment] = (await book()).moments;
    expect(moment).toMatchObject({ kept: true, kept_by: "Mia", fades_at: null });
  });

  it("tells the word-count rule in both languages", () => {
    expect(saysEnough("Fine, thanks.")).toBe(false);
    expect(saysEnough("今天很好")).toBe(false);
    expect(saysEnough("早上去市場買了很大的魚，回家煮了湯，鄰居也來一起吃。")).toBe(true);
  });
});

describe("stories gathered from her memories", () => {
  it("gathers three mornings on one subject, titled in her own words", async () => {
    const told = [];
    for (const words of TOMATOES) told.push(await memory(words));
    const { stories, moments } = await book();
    expect(stories).toEqual([
      expect.objectContaining({
        title: "I saved the",
        moment_ids: told.map((exchange) => exchange.id),
        kept: false,
      }),
    ]);
    expect(moments.every((moment) => moment.story_id === stories[0]?.id)).toBe(true);
    // Only her screened phrases went to the model, with what she was asked.
    const call = ai.calls.find((made) => made.call === "story_weave");
    expect(call?.input).toMatchObject({
      moments: [
        { id: "m1", quote: TOMATOES[0] },
        { id: "m2", quote: TOMATOES[1] },
        { id: "m3", quote: "The tomatoes finally turned." },
      ],
    });
  });

  it("weaves nothing while the switch is off", async () => {
    h.config.memoryStories = false;
    for (const words of TOMATOES) await memory(words);
    expect((await book()).stories).toEqual([]);
    expect(ai.calls.some((made) => made.call === "story_weave")).toBe(false);
  });

  it("keeps no story whose title is not her words, or that points at a moment not sent", async () => {
    h.deps.ai = createFakeAi({
      storyWeave: async () => ({
        ok: true,
        value: {
          stories: [
            { title: "Her lovely garden", title_from: "m1", moments: ["m1", "m2"] },
            { title: "tomato plants", title_from: "m2", moments: ["m2", "m9"] },
          ],
        },
        record: fakeRecord("story_weave"),
      }),
    });
    for (const words of TOMATOES) await memory(words);
    expect((await book()).stories).toEqual([]);
    expect(await h.db.select().from(memoryStories)).toEqual([]);
  });

  it("puts a moment in one story only, however often it is woven", async () => {
    for (const words of TOMATOES) await memory(words);
    expect(await weaveStories(h.deps, await her())).toBe(0);
    expect((await book()).stories).toHaveLength(1);
  });

  it("is kept when the family keeps every one of its memories", async () => {
    const told = [];
    for (const words of TOMATOES) told.push(await memory(words));
    for (const [index, exchange] of told.entries()) {
      await keepApiAnswer(h.deps, mia, `keep-${index}`, exchange.id);
    }
    expect((await book()).stories[0]).toMatchObject({ kept: true, title: "I saved the" });
  });

  it("fades with its memories when nobody keeps them", async () => {
    for (const words of TOMATOES) await memory(words);
    await h.db.update(keepSuggestions).set({ expiresAt: h.clock.now() });
    h.clock.advance(31 * 86_400_000);
    expect((await book()).stories).toEqual([]);
  });

  it("goes with her memories when she writes memories off", async () => {
    for (const words of TOMATOES) await memory(words);
    const event: InboundEvent = {
      channel: "telegram",
      eventId: "tg:stories:off",
      at: h.clock.now().toISOString(),
      kind: "text",
      text: "memories off",
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
      messageId: "801",
    };
    await handleParentCommand(h.deps, await her(), "memories_off", event);
    expect(await h.db.select().from(memoryStories)).toEqual([]);
    expect((await book()).moments).toEqual([]);
  });
});
