import { ApiFamilyPlan, ApiMe, ApiUser } from "@vela/contracts";
import { channelLinks, events, families, members, subscriptions, users } from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiFamilyPlan, loadApiMe, provisionApiUser } from "./api-accounts.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;

const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const profile = { display_name: "Mia", language: "en", tz: "Asia/Taipei" };
const missingId = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

async function seedAccount() {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({
      authSubject: identity.authSubject,
      displayName: profile.display_name,
      language: "en",
      tz: profile.tz,
      email: "mia@example.test",
      phone: "+886900000001",
    })
    .returning();
  if (user === undefined) {
    throw new Error("expected a seeded user");
  }
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.member.id));
  return { ...seed, user };
}

async function seedOtherFamily() {
  return seedFamily(h.db, {
    now: h.clock.now(),
    organiserExternalId: "3001",
    memberExternalId: "3002",
  });
}

async function addSubscription(familyId: string, memberId: string) {
  await h.db
    .insert(subscriptions)
    .values({ familyId, memberId, provider: "trial", status: "trial" });
}

describe("provisionApiUser", () => {
  it("creates only the account profile, trims its name, and returns the public wire shape", async () => {
    const claimedIdentity = { ...identity, email: "private@example.test", phone: "+886900000002" };
    const user = await provisionApiUser(h.db, claimedIdentity, {
      ...profile,
      display_name: "  Mia  ",
    });

    expect(user).toEqual({ id: expect.any(String), ...profile });
    expect(ApiUser.parse(user)).toEqual(user);
    expect(await h.db.select().from(users)).toEqual([
      expect.objectContaining({
        id: user.id,
        authSubject: identity.authSubject,
        displayName: "Mia",
        language: "en",
        tz: profile.tz,
        email: null,
        phone: null,
        deletedAt: null,
      }),
    ]);
    expect(await h.db.select().from(members)).toEqual([]);
    expect(await h.db.select().from(families)).toEqual([]);
    expect(await h.db.select().from(channelLinks)).toEqual([]);
    expect(await h.db.select().from(events)).toEqual([]);
    expect(h.queues.outbound.pending).toEqual([]);
    expect(h.queues.media.pending).toEqual([]);
    expect(h.queues.understand.pending).toEqual([]);
  });

  it("is idempotent and never overwrites the first profile or UUID", async () => {
    const first = await provisionApiUser(h.db, identity, profile);
    const before = await h.db.select().from(users);

    expect(
      await provisionApiUser(
        h.db,
        { ...identity, sessionId: "another-session" },
        {
          display_name: "Replacement",
          language: "ru",
          tz: "UTC",
        },
      ),
    ).toEqual(first);
    expect(await h.db.select().from(users)).toEqual(before);
  });

  it("resolves racing calls to a single unchanged account", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        provisionApiUser(h.db, identity, { ...profile, display_name: `First ${index}` }),
      ),
    );
    const [first] = results;
    expect(first).toBeDefined();
    for (const result of results) {
      expect(result).toEqual(first);
    }
    const rows = await h.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first?.id, displayName: first?.display_name });
  });

  it("does not resurrect or alter a soft-deleted account", async () => {
    const seed = await seedAccount();
    await h.db.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, seed.user.id));
    const before = await h.db.select().from(users);

    await expect(
      provisionApiUser(h.db, identity, { ...profile, display_name: "New name" }),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    expect(await h.db.select().from(users)).toEqual(before);
  });

  it("does not link Telegram members or match a legacy user by email or phone", async () => {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      memberExternalId: "mia@example.test",
    });
    await h.db
      .insert(users)
      .values({ displayName: "Legacy", email: "mia@example.test", phone: "+886900000003" });
    const beforeMembers = await h.db.select().from(members);
    const beforeLinks = await h.db.select().from(channelLinks);
    const externalIdentity = {
      ...identity,
      authSubject: seed.memberLink.externalId,
      phone: "+886900000003",
    };
    const user = await provisionApiUser(h.db, externalIdentity, profile);

    expect(await h.db.select().from(users)).toHaveLength(2);
    expect(await loadApiMe(h.db, externalIdentity)).toEqual({ user, memberships: [] });
    expect(await h.db.select().from(members)).toEqual(beforeMembers);
    expect(await h.db.select().from(channelLinks)).toEqual(beforeLinks);
  });

  it.each([
    null,
    {},
    { ...profile, display_name: " \t\n" },
    { ...profile, display_name: "x".repeat(81) },
    { ...profile, display_name: 123 },
    { ...profile, language: "invalid-secret" },
    { ...profile, tz: "invalid-secret" },
    ...[
      "id",
      "authSubject",
      "email",
      "phone",
      "role",
      "family_id",
      "member_id",
      "plan",
      "deletedAt",
      "billing",
    ].map((field) => ({ ...profile, [field]: "private-secret" })),
  ])(
    "rejects invalid or privileged profile %j without querying or exposing input",
    async (invalidProfile) => {
      const insert = vi.spyOn(h.db, "insert");
      const select = vi.spyOn(h.db, "select");
      try {
        const error = await provisionApiUser(h.db, identity, invalidProfile).catch(
          (error: unknown) => error,
        );
        expect(error).toBeInstanceOf(VelaError);
        expect(error).toMatchObject({
          code: "invalid_payload",
          message: "Invalid account profile",
        });
        expect(insert).not.toHaveBeenCalled();
        expect(select).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    },
  );
});

