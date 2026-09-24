import { ApiReply, EXCHANGE_LIST_DAYS, type LocalDate, type OutboundKind } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { events, exchanges, families, members, outbound, replies, users } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { ReplyRefusedError, replyToApiExchange } from "./api-replies.ts";
import { deliverArrival } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-2" };
const herIdentity: SessionIdentity = { authSubject: "auth|Mom", sessionId: "session-3" };
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

function today(): LocalDate {
  return localDateOf(h.clock.now(), seed.member.tz);
}

function daysAgo(days: number): Date {
  return new Date(h.clock.now().getTime() - days * DAY_MS);
}

/** A day she answered: delivered on its own date, so a reply to it is a reply to her words. */
async function answeredDay(days: number) {
  return seedExchange(h.db, seed, {
    date: addDays(today(), -days),
    state: "answered",
    deliveredAt: days === 0 ? h.clock.now() : daysAgo(days),
    answeredAt: days === 0 ? h.clock.now() : daysAgo(days),
  });
}

let keys = 0;
async function reply(
  exchangeId: string,
  text: string,
  options: { key?: string; who?: SessionIdentity } = {},
) {
  keys += 1;
  return replyToApiExchange(
    h.deps,
    options.who ?? identity,
    options.key ?? `key-${keys}`,
    exchangeId,
    { text },
  );
}

async function replyRows() {
  return h.db.select().from(replies).orderBy(asc(replies.createdAt), asc(replies.id));
}

async function exchangeRow(id: string) {
  const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, id));
  return row;
}

async function refused(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => {
      throw new Error("expected the reply to be refused");
    },
    (error: unknown) => error,
  );
}

