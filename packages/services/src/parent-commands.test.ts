import {
  type Ai,
  type AiOutcome,
  createFakeAi,
  fakeRecord,
  SAFE_DEFAULTS,
  type Translation,
} from "@vela/ai";
import type { InboundEvent, Lang, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { parseParentCommand } from "@vela/core";
import {
  answers,
  events,
  families,
  type Member,
  members,
  outbound,
  translations,
  weeklyReads,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleParentCommand } from "./parent-commands.ts";
import { understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

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

const HER = "2001";
const ORGANISER = "1001";

let sequence = 0;

function said(text: string, extra: Partial<InboundEvent> = {}): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    kind: "text",
    sender: { externalUserId: HER },
    conversation: { externalId: HER, kind: "private" },
    messageId: String(sequence),
    text,
    ...extra,
  };
}

/** The words as she would type them, through core's matcher, then the handler. */
async function say(member: Member, text: string, extra: Partial<InboundEvent> = {}): Promise<void> {
  const command = parseParentCommand(text);
  if (command === null) {
    throw new Error(`not a command: ${text}`);
  }
  await handleParentCommand(h.deps, member, command, said(text, extra));
}

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function herRow(seed: SeededFamily): Promise<Member> {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (row === undefined) {
    throw new Error("her row is gone");
  }
  return row;
}

async function outboundRows() {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventNames(): Promise<string[]> {
  const rows = await h.db.select({ name: events.name }).from(events).orderBy(asc(events.id));
  return rows.map((row) => row.name);
}

async function herMessages(): Promise<string[]> {
  await h.run(handlers());
  return h.telegram.sentTo(HER).map((entry) => entry.message.text);
}

/** An answered morning on `date` whose answer, `text`, was understood into `summary`. */
async function answeredDay(
  seed: SeededFamily,
  date: LocalDate,
  summary: string | null,
  text = "...",
): Promise<string> {
  const deliveredAt = new Date(`${date}T00:00:00Z`);
  const answeredAt = new Date(`${date}T01:00:00Z`);
  const exchange = await seedExchange(h.db, seed, {
    date,
    state: "answered",
    deliveredAt,
    answeredAt,
    createdAt: deliveredAt,
  });
  const [answer] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: `${HER}:${date}`,
      payload: { text },
      summary,
      receivedAt: answeredAt,
    })
    .returning({ id: answers.id });
  if (answer === undefined) {
    throw new Error("answer insert returned no row");
  }
  return answer.id;
}

async function sentWeeklyRead(
  seed: SeededFamily,
  options: { lines: string[]; sentAt: Date | null; suggestion?: string; weekStart?: LocalDate },
): Promise<string> {
  const [row] = await h.db
    .insert(weeklyReads)
    .values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      weekStart: options.weekStart ?? "2026-09-07",
      lines: ["A draft line the founder rewrote"],
      suggestion: "A draft suggestion",
      stats: { counted_days: 7, answered_days: 5, hello_mornings: 2, family_asks: 5 },
      promptVersion: "weekly_read.v4",
      createdAt: options.sentAt ?? h.clock.now(),
      sentLines: options.sentAt === null ? null : options.lines,
      sentSuggestion:
        options.sentAt === null ? null : (options.suggestion ?? "Ask about the garden"),
      sentAt: options.sentAt,
    })
    .returning({ id: weeklyReads.id });
  if (row === undefined) {
    throw new Error("weekly read insert returned no row");
  }
  return row.id;
}

