import { families, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;

const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const missingFamilyId = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

async function seedAccount(member: "organiser" | "member" = "organiser") {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, email: "mia@example.test", displayName: "Mia" })
    .returning();
  if (user === undefined) {
    throw new Error("expected a seeded user");
  }
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed[member].id));
  return { ...seed, user, accountMember: seed[member] };
}

describe("authorizeFamilyAccess", () => {
  it.each(["active", "paused"] as const)(
    "grants an %s organiser using database ids and role",
    async (status) => {
      const seed = await seedAccount();
      await h.db.update(members).set({ status }).where(eq(members.id, seed.organiser.id));
      const expected = {
        kind: "granted",
        access: {
          userId: seed.user.id,
          memberId: seed.organiser.id,
          familyId: seed.family.id,
          role: "organiser",
        },
      };

      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toEqual(expected);
      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toEqual(
        expected,
      );
    },
  );

  it.each(["active", "paused"] as const)(
    "allows an %s ordinary member by default but forbids organiser-only access",
    async (status) => {
      const seed = await seedAccount("member");
      await h.db.update(members).set({ status }).where(eq(members.id, seed.member.id));

      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toEqual({
        kind: "granted",
        access: {
          userId: seed.user.id,
          memberId: seed.member.id,
          familyId: seed.family.id,
          role: "member",
        },
      });
      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toEqual({
        kind: "forbidden",
      });
    },
  );

  it("does not let an organiser access another family or carry their role into it", async () => {
    const seed = await seedAccount();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "3001",
      memberExternalId: "3002",
    });

    expect(await authorizeFamilyAccess(h.db, identity, other.family.id)).toEqual({
      kind: "not_found",
    });
    expect(await authorizeFamilyAccess(h.db, identity, other.family.id, "organiser")).toEqual({
      kind: "not_found",
    });
    await h.db.update(members).set({ userId: seed.user.id }).where(eq(members.id, other.member.id));
    expect(await authorizeFamilyAccess(h.db, identity, other.family.id, "organiser")).toEqual({
      kind: "forbidden",
    });
    expect(await authorizeFamilyAccess(h.db, identity, other.family.id)).toEqual({
      kind: "granted",
      access: {
        userId: seed.user.id,
        memberId: other.member.id,
        familyId: other.family.id,
        role: "member",
      },
    });
  });

  it.each(["unknown", "auth|mia", " auth|Mia", "auth|Mia ", "mia@example.test"])(
    "requires the exact stored auth subject, not %s",
    async (authSubject) => {
      const seed = await seedAccount();
      const claimedIdentity = {
        ...identity,
        authSubject,
        email: seed.user.email,
        role: "organiser",
        userId: seed.user.id,
        memberId: seed.organiser.id,
        familyId: seed.family.id,
      };

      expect(await authorizeFamilyAccess(h.db, claimedIdentity, seed.family.id)).toEqual({
        kind: "not_found",
      });
    },
  );

  it("ignores claimed role and membership ids even for a mapped identity", async () => {
    const seed = await seedAccount("member");
    const claimedIdentity = { ...identity, role: "organiser", memberId: seed.organiser.id };

    expect(await authorizeFamilyAccess(h.db, claimedIdentity, seed.family.id, "organiser")).toEqual(
      { kind: "forbidden" },
    );
  });

  it("treats email-shaped subjects as opaque exact mappings, not email lookups", async () => {
    const seed = await seedAccount();
    await h.db
      .update(users)
      .set({ authSubject: "subject@example.test" })
      .where(eq(users.id, seed.user.id));

    expect(
      await authorizeFamilyAccess(
        h.db,
        { ...identity, authSubject: "subject@example.test" },
        seed.family.id,
      ),
    ).toMatchObject({ kind: "granted" });
    expect(
      await authorizeFamilyAccess(
        h.db,
        { ...identity, authSubject: "mia@example.test" },
        seed.family.id,
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("returns the same absence for unknown users, nonmembers, and nonexistent families without creating users", async () => {
    const seed = await seedAccount();
    const before = await h.db.select().from(users);

    expect(
      await authorizeFamilyAccess(
        h.db,
        { ...identity, authSubject: "unknown" },
        seed.family.id,
        "organiser",
      ),
    ).toEqual({ kind: "not_found" });
    expect(await authorizeFamilyAccess(h.db, identity, missingFamilyId, "organiser")).toEqual({
      kind: "not_found",
    });
    await h.db.update(members).set({ userId: null }).where(eq(members.id, seed.organiser.id));
    expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toEqual({
      kind: "not_found",
    });
    expect(await h.db.select().from(users)).toEqual(before);
  });

  it.each(["user", "family"] as const)(
    "hides a soft-deleted %s even for an organiser",
    async (deleted) => {
      const seed = await seedAccount();
      if (deleted === "user") {
        await h.db
          .update(users)
          .set({ deletedAt: h.clock.now() })
          .where(eq(users.id, seed.user.id));
      } else {
        await h.db
          .update(families)
          .set({ deletedAt: h.clock.now() })
          .where(eq(families.id, seed.family.id));
      }

      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toEqual({
        kind: "not_found",
      });
      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toEqual({
        kind: "not_found",
      });
    },
  );

  it.each(["invited", "left", "deceased"] as const)(
    "hides %s membership regardless of its role",
    async (status) => {
      const seed = await seedAccount();
      await h.db.update(members).set({ status }).where(eq(members.id, seed.organiser.id));

      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toEqual({
        kind: "not_found",
      });
      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toEqual({
        kind: "not_found",
      });
    },
  );

  it.each(["active", "paused"] as const)(
    "hides an inconsistent %s membership with leftAt set",
    async (status) => {
      const seed = await seedAccount();
      await h.db
        .update(members)
        .set({ status, leftAt: h.clock.now() })
        .where(eq(members.id, seed.organiser.id));

      expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toEqual({
        kind: "not_found",
      });
    },
  );

  it("does not link an account with no auth subject by its email or id", async () => {
    const seed = await seedAccount();
    await h.db.update(users).set({ authSubject: null }).where(eq(users.id, seed.user.id));

    for (const authSubject of [identity.authSubject, "mia@example.test", seed.user.id]) {
      expect(
        await authorizeFamilyAccess(h.db, { ...identity, authSubject }, seed.family.id),
      ).toEqual({ kind: "not_found" });
    }
  });

  it("does not authorize or auto-link Telegram-only members by channel identity", async () => {
    const seed = await seedAccount();
    await h.db
      .update(users)
      .set({ authSubject: seed.memberLink.externalId })
      .where(eq(users.id, seed.user.id));
    await h.db.update(members).set({ userId: null }).where(eq(members.id, seed.organiser.id));
    const before = await h.db.select().from(members);

    expect(
      await authorizeFamilyAccess(
        h.db,
        { ...identity, authSubject: seed.memberLink.externalId },
        seed.family.id,
      ),
    ).toEqual({ kind: "not_found" });
    expect(await h.db.select().from(members)).toEqual(before);
  });

  it.each([
    "",
    " ",
    "not-a-uuid",
    "00000000-0000-4000-8000-00000000000g",
    `${missingFamilyId} `,
    "' OR true --",
  ])("rejects malformed family id %j before querying", async (familyId) => {
    const select = vi.spyOn(h.db, "select");
    try {
      expect(await authorizeFamilyAccess(h.db, identity, familyId)).toEqual({ kind: "not_found" });
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
  });

  it.each([
    { ...identity, authSubject: "" },
    { ...identity, authSubject: " \t\n" },
    { ...identity, sessionId: "" },
    { ...identity, sessionId: " \t\n" },
  ])("rejects blank identity fields before querying: %j", async (invalidIdentity) => {
    const seed = await seedAccount();
    const select = vi.spyOn(h.db, "select");
    try {
      expect(await authorizeFamilyAccess(h.db, invalidIdentity, seed.family.id)).toEqual({
        kind: "not_found",
      });
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
  });

  it("reads fresh membership and role on every call with the same session", async () => {
    const seed = await seedAccount();
    expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toMatchObject({
      kind: "granted",
    });
    await h.db.update(members).set({ role: "member" }).where(eq(members.id, seed.organiser.id));
    expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toEqual({
      kind: "forbidden",
    });
    expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toMatchObject({
      kind: "granted",
      access: { role: "member" },
    });
    await h.db.update(members).set({ role: "organiser" }).where(eq(members.id, seed.organiser.id));
    expect(await authorizeFamilyAccess(h.db, identity, seed.family.id, "organiser")).toMatchObject({
      kind: "granted",
    });
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, seed.organiser.id));
    expect(await authorizeFamilyAccess(h.db, identity, seed.family.id)).toEqual({
      kind: "not_found",
    });
  });

  it("accepts the caller's transaction and sees revocation inside it", async () => {
    const seed = await seedAccount();
    await h.db.transaction(async (tx) => {
      expect(await authorizeFamilyAccess(tx, identity, seed.family.id)).toMatchObject({
        kind: "granted",
      });
      await tx.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, seed.user.id));
      expect(await authorizeFamilyAccess(tx, identity, seed.family.id)).toEqual({
        kind: "not_found",
      });
    });
  });
});
