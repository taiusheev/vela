import { consents, deletions, events, members, nearbyContacts, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiFamily } from "./api-family.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { addApiNearby, NearbyRefusedError, removeApiNearby } from "./api-nearby.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-2" };
const stranger: SessionIdentity = { authSubject: "auth|Zoe", sessionId: "session-3" };

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

let keys = 0;
function add(
  input: Record<string, unknown>,
  who: SessionIdentity = mia,
  options: { key?: string; familyId?: string } = {},
) {
  keys += 1;
  return addApiNearby(
    h.deps,
    who,
    options.key ?? `key-${keys}`,
    options.familyId ?? seed.family.id,
    { member_id: seed.member.id, relation: null, ...input },
  );
}

function remove(contactId: string, who: SessionIdentity = mia, key?: string) {
  keys += 1;
  return removeApiNearby(h.deps, who, key ?? `key-${keys}`, contactId);
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.catch((caught: unknown) => caught);
  if (error instanceof NearbyRefusedError) return error.reason;
  if (error instanceof VelaError) return error.code;
  if (error instanceof ApiIdempotencyError) return error.code;
  return error;
}

describe("addApiNearby", () => {
  it("adds someone nearby by name and relation, waiting for their yes, and contacts nobody", async () => {
    const result = await add({ name: "Lena", relation: "neighbour" });

    expect(result.response.status).toBe(201);
    expect(result.response.body).toEqual({
      id: expect.any(String),
      near_member_id: seed.member.id,
      name: "Lena",
      relation: "neighbour",
      consent: "waiting",
    });
    const [row] = await h.db.select().from(nearbyContacts);
    expect(row).toMatchObject({ phone: null, consentedAt: null, consentRequestedAt: null });
    expect(h.telegram.sent).toEqual([]);
    const [event] = await h.db.select().from(events).where(eq(events.name, "nearby_contact_added"));
    expect(event?.props).toEqual({ consented: false, source: "app" });
  });

  it("shows the new contact on You for organisers", async () => {
    await add({ name: "Lena", relation: "neighbour" });
    const family = await loadApiFamily(h.db, mia, seed.family.id);
    expect(family?.nearby).toEqual([
      expect.objectContaining({ name: "Lena", relation: "neighbour", consent: "waiting" }),
    ]);
  });

  it("answers the contact already near her for the same name, whatever the case", async () => {
    const first = await add({ name: "Lena", relation: "neighbour" });
    const again = await add({ name: "  lena ", relation: null });

    expect(again.response.status).toBe(200);
    expect(again.response.body).toEqual(first.response.body);
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(1);
  });

  it("refuses a third person nearby, and writes nothing", async () => {
    await add({ name: "Lena" });
    await add({ name: "Petro" });

    expect(await failure(add({ name: "Igor" }))).toBe("full");
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(2);
  });

  it("counts a contact the founder added, with their yes, toward the two", async () => {
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Lena",
      answer: { yes: { phone: "+886 912 345 678" } },
    });
    await add({ name: "Petro" });

    expect(await failure(add({ name: "Igor" }))).toBe("full");
  });

  it("refuses a name or relation holding a phone number, before keeping anything", async () => {
    expect(await failure(add({ name: "Lena 0912 345 678" }))).toBe("number");
    expect(await failure(add({ name: "Lena", relation: "＋８８６ ９１２ ３４５ ６７８" }))).toBe(
      "number",
    );
    expect(await h.db.select().from(nearbyContacts)).toEqual([]);
  });

  it("refuses an empty or over-long name as invalid", async () => {
    expect(await failure(add({ name: "   " }))).toBe("invalid");
    expect(await failure(add({ name: "L".repeat(41) }))).toBe("invalid");
  });

  it("answers not found to a member who does not organise, a stranger, and another family", async () => {
    expect(await failure(add({ name: "Lena" }, sam))).toBe("not_found");
    expect(await failure(add({ name: "Lena" }, stranger))).toBe("not_found");
    expect(
      await failure(
        add({ name: "Lena" }, mia, { familyId: "99999999-9999-7999-8999-999999999999" }),
      ),
    ).toBe("not_found");
    expect(await failure(add({ name: "Lena", member_id: seed.organiser.id }))).toBe("not_found");
    expect(await h.db.select().from(nearbyContacts)).toEqual([]);
  });

  it("replays one key's answer without a second row", async () => {
    const first = await add({ name: "Lena" }, mia, { key: "same-key" });
    const replay = await add({ name: "Lena" }, mia, { key: "same-key" });

    expect(replay.replayed).toBe(true);
    expect(replay.response).toEqual(first.response);
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(1);
  });
});

describe("removeApiNearby", () => {
  it("removes someone nearby with their consent rows, and keeps a proof of the deletion", async () => {
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Lena",
      answer: { yes: { phone: "+886 912 345 678" } },
    });

    const result = await remove(contact.id);

    expect(result.response).toEqual({ status: 200, body: { id: contact.id, removed: true } });
    expect(await h.db.select().from(nearbyContacts)).toEqual([]);
    const [proof] = await h.db.select().from(deletions);
    expect(proof).toMatchObject({ objectType: "nearby_contact", objectId: contact.id });
    const kept = await h.db.select().from(consents).where(eq(consents.contactId, contact.id));
    expect(kept).toEqual([]);
  });

  it("answers not found to a new key for a contact already removed", async () => {
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Lena",
      answer: null,
    });
    await remove(contact.id);

    // The row is gone, so the family is found from nothing: a second key cannot be scoped.
    expect(await failure(remove(contact.id))).toBe("not_found");
  });

  it("answers not found to someone who does not organise her family", async () => {
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Lena",
      answer: null,
    });

    expect(await failure(remove(contact.id, sam))).toBe("not_found");
    expect(await failure(remove(contact.id, stranger))).toBe("not_found");
    expect(await failure(remove("not-a-uuid"))).toBe("not_found");
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(1);
  });
});
