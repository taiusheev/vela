import { ApiComposedAsk } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { events, exchanges, members, outbound, turns, users } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { AskDayTakenError, composeApiAsk } from "./api-asks.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound, STRANDED_AFTER_MINUTES } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedLinkedGroup } from "./testing/seed.ts";
import { reconcile } from "./tick.ts";

let h: Harness;
let seed: SeededFamily;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-2" };
const missingId = "00000000-0000-4000-8000-000000000001";

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

let keys = 0;
async function compose(
  body: Record<string, unknown>,
  options: { key?: string; who?: SessionIdentity; familyId?: string } = {},
) {
  keys += 1;
  return composeApiAsk(
    h.deps,
    options.who ?? identity,
    options.key ?? `key-${keys}`,
    options.familyId ?? seed.family.id,
    { recipient_id: seed.member.id, type: "question", when: "tomorrow", ...body },
  );
}

async function exchangeRows() {
  return h.db.select().from(exchanges).where(eq(exchanges.recipientId, seed.member.id));
}

describe("composeApiAsk", () => {
  it("puts a question into her next morning and answers 201 with the composed ask", async () => {
    const result = await compose({ text: "What did the garden look like this morning?" });
    expect(result.replayed).toBe(false);
    expect(result.response.status).toBe(201);
    const body = ApiComposedAsk.parse(result.response.body);
    expect(body).toEqual({
      id: expect.any(String),
      family_id: seed.family.id,
      recipient_id: seed.member.id,
      recipient_name: "Mom",
      asker_name: "Mia",
      on_behalf_of: null,
      type: "question",
      ask: "What did the garden look like this morning?",
      when_rule: "tomorrow",
      scheduled_for: addDays(today(), 1),
      state: "composed",
    });

    const [row] = await exchangeRows();
    expect(row).toMatchObject({
      askerId: seed.organiser.id,
      state: "composed",
      textLang: seed.organiser.language,
      scheduledFor: addDays(today(), 1),
    });
  });

  it("dates the morning in her time zone, not the caller's", async () => {
    // An hour when the two are not on the same date at all: 01:00 on the 15th in Taipei is still
    // 18:00 on the 14th in London, so only her zone can give the morning this test expects.
    h.clock.set(new Date("2026-09-14T17:00:00.000Z"));
    await h.db
      .update(members)
      .set({ tz: "Europe/London" })
      .where(eq(members.id, seed.organiser.id));
    expect(localDateOf(h.clock.now(), "Asia/Taipei")).toBe("2026-09-15");
    expect(localDateOf(h.clock.now(), "Europe/London")).toBe("2026-09-14");

    const body = ApiComposedAsk.parse((await compose({ text: "Did it rain?" })).response.body);
    expect(body.scheduled_for).toBe("2026-09-16");
  });

  it("leaves a whenever ask undated, so it waits for the first free morning", async () => {
    const body = ApiComposedAsk.parse(
      (await compose({ when: "whenever", text: "Tell me about the market" })).response.body,
    );
    expect(body).toMatchObject({ when_rule: "whenever", scheduled_for: null });
  });

  it("takes a named day inside her next two weeks and refuses one outside them", async () => {
    const body = ApiComposedAsk.parse(
      (await compose({ when: "date", date: addDays(today(), 3), text: "Ready for Friday?" }))
        .response.body,
    );
    expect(body).toMatchObject({ when_rule: "date", scheduled_for: addDays(today(), 3) });

    for (const date of [today(), addDays(today(), -1), addDays(today(), 15)]) {
      await expect(compose({ when: "date", date, text: "Too far" })).rejects.toThrow(VelaError);
    }
  });

  it("refuses a body the screen could not have sent", async () => {
    for (const body of [
      { text: "" },
      { text: "x".repeat(1_001) },
      { type: "voice_note", text: "no file to carry" },
      { type: "hello", text: "not the family's to send" },
      { type: "vote", text: "Which one?" },
      { type: "vote", text: "Which one?", vote_options: ["only one"] },
      { type: "question", text: "Options without a vote", vote_options: ["a", "b"] },
      { when: "date", text: "A date with no day" },
      { when: "tomorrow", date: addDays(today(), 1), text: "A day it may not name" },
      { recipient_id: "not-a-uuid", text: "Nobody" },
    ]) {
      await expect(compose(body)).rejects.toThrow(ApiIdempotencyError);
    }
    expect(await exchangeRows()).toEqual([]);
  });

  it("carries a vote's options in the shape the arrival reads", async () => {
    await compose({ type: "vote", text: "Which shall I plant?", vote_options: ["Beans", "Peas"] });
    const [row] = await exchangeRows();
    expect(row?.options).toEqual({ vote_options: ["Beans", "Peas"] });
  });

  it("says who holds a morning already, and offers the next one nobody holds", async () => {
    const tomorrow = addDays(today(), 1);
    await seedExchange(h.db, seed, { date: tomorrow, state: "scheduled" });
    const conflict = await compose({ text: "Mine too" }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(AskDayTakenError);
    expect((conflict as AskDayTakenError).conflict).toEqual({
      taken_by: "Mia",
      date_alternative: addDays(today(), 2),
    });
    expect(await exchangeRows()).toHaveLength(1);
  });

  it("names Vela when the morning is her own hello, not a family member's ask", async () => {
    const tomorrow = addDays(today(), 1);
    await seedExchange(h.db, seed, {
      date: tomorrow,
      type: "hello",
      text: null,
      state: "scheduled",
    });
    const conflict = await compose({ text: "Mine instead" }).catch((error: unknown) => error);
    expect((conflict as AskDayTakenError).conflict.taken_by).toBe("Vela");
  });

  it("skips over several claimed mornings to the first free one", async () => {
    for (const day of [1, 2, 3]) {
      await seedExchange(h.db, seed, { date: addDays(today(), day), state: "scheduled" });
    }
    const conflict = await compose({ text: "Anywhere" }).catch((error: unknown) => error);
    expect((conflict as AskDayTakenError).conflict.date_alternative).toBe(addDays(today(), 4));
  });

  it("offers no alternative when every morning in the window is taken", async () => {
    for (let day = 1; day <= 15; day += 1) {
      await seedExchange(h.db, seed, { date: addDays(today(), day), state: "scheduled" });
    }
    const conflict = await compose({ text: "Anywhere" }).catch((error: unknown) => error);
    expect((conflict as AskDayTakenError).conflict.date_alternative).toBeNull();
  });

  it("does not count a withdrawn ask as holding the morning", async () => {
    const tomorrow = addDays(today(), 1);
    const taken = await seedExchange(h.db, seed, { date: tomorrow, state: "scheduled" });
    await h.db.update(exchanges).set({ state: "withdrawn" }).where(eq(exchanges.id, taken.id));
    const body = ApiComposedAsk.parse((await compose({ text: "Mine then" })).response.body);
    expect(body.scheduled_for).toBe(tomorrow);
  });

  it("replays the first answer and writes nothing a second time", async () => {
    const first = await compose({ text: "What did you cook?" }, { key: "same" });
    const again = await compose({ text: "What did you cook?" }, { key: "same" });
    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(await exchangeRows()).toHaveLength(1);
    expect(await h.db.select().from(events).where(eq(events.name, "ask_composed"))).toHaveLength(1);
  });

  it("refuses the same key with a different ask, and writes nothing", async () => {
    await compose({ text: "What did you cook?" }, { key: "same" });
    await expect(compose({ text: "Something else" }, { key: "same" })).rejects.toThrow(
      ApiIdempotencyError,
    );
    expect(await exchangeRows()).toHaveLength(1);
  });

  it("stamps the turn when one was prompted for that day, and manages without one", async () => {
    const tomorrow = addDays(today(), 1);
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: tomorrow,
      recipientId: seed.member.id,
      holderId: seed.organiser.id,
      promptedAt: h.clock.now(),
    });
    await compose({ text: "Tomorrow then" });
    const [turn] = await h.db
      .select()
      .from(turns)
      .where(and(eq(turns.familyId, seed.family.id), eq(turns.localDay, tomorrow)));
    expect(turn?.actedAt).toBeInstanceOf(Date);

    // The day after has no turn row at all, and composing for it still works.
    await compose({ when: "date", date: addDays(today(), 2), text: "And the day after" });
    expect(await exchangeRows()).toHaveLength(2);
  });

  it("writes one content-free ask_composed event naming the app", async () => {
    await compose({ text: "What did you cook?" });
    const [event] = await h.db.select().from(events).where(eq(events.name, "ask_composed"));
    expect(event).toMatchObject({ familyId: seed.family.id, memberId: seed.organiser.id });
    expect(event?.props).toEqual({
      type: "question",
      when_rule: "tomorrow",
      source: "app",
      media: 0,
      queued: false,
    });
    expect(JSON.stringify(event?.props)).not.toContain("cook");
  });

  it("keeps a child's name when a parent sends for them", async () => {
    const body = ApiComposedAsk.parse(
      (await compose({ text: "Can I see the cat?", on_behalf_of: "Léa" })).response.body,
    );
    expect(body.on_behalf_of).toBe("Léa");
  });

  it("tells a stranger, another family and an unknown family apart from nothing at all", async () => {
    await expect(compose({ text: "Hello" }, { who: stranger })).rejects.toThrow(VelaError);
    await expect(compose({ text: "Hello" }, { familyId: missingId })).rejects.toThrow(VelaError);

    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "3001",
      memberExternalId: "3002",
    });
    await expect(
      composeApiAsk(h.deps, identity, "cross", other.family.id, {
        recipient_id: other.member.id,
        type: "question",
        text: "Not mine to ask",
        when: "tomorrow",
      }),
    ).rejects.toThrow(VelaError);
    expect(await exchangeRows()).toEqual([]);
  });

  it("refuses a recipient who is paused, has left, or keeps no light", async () => {
    for (const change of [
      { status: "paused" as const },
      { leftAt: h.clock.now() },
      { lightOn: false, lightConsentedAt: null },
    ]) {
      await h.db.update(members).set(change).where(eq(members.id, seed.member.id));
      await expect(compose({ text: "Are you there?" })).rejects.toThrow(VelaError);
      await h.db
        .update(members)
        .set({ status: "active", leftAt: null, lightOn: true, lightConsentedAt: h.clock.now() })
        .where(eq(members.id, seed.member.id));
    }
    expect(await exchangeRows()).toEqual([]);
  });

  it("answers not found for a recipient who is not of this family, never an internal error", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "4001",
      memberExternalId: "4002",
    });
    // Both go through the caller's own family, so authorization grants and the recipient is the
    // only thing wrong: a bare Error here would reach the app as a 500 (API contract §4).
    for (const recipientId of [missingId, other.member.id]) {
      const failure = await compose({ recipient_id: recipientId, text: "Not yours" }).catch(
        (error: unknown) => error,
      );
      expect(failure, recipientId).toBeInstanceOf(VelaError);
      expect((failure as VelaError).code).toBe("not_found");
    }
    expect(await exchangeRows()).toEqual([]);
  });

  it("refuses to ask a member of the family who does not keep the light", async () => {
    await expect(
      compose({ recipient_id: seed.organiser.id, text: "Asking the organiser" }),
    ).rejects.toThrow(VelaError);
  });
});

