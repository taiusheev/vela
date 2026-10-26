import { answers, members, quietEvents, subscriptions, users, weeklyReads } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { listApiWeeklyReads, loadApiWeeklyRead, openApiWeeklyRead } from "./api-weekly-read.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-2" };
const stranger: SessionIdentity = { authSubject: "auth|Zoe", sessionId: "session-3" };

/** The week before the harness's Monday, 14 September 2026, in Taipei. */
const WEEK_START = "2026-09-07";
/** Her light started on the Wednesday, so Monday and Tuesday are not counted. */
const LIGHT_STARTS_ON = "2026-09-09";

async function account(identity: SessionIdentity, memberId: string): Promise<void> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: identity.authSubject })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

/** A read of her week as the founder sent it, or only drafted when `sent` is false. */
async function readOfHerWeek(
  options: { sent?: boolean; suggestion?: string; weekStart?: string; suggestionDay?: string } = {},
) {
  const sent = options.sent ?? true;
  const [read] = await h.db
    .insert(weeklyReads)
    .values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      weekStart: options.weekStart ?? WEEK_START,
      lines: ["She mentioned the garden twice."],
      suggestion: "Ask her about the seeds.",
      stats: {
        counted_days: 5,
        answered_days: 2,
        hello_mornings: 1,
        family_asks: 2,
        usual_time: "08:30",
        drift_min: null,
        topics: [],
        voice_len_drift: null,
        ...(options.suggestionDay === undefined ? {} : { suggestion_day: options.suggestionDay }),
      },
      promptVersion: "weekly_read@test",
      sentLines: sent ? ["She told you about the garden twice."] : null,
      sentSuggestion: sent ? (options.suggestion ?? "Ask her which seeds she kept.") : null,
      sentAt: sent ? new Date("2026-09-13T12:00:00.000Z") : null,
    })
    .returning();
  if (read === undefined) throw new Error("expected a read");
  return read;
}

async function covered(status: "trial" | "active" | "lapsed", trialEndsAt: Date | null = null) {
  await h.db.insert(subscriptions).values({
    familyId: seed.family.id,
    memberId: seed.member.id,
    provider: status === "trial" ? "trial" : "manual",
    status,
    trialEndsAt,
  });
}

async function load(who: SessionIdentity = mia, memberId: string | null = seed.member.id) {
  return loadApiWeeklyRead(h.db, who, seed.family.id, memberId ?? undefined, h.clock.now());
}

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await h.db
    .update(members)
    .set({ lightStartsOn: LIGHT_STARTS_ON })
    .where(eq(members.id, seed.member.id));
  await account(mia, seed.organiser.id);
  const plain = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "4002",
  });
  await account(sam, plain.member.id);

  // Wednesday: answered at 08:30. Thursday: answered at 13:00, after the quiet notice opened at
  // 11:00. Friday: delivered, never answered. Saturday and Sunday: nothing at all.
  await seedExchange(h.db, seed, {
    date: "2026-09-09",
    state: "answered",
    deliveredAt: new Date("2026-09-08T23:30:00.000Z"),
    answeredAt: new Date("2026-09-09T00:30:00.000Z"),
  });
  const late = await seedExchange(h.db, seed, {
    date: "2026-09-10",
    state: "answered",
    deliveredAt: new Date("2026-09-09T23:30:00.000Z"),
    answeredAt: new Date("2026-09-10T05:00:00.000Z"),
  });
  await h.db.insert(quietEvents).values({
    exchangeId: late.id,
    memberId: seed.member.id,
    openedAt: new Date("2026-09-10T03:00:00.000Z"),
  });
  await seedExchange(h.db, seed, {
    date: "2026-09-11",
    state: "delivered",
    deliveredAt: new Date("2026-09-10T23:30:00.000Z"),
  });
});
afterAll(async () => {
  await h.close();
});