describe("stop", () => {
  it("pauses her, clears her scheduler, tells her and the organiser, and records the event once", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db
      .update(members)
      .set({ nextWakeAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    const stop = said("stop");

    await handleParentCommand(h.deps, seed.member, "stop", stop);
    await handleParentCommand(h.deps, seed.member, "stop", stop);

    expect(await herRow(seed)).toMatchObject({ status: "paused", nextWakeAt: null, lightOn: true });
    expect(h.scheduler.wakes.get(seed.member.id)).toBeNull();
    const rows = await outboundRows();
    expect(rows.map((row) => [row.kind, row.conversationId])).toEqual([
      ["system", HER],
      ["system", ORGANISER],
    ]);
    await h.run(handlers());
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      t("en", "parent.stopped"),
    ]);
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      "Mom asked to pause. Nothing is wrong with the app.",
    ]);
    expect(await eventNames()).toEqual(["stop_said"]);
  });

  it("only repeats her reply when she is already paused", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await say(seed.member, "stop");

    await say(await herRow(seed), "pause");

    expect((await outboundRows()).map((row) => row.conversationId)).toEqual([HER, ORGANISER, HER]);
    expect(await eventNames()).toEqual(["stop_said"]);
  });

  it("understands 停 from a Traditional Chinese speaker", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), language: "zh-TW" });

    await say(seed.member, "停");

    expect((await herRow(seed)).status).toBe("paused");
    expect(await herMessages()).toEqual([t("zh-TW", "parent.stopped")]);
    expect(h.telegram.sentTo(ORGANISER)[0]?.message.text).toBe(
      t("zh-TW", "organiser.stopped", { name: "Mom" }),
    );
  });
});

describe("start", () => {
  it("resumes only when she paused, from today at the earliest, and ticks her", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await say(seed.member, "stop");
    await h.db
      .update(members)
      .set({ lightStartsOn: "2026-09-01" })
      .where(eq(members.id, seed.member.id));
    h.clock.advanceMinutes(90);

    await say(await herRow(seed), "start");

    expect(await herRow(seed)).toMatchObject({ status: "active", lightStartsOn: "2026-09-14" });
    // The tick runs at once, so this morning, still inside its window, goes out with the welcome.
    expect(await herMessages()).toEqual([
      t("en", "parent.stopped"),
      "Welcome back. Your next morning arrives at 08:00.",
      expect.stringContaining(t("en", "arrival.greeting", { address: "Mrs Chen" })),
    ]);
    expect(await eventNames()).toEqual([
      "stop_said",
      "start_said",
      "exchange_prepared",
      "arrival_delivered",
    ]);
    expect(h.scheduler.wakes.get(seed.member.id)).not.toBeNull();
  });

  it("keeps a start date that is still ahead", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await say(seed.member, "stop");
    await h.db
      .update(members)
      .set({ lightStartsOn: "2026-09-20" })
      .where(eq(members.id, seed.member.id));

    await say(await herRow(seed), "resume");

    expect((await herRow(seed)).lightStartsOn).toBe("2026-09-20");
  });

  it("does nothing while she is active, and nothing more on a redelivered start", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await say(seed.member, "start");
    expect(await outboundRows()).toHaveLength(0);
    expect(await eventNames()).toEqual([]);
    expect(h.scheduler.history).toHaveLength(0);

    await say(seed.member, "stop");
    const start = said("start");
    await handleParentCommand(h.deps, await herRow(seed), "start", start);
    await handleParentCommand(h.deps, await herRow(seed), "start", start);

    expect(await eventNames()).toEqual(["stop_said", "start_said"]);
    expect((await outboundRows()).map((row) => row.conversationId)).toEqual([HER, ORGANISER, HER]);
  });

  it("ticks her through the function it is given", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await say(seed.member, "stop");
    const ticked: string[] = [];

    await handleParentCommand(
      h.deps,
      await herRow(seed),
      "start",
      said("start"),
      async (_deps, id) => {
        ticked.push(id);
      },
    );

    expect(ticked).toEqual([seed.member.id]);
    expect(h.scheduler.wakes.get(seed.member.id)).toBeNull();
  });

  it("understands 開始 and 继续", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), language: "zh-TW" });
    await say(seed.member, "停");
    await say(await herRow(seed), "開始");
    expect((await herRow(seed)).status).toBe("active");

    await say(await herRow(seed), "停止");
    await say(await herRow(seed), "继续");

    expect((await herRow(seed)).status).toBe("active");
    expect((await herMessages()).at(-1)).toBe(t("zh-TW", "parent.started", { time: "08:00" }));
  });
});

