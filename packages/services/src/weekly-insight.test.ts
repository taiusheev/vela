import { createFakeAi, fakeRecord, type WeeklyInsight, type WeeklyInsightInput } from "@vela/ai";
import type { LocalDate, LocalTime } from "@vela/contracts";
import { zonedInstant } from "@vela/core";
import { aiCalls, answers, type Exchange, members, replies, weeklyReads } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadFamilyPage, sendWeeklyRead } from "./admin.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { applyRetention, draftWeeklyRead } from "./jobs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";
import { type InsightWeek, keptInsight } from "./weekly-insight.ts";

const TZ = "Asia/Taipei";
const FOUNDER = { admin: "founder@vela.test" };
const WEEK_END: LocalDate = "2026-09-20";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  h.config.weeklyInsight = undefined;
});
afterAll(async () => {
  await h.close();
});

function at(date: LocalDate, time: LocalTime): Date {
  return zonedInstant(date, time, TZ);
}

async function morning(
  seed: SeededFamily,
  date: LocalDate,
  ask: { askerId: string; text: string },
  words: string,
  health: string[] = [],
): Promise<Exchange> {
  const exchange = await seedExchange(h.db, seed, {
    date,
    askerId: ask.askerId,
    text: ask.text,
    state: "answered",
    deliveredAt: at(date, "08:00"),
    answeredAt: at(date, "08:20"),
  });
  await h.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: seed.member.id,
    kind: "text",
    channel: "telegram",
    externalId: `2001:${date}`,
    payload: { text: words },
    mentions: { people: [], places: [], plans: [], health, dates: [] },
    receivedAt: at(date, "08:20"),
    understoodAt: at(date, "08:20"),
  });
  return exchange;
}

async function reply(
  exchange: Exchange,
  memberId: string,
  kind: "text" | "heart",
  text: string | null,
  when: Date,
): Promise<void> {
  await h.db.insert(replies).values({
    exchangeId: exchange.id,
    memberId,
    kind,
    text,
    channel: "telegram",
    externalId: `${memberId}:${when.getTime()}`,
    createdAt: when,
  });
}

/** Mia (organiser) asks on Monday, Tom (not an organiser) on Wednesday; Tom replies in words. */
async function seededWeek() {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  await h.db
    .update(members)
    .set({ lightStartsOn: "2026-09-14" })
    .where(eq(members.id, seed.member.id));
  const tom = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Tom",
    externalId: "3001",
  });
  const monday = await morning(
    seed,
    "2026-09-14",
    { askerId: seed.organiser.id, text: "How was the market?" },
    "Busy! Auntie Lin and I bought too many pears. Don't worry about me.",
  );
  await reply(monday, tom.member.id, "text", "Save me a pear!", at("2026-09-14", "09:00"));
  await reply(monday, seed.organiser.id, "heart", null, at("2026-09-14", "09:05"));
  await morning(
    seed,
    "2026-09-16",
    { askerId: tom.member.id, text: "Did you sleep well?" },
    "My knee kept me up, but I'm fine.",
    ["knee"],
  );
  h.clock.set(at(WEEK_END, "18:00"));
  return { seed, tom };
}

const MODEL_ANSWER: WeeklyInsight = {
  readings: [
    {
      about: "elder",
      reading: "Mom may not want to be a worry.",
      // The right words with the wrong date: code finds them and puts Monday's date on them.
      quotes: [{ date: "2026-09-16", text: "Don't worry about me." }],
      sureness: "tentative",
    },
    {
      about: "elder",
      reading: "Mom may feel tired.",
      quotes: [{ date: "2026-09-16", text: "I am so tired of everything" }],
      sureness: "fairly_clear",
    },
    {
      about: "elder",
      reading: "Mom may be showing signs of depression.",
      quotes: [{ date: "2026-09-14", text: "Busy!" }],
      sureness: "tentative",
    },
  ],
  feedback: [
    {
      key: "f1",
      landed: "Your Monday question about the market got a lively answer about pears.",
      tryNext: "Ask Mom about Auntie Lin next week.",
    },
    { key: "f2", landed: "Your Wednesday question got an answer.", tryNext: "Ask again." },
  ],
};

