import { apiRequestReceipts, channelLinks, events, members, users } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import {
  deviceTokenHash,
  memberOfDeviceToken,
  removeApiDevice,
  setUpApiDevice,
} from "./api-device.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-2" };

async function account(identity: SessionIdentity, memberId: string): Promise<void> {
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

async function setUp(who: SessionIdentity = mia, memberId = seed.member.id) {
  return (await setUpApiDevice(h.deps, who, seed.family.id, memberId)).body;
}

async function deviceLinks() {
  return h.db
    .select()
    .from(channelLinks)
    .where(and(eq(channelLinks.memberId, seed.member.id), eq(channelLinks.channel, "device")));
}

describe("setUpApiDevice", () => {
  it("sets her phone up, keeping only the token's hash, and makes it the surface she answers on", async () => {
    const { member_id, token } = await setUp();

    expect(member_id).toBe(seed.member.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [link] = await deviceLinks();
    expect(link?.externalId).toBe(await deviceTokenHash(token));
    expect(link?.externalId).not.toContain(token);
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.primarySurface).toBe("parent-surface");
    const [event] = await h.db.select().from(events).where(eq(events.name, "device_set_up"));
    expect(event?.props).toEqual({ by: seed.organiser.id });
  });

  it("keeps no receipt that could hold the token", async () => {
    await setUp();
    expect(await h.db.select().from(apiRequestReceipts)).toEqual([]);
  });

  it("finds her by the token, and by nothing else", async () => {
    const { token } = await setUp();

    expect((await memberOfDeviceToken(h.db, token))?.id).toBe(seed.member.id);
    expect(await memberOfDeviceToken(h.db, `${token.slice(0, -1)}A`)).toBeNull();
    expect(await memberOfDeviceToken(h.db, await deviceTokenHash(token))).toBeNull();
    expect(await memberOfDeviceToken(h.db, "")).toBeNull();
  });

  it("voids the earlier phone when she is set up again", async () => {
    const first = await setUp();
    const second = await setUp();

    expect(await deviceLinks()).toHaveLength(1);
    expect(await memberOfDeviceToken(h.db, first.token)).toBeNull();
    expect((await memberOfDeviceToken(h.db, second.token))?.id).toBe(seed.member.id);
  });

  it("sets up a phone for her before her yes, so she can answer it there", async () => {
    await h.db
      .update(members)
      .set({ status: "invited", lightOn: false, lightConsentedAt: null })
      .where(eq(members.id, seed.member.id));

    const { token } = await setUp();
    expect((await memberOfDeviceToken(h.db, token))?.status).toBe("invited");
  });

  it("refuses a member who does not organise, and anyone who is not her", async () => {
    await expect(setUp(sam)).rejects.toThrow(VelaError);
    await expect(setUp(mia, seed.organiser.id)).rejects.toThrow(VelaError);
    await expect(setUp(mia, "not-a-uuid")).rejects.toThrow(VelaError);
    expect(await deviceLinks()).toEqual([]);
  });

  it("stops answering for her once she has left", async () => {
    const { token } = await setUp();
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    expect(await memberOfDeviceToken(h.db, token)).toBeNull();
  });
});

describe("removeApiDevice", () => {
  it("takes her phone off at once and puts her back on Telegram, where she has a link", async () => {
    const { token } = await setUp();

    const result = await removeApiDevice(h.deps, mia, "rm-1", seed.family.id, seed.member.id);

    expect(result.response).toEqual({
      status: 200,
      body: { member_id: seed.member.id, removed: true },
    });
    expect(await memberOfDeviceToken(h.db, token)).toBeNull();
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.primarySurface).toBe("telegram");
  });

  it("answers removed for a phone that was never set up, and records nothing", async () => {
    const result = await removeApiDevice(h.deps, mia, "rm-2", seed.family.id, seed.member.id);
    expect(result.response.status).toBe(200);
    expect(await h.db.select().from(events).where(eq(events.name, "device_removed"))).toEqual([]);
  });

  it("refuses a member who does not organise", async () => {
    await setUp();
    await expect(
      removeApiDevice(h.deps, sam, "rm-3", seed.family.id, seed.member.id),
    ).rejects.toThrow(VelaError);
    expect(await deviceLinks()).toHaveLength(1);
  });
});