describe("what the family sees", () => {
  it("says there is nothing yet before any answer, and adds no weekly read heading", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });

    await say(seed.member, "What does the family see?");

    expect(await herMessages()).toEqual([t("en", "parent.family_sees_empty")]);
    expect(await eventNames()).toEqual([]);
  });

  it("lists the summaries of her last seven answered days, dated, newest first", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    for (let day = 5; day <= 13; day += 1) {
      const date: LocalDate = `2026-09-${String(day).padStart(2, "0")}`;
      await answeredDay(seed, date, day === 9 ? null : `Day ${day} went well.`);
    }

    await say(seed.member, "what does my family see");

    expect(await herMessages()).toEqual([
      [
        t("en", "parent.family_sees_heading"),
        "Sunday 13 September: Day 13 went well.",
        "Saturday 12 September: Day 12 went well.",
        "Friday 11 September: Day 11 went well.",
        "Thursday 10 September: Day 10 went well.",
        "Tuesday 8 September: Day 8 went well.",
        "Monday 7 September: Day 7 went well.",
      ].join("\n"),
    ]);
  });

  it("answers 家人看到什麼 and 家人看得到什麼 in her language with her dates", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), memberLanguage: "zh-TW" });
    await answeredDay(seed, "2026-09-13", "她做了晚餐。");

    await say(seed.member, "家人看到什麼");
    await say(seed.member, "家人看得到什麼");

    const expected = `${t("zh-TW", "parent.family_sees_heading")}\n9月13日（星期日）：她做了晚餐。`;
    expect(await herMessages()).toEqual([expected, expected]);
  });

  it("gives her the summaries in her language when the family writes in another, and as stored without a translation", async () => {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      language: "en",
      memberLanguage: "zh-TW",
    });
    // The model writes the summary in the family's language, as `understandAnswer` asks it to.
    h.deps.ai = createFakeAi({
      understand: async (input) => ({
        ok: true,
        value: {
          ...SAFE_DEFAULTS.understand(input),
          summary: input.summaryLang === "en" ? "Mom cooked soup." : "媽媽煮了湯。",
        },
        record: fakeRecord("understand"),
      }),
    });
    const understood = await answeredDay(seed, "2026-09-13", null, "我煮了湯");
    await understandAnswer(h.deps, understood);
    await answeredDay(seed, "2026-09-12", "Mom went to the market.");

    await say(seed.member, "家人看到什麼");

    expect(await herMessages()).toEqual([
      [
        t("zh-TW", "parent.family_sees_heading"),
        "9月13日（星期日）：[zh-TW] Mom cooked soup.",
        "9月12日（星期六）：Mom went to the market.",
      ].join("\n"),
    ]);
  });

  /**
   * The model for an answer understood twice: the first flag fails, so the answer is re-run, and
   * the re-run rewrites the summary. The family writes in English and she reads Traditional Chinese.
   */
  async function rewrittenOnRerun(translate: Ai["translate"]): Promise<{
    seed: SeededFamily;
    answerId: string;
  }> {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      language: "en",
      memberLanguage: "zh-TW",
    });
    const summaries = ["Mom cooked soup.", "Mom made soup for dinner."];
    let flagCalls = 0;
    h.deps.ai = createFakeAi({
      understand: async (input) => ({
        ok: true,
        value: { ...SAFE_DEFAULTS.understand(input), summary: summaries.shift() ?? "answered" },
        record: fakeRecord("understand"),
      }),
      flag: async (input) => {
        flagCalls += 1;
        return flagCalls === 1
          ? {
              ok: false,
              value: SAFE_DEFAULTS.flag(input),
              record: fakeRecord("flag", "http_529"),
              error: "http_529",
            }
          : { ok: true, value: SAFE_DEFAULTS.flag(input), record: fakeRecord("flag") };
      },
      translate,
    });
    return { seed, answerId: await answeredDay(seed, "2026-09-13", null, "我煮了湯") };
  }

  function translated(input: Parameters<Ai["translate"]>[0]): AiOutcome<Translation> {
    return {
      ok: true,
      value: { text: `[${input.to}] ${input.text}` },
      record: fakeRecord("translate"),
    };
  }

  function translationFailed(input: Parameters<Ai["translate"]>[0]): AiOutcome<Translation> {
    return {
      ok: false,
      value: SAFE_DEFAULTS.translate(input),
      record: fakeRecord("translate", "http_529"),
      error: "http_529",
    };
  }

  it("gives her a rewritten summary as stored, not the old one's translation, when the new translation fails", async () => {
    let summaryTranslations = 0;
    const { seed, answerId } = await rewrittenOnRerun(async (input) => {
      if (input.to !== "zh-TW") {
        return translated(input);
      }
      summaryTranslations += 1;
      return summaryTranslations === 1 ? translated(input) : translationFailed(input);
    });

    await understandAnswer(h.deps, answerId);
    await say(seed.member, "家人看到什麼");
    await understandAnswer(h.deps, answerId);
    await say(seed.member, "家人看到什麼");

    const heading = t("zh-TW", "parent.family_sees_heading");
    expect(await herMessages()).toEqual([
      `${heading}\n9月13日（星期日）：[zh-TW] Mom cooked soup.`,
      `${heading}\n9月13日（星期日）：Mom made soup for dinner.`,
    ]);
  });

  it("leaves her no translation of the old summary when a re-run stops after rewriting it", async () => {
    let wordTranslations = 0;
    const { seed, answerId } = await rewrittenOnRerun(async (input) => {
      if (input.to === "zh-TW") {
        return translated(input);
      }
      wordTranslations += 1;
      if (wordTranslations === 1) {
        return translationFailed(input);
      }
      // Her words are translated after the summary is written and before her copy of it is: the
      // job stopping there, as a Worker out of time would, must not leave the old copy behind.
      throw new Error("the job stopped");
    });

    await understandAnswer(h.deps, answerId);
    await say(seed.member, "家人看到什麼");
    await expect(understandAnswer(h.deps, answerId)).rejects.toThrow("the job stopped");
    await say(seed.member, "家人看到什麼");

    const heading = t("zh-TW", "parent.family_sees_heading");
    expect(await herMessages()).toEqual([
      `${heading}\n9月13日（星期日）：[zh-TW] Mom cooked soup.`,
      `${heading}\n9月13日（星期日）：Mom made soup for dinner.`,
    ]);
  });

  it("adds the lines of the latest sent weekly read, never its counts, its nobody-asked line, or its suggestion", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await answeredDay(seed, "2026-09-13", "She cooked dinner.");
    await sentWeeklyRead(seed, {
      lines: ["An older read"],
      sentAt: new Date("2026-09-06T10:00:00Z"),
      weekStart: "2026-08-31",
    });
    await sentWeeklyRead(seed, {
      lines: ["She cooked every day this week.", "Her knee is better."],
      sentAt: new Date("2026-09-13T10:00:00Z"),
    });
    await sentWeeklyRead(seed, {
      lines: ["A draft nobody sent"],
      sentAt: null,
      weekStart: "2026-09-14",
    });

    await say(seed.member, "what does the family see");

    const [message] = await herMessages();
    expect(message).toBe(
      [
        `${t("en", "parent.family_sees_heading")}\nSunday 13 September: She cooked dinner.`,
        `${t("en", "parent.family_sees_weekly_read")}\nShe cooked every day this week.\nHer knee is better.`,
      ].join("\n\n"),
    );
    expect(message).not.toContain("An older read");
    expect(message).not.toContain("draft");
    expect(message).not.toContain("5 of 7");
    expect(message).not.toContain("answered");
    expect(message).not.toContain("Nobody in the family");
    expect(message).not.toContain("Ask about the garden");
    expect(message).not.toContain("Something to ask");
  });

  it("adds nothing, not even the heading, for a sent read without lines", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await sentWeeklyRead(seed, { lines: [], sentAt: h.clock.now(), suggestion: "" });

    await say(seed.member, "what does the family see");

    expect(await herMessages()).toEqual([t("en", "parent.family_sees_empty")]);
  });

  it("gives her the read's lines in her language through the translations row, or as sent without one", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), memberLanguage: "zh-TW" });
    const readId = await sentWeeklyRead(seed, {
      lines: ["She cooked every day.", "Her knee is better."],
      sentAt: h.clock.now(),
    });
    await say(seed.member, "家人看得到什麼");
    await h.db.insert(translations).values({
      objectType: "weekly_read",
      objectId: readId,
      lang: "zh-TW",
      text: "她這週每天都下廚。\n她的膝蓋好多了。",
      provider: "test",
    });

    await say(seed.member, "家人看得到什麼");

    const heading = t("zh-TW", "parent.family_sees_weekly_read");
    expect(await herMessages()).toEqual([
      `${t("zh-TW", "parent.family_sees_empty")}\n\n${heading}\nShe cooked every day.\nHer knee is better.`,
      `${t("zh-TW", "parent.family_sees_empty")}\n\n${heading}\n她這週每天都下廚。\n她的膝蓋好多了。`,
    ]);
  });

  it("answers a redelivered command once", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const event = said("what does the family see");

    await handleParentCommand(h.deps, seed.member, "what_family_sees", event);
    await handleParentCommand(h.deps, seed.member, "what_family_sees", event);

    expect(await outboundRows()).toHaveLength(1);
  });
});