describe("draftWeeklyRead with the weekly insight (ADR-48)", () => {
  it("gives the model her words and the family's to her by key, and keeps only what code can stand behind", async () => {
    const { seed, tom } = await seededWeek();
    h.config.weeklyInsight = true;
    let seen: WeeklyInsightInput | null = null;
    const ai = createFakeAi({
      weeklyInsight: async (input) => {
        seen = input;
        return { ok: true, value: MODEL_ANSWER, record: fakeRecord("weekly_insight") };
      },
    });

    await draftWeeklyRead({ ...h.deps, ai }, seed.member.id, WEEK_END);

    expect(seen).toMatchObject({
      lang: "en",
      elderName: "Mom",
      weekEnd: WEEK_END,
      family: [
        { key: "f1", name: "Mia", feedback: true },
        { key: "f2", name: "Tom", feedback: false },
      ],
      days: [
        {
          date: "2026-09-14",
          weekday: "Monday",
          ask: { from: "f1", type: "question", text: "How was the market?" },
          messages: [
            {
              from: "elder",
              form: "words",
              text: "Busy! Auntie Lin and I bought too many pears. Don't worry about me.",
            },
            { from: "f2", form: "words", text: "Save me a pear!" },
            { from: "f1", form: "reaction", text: "heart" },
          ],
        },
        { date: "2026-09-16", weekday: "Wednesday", ask: { from: "f2" } },
      ],
    });
    const [read] = await h.db.select().from(weeklyReads);
    expect(read?.stats).toMatchObject({
      insight: {
        readings: [
          {
            reading: "Mom may not want to be a worry.",
            quotes: [{ date: "2026-09-14", text: "Don't worry about me." }],
          },
        ],
        prompt_version: "weekly_insight.v1",
      },
      // Tom gets none: he does not receive the read.
      feedback: [
        {
          member_id: seed.organiser.id,
          landed: "Your Monday question about the market got a lively answer about pears.",
          try_next: "Ask Mom about Auntie Lin next week.",
        },
      ],
    });
    expect(JSON.stringify(read?.stats)).not.toContain(tom.member.id);
    const calls = await h.db.select().from(aiCalls).where(eq(aiCalls.call, "weekly_insight"));
    expect(calls).toHaveLength(1);
  });

  it("calls nothing and stores nothing while the switch is off", async () => {
    const { seed } = await seededWeek();

    await draftWeeklyRead(h.deps, seed.member.id, WEEK_END);

    expect(h.ai.calls.map((call) => call.call)).not.toContain("weekly_insight");
    const [read] = await h.db.select().from(weeklyReads);
    expect(read?.stats).not.toHaveProperty("insight");
    expect(read?.stats).not.toHaveProperty("feedback");
  });

  it("stores no reading or feedback when the call fails, and the read is drafted as before", async () => {
    const { seed } = await seededWeek();
    h.config.weeklyInsight = true;
    const ai = createFakeAi({
      weeklyInsight: async () => ({
        ok: false,
        value: { readings: [], feedback: [] },
        record: fakeRecord("weekly_insight", "http_500"),
        error: "http_500",
      }),
    });

    await draftWeeklyRead({ ...h.deps, ai }, seed.member.id, WEEK_END);

    const [read] = await h.db.select().from(weeklyReads);
    expect(read?.stats).toMatchObject({ answered_days: 2 });
    expect(read?.stats).not.toHaveProperty("insight");
  });
});

describe("keptInsight", () => {
  const week: InsightWeek = {
    input: {
      lang: "en",
      elderName: "Mom",
      weekEnd: WEEK_END,
      family: [
        { key: "f1", name: "Mia", feedback: true },
        { key: "f2", name: "Tom", feedback: true },
      ],
      days: [
        {
          date: "2026-09-14",
          weekday: "Monday",
          ask: { from: "f1", type: "question", text: "How was the market?" },
          messages: [
            {
              from: "elder",
              at: "08:20",
              form: "words",
              text: "My knee hurts, but   don't worry.",
            },
          ],
        },
      ],
    },
    memberOf: new Map([
      ["f1", "mia-id"],
      ["f2", "tom-id"],
    ]),
    healthWords: ["Knee"],
  };

  it("finds quotes despite spacing and case, and drops a reading whose quote is not in the week", () => {
    const kept = keptInsight(week, {
      readings: [
        {
          about: "elder",
          reading: "Mom may play down the knee.",
          quotes: [{ date: "2026-09-14", text: "but DON'T worry." }],
          sureness: "tentative",
        },
        {
          about: "between",
          reading: "Mom may echo Mia.",
          quotes: [
            { date: "2026-09-14", text: "How was the market?" },
            { date: "2026-09-14", text: "made up" },
          ],
          sureness: "tentative",
        },
      ],
      feedback: [],
    });
    expect(kept.readings.map((reading) => reading.reading)).toEqual([
      "Mom may play down the knee.",
    ]);
  });

  it("drops feedback that holds her health word, another family member's name, or a clinical word", () => {
    const kept = keptInsight(week, {
      readings: [],
      feedback: [
        { key: "f1", landed: "Your question reached Mom.", tryNext: "Ask about her knee." },
        { key: "f2", landed: "Your reply came after Mia's.", tryNext: "Ask about the market." },
      ],
    });
    expect(kept.feedback).toEqual([]);
    expect(
      keptInsight(week, {
        readings: [],
        feedback: [
          { key: "f1", landed: "Your question reached Mom.", tryNext: "Ask about the market." },
          { key: "f9", landed: "Nobody.", tryNext: "Nothing." },
        ],
      }).feedback,
    ).toEqual([
      {
        member_id: "mia-id",
        landed: "Your question reached Mom.",
        try_next: "Ask about the market.",
      },
    ]);
  });
});