describe("account identity validation", () => {
  it.each([
    { ...identity, authSubject: "" },
    { ...identity, authSubject: " \t\n" },
    { ...identity, sessionId: "" },
    { ...identity, sessionId: " \t\n" },
  ])("fails closed before touching the database for %j", async (invalidIdentity) => {
    const insert = vi.spyOn(h.db, "insert");
    const select = vi.spyOn(h.db, "select");
    try {
      await expect(provisionApiUser(h.db, invalidIdentity, profile)).rejects.toMatchObject({
        name: "VelaError",
        code: "not_found",
      });
      expect(await loadApiMe(h.db, invalidIdentity)).toBeNull();
      expect(await loadApiFamilyPlan(h.db, invalidIdentity, missingId)).toBeNull();
      expect(insert).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each(["unknown", "auth|mia", " auth|Mia", "auth|Mia ", "mia@example.test"])(
    "reads require the exact auth subject rather than %j or claimed ids",
    async (authSubject) => {
      const seed = await seedAccount();
      const claimed = {
        ...identity,
        authSubject,
        userId: seed.user.id,
        memberId: seed.member.id,
        familyId: seed.family.id,
        role: "organiser",
      };
      expect(await loadApiMe(h.db, claimed)).toBeNull();
      expect(await loadApiFamilyPlan(h.db, claimed, seed.family.id)).toBeNull();
    },
  );
});

describe("loadApiMe", () => {
  it("returns null for absent, unmapped, and deleted accounts", async () => {
    expect(await loadApiMe(h.db, identity)).toBeNull();
    const seed = await seedAccount();
    await h.db.update(users).set({ authSubject: null }).where(eq(users.id, seed.user.id));
    expect(await loadApiMe(h.db, identity)).toBeNull();
    await h.db
      .update(users)
      .set({ authSubject: identity.authSubject, deletedAt: h.clock.now() })
      .where(eq(users.id, seed.user.id));
    expect(await loadApiMe(h.db, identity)).toBeNull();
  });

  it("returns the safe user with no memberships when none are linked", async () => {
    const user = await provisionApiUser(h.db, identity, profile);
    expect(await loadApiMe(h.db, identity)).toEqual({ user, memberships: [] });
  });

  it("returns only visible own memberships, ordered by createdAt then id", async () => {
    const seed = await seedAccount();
    const other = await seedOtherFamily();
    await h.db
      .update(members)
      .set({ userId: seed.user.id, status: "paused" })
      .where(eq(members.id, other.organiser.id));
    const [third] = await h.db
      .insert(families)
      .values({ name: "Third", region: "apac", country: "TW" })
      .returning();
    if (third === undefined) {
      throw new Error("expected family");
    }
    const [thirdMember] = await h.db
      .insert(members)
      .values({
        familyId: third.id,
        userId: seed.user.id,
        displayName: "Mia",
        role: "member",
        status: "active",
        tz: "UTC",
        country: "TW",
        createdAt: new Date("2020-01-01T00:00:00Z"),
      })
      .returning();
    if (thirdMember === undefined) {
      throw new Error("expected membership");
    }
    const result = await loadApiMe(h.db, identity);
    const tiedMembers = [seed.member, { ...other.organiser, status: "paused" }].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    expect(result?.user).toEqual({ id: seed.user.id, ...profile });
    expect(result?.memberships.map((membership) => membership.member_id)).toEqual([
      thirdMember.id,
      ...tiedMembers.map((member) => member.id),
    ]);
    expect(result?.memberships).toContainEqual({
      member_id: other.organiser.id,
      role: "organiser",
      status: "paused",
      family: { id: other.family.id, name: other.family.name, region: "apac", plan: "free" },
    });
    expect(ApiMe.parse(result)).toEqual(result);
    expect(Object.keys(result?.user ?? {}).sort()).toEqual([
      "display_name",
      "id",
      "language",
      "tz",
    ]);
    expect(result?.memberships).toHaveLength(3);
  });

  it.each(["invited", "left", "deceased", "leftAt", "deletedFamily"] as const)(
    "omits %s membership while retaining the user",
    async (hidden) => {
      const seed = await seedAccount();
      if (hidden === "deletedFamily") {
        await h.db
          .update(families)
          .set({ deletedAt: h.clock.now() })
          .where(eq(families.id, seed.family.id));
      } else {
        await h.db
          .update(members)
          .set(hidden === "leftAt" ? { leftAt: h.clock.now() } : { status: hidden })
          .where(eq(members.id, seed.member.id));
      }
      expect(await loadApiMe(h.db, identity)).toEqual({
        user: { id: seed.user.id, ...profile },
        memberships: [],
      });
    },
  );
});

describe("loadApiFamilyPlan", () => {
  it.each(["active", "paused"] as const)(
    "allows an ordinary %s member and returns an empty stored plan",
    async (status) => {
      const seed = await seedAccount();
      await h.db.update(members).set({ status }).where(eq(members.id, seed.member.id));
      const result = await loadApiFamilyPlan(h.db, identity, seed.family.id);
      expect(result).toEqual({ family_id: seed.family.id, plan: "free", subscriptions: [] });
      expect(ApiFamilyPlan.parse(result)).toEqual(result);
    },
  );

  it.each(["trial", "active", "grace", "lapsed", "cancelled"] as const)(
    "returns stored %s status and ISO dates without financial or identity fields",
    async (status) => {
      const seed = await seedAccount();
      const trialEndsAt = new Date("2020-01-01T12:00:00+08:00");
      const currentPeriodEnd = new Date("2021-02-03T04:05:06.789Z");
      const graceUntil = new Date("2021-02-10T00:00:00Z");
      await h.db.insert(subscriptions).values({
        familyId: seed.family.id,
        memberId: seed.organiser.id,
        payerUserId: seed.user.id,
        provider: "stripe",
        externalId: "secret-payment-id",
        status,
        planInterval: "year",
        currency: "USD",
        priceCents: 9999,
        trialEndsAt,
        currentPeriodEnd,
        graceUntil,
      });
      await addSubscription(seed.family.id, seed.member.id);
      await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.organiser.id));
      const result = await loadApiFamilyPlan(h.db, identity, seed.family.id);
      expect(result?.subscriptions).toEqual(
        expect.arrayContaining([
          {
            member_id: seed.organiser.id,
            status,
            trial_ends_at: trialEndsAt.toISOString(),
            current_period_end: currentPeriodEnd.toISOString(),
            grace_until: graceUntil.toISOString(),
          },
          {
            member_id: seed.member.id,
            status: "trial",
            trial_ends_at: null,
            current_period_end: null,
            grace_until: null,
          },
        ]),
      );
      expect(result?.subscriptions).toHaveLength(2);
      expect(result?.plan).toBe(seed.family.plan);
      await h.db.update(families).set({ plan: "light" }).where(eq(families.id, seed.family.id));
      expect((await loadApiFamilyPlan(h.db, identity, seed.family.id))?.plan).toBe("light");
      expect(ApiFamilyPlan.parse(result)).toEqual(result);
      expect(Object.keys(result ?? {}).sort()).toEqual(["family_id", "plan", "subscriptions"]);
      for (const subscription of result?.subscriptions ?? []) {
        expect(Object.keys(subscription).sort()).toEqual([
          "current_period_end",
          "grace_until",
          "member_id",
          "status",
          "trial_ends_at",
        ]);
      }
      expect(JSON.stringify(result)).not.toContain("secret-payment-id");
    },
  );

  it("hides subscriptions whose family and covered member disagree in either direction", async () => {
    const seed = await seedAccount();
    const other = await seedOtherFamily();
    await addSubscription(seed.family.id, other.member.id);
    await addSubscription(other.family.id, seed.organiser.id);
    await addSubscription(other.family.id, other.organiser.id);

    expect(await loadApiFamilyPlan(h.db, identity, seed.family.id)).toEqual({
      family_id: seed.family.id,
      plan: "free",
      subscriptions: [],
    });
    expect(await loadApiFamilyPlan(h.db, identity, other.family.id)).toBeNull();
    await addSubscription(seed.family.id, seed.member.id);
    expect(
      (await loadApiFamilyPlan(h.db, identity, seed.family.id))?.subscriptions.map(
        (subscription) => subscription.member_id,
      ),
    ).toEqual([seed.member.id]);
  });

  it.each(["invited", "left", "deceased", "leftAt"] as const)(
    "hides a covered member with %s without confusing them with the authorized viewer",
    async (hidden) => {
      const seed = await seedAccount();
      await addSubscription(seed.family.id, seed.organiser.id);
      await h.db
        .update(members)
        .set(hidden === "leftAt" ? { leftAt: h.clock.now() } : { status: hidden })
        .where(eq(members.id, seed.organiser.id));
      expect(await loadApiFamilyPlan(h.db, identity, seed.family.id)).toEqual({
        family_id: seed.family.id,
        plan: "free",
        subscriptions: [],
      });
    },
  );

  it.each(["invited", "left", "deceased", "leftAt", "user", "family", "unlinked"] as const)(
    "rechecks %s revocation on the same session without trusting claimed access",
    async (revoked) => {
      const seed = await seedAccount();
      await addSubscription(seed.family.id, seed.organiser.id);
      const claimed = {
        ...identity,
        userId: seed.user.id,
        memberId: seed.member.id,
        familyId: seed.family.id,
        role: "organiser",
      };
      expect(await loadApiFamilyPlan(h.db, claimed, seed.family.id)).not.toBeNull();
      if (revoked === "user") {
        await h.db
          .update(users)
          .set({ deletedAt: h.clock.now() })
          .where(eq(users.id, seed.user.id));
      } else if (revoked === "family") {
        await h.db
          .update(families)
          .set({ deletedAt: h.clock.now() })
          .where(eq(families.id, seed.family.id));
      } else {
        const change =
          revoked === "leftAt"
            ? { leftAt: h.clock.now() }
            : revoked === "unlinked"
              ? { userId: null }
              : { status: revoked };
        await h.db.update(members).set(change).where(eq(members.id, seed.member.id));
      }
      expect(await loadApiFamilyPlan(h.db, claimed, seed.family.id)).toBeNull();
      const me = await loadApiMe(h.db, claimed);
      if (revoked === "user") {
        expect(me).toBeNull();
      } else {
        expect(me?.memberships).toEqual([]);
      }
    },
  );

  it("uses the same absence for unknown accounts, missing families, and nonmembers", async () => {
    const seed = await seedAccount();
    const other = await seedOtherFamily();
    expect(
      await loadApiFamilyPlan(h.db, { ...identity, authSubject: "unknown" }, seed.family.id),
    ).toBeNull();
    expect(await loadApiFamilyPlan(h.db, identity, missingId)).toBeNull();
    expect(await loadApiFamilyPlan(h.db, identity, other.family.id)).toBeNull();
  });

  it.each(["", " ", "not-a-uuid", `${missingId} `, "' OR true --"])(
    "rejects invalid family id %j before querying",
    async (familyId) => {
      const select = vi.spyOn(h.db, "select");
      try {
        expect(await loadApiFamilyPlan(h.db, identity, familyId)).toBeNull();
        expect(select).not.toHaveBeenCalled();
      } finally {
        select.mockRestore();
      }
    },
  );
});

describe("account read query boundaries", () => {
  it("performs one SELECT per read and no writes, including absence", async () => {
    const seed = await seedAccount();
    await addSubscription(seed.family.id, seed.organiser.id);
    const select = vi.spyOn(h.db, "select");
    const insert = vi.spyOn(h.db, "insert");
    const update = vi.spyOn(h.db, "update");
    const remove = vi.spyOn(h.db, "delete");
    const execute = vi.spyOn(h.db, "execute");
    try {
      await loadApiMe(h.db, identity);
      expect(select).toHaveBeenCalledTimes(1);
      await loadApiFamilyPlan(h.db, identity, seed.family.id);
      expect(select).toHaveBeenCalledTimes(2);
      await loadApiMe(h.db, { ...identity, authSubject: "unknown" });
      expect(select).toHaveBeenCalledTimes(3);
      await loadApiFamilyPlan(h.db, identity, missingId);
      expect(select).toHaveBeenCalledTimes(4);
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("works inside a read-only transaction", async () => {
    const seed = await seedAccount();
    await addSubscription(seed.family.id, seed.organiser.id);
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      expect(await loadApiMe(tx, identity)).not.toBeNull();
      expect(await loadApiFamilyPlan(tx, identity, seed.family.id)).not.toBeNull();
      expect(await loadApiMe(tx, { ...identity, authSubject: "unknown" })).toBeNull();
      expect(await loadApiFamilyPlan(tx, identity, missingId)).toBeNull();
    });
  });

  it("accepts caller transactions and observes uncommitted revocation", async () => {
    const seed = await seedAccount();
    await h.db.transaction(async (tx) => {
      expect(await provisionApiUser(tx, identity, profile)).toEqual({
        id: seed.user.id,
        ...profile,
      });
      expect(await loadApiMe(tx, identity)).not.toBeNull();
      expect(await loadApiFamilyPlan(tx, identity, seed.family.id)).not.toBeNull();
      await tx.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, seed.user.id));
      expect(await loadApiMe(tx, identity)).toBeNull();
      expect(await loadApiFamilyPlan(tx, identity, seed.family.id)).toBeNull();
    });
  });
});
