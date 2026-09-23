import { ApiUser } from "@vela/contracts";
import {
  accountLinkChallenges,
  apiRequestReceipts,
  channelLinks,
  consents,
  events,
  families,
  members,
  users,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { disableApiAccount, provisionApiAccount, updateApiAccount } from "./api-account-writes.ts";
import { runApiMutation } from "./api-idempotency.ts";
import { sha256Hex } from "./hash.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

let h: Harness;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-one" };
const other = { ...identity, authSubject: "auth|mia" };
const profile = { display_name: "Mia", language: "en", tz: "Asia/Taipei" };
const denied = { name: "VelaError", code: "not_found", message: "Account not found" };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

function provision(key = "create", input: unknown = profile, actor = identity) {
  return provisionApiAccount(h.deps, actor, key, input);
}

function update(key = "update", input: unknown = { display_name: "New name" }, actor = identity) {
  return updateApiAccount(h.deps, actor, key, input);
}

async function receipts() {
  return h.db.select().from(apiRequestReceipts);
}

async function challenges() {
  return h.db.select().from(accountLinkChallenges).orderBy(accountLinkChallenges.id);
}

async function seedChallenges(userId: string, seed: SeededFamily) {
  const now = h.clock.now();
  for (const state of ["unbound", "pending", "expired", "completed", "invalidated"]) {
    const expiresAt = new Date(now.getTime() + (state === "expired" ? -1 : 13 * 60 * 1_000));
    await h.db.insert(accountLinkChallenges).values({
      userId,
      sessionHash: await sha256Hex(`${userId}:${state}:session`),
      familyId: state === "unbound" ? null : seed.family.id,
      memberId: state === "unbound" ? null : seed.member.id,
      channelLinkId: state === "unbound" ? null : seed.memberLink.id,
      channelIdentityHash: state === "unbound" ? null : await sha256Hex(`${userId}:channel`),
      codeHash:
        state === "pending" || state === "expired"
          ? await sha256Hex(`${userId}:${state}:code`)
          : null,
      createdAt: new Date(expiresAt.getTime() - 15 * 60 * 1_000),
      expiresAt,
      completedAt: state === "completed" ? new Date(now.getTime() - 60 * 1_000) : null,
      invalidatedAt: state === "invalidated" ? new Date(now.getTime() - 60 * 1_000) : null,
    });
  }
}

async function sideEffects() {
  return {
    families: await h.db.select().from(families),
    members: await h.db.select().from(members),
    links: await h.db.select().from(channelLinks),
    consents: await h.db.select().from(consents),
    events: await h.db.select().from(events),
    outbound: h.queues.outbound.pending,
    media: h.queues.media.pending,
    understand: h.queues.understand.pending,
    logs: h.logger.entries,
  };
}

describe("account writes", () => {
  it("creates a canonical profile and replays the original response after later patches", async () => {
    const first = await provision("create", { ...profile, display_name: "  Mia  " });
    expect(first).toEqual({
      response: { status: 200, body: { id: expect.any(String), ...profile } },
      replayed: false,
    });
    expect(ApiUser.parse(first.response.body)).toEqual(first.response.body);
    const patched = await update();
    expect(patched.response).toEqual({
      status: 200,
      body: { ...ApiUser.parse(first.response.body), display_name: "New name" },
    });
    expect(await provision("create", profile, { ...identity, sessionId: "refreshed" })).toEqual({
      ...first,
      replayed: true,
    });
    expect(
      await provision("new-key", { display_name: "Ignored", language: "ru", tz: "UTC" }),
    ).toEqual({
      ...patched,
      replayed: false,
    });
    expect(await receipts()).toHaveLength(3);
    for (const receipt of await receipts()) {
      expect(receipt).toMatchObject({ familyId: null, memberId: null });
    }
  });

  it("rechecks the locked live account after the low-level provision returns", async () => {
    await h.db.execute(sql`create function pg_temp.tombstone_new_account() returns trigger language plpgsql as $$
      begin new.deleted_at := now(); return new; end;
    $$`);
    await h.db.execute(sql`create trigger tombstone_new_account before insert on users
      for each row execute function pg_temp.tombstone_new_account()`);
    try {
      await expect(provision()).rejects.toMatchObject(denied);
      expect(await h.db.select().from(users)).toEqual([]);
      expect(await receipts()).toEqual([]);
    } finally {
      await h.db.execute(sql`drop trigger tombstone_new_account on users`);
      await h.db.execute(sql`drop function pg_temp.tombstone_new_account()`);
    }
  });

  it("updates only supplied user fields, never identity, memberships, channels, consents or events", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const first = ApiUser.parse((await provision()).response.body);
    await h.db.update(users).set({ email: "private@example.test", phone: "+886900000001" });
    await h.db.update(members).set({ userId: first.id }).where(eq(members.id, seed.member.id));
    const before = await sideEffects();
    const [stored] = await h.db.select().from(users);
    await update("language", { language: "ru" });
    expect(await h.db.select().from(users)).toEqual([{ ...stored, language: "ru" }]);
    await update("zone", { tz: "UTC" });
    expect(await h.db.select().from(users)).toEqual([{ ...stored, language: "ru", tz: "UTC" }]);
    await update("name", { display_name: "  Updated  " });
    expect(await h.db.select().from(users)).toEqual([
      { ...stored, language: "ru", tz: "UTC", displayName: "Updated" },
    ]);
    expect(await sideEffects()).toEqual(before);
  });

  it("creates no ancillary state and isolates exact actors sharing a key", async () => {
    const before = await sideEffects();
    const first = await provision();
    const second = await provision("create", profile, other);
    expect(second.replayed).toBe(false);
    expect(second.response.body).not.toEqual(first.response.body);
    await update("update", { language: "ru" }, other);
    expect(await provision()).toEqual({ ...first, replayed: true });
    expect(await sideEffects()).toEqual(before);
    expect(await h.db.select().from(users)).toHaveLength(2);
    expect(await receipts()).toHaveLength(3);
  });

  it("conflicts on changed operation or canonical input for the same actor and key", async () => {
    await provision();
    await expect(update("create", profile)).rejects.toMatchObject({ code: "conflict" });
    await expect(provision("create", { ...profile, language: "ru" })).rejects.toMatchObject({
      code: "conflict",
    });
    const first = await update("patch", { display_name: " Name ", tz: "UTC" });
    expect(await update("patch", { tz: "UTC", display_name: "Name" })).toEqual({
      ...first,
      replayed: true,
    });
    await expect(update("patch", { display_name: "Name" })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await receipts()).toHaveLength(2);
  });

  it.each(["unknown", "auth|mia", " auth|Mia", "auth|Mia "])(
    "denies update for exact-subject mismatch %j",
    async (authSubject) => {
      await provision();
      const before = await receipts();
      await expect(
        update("missing", { language: "ru" }, { ...identity, authSubject }),
      ).rejects.toMatchObject(denied);
      expect(await receipts()).toEqual(before);
    },
  );

  it.each(["provision", "update"] as const)(
    "denies %s replay and fresh writes for deleted accounts",
    async (operation) => {
      await provision();
      if (operation === "update") await update();
      await h.db.update(users).set({ deletedAt: h.clock.now() });
      const before = await receipts();
      const accounts = await h.db.select().from(users);
      const write = operation === "provision" ? provision : update;
      await expect(write()).rejects.toMatchObject(denied);
      await expect(write("fresh")).rejects.toMatchObject(denied);
      expect(await receipts()).toEqual(before);
      expect(await h.db.select().from(users)).toEqual(accounts);
    },
  );

  it.each(["provision", "update"] as const)(
    "denies %s replay when the account is no longer present",
    async (operation) => {
      await provision();
      if (operation === "update") await update();
      await h.db.delete(users);
      const before = await receipts();
      await expect(operation === "provision" ? provision() : update()).rejects.toMatchObject(
        denied,
      );
      expect(await receipts()).toEqual(before);
      expect(await h.db.select().from(users)).toEqual([]);
    },
  );

  it("treats an expired provision receipt as fresh when the account is absent", async () => {
    await provision();
    await h.db.delete(users);
    h.clock.advance(24 * 60 * 60 * 1_000);
    expect((await provision()).replayed).toBe(false);
    expect(await h.db.select().from(users)).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
  });

  it.each(["provision", "update"] as const)(
    "serializes concurrent %s calls with same and distinct keys",
    async (operation) => {
      if (operation === "update") await provision();
      const write = operation === "provision" ? provision : update;
      const same = await Promise.all(Array.from({ length: 6 }, () => write("same")));
      expect(same.filter((result) => !result.replayed)).toHaveLength(1);
      for (const result of same) expect(result.response).toEqual(same[0]?.response);
      const distinct = await Promise.all(
        Array.from({ length: 6 }, (_, index) => write(`different-${index}`)),
      );
      expect(distinct.every((result) => !result.replayed)).toBe(true);
      expect(await h.db.select().from(users)).toHaveLength(1);
      expect(await receipts()).toHaveLength(operation === "provision" ? 7 : 8);
    },
  );

  it.each(["provision", "update"] as const)(
    "rolls back %s and its reservation when receipt completion fails",
    async (operation) => {
      if (operation === "update") await provision();
      const before = await h.db.select().from(users);
      const saved = await receipts();
      await h.db.execute(sql`create function pg_temp.fail_account_receipt() returns trigger language plpgsql as $$
      begin raise exception 'receipt failure'; end;
    $$`);
      await h.db.execute(sql`create trigger fail_account_receipt before update on api_request_receipts
      for each row execute function pg_temp.fail_account_receipt()`);
      try {
        await expect(operation === "provision" ? provision() : update()).rejects.toBeInstanceOf(
          Error,
        );
        expect(await h.db.select().from(users)).toEqual(before);
        expect(await receipts()).toEqual(saved);
      } finally {
        await h.db.execute(sql`drop trigger fail_account_receipt on api_request_receipts`);
        await h.db.execute(sql`drop function pg_temp.fail_account_receipt()`);
      }
    },
  );
});