describe("the insight on the page, in the send, and after 30 days", () => {
  const STATS = {
    counted_days: 7,
    answered_days: 2,
    hello_mornings: 0,
    family_asks: 2,
    usual_time: "08:20",
    topics: [],
    patterns: [],
    family_patterns: [],
    insight: {
      readings: [
        {
          about: "elder",
          reading: "Mom may not want to be a worry.",
          quotes: [{ date: "2026-09-14", text: "Don't worry about me." }],
          sureness: "tentative",
        },
      ],
      prompt_version: "weekly_insight.v1",
    },
  };

  async function readWithFeedback(seed: SeededFamily, organiserId: string): Promise<string> {
    const [row] = await h.db
      .insert(weeklyReads)
      .values({
        familyId: seed.family.id,
        memberId: seed.member.id,
        weekStart: "2026-09-14",
        lines: ["Mom went to the market with Auntie Lin."],
        suggestion: "Ask about the pears.",
        stats: {
          ...STATS,
          feedback: [
            {
              member_id: organiserId,
              landed: "Your Monday ask landed.",
              try_next: "Ask about pears.",
            },
          ],
        },
        promptVersion: "weekly_read.v5",
        createdAt: h.clock.now(),
      })
      .returning({ id: weeklyReads.id });
    if (row === undefined) throw new Error("no read");
    return row.id;
  }

  it("shows the readings and each receiving organiser's draft on the page, and sends feedback only in its organiser's copy", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const ben = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Ben",
      externalId: "1002",
      role: "organiser",
    });
    const readId = await readWithFeedback(seed, seed.organiser.id);
    h.clock.set(at(WEEK_END, "19:00"));

    const page = await loadFamilyPage(h.deps, FOUNDER, seed.family.id);
    const entry = page?.weeklyReads.find((candidate) => candidate.read.id === readId);
    expect(entry?.readings.map((reading) => reading.reading)).toEqual([
      "Mom may not want to be a worry.",
    ]);
    expect(entry?.feedback).toEqual([
      {
        memberId: seed.organiser.id,
        name: "Mia",
        text: "Your Monday ask landed.\nAsk about pears.",
      },
      { memberId: ben.member.id, name: "Ben", text: "" },
    ]);

    expect(
      await sendWeeklyRead(h.deps, FOUNDER, {
        weeklyReadId: readId,
        lines: ["Mom went to the market with Auntie Lin."],
        suggestion: "Ask about the pears.",
        feedback: {
          [seed.organiser.id]: "Your Monday ask landed.\nAsk about pears.",
          [ben.member.id]: "",
        },
      }),
    ).toBe("sent");
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });

    const toMia = h.telegram.sentTo("1001")[0]?.message.text ?? "";
    const toBen = h.telegram.sentTo("1002")[0]?.message.text ?? "";
    expect(toMia).toContain(
      "Just for you, Mia, about your own messages this week:\nYour Monday ask landed.\nAsk about pears.",
    );
    expect(toBen).toContain("Mom went to the market with Auntie Lin.");
    expect(toBen).not.toContain("Just for you");
    expect(toBen).not.toContain("Monday ask");
    // The readings are the founder's only: in no organiser's message.
    expect(`${toMia}\n${toBen}`).not.toContain("worry");
    const [read] = await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, readId));
    expect(read?.stats).toMatchObject({ feedback_sent: 1 });
  });

  it("clears the readings and feedback 30 days after the week ends, keeping the rest of the read", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const readId = await readWithFeedback(seed, seed.organiser.id);
    const stats = async () =>
      (await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, readId)))[0]?.stats;

    h.clock.set(new Date("2026-10-19T12:00:00Z"));
    expect((await applyRetention(h.deps)).weekly_insights_cleared).toBe(0);
    expect(await stats()).toHaveProperty("insight");

    h.clock.set(new Date("2026-10-21T12:00:00Z"));
    expect((await applyRetention(h.deps)).weekly_insights_cleared).toBe(1);
    const after = await stats();
    expect(after).not.toHaveProperty("insight");
    expect(after).not.toHaveProperty("feedback");
    expect(after).toMatchObject({ answered_days: 2, family_asks: 2 });
  });
});
