import { ApiLeft, ApiMemberPause } from "@vela/contracts";
import { events, members, users } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiFamily } from "./api-family.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { leaveApiFamily, MemberChangeRefusedError, pauseApiMember } from "./api-members.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let annaId: string;
let samId: string;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const anna: SessionIdentity = { authSubject: "auth|Anna", sessionId: "session-2" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-3" };
const mom: SessionIdentity = { authSubject: "auth|Mom", sessionId: "session-4" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-5" };

async function account(identity: SessionIdentity, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: identity.authSubject })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await account(mia, seed.organiser.id);
  await account(mom, seed.member.id);
  const second = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  annaId = second.member.id;
  await account(anna, annaId);
  const plain = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "4002",
  });
  samId = plain.member.id;
  await account(sam, samId);
});
afterAll(async () => {
  await h.close();
});

let keys = 0;
function nextKey(): string {
  keys += 1;
  return `key-${keys}`;
}

async function pause(who: SessionIdentity, memberId: string, paused: boolean, key = nextKey()) {
  return pauseApiMember(h.deps, who, key, seed.family.id, memberId, { paused });
}

async function leave(who: SessionIdentity, memberId: string, key = nextKey()) {
  return leaveApiFamily(h.deps, who, key, seed.family.id, memberId, {});
}

async function statusOf(memberId: string) {
  const [row] = await h.db.select().from(members).where(eq(members.id, memberId));
  return row;
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  const failure = await promise.catch((error: unknown) => error);
  if (failure instanceof MemberChangeRefusedError) return failure.reason;
  if (failure instanceof VelaError) return failure.code;
  return failure;
}

describe("pauseApiMember", () => {
  it("pauses and resumes the caller's own membership", async () => {
    const paused = await pause(sam, samId, true);
    expect(ApiMemberPause.parse(paused.response.body)).toEqual({
      member_id: samId,
      status: "paused",
    });
    expect((await statusOf(samId))?.status).toBe("paused");

    const resumed = await pause(sam, samId, false);
    expect(ApiMemberPause.parse(resumed.response.body).status).toBe("active");
    expect((await statusOf(samId))?.status).toBe("active");
  });

  it("answers a pause already in place as it stands, and replays a repeated key", async () => {
    await pause(sam, samId, true);
    const again = await pause(sam, samId, true);
    expect(again.response.body).toEqual({ member_id: samId, status: "paused" });

    const first = await pause(sam, samId, false, "same");
    const replay = await pause(sam, samId, false, "same");
    expect(replay.replayed).toBe(true);
    expect(replay.response).toEqual(first.response);
  });

  it("lets an organiser pause while another is active, and refuses the last one", async () => {
    await pause(mia, seed.organiser.id, true);
    expect((await statusOf(seed.organiser.id))?.status).toBe("paused");

    expect(await refusal(pause(anna, annaId, true))).toBe("last_organiser");
    expect((await statusOf(annaId))?.status).toBe("active");

    // Resuming is never refused, and then the other may pause.
    await pause(mia, seed.organiser.id, false);
    await pause(anna, annaId, true);
    expect((await statusOf(annaId))?.status).toBe("paused");
  });

  it("refuses a kept-light member, whose pause goes through her own chat", async () => {
    expect(await refusal(pause(mom, seed.member.id, true))).toBe("kept_light");
    expect((await statusOf(seed.member.id))?.status).toBe("active");
  });

  it("acts on nobody's membership but the caller's own", async () => {
    expect(await refusal(pause(mia, samId, true))).toBe("not_found");
    expect(await refusal(pause(stranger, samId, true))).toBe("not_found");
    expect((await statusOf(samId))?.status).toBe("active");
    await expect(
      pauseApiMember(h.deps, sam, "k", seed.family.id, samId, { paused: true, why: "x" }),
    ).rejects.toThrow(ApiIdempotencyError);
  });
});

describe("leaveApiFamily", () => {
  it("leaves: out of the turns, the family closed to the caller, one member_left event", async () => {
    const result = await leave(sam, samId, "leave-1");
    expect(ApiLeft.parse(result.response.body)).toEqual({
      member_id: samId,
      left_at: h.clock.now().toISOString(),
    });
    expect(await statusOf(samId)).toMatchObject({
      status: "left",
      leftAt: h.clock.now(),
      turnsIn: false,
    });
    const recorded = await h.db
      .select()
      .from(events)
      .where(and(eq(events.name, "member_left"), eq(events.memberId, samId)));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.props).toEqual({ source: "app", role: "member", kept_light: false });
    expect(await loadApiFamily(h.db, sam, seed.family.id)).toBeNull();
  });

  it("replays the leave that made the caller a non-member, and answers a later one as it stands", async () => {
    const first = await leave(sam, samId, "leave-1");
    const replay = await leave(sam, samId, "leave-1");
    expect(replay.replayed).toBe(true);
    expect(replay.response).toEqual(first.response);

    h.clock.set(new Date(h.clock.now().getTime() + 60_000));
    const later = await leave(sam, samId);
    expect(later.replayed).toBe(false);
    expect(later.response.body).toEqual(first.response.body);
    expect(
      await h.db
        .select()
        .from(events)
        .where(and(eq(events.name, "member_left"), eq(events.memberId, samId))),
    ).toHaveLength(1);
  });

  it("refuses the last active organiser, counting a paused one as not there", async () => {
    await leave(mia, seed.organiser.id);
    expect(await refusal(leave(anna, annaId))).toBe("last_organiser");

    await h.db
      .update(members)
      .set({ status: "active", leftAt: null })
      .where(eq(members.id, seed.organiser.id));
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, annaId));
    expect(await refusal(leave(mia, seed.organiser.id))).toBe("last_organiser");
    expect((await statusOf(seed.organiser.id))?.status).toBe("active");
  });

  it("refuses a kept-light member, and acts on nobody's membership but the caller's", async () => {
    expect(await refusal(leave(mom, seed.member.id))).toBe("kept_light");
    expect(await refusal(leave(mia, samId))).toBe("not_found");
    expect(await refusal(leave(stranger, samId))).toBe("not_found");
    expect((await statusOf(samId))?.status).toBe("active");
    expect((await statusOf(seed.member.id))?.status).toBe("active");
  });
});