describe("account input boundaries", () => {
  const unknowns = [
    "role",
    "user_id",
    "member_id",
    "family_id",
    "email",
    "phone",
    "invite_token",
    "TelegramID",
    "telegram_id",
    "authSubject",
    "deletedAt",
    "id",
  ];
  it.each([provisionApiAccount, updateApiAccount])(
    "rejects unknown or invalid input before a transaction for %s",
    async (write) => {
      const transaction = vi.spyOn(h.db, "transaction");
      try {
        for (const input of [
          null,
          undefined,
          {},
          [],
          { ...profile, display_name: " \t" },
          { ...profile, display_name: "x\0y" },
          { ...profile, display_name: "x".repeat(81) },
          { ...profile, display_name: undefined },
          { ...profile, language: undefined },
          { ...profile, tz: undefined },
          { ...profile, language: "private-invalid" },
          { ...profile, tz: "private-invalid" },
          ...unknowns.map((key) => ({ ...profile, [key]: "private-secret" })),
        ]) {
          await expect(write(h.deps, identity, "invalid", input)).rejects.toMatchObject({
            name: "ApiIdempotencyError",
            code: "invalid",
            message: "Invalid API mutation request",
          });
        }
        expect(transaction).not.toHaveBeenCalled();
      } finally {
        transaction.mockRestore();
      }
      expect(await receipts()).toEqual([]);
      expect(await h.db.select().from(users)).toEqual([]);
    },
  );

  it.each([provision, update])(
    "delegates invalid session and key rejection before writes for %s",
    async (write) => {
      const transaction = vi.spyOn(h.db, "transaction");
      try {
        for (const actor of [
          { ...identity, authSubject: " " },
          { ...identity, sessionId: "" },
        ]) {
          await expect(write("valid", profile, actor)).rejects.toMatchObject({ code: "invalid" });
        }
        await expect(write("bad/key", profile)).rejects.toMatchObject({ code: "invalid" });
        expect(transaction).not.toHaveBeenCalled();
      } finally {
        transaction.mockRestore();
      }
    },
  );
});

