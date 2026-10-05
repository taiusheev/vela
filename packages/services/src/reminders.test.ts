/**
 * Memory and reminders (spec §12, build plan 5.3): the family's coming dated facts offered as
 * "Remind me to ask", a reminder made only by that tap and due the day after, finished by "Done",
 * and both cleared by retention once they are of no use.
 */
import { ApiReminder, ApiReminders } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { members, memoryFacts, reminders, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { VelaError } from "./errors.ts";
import { applyRetention } from "./jobs.ts";
import {
  createApiReminder,
  FactMissingError,
  finishApiReminder,
  loadApiReminders,
} from "./reminders.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-x" };
let today: string;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await account(mia, "Mia", seed.organiser.id);
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  await account(sam, "Sam", brother.member.id);
  today = localDateOf(h.clock.now(), seed.member.tz);
});
afterAll(async () => {
  await h.close();
});

async function account(identity: SessionIdentity, name: string, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  if (user === undefined) throw new Error(`expected an account for ${name}`);
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

function herName(): string {
  return seed.member.addressForm ?? seed.member.displayName;
}

function daysFrom(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A plan of hers, as understanding keeps it. */
async function plan(what: string, on: string) {
  const [fact] = await h.db
    .insert(memoryFacts)
    .values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      kind: "date",
      text: what,
      onDate: on,
      expiresAt: new Date(Date.parse(`${on}T00:00:00Z`) + 3 * 86_400_000),
    })
    .returning();
  if (fact === undefined) throw new Error("expected a fact");
  return fact;
}

async function read(who: SessionIdentity = mia) {
  const found = await loadApiReminders(h.db, who, seed.family.id, h.clock.now());
  return found === null ? null : ApiReminders.parse(found);
}

describe("the family's coming plans", () => {
  it("are offered to each member as reminders to ask, from her today on", async () => {
    const lunch = await plan("lunch with Auntie Lin", daysFrom(today, 3));
    await plan("yesterday's market", daysFrom(today, -1));

    expect((await read())?.suggestions).toEqual([
      {
        fact_id: lunch.id,
        about_member_id: seed.member.id,
        about_name: herName(),
        what: "lunch with Auntie Lin",
        on: daysFrom(today, 3),
      },
    ]);
    expect((await read(sam))?.suggestions).toHaveLength(1);
    expect(await read(stranger)).toBeNull();
  });
});

describe("Remind me to ask", () => {
  it("makes one reminder, due the day after, which takes the place of the suggestion", async () => {
    const lunch = await plan("lunch with Auntie Lin", daysFrom(today, 3));

    const first = await createApiReminder(h.deps, mia, "remind-1", seed.family.id, {
      fact_id: lunch.id,
    });
    const again = await createApiReminder(h.deps, mia, "remind-2", seed.family.id, {
      fact_id: lunch.id,
    });

    const made = ApiReminder.parse(first.response.body);
    expect(first.response.status).toBe(201);
    expect(made).toMatchObject({
      about_name: herName(),
      what: "lunch with Auntie Lin",
      due_date: daysFrom(today, 4),
      done: false,
    });
    expect(ApiReminder.parse(again.response.body).id).toBe(made.id);
    expect(await h.db.select().from(reminders)).toHaveLength(1);
    expect(await read()).toEqual({ suggestions: [], reminders: [made] });
    // Sam has made none: the plan is still offered to him.
    expect((await read(sam))?.suggestions).toHaveLength(1);
  });

  it("refuses a plan that has passed, one of another family, and a stranger", async () => {
    const past = await plan("yesterday's market", daysFrom(today, -1));
    const lunch = await plan("lunch with Auntie Lin", daysFrom(today, 3));

    await expect(
      createApiReminder(h.deps, mia, "past", seed.family.id, { fact_id: past.id }),
    ).rejects.toBeInstanceOf(FactMissingError);
    await expect(
      createApiReminder(h.deps, stranger, "stranger", seed.family.id, { fact_id: lunch.id }),
    ).rejects.toBeInstanceOf(VelaError);
    expect(await h.db.select().from(reminders)).toEqual([]);
  });
});

describe("Done", () => {
  it("finishes the member's own reminder, and no one else's", async () => {
    const lunch = await plan("lunch with Auntie Lin", daysFrom(today, 3));
    const made = ApiReminder.parse(
      (await createApiReminder(h.deps, mia, "remind", seed.family.id, { fact_id: lunch.id }))
        .response.body,
    );

    await expect(finishApiReminder(h.deps, sam, "sam-done", made.id)).rejects.toBeInstanceOf(
      VelaError,
    );
    const done = await finishApiReminder(h.deps, mia, "mia-done", made.id);

    expect(done.response.body).toEqual({ id: made.id, done: true });
    expect(await read()).toEqual({ suggestions: [], reminders: [] });
  });
});

describe("retention", () => {
  it("deletes a plan two days after its day and a reminder two days after it was due", async () => {
    const lunch = await plan("lunch with Auntie Lin", daysFrom(today, 1));
    await createApiReminder(h.deps, mia, "remind", seed.family.id, { fact_id: lunch.id });

    h.clock.advanceMinutes(4 * 24 * 60);
    await applyRetention(h.deps);
    expect(await h.db.select().from(memoryFacts)).toEqual([]);
    expect(await h.db.select().from(reminders)).toHaveLength(1);

    h.clock.advanceMinutes(2 * 24 * 60);
    await applyRetention(h.deps);
    expect(await h.db.select().from(reminders)).toEqual([]);
  });
});
