import type { LocalDate, LocalTime } from "@vela/contracts";
import { zonedInstant } from "@vela/core";
import { answers, consents } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedHealthWordsConsent,
} from "./testing/seed.ts";
import { weeklyHealthMentions } from "./weekly-health.ts";

const TZ = "Asia/Taipei";
/** Monday 14 to Sunday 20 September 2026. */
const WEEK_START: LocalDate = "2026-09-14";

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

function at(date: LocalDate, time: LocalTime): Date {
  return zonedInstant(date, time, TZ);
}

/** An answered morning whose answer holds `health` as her health words. */
async function answerWith(seed: SeededFamily, date: LocalDate, health: string[]): Promise<void> {
  const exchange = await seedExchange(h.db, seed, {
    date,
    state: "answered",
    deliveredAt: at(date, "08:00"),
    answeredAt: at(date, "09:00"),
  });
  await h.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: seed.member.id,
    kind: "text",
    channel: "telegram",
    externalId: `2001:${date}`,
    payload: { text: "words" },
    mentions: { people: [], places: [], plans: [], health, dates: [] },
    receivedAt: at(date, "09:00"),
    understoodAt: at(date, "09:00"),
  });
}

async function family(): Promise<SeededFamily> {
  return seedFamily(h.db, { now: at("2026-09-01", "09:00") });
}

const NOW = () => at("2026-09-20", "18:00");

describe("weeklyHealthMentions (ADR-47)", () => {
  it("quotes her health words said on two days, under a yes to the question that named the read", async () => {
    const seed = await family();
    await seedHealthWordsConsent(h.db, seed, {
      at: at("2026-09-01", "09:00"),
      answer: "yes",
      textVersion: "consent.health_words@2",
    });
    await answerWith(seed, "2026-09-14", ["knee hurts"]);
    await answerWith(seed, "2026-09-16", ["slept badly"]);
    await answerWith(seed, "2026-09-17", ["Knee hurts"]);

    expect(await weeklyHealthMentions(h.db, seed.member, WEEK_START, NOW())).toEqual([
      { words: "knee hurts", dates: ["2026-09-14", "2026-09-17"] },
    ]);
  });

  it("quotes nothing under a yes to the earlier question, which named the same-day call only", async () => {
    const seed = await family();
    await seedHealthWordsConsent(h.db, seed, { at: at("2026-09-01", "09:00"), answer: "yes" });
    await answerWith(seed, "2026-09-14", ["knee hurts"]);
    await answerWith(seed, "2026-09-17", ["knee hurts"]);

    expect(await weeklyHealthMentions(h.db, seed.member, WEEK_START, NOW())).toEqual([]);
  });

  it("quotes nothing once she has withdrawn her yes, or under a no", async () => {
    const seed = await family();
    const consent = await seedHealthWordsConsent(h.db, seed, {
      at: at("2026-09-01", "09:00"),
      answer: "yes",
      textVersion: "consent.health_words@2",
    });
    await answerWith(seed, "2026-09-14", ["knee hurts"]);
    await answerWith(seed, "2026-09-17", ["knee hurts"]);
    await h.db
      .update(consents)
      .set({ withdrawnAt: at("2026-09-19", "10:00") })
      .where(eq(consents.id, consent.id));

    expect(await weeklyHealthMentions(h.db, seed.member, WEEK_START, NOW())).toEqual([]);
  });

  it("leaves out answers from before her yes", async () => {
    const seed = await family();
    await answerWith(seed, "2026-09-14", ["knee hurts"]);
    await seedHealthWordsConsent(h.db, seed, {
      at: at("2026-09-15", "12:00"),
      answer: "yes",
      textVersion: "consent.health_words@2",
    });
    await answerWith(seed, "2026-09-17", ["knee hurts"]);

    expect(await weeklyHealthMentions(h.db, seed.member, WEEK_START, NOW())).toEqual([]);
  });

  it("quotes nothing once retention has cleared the answers' words at 30 days", async () => {
    const seed = await family();
    await seedHealthWordsConsent(h.db, seed, {
      at: at("2026-09-01", "09:00"),
      answer: "yes",
      textVersion: "consent.health_words@2",
    });
    await answerWith(seed, "2026-09-14", ["knee hurts"]);
    await answerWith(seed, "2026-09-17", ["knee hurts"]);
    await h.db.update(answers).set({ mentions: {} }).where(eq(answers.memberId, seed.member.id));

    expect(await weeklyHealthMentions(h.db, seed.member, WEEK_START, NOW())).toEqual([]);
  });

  it("reads only the week asked for", async () => {
    const seed = await family();
    await seedHealthWordsConsent(h.db, seed, {
      at: at("2026-09-01", "09:00"),
      answer: "yes",
      textVersion: "consent.health_words@2",
    });
    await answerWith(seed, "2026-09-13", ["knee hurts"]);
    await answerWith(seed, "2026-09-17", ["knee hurts"]);
    await answerWith(seed, "2026-09-21", ["knee hurts"]);

    expect(await weeklyHealthMentions(h.db, seed.member, WEEK_START, NOW())).toEqual([]);
  });
});