describe("disableApiAccount", () => {
  it("takes the shared actor lock before touching users or receipts", async () => {
    const transaction = h.db.transaction.bind(h.db);
    const actorHash = await sha256Hex(identity.authSubject);
    const wrapper = vi.spyOn(h.db, "transaction").mockImplementation((callback, config) =>
      transaction(async (tx) => {
        const execute = vi.spyOn(tx, "execute");
        const insert = vi.spyOn(tx, "insert");
        const select = vi.spyOn(tx, "select");
        const remove = vi.spyOn(tx, "delete");
        const result = await callback(tx);
        const query = execute.mock.calls[0]?.[0];
        if (query === undefined || typeof query === "string") throw new Error("expected SQL lock");
        expect(new PgDialect().sqlToQuery(query.getSQL())).toMatchObject({
          sql: "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          params: [actorHash],
        });
        for (const query of [insert, select, remove]) {
          expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
            query.mock.invocationCallOrder[0] ?? 0,
          );
        }
        return result;
      }, config),
    );
    try {
      await disableApiAccount(h.deps, identity.authSubject);
    } finally {
      wrapper.mockRestore();
    }
  });

  it("waits for a pending write transaction then purges its committed receipt", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const transaction = h.db.transaction.bind(h.db);
    let hold = true;
    const wrapper = vi.spyOn(h.db, "transaction").mockImplementation((callback, config) =>
      transaction(async (tx) => {
        const result = await callback(tx);
        if (hold) {
          hold = false;
          entered.resolve();
          await release.promise;
        }
        return result;
      }, config),
    );
    let disabled = false;
    const first = provision("pending");
    try {
      await entered.promise;
      const disabling = disableApiAccount(h.deps, identity.authSubject).then(() => {
        disabled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(disabled).toBe(false);
      release.resolve();
      expect((await first).response.status).toBe(200);
      await disabling;
      expect(await receipts()).toEqual([]);
      await expect(provision("pending")).rejects.toMatchObject(denied);
      expect(await h.db.select().from(users)).toEqual([
        expect.objectContaining({ deletedAt: h.clock.now() }),
      ]);
    } finally {
      release.resolve();
      wrapper.mockRestore();
    }
  });

  it.each(["", " \t"])(
    "rejects invalid disable subject %j before opening a transaction",
    async (subject) => {
      const transaction = vi.spyOn(h.db, "transaction");
      try {
        await expect(disableApiAccount(h.deps, subject)).rejects.toMatchObject({ code: "invalid" });
        expect(transaction).not.toHaveBeenCalled();
      } finally {
        transaction.mockRestore();
      }
    },
  );

  it("preserves the profile and first tombstone, purges only the actor's receipts and challenges", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const account = ApiUser.parse((await provision()).response.body);
    await update();
    const otherAccount = ApiUser.parse((await provision("create", profile, other)).response.body);
    await h.db.update(members).set({ userId: account.id }).where(eq(members.id, seed.member.id));
    await seedChallenges(account.id, seed);
    await seedChallenges(otherAccount.id, seed);
    const otherChallenges = (await challenges()).filter((row) => row.userId === otherAccount.id);
    const effects = await sideEffects();
    await runApiMutation(
      h.deps,
      identity,
      { key: "unrelated", operation: "other:v1", input: null },
      {
        authorize: async () => {},
        mutate: async () => ({ status: 200, body: null }),
      },
    );
    const [before] = await h.db
      .select()
      .from(users)
      .where(eq(users.authSubject, identity.authSubject));
    const actorHash = await sha256Hex(other.authSubject);
    const others = (await receipts()).filter((row) => row.actorHash === actorHash);
    const timestamp = h.clock.now();
    await disableApiAccount(h.deps, identity.authSubject);
    expect(
      await h.db.select().from(users).where(eq(users.authSubject, identity.authSubject)),
    ).toEqual([{ ...before, deletedAt: timestamp }]);
    expect(await receipts()).toEqual(others);
    expect(await challenges()).toEqual(otherChallenges);
    expect(await sideEffects()).toEqual(effects);
    h.clock.advance(1_000);
    await disableApiAccount(h.deps, identity.authSubject);
    expect(
      await h.db.select().from(users).where(eq(users.authSubject, identity.authSubject)),
    ).toEqual([{ ...before, deletedAt: timestamp }]);
    await expect(provision()).rejects.toMatchObject(denied);
    await expect(update()).rejects.toMatchObject(denied);
    expect(await receipts()).toEqual(others);
    expect(await challenges()).toEqual(otherChallenges);
    expect(await sideEffects()).toEqual(effects);
  });

  it("deposits an idempotent tombstone for an unknown subject without ancillary writes", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const otherAccount = ApiUser.parse((await provision("create", profile, other)).response.body);
    await seedChallenges(otherAccount.id, seed);
    const savedChallenges = await challenges();
    const savedReceipts = await receipts();
    const before = await sideEffects();
    await disableApiAccount(h.deps, identity.authSubject);
    const accounts = await h.db.select().from(users).orderBy(users.id);
    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.authSubject === identity.authSubject)).toMatchObject({
      displayName: "",
      deletedAt: h.clock.now(),
    });
    expect(accounts.find((account) => account.id === otherAccount.id)).toMatchObject({
      deletedAt: null,
    });
    h.clock.advance(2_000);
    await disableApiAccount(h.deps, identity.authSubject);
    expect(await h.db.select().from(users).orderBy(users.id)).toEqual(accounts);
    await expect(provision()).rejects.toMatchObject(denied);
    await expect(update()).rejects.toMatchObject(denied);
    expect(await receipts()).toEqual(savedReceipts);
    expect(await challenges()).toEqual(savedChallenges);
    expect(await sideEffects()).toEqual(before);
  });

  it.each([apiRequestReceipts, accountLinkChallenges])(
    "rolls back the tombstone and both purges when deleting %s fails",
    async (table) => {
      const seed = await seedFamily(h.db, { now: h.clock.now() });
      const account = ApiUser.parse((await provision()).response.body);
      await seedChallenges(account.id, seed);
      const before = await h.db.select().from(users);
      const saved = await receipts();
      const savedChallenges = await challenges();
      const effects = await sideEffects();
      await h.db.execute(sql`create function pg_temp.fail_account_purge() returns trigger language plpgsql as $$
      begin raise exception 'purge failure'; end;
    $$`);
      await h.db.execute(sql`create trigger fail_account_purge before delete on ${table}
      for each row execute function pg_temp.fail_account_purge()`);
      try {
        await expect(disableApiAccount(h.deps, identity.authSubject)).rejects.toBeInstanceOf(Error);
        expect(await h.db.select().from(users)).toEqual(before);
        expect(await receipts()).toEqual(saved);
        expect(await challenges()).toEqual(savedChallenges);
        expect(await sideEffects()).toEqual(effects);
      } finally {
        await h.db.execute(sql`drop trigger fail_account_purge on ${table}`);
        await h.db.execute(sql`drop function pg_temp.fail_account_purge()`);
      }
    },
  );

  it.each(["provision", "update"] as const)(
    "racing disable and %s never leaves a live account or a receipt",
    async (operation) => {
      if (operation === "update") await provision();
      const write = operation === "provision" ? provision : update;
      const results = await Promise.allSettled([
        write("race-one"),
        disableApiAccount(h.deps, identity.authSubject),
        write("race-two"),
        disableApiAccount(h.deps, identity.authSubject),
      ]);
      for (const index of [0, 2]) {
        const result = results[index];
        if (result?.status === "rejected") expect(result.reason).toMatchObject(denied);
        else
          expect(result).toMatchObject({
            status: "fulfilled",
            value: { response: { status: 200 } },
          });
      }
      expect(results[1]?.status).toBe("fulfilled");
      expect(results[3]?.status).toBe("fulfilled");
      expect(await h.db.select().from(users)).toEqual([
        expect.objectContaining({ deletedAt: h.clock.now() }),
      ]);
      expect(await receipts()).toEqual([]);
      await expect(write("after")).rejects.toMatchObject(denied);
      expect(await receipts()).toEqual([]);
    },
  );
});
