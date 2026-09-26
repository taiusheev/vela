import { createFakeAi, createOffAi, fakeRecord, type SuggestInput } from "@vela/ai";
import type { LocalDate } from "@vela/contracts";
import { ASK_BANK, type AskBankType, askBankItem, askBankText } from "@vela/copy";
import { addDays, localDateOf, weekdayOf } from "@vela/core";
import { aiCalls, answers, exchanges, families, type Member, members, suggestions } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BANK_PROMPT_VERSION,
  type BankPickInput,
  pickBankItem,
  renderSuggestion,
  SUGGESTION_REPEAT_DAYS,
  SUGGESTION_ROTATION,
  type SuggestedDay,
  writeSuggestionFor,
  writeSuggestions,
} from "./suggestions.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

const MEMBER = "01990000-0000-7000-8000-00000000a001";
/** A Monday, when the rotation proposes a story. */
const MONDAY: LocalDate = "2026-09-14";

function pick(overrides: Partial<BankPickInput> = {}) {
  return pickBankItem({
    memberId: MEMBER,
    forDate: MONDAY,
    storyDay: 0,
    recent: [],
    used: [],
    family: [],
    recentAskTypes: [],
    ...overrides,
  });
}

/** Her picks for `days` days from `from`, each fed back in as the history of the next. */
function simulate(
  memberId: string,
  from: LocalDate,
  days: number,
  options: { recentAskTypes?: BankPickInput["recentAskTypes"]; storyDay?: number } = {},
): SuggestedDay[] {
  const recent: SuggestedDay[] = [];
  for (let day = 0; day < days; day += 1) {
    const forDate = addDays(from, day);
    const item = pickBankItem({
      memberId,
      forDate,
      storyDay: options.storyDay ?? 0,
      recent,
      used: [],
      family: [],
      recentAskTypes: options.recentAskTypes ?? [],
    });
    recent.push({ bankId: item.id, localDay: forDate });
  }
  return recent;
}

function typeOf(bankId: string): AskBankType | undefined {
  return askBankItem(bankId)?.type;
}