describe("loadApiWeeklyRead", () => {
  it("gives an organiser her latest sent read: the seven days, the counts, and what the founder sent", async () => {
    const read = await readOfHerWeek();
    await covered("trial", new Date("2026-10-01T00:00:00.000Z"));

    expect(await load()).toEqual({
      member_id: seed.member.id,
      display_name: seed.member.displayName,
      locked: false,
      read: {
        id: read.id,
        week_start: "2026-09-07",
        week_end: "2026-09-13",
        sent_at: "2026-09-13T12:00:00.000Z",
        days: [
          { date: "2026-09-07", state: "not_counted", answered_at: null },
          { date: "2026-09-08", state: "not_counted", answered_at: null },
          { date: "2026-09-09", state: "answered", answered_at: "08:30" },
          { date: "2026-09-10", state: "late", answered_at: "13:00" },
          { date: "2026-09-11", state: "unanswered", answered_at: null },
          { date: "2026-09-12", state: "unanswered", answered_at: null },
          { date: "2026-09-13", state: "unanswered", answered_at: null },
        ],
        counts: { counted_days: 5, answered_days: 2, hello_mornings: 1, family_asks: 2 },
        notes: ["She told you about the garden twice."],
        suggestion: "Ask her which seeds she kept.",
        suggestion_source: null,
      },
    });
  });

  it("shows the seven days and locks the rest when no Vela Light covers her", async () => {
    await readOfHerWeek();

    const result = await load();

    expect(result?.locked).toBe(true);
    expect(result?.read?.days.map((day) => day.state)).toEqual([
      "not_counted",
      "not_counted",
      "answered",
      "late",
      "unanswered",
      "unanswered",
      "unanswered",
    ]);
    expect(result?.read).toMatchObject({ counts: null, notes: null, suggestion: null });
  });

  it("locks a lapsed plan and a trial that has ended, and opens an active plan", async () => {
    await readOfHerWeek();
    await covered("lapsed");
    expect((await load())?.locked).toBe(true);

    await h.db.delete(subscriptions);
    await covered("trial", new Date("2026-09-13T00:00:00.000Z"));
    expect((await load())?.locked).toBe(true);

    await h.db.delete(subscriptions);
    await covered("active");
    expect((await load())?.locked).toBe(false);
  });

  it("leaves out a suggestion the founder removed before sending", async () => {
    await readOfHerWeek({ suggestion: "" });
    await covered("active");

    expect((await load())?.read?.suggestion).toBeNull();
  });

  it("keeps reviewed notes available for the free pilot after a commercial trial ends", async () => {
    await readOfHerWeek();
    await covered("trial", new Date("2026-09-13T00:00:00.000Z"));
    const read = () =>
      loadApiWeeklyRead(h.db, mia, seed.family.id, seed.member.id, h.clock.now(), {
        pilotFree: true,
      });
    expect(await read()).toMatchObject({
      locked: false,
      read: {
        notes: ["She told you about the garden twice."],
        counts: { counted_days: 5 },
      },
    });
    await h.db.delete(subscriptions);
    expect((await read())?.locked).toBe(false);
    expect(
      await loadApiWeeklyRead(h.db, sam, seed.family.id, seed.member.id, h.clock.now(), {
        pilotFree: true,
      }),
    ).toBeNull();
  });

  it("records a free pilot opening without a subscription while keeping organiser permission", async () => {
    const read = await readOfHerWeek();
    await expect(
      openApiWeeklyRead(h.deps, mia, "free-read-1", read.id, {}, { pilotFree: true }),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      openApiWeeklyRead(h.deps, mia, "free-read-1", read.id, {}, { pilotFree: true }),
    ).resolves.toMatchObject({ replayed: true });
    await expect(
      openApiWeeklyRead(h.deps, sam, "free-read-2", read.id, {}, { pilotFree: true }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(openApiWeeklyRead(h.deps, mia, "paid-read-1", read.id, {})).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("shows no read until one has been sent, and the newest sent one after that", async () => {
    await readOfHerWeek({ sent: false });
    expect((await load())?.read).toBeNull();

    await readOfHerWeek({ weekStart: "2026-08-31" });
    expect((await load())?.read?.week_start).toBe("2026-08-31");
  });

  it("answers nothing to a member who does not organise, a stranger, or a member who is not her", async () => {
    await readOfHerWeek();

    expect(await load(sam)).toBeNull();
    expect(await load(stranger)).toBeNull();
    expect(await load(mia, null)).toBeNull();
    expect(await load(mia, "not-a-uuid")).toBeNull();
    expect(await load(mia, seed.organiser.id)).toBeNull();
  });
});

describe("why the suggestion, and her earlier weeks", () => {
  it("shows the morning the suggestion grows from: its date, who asked, and her answer's summary", async () => {
    await covered("active");
    const days = await h.db.query.exchanges.findMany();
    const morning = days.find((exchange) => exchange.scheduledFor === "2026-09-09");
    if (morning === undefined) throw new Error("expected Wednesday's exchange");
    await h.db.insert(answers).values({
      exchangeId: morning.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: "Planted the tomato seeds." },
      summary: "Planted the tomato seeds by the fence.",
      receivedAt: new Date("2026-09-09T00:30:00.000Z"),
    });
    await readOfHerWeek({ suggestionDay: "2026-09-09" });

    expect((await load())?.read?.suggestion_source).toEqual({
      date: "2026-09-09",
      exchange_id: morning.id,
      asker_name: seed.organiser.displayName,
      summary: "Planted the tomato seeds by the fence.",
    });
  });

  it("shows no source when the founder removed the suggestion, or when the read is locked", async () => {
    await readOfHerWeek({ suggestion: "", suggestionDay: "2026-09-09" });
    await covered("active");
    expect((await load())?.read?.suggestion_source).toBeNull();
    await h.db.delete(subscriptions);
    await covered("lapsed");
    expect((await load())?.read?.suggestion_source).toBeNull();
  });

  it("opens an earlier week by id, and nothing for a read that is not hers to open", async () => {
    await covered("active");
    const earlier = await readOfHerWeek({ weekStart: "2026-08-31" });
    const latest = await readOfHerWeek();
    const draft = await readOfHerWeek({ sent: false, weekStart: "2026-09-14" });
    const open = (readId: string) =>
      loadApiWeeklyRead(h.db, mia, seed.family.id, seed.member.id, h.clock.now(), { readId });

    expect((await load())?.read?.id).toBe(latest.id);
    expect((await open(earlier.id.toUpperCase()))?.read?.week_start).toBe("2026-08-31");
    expect(await open(draft.id)).toBeNull();
    expect(await open("not-a-read")).toBeNull();
    expect(await open("0199a6b0-0000-7000-8000-000000000042")).toBeNull();
    expect(
      await loadApiWeeklyRead(h.db, sam, seed.family.id, seed.member.id, h.clock.now(), {
        readId: earlier.id,
      }),
    ).toBeNull();
  });

  it("lists her sent weeks newest first to an organiser, and nothing to anyone else", async () => {
    const earlier = await readOfHerWeek({ weekStart: "2026-08-31" });
    const latest = await readOfHerWeek();
    await readOfHerWeek({ sent: false, weekStart: "2026-09-14" });

    expect(await listApiWeeklyReads(h.db, mia, seed.family.id, seed.member.id)).toEqual({
      member_id: seed.member.id,
      reads: [
        {
          id: latest.id,
          week_start: "2026-09-07",
          week_end: "2026-09-13",
          sent_at: "2026-09-13T12:00:00.000Z",
        },
        {
          id: earlier.id,
          week_start: "2026-08-31",
          week_end: "2026-09-06",
          sent_at: "2026-09-13T12:00:00.000Z",
        },
      ],
    });
    expect(await listApiWeeklyReads(h.db, sam, seed.family.id, seed.member.id)).toBeNull();
    expect(await listApiWeeklyReads(h.db, stranger, seed.family.id, seed.member.id)).toBeNull();
    expect(await listApiWeeklyReads(h.db, mia, seed.family.id, seed.organiser.id)).toBeNull();
  });
});