describe("who may command", () => {
  async function silenced(
    seed: SeededFamily,
    change: Partial<Member>,
    text = "stop",
  ): Promise<void> {
    await h.db.update(members).set(change).where(eq(members.id, seed.member.id));
    await say(await herRow(seed), text);
  }

  it("ignores every command before consent, after a No, and once she is left or deceased", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const before = await herRow(seed);

    await silenced(seed, { lightConsentedAt: null, lightOn: false, status: "invited" });
    await silenced(seed, { lightConsentedAt: null, lightOn: false, status: "invited" }, "start");
    await silenced(
      seed,
      { lightConsentedAt: null, lightOn: false, status: "invited" },
      "what does the family see",
    );
    await silenced(seed, { ...before, status: "left", leftAt: h.clock.now() });
    await silenced(seed, { ...before, status: "deceased", lightOn: false });
    await silenced(
      seed,
      { ...before, status: "deceased", lightOn: false },
      "what does the family see",
    );

    expect(await outboundRows()).toHaveLength(0);
    expect(await eventNames()).toEqual([]);
    expect(h.scheduler.history).toHaveLength(0);
  });

  it("ignores a command once the family's deletion was requested, and one from a group", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await handleParentCommand(
      h.deps,
      seed.member,
      "stop",
      said("stop", { conversation: { externalId: "-100500", kind: "group" } }),
    );
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));

    await say(seed.member, "stop");

    expect((await herRow(seed)).status).toBe("active");
    expect(await outboundRows()).toHaveLength(0);
    expect(await eventNames()).toEqual([]);
  });

  it("uses the member's language for the reply whatever the family speaks", async () => {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      language: "en",
      memberLanguage: "zh-TW",
    });

    await say(seed.member, "stop");

    expect(await herMessages()).toEqual([t("zh-TW", "parent.stopped")]);
    expect(h.telegram.sentTo(ORGANISER)[0]?.message.text).toBe(
      t("en", "organiser.stopped", { name: "Mom" }),
    );
    const lang: Lang | undefined = h.telegram.sentTo(ORGANISER)[0]?.message.lang;
    expect(lang).toBe("en");
  });
});