function memberId(index: number): string {
  return `01990000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("pickBankItem", () => {
  it("picks the same item for the same member, day and history", () => {
    expect(pick().id).toBe(pick().id);
  });

  it("gives members different items on the same day", () => {
    const picked = new Set(
      Array.from({ length: 20 }, (_, index) => pick({ memberId: memberId(index) }).id),
    );
    expect(picked.size).toBeGreaterThanOrEqual(5);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])("proposes the rotation's type on weekday %i", (weekday) => {
    const forDate = addDays("2026-09-13", weekday);
    expect(weekdayOf(forDate)).toBe(weekday);
    expect(pick({ forDate, storyDay: 3 }).type).toBe(SUGGESTION_ROTATION[weekday]);
  });

  it("repeats no item or near-duplicate in 42 days running, fed its own picks", () => {
    for (const index of [1, 2, 3, 4, 5]) {
      const picks = simulate(memberId(index), MONDAY, SUGGESTION_REPEAT_DAYS);
      const groups = picks.map((day) => askBankItem(day.bankId)?.group);
      expect(new Set(groups).size, memberId(index)).toBe(SUGGESTION_REPEAT_DAYS);
    }
  });

  it("gives an item again only once 42 days have passed", () => {
    const picks = simulate(memberId(7), MONDAY, 100);
    for (const [index, day] of picks.entries()) {
      const group = askBankItem(day.bankId)?.group;
      const earlier = picks
        .slice(0, index)
        .filter((other) => askBankItem(other.bankId)?.group === group);
      for (const other of earlier) {
        expect(day.localDay >= addDays(other.localDay, SUGGESTION_REPEAT_DAYS), day.bankId).toBe(
          true,
        );
      }
    }
  });

  // The app composes a story or a recipe as a question too, so a question asked every day must not
  // push the rotation off its week: six weeks of it keep three questions, two stories, a recipe and
  // a word a week, give or take one.
  it("keeps the weekly mix through six weeks of a question asked every morning", () => {
    const expected: Record<AskBankType, number> = { question: 3, story: 2, recipe: 1, word: 1 };
    for (const index of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const picks = simulate(memberId(index), "2026-09-13", SUGGESTION_REPEAT_DAYS, {
        recentAskTypes: ["question", "question"],
      });
      for (let week = 0; week < 6; week += 1) {
        const days = picks.slice(week * 7, week * 7 + 7);
        for (const [type, count] of Object.entries(expected)) {
          const found = days.filter((day) => typeOf(day.bankId) === type).length;
          expect(
            Math.abs(found - count),
            `${memberId(index)} week ${week} ${type}`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("moves a recipe day on to the next type when a recipe was asked the day before", () => {
    const wednesday = addDays(MONDAY, 2);
    expect(pick({ forDate: wednesday }).type).toBe("recipe");
    expect(pick({ forDate: wednesday, recentAskTypes: ["recipe"] }).type).toBe("story");
    expect(pick({ forDate: wednesday, recentAskTypes: ["recipe", "story"] }).type).toBe("question");
  });

  it("never moves a day off a question because a question was asked", () => {
    const tuesday = addDays(MONDAY, 1);
    expect(pick({ forDate: tuesday, recentAskTypes: ["question", "question"] }).type).toBe(
      "question",
    );
  });

  it("gives no story on the family's story day", () => {
    expect(pick({ storyDay: 0 }).type).toBe("story");
    expect(pick({ storyDay: 1 }).type).toBe("question");
  });

  // Her day's topic is compared with an item of another type, so leaving the rule out would leave
  // the day's candidates, and so its pick, exactly as they are without that history.
  it("keeps a topic off the two days either side of a day that had it", () => {
    let compared = 0;
    for (let index = 0; index < 20; index += 1) {
      const base = pick({ memberId: memberId(index) });
      const sameTopic = ASK_BANK.find(
        (item) => item.topic === base.topic && item.type !== base.type && item.group !== base.group,
      );
      if (sameTopic === undefined) continue;
      compared += 1;
      for (const offset of [-2, -1, 1, 2]) {
        const recent = [{ bankId: sameTopic.id, localDay: addDays(MONDAY, offset) }];
        expect(pick({ memberId: memberId(index), recent }).topic, `${offset}`).not.toBe(base.topic);
      }
      const recent = [{ bankId: sameTopic.id, localDay: addDays(MONDAY, -3) }];
      expect(pick({ memberId: memberId(index), recent }).id).toBe(base.id);
    }
    expect(compared).toBeGreaterThanOrEqual(5);
  });

  it("never gives what an ask was composed from, at any age", () => {
    const first = pick();
    expect(pick({ used: [first.id] }).group).not.toBe(first.group);
  });

  // Every question of no group was given in the last weeks, so only the near-duplicates are left.
  it("gives no near-duplicate of an item she was given or an ask was composed from", () => {
    const tuesday = addDays(MONDAY, 1);
    const solo = ASK_BANK.filter((item) => item.type === "question" && item.group === item.id);
    const recent = solo.map((item, index) => ({
      bankId: item.id,
      localDay: addDays(tuesday, -10 - index),
    }));
    const firstJob = ["life.work.first_day", "life.work.first_job", "opinions.advice.first_job"];
    const teacher = ["life.school.teacher", "life.work.teacher"];
    const picked = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      const item = pick({
        forDate: tuesday,
        memberId: memberId(index),
        recent: [...recent, { bankId: "life.work.teacher", localDay: addDays(tuesday, -5) }],
        used: ["life.work.first_day"],
      });
      picked.add(item.id);
      expect([...firstJob, ...teacher]).not.toContain(item.id);
    }
    expect(picked).toEqual(new Set(["life.place.street"]));
  });

  it("keeps apart what the family's other members were given within a week", () => {
    const first = pick();
    expect(pick({ family: [{ bankId: first.id, localDay: MONDAY }] }).group).not.toBe(first.group);
    expect(pick({ family: [{ bankId: first.id, localDay: addDays(MONDAY, -7) }] }).group).not.toBe(
      first.group,
    );
    expect(pick({ family: [{ bankId: first.id, localDay: addDays(MONDAY, -8) }] }).id).toBe(
      first.id,
    );
  });

  it("takes another type when the rotation's type has nothing left", () => {
    const recipes = ASK_BANK.filter((item) => item.type === "recipe");
    const wednesday = addDays(MONDAY, 2);
    const picked = pick({
      forDate: wednesday,
      recent: recipes.map((item, index) => ({
        bankId: item.id,
        localDay: addDays(wednesday, -1 - index * 3),
      })),
    });
    expect(picked.type).not.toBe("recipe");
  });

  it("still gives an item when every item is excluded: the one she has gone longest without", () => {
    const everything = ASK_BANK.map((item) => ({ bankId: item.id, localDay: MONDAY }));
    const byId = [...ASK_BANK].sort((a, b) => a.id.localeCompare(b.id));
    const [first, second] = byId;
    expect(pick({ family: everything }).id).toBe(first?.id);
    const recent = byId.map((item, index) => ({
      bankId: item.id,
      localDay: addDays(MONDAY, -100 + index),
    }));
    expect(pick({ family: everything, recent }).id).toBe(first?.id);
    expect(pick({ family: everything, recent, used: [first?.id ?? ""] }).id).toBe(second?.id);
  });
});

describe("renderSuggestion", () => {
  const bankRow = {
    bankId: "knowledge.food.soup",
    type: "recipe",
    text: "",
    lang: null,
    source: {},
  } as const;

  it("shows a bank row in each reader's language, English for a language the bank lacks", () => {
    expect(renderSuggestion(bankRow, "en")).toEqual({
      text: askBankText("knowledge.food.soup", "en"),
      type: "recipe",
      fromHerWords: false,
    });
    expect(renderSuggestion(bankRow, "zh-TW")?.text).toBe("天氣變冷的時候，您會煮什麼湯？");
    expect(renderSuggestion(bankRow, "ja")?.text).toBe(askBankText("knowledge.food.soup", "en"));
  });

  it("shows an AI draft to a reader of its language, and its bank item to anyone else", () => {
    const aiRow = {
      ...bankRow,
      type: "question",
      text: "What soup did Auntie Lin teach you?",
      lang: "en",
      source: { ai_source: "mention" },
    } as const;
    expect(renderSuggestion(aiRow, "en")).toEqual({
      text: "What soup did Auntie Lin teach you?",
      type: "question",
      fromHerWords: true,
    });
    expect(renderSuggestion(aiRow, "zh-TW")).toEqual({
      text: "天氣變冷的時候，您會煮什麼湯？",
      type: "recipe",
      fromHerWords: false,
    });
    expect(
      renderSuggestion({ ...aiRow, source: { ai_source: "rotation" } }, "en")?.fromHerWords,
    ).toBe(false);
  });

  it("shows the bank item once retention has cleared a draft, and nothing for an unknown id", () => {
    expect(renderSuggestion({ ...bankRow, lang: "en", text: "" }, "en")?.text).toBe(
      askBankText("knowledge.food.soup", "en"),
    );
    expect(renderSuggestion({ ...bankRow, bankId: "life.unknown.item" }, "en")).toBeNull();
  });
});

let h: Harness;
let seed: SeededFamily;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: addMinutesAgo(60 * 24 * 3) });
  h.deps.ai = createOffAi();
});

afterAll(async () => {
  await h.close();
});

function addMinutesAgo(minutes: number): Date {
  return new Date(h.clock.now().getTime() - minutes * 60_000);
}

function today(): LocalDate {
  return localDateOf(h.clock.now(), seed.member.tz);
}

async function rows() {
  return h.db
    .select()
    .from(suggestions)
    .orderBy(asc(suggestions.aboutMemberId), asc(suggestions.localDay));
}

/** Another family with its own organiser and kept-light member, changed as given. */
async function otherFamily(index: number, change: Partial<Member> = {}): Promise<SeededFamily> {
  const other = await seedFamily(h.db, {
    now: addMinutesAgo(60 * 24 * 3),
    familyName: `Family ${index}`,
    organiserExternalId: `30${index}1`,
    memberExternalId: `30${index}2`,
  });
  if (Object.keys(change).length > 0) {
    await h.db.update(members).set(change).where(eq(members.id, other.member.id));
  }
  return other;
}

describe("writeSuggestions", () => {
  it("writes her next three days from the bank, with no words, while AI is off", async () => {
    const run = await writeSuggestions(h.deps);

    expect(run).toEqual({ written: 3, existing: 0, claimed: 0, inactive: 0, failed: 0 });
    const written = await rows();
    expect(written.map((row) => row.localDay)).toEqual([
      addDays(today(), 1),
      addDays(today(), 2),
      addDays(today(), 3),
    ]);
    for (const row of written) {
      expect(row).toMatchObject({
        familyId: seed.family.id,
        forMemberId: null,
        aboutMemberId: seed.member.id,
        text: "",
        lang: null,
        source: {},
        promptVersion: BANK_PROMPT_VERSION,
        usedAt: null,
      });
      expect(row.type).toBe(askBankItem(row.bankId)?.type);
    }
    expect(new Set(written.map((row) => row.bankId)).size).toBe(3);
    expect(await h.db.select().from(aiCalls)).toEqual([]);
    expect(h.logger.entries.filter((entry) => entry.level !== "info")).toEqual([]);
  });

  it("writes nothing for a member who is invited or paused, keeps no light, never consented, or left, or in a family that ended", async () => {
    await otherFamily(6, { status: "invited" });
    await otherFamily(1, { status: "paused" });
    await otherFamily(2, { lightOn: false });
    await otherFamily(3, { lightConsentedAt: null });
    await otherFamily(4, { leftAt: addMinutesAgo(10) });
    const deleted = await otherFamily(5);
    await h.db
      .update(families)
      .set({ deletedAt: addMinutesAgo(10) })
      .where(eq(families.id, deleted.family.id));

    const run = await writeSuggestions(h.deps);

    expect(run.written).toBe(3);
    expect(new Set((await rows()).map((row) => row.aboutMemberId))).toEqual(
      new Set([seed.member.id]),
    );
  });

  it("changes nothing on a second run, which finds every day written", async () => {
    await writeSuggestions(h.deps);
    const first = await rows();

    const run = await writeSuggestions(h.deps);

    expect(run).toEqual({ written: 0, existing: 3, claimed: 0, inactive: 0, failed: 0 });
    expect(await rows()).toEqual(first);
  });

  it("writes the new day once the night moves on, and leaves the days already written", async () => {
    await writeSuggestions(h.deps);
    const first = await rows();
    h.clock.advanceMinutes(24 * 60);

    const run = await writeSuggestions(h.deps);

    expect(run).toEqual({ written: 1, existing: 2, claimed: 0, inactive: 0, failed: 0 });
    const second = await rows();
    expect(second.slice(0, 3)).toEqual(first);
    expect(second[3]?.localDay).toBe(addDays(first[2]?.localDay ?? "", 1));
    expect(new Set(second.map((row) => askBankItem(row.bankId)?.group)).size).toBe(4);
  });

  it("writes nothing for a day an ask has claimed, and a withdrawn ask claims nothing", async () => {
    await seedExchange(h.db, seed, { date: addDays(today(), 1), state: "composed" });
    await seedExchange(h.db, seed, { date: addDays(today(), 2), state: "withdrawn" });

    const run = await writeSuggestions(h.deps);

    expect(run).toEqual({ written: 2, existing: 0, claimed: 1, inactive: 0, failed: 0 });
    expect((await rows()).map((row) => row.localDay)).toEqual([
      addDays(today(), 2),
      addDays(today(), 3),
    ]);
  });

  it("moves her day off a recipe when a recipe was asked for the day before", async () => {
    // Tomorrow is a Tuesday (a question), the day after a Wednesday (a recipe).
    expect(weekdayOf(addDays(today(), 2))).toBe(3);
    await seedExchange(h.db, seed, {
      date: addDays(today(), 1),
      state: "composed",
      type: "recipe",
    });

    await writeSuggestions(h.deps);

    const wednesday = (await rows()).find((row) => row.localDay === addDays(today(), 2));
    expect(wednesday?.type).toBe("story");
  });

  it("gives two kept-light members of one family different items", async () => {
    const [dad] = await h.db
      .insert(members)
      .values({
        familyId: seed.family.id,
        displayName: "Dad",
        tz: seed.member.tz,
        country: "TW",
        status: "active",
        lightOn: true,
        lightConsentedAt: addMinutesAgo(60 * 24 * 3),
      })
      .returning();
    if (dad === undefined) throw new Error("expected a second kept-light member");

    const run = await writeSuggestions(h.deps);

    expect(run.written).toBe(6);
    const written = await rows();
    const groups = written.map((row) => askBankItem(row.bankId)?.group);
    expect(new Set(groups).size).toBe(6);
  });

  it("never gives her an item an ask was once composed from", async () => {
    const tomorrow = addDays(today(), 1);
    const first = pickBankItem({
      memberId: seed.member.id,
      forDate: tomorrow,
      storyDay: seed.family.storyDay,
      recent: [],
      used: [],
      family: [],
      recentAskTypes: [],
    });
    await h.db.insert(suggestions).values({
      familyId: seed.family.id,
      aboutMemberId: seed.member.id,
      localDay: addDays(today(), -200),
      bankId: first.id,
      type: first.type,
      text: "",
      promptVersion: BANK_PROMPT_VERSION,
      usedAt: addMinutesAgo(60 * 24 * 200),
    });

    await writeSuggestions(h.deps);

    const written = (await rows()).find((row) => row.localDay === tomorrow);
    expect(askBankItem(written?.bankId ?? "")?.group).not.toBe(first.group);
  });

  it("logs a member it cannot read and still writes everyone else", async () => {
    const broken = await otherFamily(1, { tz: "Mars/Olympus_Mons" });

    const run = await writeSuggestions(h.deps);

    expect(run).toEqual({ written: 3, existing: 0, claimed: 0, inactive: 0, failed: 1 });
    expect(h.logger.entries).toContainEqual({
      level: "error",
      event: "suggestion_failed",
      fields: { memberId: broken.member.id, error: expect.stringMatching(/^RangeError/) },
    });
    expect(new Set((await rows()).map((row) => row.aboutMemberId))).toEqual(
      new Set([seed.member.id]),
    );
  });
});

describe("writeSuggestions with AI on", () => {
  beforeEach(() => {
    h.deps.ai = h.ai;
  });

  function suggestCalls(): SuggestInput[] {
    return h.ai.calls
      .filter((call) => call.call === "suggest")
      .map((call) => call.input as SuggestInput);
  }

  it("keeps the model's draft in the first organiser's language and logs each call by ids", async () => {
    const run = await writeSuggestions(h.deps);

    expect(run.written).toBe(3);
    const written = await rows();
    for (const row of written) {
      expect(row).toMatchObject({
        text: "Mom, what are you doing today?",
        lang: "en",
        source: { ai_source: "rotation" },
        promptVersion: fakeRecord("suggest").promptVersion,
      });
      expect(row.bankId).not.toBe("");
    }
    const calls = await h.db.select().from(aiCalls).orderBy(asc(aiCalls.at), asc(aiCalls.id));
    expect(calls.map((call) => call.inputRef)).toEqual(
      written.map((row) => ({
        member_id: seed.member.id,
        for_date: row.localDay,
        bank_id: row.bankId,
      })),
    );
    expect(calls.every((call) => call.call === "suggest" && call.ok)).toBe(true);
    expect(suggestCalls()[0]).toEqual({
      lang: "en",
      holderName: "Mia",
      recipientAddress: "Mom",
      forDate: addDays(today(), 1),
      rotationType: askBankItem(written[0]?.bankId ?? "")?.type,
      recentMentions: [],
      familyDates: [],
      holderLastAsk: null,
    });
  });

  it("writes for the first organiser in their language, English when the bank has none of theirs", async () => {
    await h.db.update(members).set({ language: "zh-TW" }).where(eq(members.id, seed.organiser.id));
    await seedGroupMember(h.db, seed, {
      now: addMinutesAgo(60),
      name: "Leo",
      externalId: "1009",
      role: "organiser",
    });

    await writeSuggestions(h.deps);

    expect(suggestCalls().map((input) => [input.lang, input.holderName])).toEqual([
      ["zh-TW", "Mia"],
      ["zh-TW", "Mia"],
      ["zh-TW", "Mia"],
    ]);
    expect((await rows()).map((row) => row.lang)).toEqual(["zh-TW", "zh-TW", "zh-TW"]);

    await h.reset();
    seed = await seedFamily(h.db, { now: addMinutesAgo(60 * 24 * 3) });
    h.deps.ai = h.ai;
    await h.db.update(members).set({ language: "ja" }).where(eq(members.id, seed.organiser.id));
    await writeSuggestions(h.deps);
    expect(suggestCalls().map((input) => input.lang)).toEqual(["en", "en", "en"]);
  });

  it("gives the model the people, places and plans she mentioned lately, never her health or dates, and her last ask", async () => {
    const answered = await seedExchange(h.db, seed, {
      date: today(),
      state: "answered",
      text: "What did you do this morning?",
    });
    await h.db.insert(answers).values([
      {
        exchangeId: answered.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "2001:1",
        mentions: {
          people: ["Auntie Lin", "Auntie Lin"],
          places: ["the market"],
          plans: ["dumplings on Sunday"],
          health: ["my knee"],
          dates: [{ date: "2026-09-20", label: "Mia's birthday" }],
        },
        receivedAt: addMinutesAgo(60),
      },
      {
        exchangeId: answered.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "2001:2",
        mentions: { people: ["the old neighbour"] },
        receivedAt: addMinutesAgo(60 * 24 * 15),
      },
    ]);

    await writeSuggestions(h.deps);

    const [input] = suggestCalls();
    expect(input?.recentMentions).toEqual(["Auntie Lin", "the market", "dumplings on Sunday"]);
    expect(input?.holderLastAsk).toEqual({
      type: "question",
      text: "What did you do this morning?",
    });
  });

  it.each([
    ["a type that needs photos", { type: "photo_choice", text: "Which of these two?" }],
    ["no words", { type: "question", text: "   " }],
    ["a check on how she is", { type: "question", text: "Are you feeling OK today?" }],
    ["a check on how she is, in Chinese", { type: "question", text: "您身體還好嗎？" }],
    ["a gendered pronoun", { type: "question", text: "What did she cook today?" }],
    ["surveillance words", { type: "question", text: "Can we keep an eye on the garden?" }],
  ] as const)(
    "keeps the bank item for a draft with %s, and logs the call",
    async (_name, draft) => {
      h.deps.ai = createFakeAi({
        suggest: async () => ({
          ok: true,
          value: { ...draft, source: "mention" },
          record: fakeRecord("suggest"),
        }),
      });

      const run = await writeSuggestions(h.deps);

      expect(run.written).toBe(3);
      for (const row of await rows()) {
        expect(row).toMatchObject({
          text: "",
          lang: null,
          source: {},
          promptVersion: BANK_PROMPT_VERSION,
        });
        expect(row.type).toBe(askBankItem(row.bankId)?.type);
      }
      expect(await h.db.select().from(aiCalls)).toHaveLength(3);
    },
  );

  it("keeps the bank item when the call fails or throws, and says so", async () => {
    h.deps.ai = createFakeAi({
      suggest: async (input) =>
        input.forDate === addDays(today(), 1)
          ? {
              ok: false,
              value: { type: input.rotationType, text: "", source: "rotation" },
              record: fakeRecord("suggest", "http_529"),
              error: "http_529",
            }
          : Promise.reject(new TypeError("the provider broke")),
    });

    const run = await writeSuggestions(h.deps);

    expect(run.written).toBe(3);
    expect((await rows()).every((row) => row.text === "" && row.lang === null)).toBe(true);
    expect(h.logger.entries.filter((entry) => entry.event === "suggestion_ai_failed")).toEqual([
      {
        level: "warn",
        event: "suggestion_ai_failed",
        fields: { memberId: seed.member.id, forDate: addDays(today(), 1), error: "http_529" },
      },
      {
        level: "warn",
        event: "suggestion_ai_failed",
        fields: { memberId: seed.member.id, forDate: addDays(today(), 2), error: "TypeError" },
      },
      {
        level: "warn",
        event: "suggestion_ai_failed",
        fields: { memberId: seed.member.id, forDate: addDays(today(), 3), error: "TypeError" },
      },
    ]);
    const calls = await h.db.select().from(aiCalls);
    expect(calls.map((call) => [call.ok, call.output])).toEqual([[false, null]]);
  });

  // Each of these lands while the model is drafting, between the reads and the write.
  it.each([
    [
      "claimed",
      async (forDate: LocalDate) => {
        await seedExchange(h.db, seed, { date: forDate, state: "composed" });
      },
    ],
    [
      "existing",
      async (forDate: LocalDate) => {
        await h.db.insert(suggestions).values({
          familyId: seed.family.id,
          aboutMemberId: seed.member.id,
          localDay: forDate,
          bankId: "life.family.name",
          type: "story",
          text: "",
          promptVersion: BANK_PROMPT_VERSION,
        });
      },
    ],
    [
      "inactive",
      async () => {
        await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
      },
    ],
  ] as const)("logs a paid call for a day that turned out %s", async (outcome, landing) => {
    const forDate = addDays(today(), 1);
    h.deps.ai = createFakeAi({
      suggest: async (input) => {
        await landing(input.forDate);
        return {
          ok: true,
          value: { type: "question", text: "What is growing in the garden?", source: "rotation" },
          record: fakeRecord("suggest"),
        };
      },
    });

    expect(await writeSuggestionFor(h.deps, seed.member.id, forDate)).toBe(outcome);

    const stored = await rows();
    expect(stored.filter((row) => row.bankId !== "life.family.name")).toEqual([]);
    const calls = await h.db.select().from(aiCalls);
    expect(calls.map((call) => call.inputRef)).toEqual([
      { member_id: seed.member.id, for_date: forDate, bank_id: expect.any(String) },
    ]);
  });
});

describe("writeSuggestionFor", () => {
  it("writes nothing for a member who cannot be asked", async () => {
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));

    expect(await writeSuggestionFor(h.deps, seed.member.id, addDays(today(), 1))).toBe("inactive");
    expect(await writeSuggestionFor(h.deps, seed.organiser.id, addDays(today(), 1))).toBe(
      "inactive",
    );
    expect(await rows()).toEqual([]);
  });

  it("writes one day, and finds it written the second time", async () => {
    const forDate = addDays(today(), 1);

    expect(await writeSuggestionFor(h.deps, seed.member.id, forDate)).toBe("written");
    expect(await writeSuggestionFor(h.deps, seed.member.id, forDate)).toBe("existing");
    expect(await rows()).toHaveLength(1);
    expect(await h.db.select().from(exchanges)).toEqual([]);
  });
});