describe("replyToApiExchange", () => {
  it("writes one reply in the family's words and moves the exchange to replied", async () => {
    const exchange = await answeredDay(0);
    const result = await reply(exchange.id, "Those are the seeds you saved");

    expect(result.replayed).toBe(false);
    expect(result.response.status).toBe(201);
    expect(ApiReply.parse(result.response.body)).toEqual({
      id: expect.any(String),
      exchange_id: exchange.id,
      from: "Mia",
      kind: "text",
      text: "Those are the seeds you saved",
      created_at: h.clock.now().toISOString(),
      reaches_her: true,
    });
    expect(await replyRows()).toEqual([
      expect.objectContaining({
        memberId: seed.organiser.id,
        kind: "text",
        channel: "app",
        externalId: null,
        toRecipient: true,
        readBackAt: null,
      }),
    ]);
    expect(await exchangeRow(exchange.id)).toMatchObject({
      state: "replied",
      repliedAt: h.clock.now(),
    });
  });

  it("says a reply to an older day will not reach her, because only her latest is read back", async () => {
    const older = await answeredDay(2);
    await answeredDay(1);
    const body = ApiReply.parse((await reply(older.id, "Still thinking of it")).response.body);
    expect(body.reaches_her).toBe(false);
  });

  it("keeps the first reply's time, and a reply after the read-back does not move it backwards", async () => {
    const exchange = await answeredDay(0);
    const first = h.clock.now();
    await reply(exchange.id, "First");
    h.clock.set(new Date(first.getTime() + 60_000));
    await reply(exchange.id, "Second");
    expect(await exchangeRow(exchange.id)).toMatchObject({ state: "replied", repliedAt: first });

    await h.db.update(exchanges).set({ state: "read_back" }).where(eq(exchanges.id, exchange.id));
    await reply(exchange.id, "After she heard the others");
    expect((await exchangeRow(exchange.id))?.state).toBe("read_back");
    expect(await replyRows()).toHaveLength(3);
  });

  it("refuses a reply before she has answered: there is nothing to reply to yet", async () => {
    const delivered = await seedExchange(h.db, seed, {
      date: today(),
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const error = await refused(reply(delivered.id, "Hello?"));
    expect(error).toBeInstanceOf(ReplyRefusedError);
    expect((error as ReplyRefusedError).reason).toBe("not_answered");
    expect(await replyRows()).toEqual([]);
    expect((await exchangeRow(delivered.id))?.state).toBe("delivered");
  });

  it("refuses her own reply, which would read her own words back to her tomorrow", async () => {
    const exchange = await answeredDay(0);
    const [account] = await h.db
      .insert(users)
      .values({ authSubject: herIdentity.authSubject, displayName: "Mom" })
      .returning();
    if (account === undefined) throw new Error("expected her account");
    await h.db.update(members).set({ userId: account.id }).where(eq(members.id, seed.member.id));

    const error = await refused(reply(exchange.id, "Talking to myself", { who: herIdentity }));
    expect(error).toBeInstanceOf(ReplyRefusedError);
    expect((error as ReplyRefusedError).reason).toBe("her_own");
    expect(await replyRows()).toEqual([]);
  });

  it("answers not found alike for everything a stranger could probe", async () => {
    const mine = await answeredDay(0);
    const withdrawn = await answeredDay(1);
    await h.db.update(exchanges).set({ state: "withdrawn" }).where(eq(exchanges.id, withdrawn.id));
    const undelivered = await seedExchange(h.db, seed, {
      date: addDays(today(), 1),
      state: "scheduled",
    });
    const aged = await answeredDay(EXCHANGE_LIST_DAYS + 1);

    const probes: [string, string, SessionIdentity][] = [
      ["a stranger", mine.id, stranger],
      ["an exchange that does not exist", missingId, identity],
      ["an id that is not an id", "not-a-uuid", identity],
      ["a withdrawn ask", withdrawn.id, identity],
      ["a morning not yet delivered", undelivered.id, identity],
      ["a day older than the list", aged.id, identity],
    ];
    for (const [label, exchangeId, who] of probes) {
      const error = await refused(reply(exchangeId, "Anyone there?", { who }));
      expect(error, label).toBeInstanceOf(VelaError);
      expect((error as VelaError).code, label).toBe("not_found");
    }
    expect(await replyRows()).toEqual([]);
  });

  it("answers not found for another family's exchange, never an internal error", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "6001",
      memberExternalId: "6002",
    });
    const theirs = await seedExchange(h.db, other, {
      date: today(),
      state: "answered",
      deliveredAt: h.clock.now(),
    });
    const error = await refused(reply(theirs.id, "Not mine to answer"));
    expect(error).toBeInstanceOf(VelaError);
    expect((error as VelaError).code).toBe("not_found");
    expect(await replyRows()).toEqual([]);
  });

  it("answers not found once the family has ended", async () => {
    const exchange = await answeredDay(0);
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    const error = await refused(reply(exchange.id, "Too late"));
    expect((error as VelaError).code).toBe("not_found");
  });

  it("replays the first answer and writes nothing twice", async () => {
    const exchange = await answeredDay(0);
    const first = await reply(exchange.id, "Once", { key: "same" });
    const again = await reply(exchange.id, "Once", { key: "same" });
    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(await replyRows()).toHaveLength(1);
    expect(await h.db.select().from(events).where(eq(events.name, "reply_posted"))).toHaveLength(1);
  });

  it("refuses one key spent on different words or on a different exchange", async () => {
    const exchange = await answeredDay(0);
    const other = await answeredDay(1);
    await reply(exchange.id, "Once", { key: "same" });
    await expect(reply(exchange.id, "Twice", { key: "same" })).rejects.toThrow(ApiIdempotencyError);
    await expect(reply(other.id, "Once", { key: "same" })).rejects.toThrow(ApiIdempotencyError);
    expect(await replyRows()).toHaveLength(1);
  });

  it("refuses a body the screen could not have sent", async () => {
    const exchange = await answeredDay(0);
    for (const body of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(1_001) }]) {
      await expect(
        replyToApiExchange(
          h.deps,
          identity,
          `bad-${JSON.stringify(body).length}`,
          exchange.id,
          body,
        ),
      ).rejects.toThrow(ApiIdempotencyError);
    }
    await expect(
      replyToApiExchange(h.deps, identity, "bad-kind", exchange.id, { text: "hi", kind: "heart" }),
    ).rejects.toThrow(ApiIdempotencyError);
    expect(await replyRows()).toEqual([]);
  });

  it("writes one content-free reply_posted event naming the app", async () => {
    const exchange = await answeredDay(0);
    await reply(exchange.id, "Something private");
    const [event] = await h.db.select().from(events).where(eq(events.name, "reply_posted"));
    expect(event).toMatchObject({
      familyId: seed.family.id,
      memberId: seed.organiser.id,
      exchangeId: exchange.id,
      surface: "app",
    });
    expect(JSON.stringify(event?.props)).not.toContain("private");
  });

  it("is read back to her the next morning, exactly as a Telegram reply would be", async () => {
    const exchange = await answeredDay(0);
    const posted = ApiReply.parse((await reply(exchange.id, "Save me one")).response.body);
    expect(posted.reaches_her).toBe(true);

    const tomorrow = addDays(today(), 1);
    h.clock.set(new Date(`${tomorrow}T08:00:00.000+08:00`));
    await deliverArrival(h.deps, seed.member.id, tomorrow, false);

    const [arrival] = await h.db
      .select()
      .from(outbound)
      .where(eq(outbound.kind, "arrival" satisfies OutboundKind));
    const payload = arrival?.payload as {
      message: { text: string };
      effect: { readBackReplyIds: string[]; previousExchangeId: string | null };
    };
    expect(payload.effect).toMatchObject({
      readBackReplyIds: [posted.id],
      previousExchangeId: exchange.id,
    });
    expect(payload.message.text).toContain("Mia: Save me one");

    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
    const [heard] = await replyRows();
    expect(heard?.readBackAt).toEqual(h.clock.now());
  });
});
