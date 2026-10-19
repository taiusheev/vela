import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RELEASE_WINDOW_QUERY, releaseWindowSafe } from "./release-window.ts";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table families(id int primary key, deleted_at timestamptz);
 create table members(family_id int references families(id), status text default 'active', left_at timestamptz,
 light_on bool default true, light_consented_at timestamptz default now(), next_wake_at timestamptz);`);
});
beforeEach(async () => {
  await db.exec("delete from members; delete from families; insert into families(id) values(1)");
});
afterAll(async () => {
  await db.close();
});
async function safe() {
  const result = await db.query(RELEASE_WINDOW_QUERY);
  return releaseWindowSafe(result.rows[0]);
}

describe("production release window", () => {
  it("allows a family with no consented active lights, and an existing light well beyond the buffer", async () => {
    expect(await safe()).toBe(true);
    await db.exec(
      "insert into members(family_id,next_wake_at) values(1,now()+interval '46 minutes')",
    );
    expect(await safe()).toBe(true);
  });
  it.each(["-1 minute", "0 minutes", "30 minutes", "45 minutes"])(
    "stops before an overdue or imminent wake (%s)",
    async (offset) => {
      await db.query("insert into members(family_id,next_wake_at) values(1,now()+$1::interval)", [
        offset,
      ]);
      expect(await safe()).toBe(false);
    },
  );
  it("stops if any active consented light has an unknown wake", async () => {
    await db.exec("insert into members(family_id,next_wake_at) values(1,null)");
    expect(await safe()).toBe(false);
  });
  it("ignores paused, departed, deleted-family and unconsented lights", async () => {
    await db.exec(`insert into families(id,deleted_at) values(2,now());
  insert into members(family_id,status) values(1,'paused');
  insert into members(family_id,left_at) values(1,now());
  insert into members(family_id,light_on) values(1,false);
  insert into members(family_id,light_consented_at) values(1,null);
  insert into members(family_id) values(2);`);
    expect(await safe()).toBe(true);
  });
  it("fails closed on malformed aggregate output", () => {
    for (const row of [
      null,
      {},
      { active: 0, unknown: 0 },
      { active: 0, unknown: 0, imminent: "0" },
      { active: NaN, unknown: 0, imminent: 0 },
      { active: -1, unknown: 0, imminent: 0 },
    ])
      expect(releaseWindowSafe(row)).toBe(false);
  });
});
