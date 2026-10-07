import type { LocalDate } from "@vela/contracts";
import { members, quietEvents, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiPrecision, loadPublicPrecision } from "./api-precision.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let others: SeededFamily[];
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

let day = 0;

/** One quiet morning of `family`'s on its own exchange, settled unless told otherwise. */
async function quiet(
  family: SeededFamily,
  openedAt: string,
  values: Partial<typeof quietEvents.$inferInsert> = {},
): Promise<void> {
  day += 1;
  const exchange = await seedExchange(h.db, family, {
    date: new Date(Date.UTC(2025, 0, day)).toISOString().slice(0, 10) as LocalDate,
    state: "delivered",
    deliveredAt: new Date(openedAt),
  });
  await h.db.insert(quietEvents).values({
    exchangeId: exchange.id,
    memberId: family.member.id,
    openedAt: new Date(openedAt),
    notifyCount: 1,
    resolvedAt: new Date(openedAt),
    outcome: "answered_late",
    ...values,
  });
}

async function load(who: SessionIdentity = mia, familyId: string = seed.family.id) {
  return loadApiPrecision(h.db, who, familyId, h.clock.now());
}

const NONE = { answered_late: 0, away: 0, fine_known: 0, true_concern: 0, unknown: 0 };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  day = 0;
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await account(mia, seed.organiser.id);
  const plain = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "4002",
  });
  await account(sam, plain.member.id);
  others = [];
  for (const n of [1, 2]) {
    others.push(
      await seedFamily(h.db, {
        now: h.clock.now(),
        familyName: `Family ${n}`,
        organiserExternalId: `110${n}`,
        memberExternalId: `210${n}`,
      }),
    );
  }
});
afterAll(async () => {
  await h.close();
});

describe("loadApiPrecision", () => {
  it("gives an organiser the family's own notices by month, outcomes and verdicts, never its quiet mornings", async () => {
    await quiet(seed, "2026-09-02T01:00:00Z", { outcome: "away", useful: true });
    await quiet(seed, "2026-09-05T01:00:00Z", { outcome: "true_concern", useful: true });
    await quiet(seed, "2026-09-13T23:00:00Z", { resolvedAt: null, outcome: null });
    // Settled before anyone was told: not a notice, and not on the page.
    await quiet(seed, "2026-09-06T01:00:00Z", { notifyCount: 0 });
    await quiet(seed, "2026-08-20T01:00:00Z", { notifyCount: 0 });
    // Another family's notice is not the family's.
    await quiet(others[0] as SeededFamily, "2026-09-03T01:00:00Z", { useful: false });

    const precision = await load();

    expect(precision?.family).toStrictEqual([
      {
        month: "2026-09",
        notices: 3,
        open: 1,
        outcomes: { ...NONE, away: 1, true_concern: 1 },
        useful: { yes: 2, no: 0 },
      },
    ]);
    expect(precision?.vela_minimum).toStrictEqual({ notices: 10, families: 3 });
  });

  it("shows a Vela month only once it has ten notices from three families", async () => {
    const families = [seed, ...others];
    // September: ten notices, from three families.
    for (let n = 0; n < 10; n += 1) {
      await quiet(families[n % 3] as SeededFamily, `2026-09-0${(n % 9) + 1}T01:00:00Z`, {
        useful: n < 7,
        ...(n === 0 ? { outcome: "true_concern" } : {}),
      });
    }
    // August: twelve notices, from two families only.
    for (let n = 0; n < 12; n += 1) {
      await quiet(families[n % 2] as SeededFamily, `2026-08-${10 + n}T01:00:00Z`);
    }
    // July: nine notices, from three families.
    for (let n = 0; n < 9; n += 1) {
      await quiet(families[n % 3] as SeededFamily, `2026-07-${10 + n}T01:00:00Z`);
    }

    const precision = await load();

    expect(precision?.vela).toStrictEqual([
      {
        month: "2026-09",
        notices: 10,
        open: 0,
        outcomes: { ...NONE, answered_late: 9, true_concern: 1 },
        useful: { yes: 7, no: 3 },
      },
    ]);
    expect(precision?.family.map((month) => month.month)).toEqual([
      "2026-09",
      "2026-08",
      "2026-07",
    ]);
  });

  it("answers nothing to a member who does not organise, a stranger, or another family's organiser", async () => {
    await quiet(seed, "2026-09-02T01:00:00Z");

    expect(await load(sam)).toBeNull();
    expect(await load(stranger)).toBeNull();
    expect(await load(mia, (others[0] as SeededFamily).family.id)).toBeNull();
    expect(await load(mia, "not-a-uuid")).toBeNull();
  });

  it("is empty for a family whose mornings never went quiet", async () => {
    expect(await load()).toStrictEqual({
      family: [],
      vela: [],
      vela_minimum: { notices: 10, families: 3 },
    });
  });
});

describe("loadPublicPrecision", () => {
  it("publishes only ended months with ten notices from three families, naming no family", async () => {
    const families = [seed, ...others];
    // September is the clock's month (14 September): never published while it runs, however big.
    for (let n = 0; n < 12; n += 1) {
      await quiet(families[n % 3] as SeededFamily, `2026-09-0${(n % 9) + 1}T01:00:00Z`);
    }
    // August: ten notices from three families, one still open, two marked useful.
    for (let n = 0; n < 10; n += 1) {
      await quiet(families[n % 3] as SeededFamily, `2026-08-${10 + n}T01:00:00Z`, {
        ...(n === 0 ? { outcome: "true_concern", useful: true } : {}),
        ...(n === 1 ? { outcome: "away", useful: true } : {}),
        ...(n === 2 ? { resolvedAt: null, outcome: null } : {}),
      });
    }
    // July: nine notices from three families; June: ten from two. Neither reaches the floor.
    for (let n = 0; n < 9; n += 1) {
      await quiet(families[n % 3] as SeededFamily, `2026-07-${10 + n}T01:00:00Z`);
    }
    for (let n = 0; n < 10; n += 1) {
      await quiet(families[n % 2] as SeededFamily, `2026-06-${10 + n}T01:00:00Z`);
    }
    // A quiet morning that told nobody is no notice, so it never makes a month publishable.
    await quiet(families[2] as SeededFamily, "2026-06-25T01:00:00Z", { notifyCount: 0 });

    expect(await loadPublicPrecision(h.db, h.clock.now())).toStrictEqual({
      months: [
        {
          month: "2026-08",
          notices: 10,
          open: 1,
          outcomes: { ...NONE, answered_late: 7, away: 1, true_concern: 1 },
          useful: { yes: 2, no: 0 },
        },
      ],
      minimum: { notices: 10, families: 3 },
      through: "2026-08",
    });
  });

  it("publishes nothing before any month qualifies", async () => {
    await quiet(seed, "2026-08-02T01:00:00Z");

    expect(await loadPublicPrecision(h.db, h.clock.now())).toStrictEqual({
      months: [],
      minimum: { notices: 10, families: 3 },
      through: "2026-08",
    });
  });
});
