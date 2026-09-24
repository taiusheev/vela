import { ApiExchangePage, EXCHANGE_LIST_DAYS } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { answers, exchanges, members, replies, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiExchanges } from "./api-exchanges.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-2" };
const missingId = "00000000-0000-4000-8000-000000000001";
const DAY_MS = 24 * 60 * 60 * 1_000;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("expected a seeded account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});

function today(): string {
  return localDateOf(h.clock.now(), seed.member.tz);
}

function daysAgo(days: number): Date {
  return new Date(h.clock.now().getTime() - days * DAY_MS);
}

/** A day that happened: delivered, on its own date, so the list will carry it. */
async function seedDay(days: number, text?: string) {
  return seedExchange(h.db, seed, {
    date: addDays(today(), -days),
    state: "answered",
    deliveredAt: daysAgo(days),
    ...(text === undefined ? {} : { text }),
  });
}

async function list(query = {}, who: SessionIdentity = identity, familyId = seed.family.id) {
  return loadApiExchanges(h.db, who, familyId, h.clock.now(), query);
}

describe("loadApiExchanges", () => {
  it("answers an empty page for a family whose days have not happened yet", async () => {
    expect(ApiExchangePage.parse(await list())).toEqual({ exchanges: [], next_cursor: null });
  });

  it("carries the same card Today shows, with the day it was for and when it arrived", async () => {
    const exchange = await seedDay(1, "What did the garden look like?");
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:1",
      payload: { text: "The tomatoes turned." },
      receivedAt: daysAgo(1),
    });
    await h.db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "heart",
      channel: "telegram",
      createdAt: daysAgo(1),
    });

    const page = ApiExchangePage.parse(await list());
    expect(page.exchanges).toEqual([
      expect.objectContaining({
        id: exchange.id,
        recipient_name: "Mom",
        asker_name: "Mia",
        ask: "What did the garden look like?",
        answer: expect.objectContaining({ text: "The tomatoes turned." }),
        replies: [{ from: "Mia", kind: "heart", text: null }],
        scheduled_for: addDays(today(), -1),
        delivered_at: daysAgo(1).toISOString(),
      }),
    ]);
  });

  it("reads newest first", async () => {
    const older = await seedDay(3);
    const middle = await seedDay(2);
    const newest = await seedDay(1);
    const page = await list();
    expect(page?.exchanges.map((row) => row.id)).toEqual([newest.id, middle.id, older.id]);
  });

  it("leaves out a day that has not happened: composed, scheduled, or withdrawn", async () => {
    await seedExchange(h.db, seed, { date: addDays(today(), 1), state: "composed" });
    await seedExchange(h.db, seed, { date: addDays(today(), 2), state: "scheduled" });
    const withdrawn = await seedDay(1);
    await h.db.update(exchanges).set({ state: "withdrawn" }).where(eq(exchanges.id, withdrawn.id));
    expect((await list())?.exchanges).toEqual([]);
  });

  it("stops at thirty days, where the family book takes over", async () => {
    const inside = await seedDay(EXCHANGE_LIST_DAYS - 1);
    await seedDay(EXCHANGE_LIST_DAYS + 1);
    expect((await list())?.exchanges.map((row) => row.id)).toEqual([inside.id]);
  });

  it("pages on the id, and ends with no cursor", async () => {
    const made = [];
    for (let day = 1; day <= 5; day += 1) made.push(await seedDay(day));
    const newestFirst = [...made].reverse().map((row) => row.id);

    const first = await list({ limit: 2 });
    expect(first?.exchanges.map((row) => row.id)).toEqual(newestFirst.slice(0, 2));
    expect(first?.next_cursor).toBe(newestFirst[1]);

    const second = await list({ limit: 2, cursor: first?.next_cursor ?? undefined });
    expect(second?.exchanges.map((row) => row.id)).toEqual(newestFirst.slice(2, 4));

    const last = await list({ limit: 2, cursor: second?.next_cursor ?? undefined });
    expect(last?.exchanges.map((row) => row.id)).toEqual(newestFirst.slice(4));
    expect(last?.next_cursor).toBeNull();
  });

  it("keeps the thirty-day floor on every page, not only the first", async () => {
    const inside = await seedDay(1);
    const old = await seedDay(EXCHANGE_LIST_DAYS + 5);
    // A cursor the caller invented, pointing past the newest row: the floor must still hold.
    const page = await list({ cursor: inside.id });
    expect(page?.exchanges.map((row) => row.id)).not.toContain(old.id);
    expect(page?.exchanges).toEqual([]);
  });

  it("ignores a cursor that is not an id rather than trusting it", async () => {
    const day = await seedDay(1);
    for (const cursor of ["", "not-a-uuid", "'; drop table exchanges; --"]) {
      expect(
        (await list({ cursor }))?.exchanges.map((row) => row.id),
        cursor,
      ).toEqual([day.id]);
    }
  });

  it("never carries another family's days, whatever is asked for", async () => {
    await seedDay(1);
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "5001",
      memberExternalId: "5002",
    });
    await seedExchange(h.db, other, {
      date: addDays(today(), -1),
      state: "answered",
      deliveredAt: daysAgo(1),
      text: "Not for these eyes",
    });

    const mine = await list();
    expect(mine?.exchanges).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain("Not for these eyes");
    expect(await list({}, identity, other.family.id)).toBeNull();
  });

  it("caps a greedy page size and falls back for a nonsense one", async () => {
    for (let day = 1; day <= 3; day += 1) await seedDay(day);
    expect((await list({ limit: 1_000 }))?.exchanges).toHaveLength(3);
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect((await list({ limit }))?.exchanges, String(limit)).toHaveLength(3);
    }
  });

  it("tells a stranger and a missing family apart from nothing at all", async () => {
    expect(await list({}, stranger)).toBeNull();
    expect(await list({}, identity, missingId)).toBeNull();
  });
});
