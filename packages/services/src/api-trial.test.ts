import { ApiTrial } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { answers, events, families, members, subscriptions, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiFamily } from "./api-family.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { startApiTrial, TrialRefusedError } from "./api-trial.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let miaUserId: string;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-2" };
const DAY = 24 * 60 * 60_000;

async function account(identity: SessionIdentity, memberId: string): Promise<string> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: identity.authSubject })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
  return user.id;
}

async function herFirstAnswer() {
  const exchange = await seedExchange(h.db, seed, {
    date: localDateOf(h.clock.now(), seed.member.tz),
    state: "answered",
    answeredAt: h.clock.now(),
  });
  await h.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: seed.member.id,
    kind: "text",
    channel: "telegram",
    externalId: "2001:7",
    payload: { text: "Yes." },
    receivedAt: h.clock.now(),
  });
}

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  miaUserId = await account(mia, seed.organiser.id);
  const plain = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "4002",
  });
  await account(sam, plain.member.id);
});
afterAll(async () => {
  await h.close();
});

let keys = 0;
async function start(who: SessionIdentity = mia, memberId = seed.member.id, key?: string) {
  keys += 1;
  return startApiTrial(h.deps, who, key ?? `key-${keys}`, seed.family.id, { member_id: memberId });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.catch((caught: unknown) => caught);
  if (error instanceof TrialRefusedError) return error.reason;
  if (error instanceof VelaError) return error.code;
  return error;
}

describe("startApiTrial", () => {
  it("starts thirty days for her after her first answer, paid for by the organiser who asked", async () => {
    await herFirstAnswer();
    const result = await start();
    const ends = new Date(h.clock.now().getTime() + 30 * DAY);
    expect(ApiTrial.parse(result.response.body)).toEqual({
      member_id: seed.member.id,
      status: "trial",
      trial_ends_at: ends.toISOString(),
    });
    const [row] = await h.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.memberId, seed.member.id));
    expect(row).toMatchObject({
      familyId: seed.family.id,
      payerUserId: miaUserId,
      provider: "trial",
      status: "trial",
      trialEndsAt: ends,
      planInterval: null,
      priceCents: null,
    });
    expect(await h.db.select().from(events).where(eq(events.name, "trial_started"))).toHaveLength(
      1,
    );
    // Nothing is gated or charged yet, so the family's plan is left as it was.
    const [family] = await h.db.select().from(families).where(eq(families.id, seed.family.id));
    expect(family?.plan).toBe("free");
    // You reads it back.
    const read = await loadApiFamily(h.db, mia, seed.family.id);
    expect(read?.members.find((m) => m.member_id === seed.member.id)?.subscription?.status).toBe(
      "trial",
    );
  });

  it("gives one trial per kept-light member: a second start answers the first, even with a new key", async () => {
    await herFirstAnswer();
    const first = await start();
    h.clock.set(new Date(h.clock.now().getTime() + 5 * DAY));
    const again = await start();
    expect(again.replayed).toBe(false);
    expect(again.response.body).toEqual(first.response.body);
    expect(await h.db.select().from(subscriptions)).toHaveLength(1);
    expect(await h.db.select().from(events).where(eq(events.name, "trial_started"))).toHaveLength(
      1,
    );

    const replay = await start(mia, seed.member.id, "same");
    expect((await start(mia, seed.member.id, "same")).replayed).toBe(true);
    expect(replay.response.body).toEqual(first.response.body);
  });

  it("waits for her first answer, and for her light to be on", async () => {
    expect(await failure(start())).toBe("not_answered_yet");
    await herFirstAnswer();
    await h.db.update(members).set({ lightOn: false }).where(eq(members.id, seed.member.id));
    expect(await failure(start())).toBe("light_off");
    expect(await h.db.select().from(subscriptions)).toEqual([]);
  });

  it("is for the family's organisers, and for its own kept-light members", async () => {
    await herFirstAnswer();
    expect(await failure(start(sam))).toBe("not_found");
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "9001",
      memberExternalId: "9002",
    });
    expect(await failure(start(mia, other.member.id))).toBe("not_found");
    await expect(
      startApiTrial(h.deps, mia, "k", seed.family.id, { member_id: seed.member.id, months: 2 }),
    ).rejects.toThrow(ApiIdempotencyError);
    expect(await h.db.select().from(subscriptions)).toEqual([]);
  });
});
