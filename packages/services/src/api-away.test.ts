/**
 * Away mode from the app (spec §8): any member of her family sets her away and ends it; repeats
 * and quiet notices stop for those days, her light shows away, and her schedule decides again.
 */
import { ApiAway, MemberLight } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { awayPeriods, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { AwayRefusedError, endApiAway, setApiAway } from "./api-away.ts";
import { loadApiLights } from "./api-lights.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-x" };
let today: string;
let keys = 0;

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
  await h.db
    .update(members)
    .set({ userId: user?.id ?? null })
    .where(eq(members.id, memberId));
}

function day(offset: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function away(who: SessionIdentity, from: string, until: string | null) {
  keys += 1;
  return setApiAway(h.deps, who, `away-${keys}`, seed.family.id, seed.member.id, { from, until });
}

async function herLight() {
  const lights = await loadApiLights(h.db, mia, seed.family.id, h.clock.now());
  return MemberLight.parse(lights?.[0]);
}

describe("away from the app", () => {
  it("is set by any member, shows on her light, and asks her schedule to decide again", async () => {
    const set = await away(sam, today, day(3));

    const period = ApiAway.parse(set.response.body);
    expect(set.response.status).toBe(201);
    expect(period).toMatchObject({ member_id: seed.member.id, from: today, until: day(3) });
    expect(set.after.wakeMemberIds).toEqual([seed.member.id]);
    const [row] = await h.db.select().from(awayPeriods);
    expect(row).toMatchObject({ source: "member", toDate: day(3) });
    expect(await herLight()).toMatchObject({
      state: "away",
      away_until: day(3),
      away_id: period.id,
    });
  });

  it("stores the same away once, and an organiser's as the organiser's", async () => {
    const first = ApiAway.parse((await away(mia, today, null)).response.body);
    const again = ApiAway.parse((await away(sam, today, null)).response.body);

    expect(again.id).toBe(first.id);
    const rows = await h.db.select().from(awayPeriods);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("organiser");
  });

  it("refuses a day before her today, a day past 90 days, and anyone outside the family", async () => {
    await expect(away(mia, day(-1), null)).rejects.toBeInstanceOf(AwayRefusedError);
    await expect(away(mia, today, day(91))).rejects.toBeInstanceOf(AwayRefusedError);
    await expect(away(stranger, today, null)).rejects.toBeInstanceOf(VelaError);
    keys += 1;
    await expect(
      setApiAway(h.deps, mia, `away-${keys}`, seed.family.id, seed.organiser.id, {
        from: today,
        until: null,
      }),
    ).rejects.toBeInstanceOf(VelaError);
    expect(await h.db.select().from(awayPeriods)).toEqual([]);
  });

  it("is ended by any member, and her light is hers again", async () => {
    const period = ApiAway.parse((await away(mia, today, null)).response.body);

    keys += 1;
    const ended = await endApiAway(h.deps, sam, `end-${keys}`, period.id);

    expect(ended.response.body).toMatchObject({ id: period.id, ended: true });
    expect(ended.after.wakeMemberIds).toEqual([seed.member.id]);
    expect(await herLight()).toMatchObject({ away_id: null, away_until: null });
    keys += 1;
    await expect(endApiAway(h.deps, stranger, `end-${keys}`, period.id)).rejects.toBeInstanceOf(
      VelaError,
    );
  });
});