describe("the family group hears that tomorrow is taken", () => {
  const nothing = { outboundIds: [], wakeMemberIds: [] };

  async function groupRows() {
    return h.db.select().from(outbound).where(eq(outbound.conversationId, "-100500"));
  }

  it("writes one line to the linked group for tomorrow's ask, without its words, for after the commit", async () => {
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const result = await compose({ text: "What did the garden look like this morning?" });
    const rows = await groupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "system",
      status: "queued",
      memberId: seed.organiser.id,
      channel: "telegram",
    });
    const payload = JSON.stringify(rows[0]?.payload);
    expect(payload).toContain("Mia asked Mom something for tomorrow morning.");
    expect(payload).not.toContain("garden");
    expect(h.queues.outbound.pending).toEqual([]);
    expect(result.after).toEqual({ outboundIds: [rows[0]?.id], wakeMemberIds: [] });
  });

  it("says nothing for a later morning, for whenever, or with no group, and nothing again on a replay", async () => {
    const noGroup = await compose({ text: "Tomorrow?" });
    expect(noGroup.after).toEqual(nothing);
    await h.db.delete(exchanges);

    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    expect((await compose({ text: "Whenever?", when: "whenever" })).after).toEqual(nothing);
    expect(
      (await compose({ text: "Later?", when: "date", date: addDays(today(), 3) })).after,
    ).toEqual(nothing);
    expect(await groupRows()).toEqual([]);

    const first = await compose({ text: "Tomorrow?" }, { key: "same" });
    const replay = await compose({ text: "Tomorrow?" }, { key: "same" });
    expect(replay.replayed).toBe(true);
    expect(replay.after).toEqual(nothing);
    expect(first.after.outboundIds).toHaveLength(1);
    expect(await groupRows()).toHaveLength(1);
  });

  it("reaches the group when nothing hands the line over: reconcile finds it", async () => {
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await compose({ text: "Tomorrow?" });
    h.clock.set(new Date(h.clock.now().getTime() + (STRANDED_AFTER_MINUTES + 1) * 60_000));
    await reconcile(h.deps);
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
    expect((await groupRows())[0]?.status).toBe("sent");
    expect(h.telegram.sentTo("-100500")).toHaveLength(1);
  });
});
