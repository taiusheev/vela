import { randomUUID } from "node:crypto";
import { ApiFamily } from "@vela/contracts";
import { channelLinks, members, pushDevices, subscriptions, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiFamily } from "./api-family.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let samId: string;
const organiser: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const sibling: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-2" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-3" };
const missingId = "00000000-0000-4000-8000-000000000001";

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
  await account(organiser, seed.organiser.id);
  const sam = await seedGroupMember(h.db, seed, {
    now: new Date(h.clock.now().getTime() + 1_000),
    name: "Sam",
    externalId: "4002",
  });
  samId = sam.member.id;
  await account(sibling, samId);
});
afterAll(async () => {
  await h.close();
});

async function family(who: SessionIdentity = organiser, id: string = seed.family.id) {
  return loadApiFamily(h.db, who, id);
}

describe("loadApiFamily", () => {
  it("lists the live members in the order they joined, each with their light", async () => {
    const read = ApiFamily.parse(await family());
    expect(read.family).toEqual({ id: seed.family.id, name: "The Chens", plan: "free" });
    expect(read.me).toEqual({ member_id: seed.organiser.id, role: "organiser" });
    expect(read.members).toEqual([
      {
        member_id: seed.organiser.id,
        display_name: "Mia",
        role: "organiser",
        status: "active",
        light: "off",
        subscription: null,
      },
      {
        member_id: seed.member.id,
        display_name: "Mom",
        role: "member",
        status: "active",
        light: "on",
        subscription: null,
      },
      {
        member_id: samId,
        display_name: "Sam",
        role: "member",
        status: "active",
        light: "off",
        subscription: null,
      },
    ]);
  });

  it("carries where her Vela Light trial stands", async () => {
    const trialEnds = new Date(h.clock.now().getTime() + 30 * 24 * 60 * 60_000);
    await h.db.insert(subscriptions).values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      provider: "trial",
      status: "trial",
      trialEndsAt: trialEnds,
    });
    const her = (await family())?.members.find((member) => member.member_id === seed.member.id);
    expect(her?.subscription).toEqual({
      status: "trial",
      trial_ends_at: trialEnds.toISOString(),
      current_period_end: null,
    });
  });

  it("shows a member invited and not yet answered as waiting, a paused one as paused, and not one who left", async () => {
    const [invited] = await h.db
      .insert(members)
      .values({
        familyId: seed.family.id,
        role: "member",
        displayName: "Grandpa",
        tz: seed.member.tz,
        country: "TW",
        status: "invited",
        turnsIn: false,
      })
      .returning();
    if (invited === undefined) throw new Error("expected an invited member");
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, samId));

    const read = await family();
    expect(
      read?.members.map((member) => [member.display_name, member.status, member.light]),
    ).toEqual([
      ["Mia", "active", "off"],
      ["Mom", "paused", "on"],
      ["Grandpa", "invited", "waiting"],
    ]);
  });

  it("gives the organisers the people nearby with where their yes stands, and never a number", async () => {
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Lena",
      relation: "neighbour",
      answer: { yes: { phone: "+886 2 1234 5678" } },
    });
    await seedNearbyContact(h.db, seed, { now: h.clock.now(), name: "Petro", answer: null });
    await seedNearbyContact(h.db, seed, { now: h.clock.now(), name: "Olga", answer: "no" });

    const read = await family();
    expect(read?.nearby).toEqual([
      {
        id: expect.any(String),
        near_member_id: seed.member.id,
        name: "Lena",
        relation: "neighbour",
        consent: "yes",
      },
      {
        id: expect.any(String),
        near_member_id: seed.member.id,
        name: "Petro",
        relation: null,
        consent: "waiting",
      },
      {
        id: expect.any(String),
        near_member_id: seed.member.id,
        name: "Olga",
        relation: null,
        consent: "no",
      },
    ]);
    // Match the complete phone, allowing formatting; random UUIDs may contain its digits.
    expect(JSON.stringify(read)).not.toMatch(/\+886\s*2\s*1234\s*5678/);
  });

  it("leaves the people nearby out for anyone who is not an organiser", async () => {
    await seedNearbyContact(h.db, seed, { now: h.clock.now(), name: "Lena", answer: null });
    const read = await family(sibling);
    expect(read?.me).toEqual({ member_id: samId, role: "member" });
    expect(read?.members).toHaveLength(3);
    expect(read?.nearby).toBeNull();
  });

  describe("how an organiser would be told if her morning goes quiet (ADR-34)", () => {
    async function phoneOf(
      identity: SessionIdentity,
      patch: Partial<Pick<typeof pushDevices.$inferInsert, "permission" | "quietChannelBlocked">>,
    ) {
      const [user] = await h.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.authSubject, identity.authSubject));
      if (user === undefined) throw new Error("expected an account");
      await h.db.insert(pushDevices).values({
        userId: user.id,
        installationId: randomUUID(),
        token: `${["Exponent", "PushToken"].join("")}[family-test-${randomUUID()}]`,
        platform: "android",
        permission: "granted",
        quietChannelBlocked: false,
        ...patch,
      });
    }

    it("says Telegram for an organiser with an unblocked link, and no phone while push is off", async () => {
      await phoneOf(organiser, {});
      expect((await family())?.told_if_quiet).toEqual({ telegram: true, app: false });
    });

    it("counts a phone that can be told only while this API sends pushes", async () => {
      await phoneOf(organiser, {});
      const read = await loadApiFamily(h.db, organiser, seed.family.id, true);
      expect(read?.told_if_quiet).toEqual({ telegram: true, app: true });
    });

    it("says neither for a blocked link and phones that cannot be told", async () => {
      await h.db
        .update(channelLinks)
        .set({ blockedAt: h.clock.now() })
        .where(eq(channelLinks.memberId, seed.organiser.id));
      await phoneOf(organiser, { permission: "denied" });
      await phoneOf(organiser, { quietChannelBlocked: true });
      await phoneOf(organiser, { permission: "provisional" });
      const read = await loadApiFamily(h.db, organiser, seed.family.id, true);
      expect(read?.told_if_quiet).toEqual({ telegram: false, app: false });
    });

    it("is null for anyone who does not organise, whom a quiet notice never reaches", async () => {
      await phoneOf(sibling, {});
      expect((await loadApiFamily(h.db, sibling, seed.family.id, true))?.told_if_quiet).toBeNull();
    });
  });

  it("answers null for a stranger, a family that is not the caller's, and one that does not exist", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "9001",
      memberExternalId: "9002",
    });
    expect(await family(stranger)).toBeNull();
    expect(await family(organiser, other.family.id)).toBeNull();
    expect(await family(organiser, missingId)).toBeNull();
    expect(await family(organiser, "not-a-uuid")).toBeNull();
  });
});
