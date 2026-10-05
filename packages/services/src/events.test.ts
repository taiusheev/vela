import { events } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordEvent } from "./events.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

describe("recordEvent", () => {
  it("writes the event with its ids, its time, and flat properties", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const at = new Date("2026-09-14T01:23:00Z");

    await recordEvent(
      h.db,
      {
        name: "answer_recorded",
        familyId: seed.family.id,
        memberId: seed.member.id,
        surface: "telegram",
        props: { kind: "voice", latency: 12, late: false, note: null },
      },
      at,
    );

    const [row] = await h.db.select().from(events);
    expect(row).toMatchObject({
      name: "answer_recorded",
      at,
      familyId: seed.family.id,
      memberId: seed.member.id,
      exchangeId: null,
      surface: "telegram",
      props: { kind: "voice", latency: 12, late: false, note: null },
    });
  });

  it("defaults the properties to none and works inside a transaction that rolls back", async () => {
    await h.db
      .transaction(async (tx) => {
        await recordEvent(tx, { name: "scheduler_tick" }, h.clock.now());
        const [row] = await tx.select().from(events);
        expect(row?.props).toEqual({});
        tx.rollback();
      })
      .catch(() => undefined);

    expect(await h.db.select().from(events)).toHaveLength(0);
  });

  it("refuses a name outside the contract before touching the database", async () => {
    await expect(
      recordEvent(h.db, { name: "something_else" as "scheduler_tick" }, h.clock.now()),
    ).rejects.toThrow();
    expect(await h.db.select().from(events)).toHaveLength(0);
  });

  it("refuses a property that could carry content", async () => {
    await expect(
      recordEvent(
        h.db,
        { name: "scheduler_tick", props: { text: "x".repeat(201) } },
        h.clock.now(),
      ),
    ).rejects.toThrow();
  });
});
