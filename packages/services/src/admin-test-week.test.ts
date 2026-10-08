import { events } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminTestWeek } from "./admin-test-week.ts";
import { recordEvent } from "./events.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const ctx = { admin: "founder@vela.test" };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
});
afterAll(async () => {
  await h.close();
});

async function happened(name: Parameters<typeof recordEvent>[1]["name"], surface?: string) {
  await recordEvent(
    h.db,
    { name, familyId: seed.family.id, memberId: seed.member.id, ...(surface ? { surface } : {}) },
    h.clock.now(),
  );
}

describe("loadAdminTestWeek", () => {
  it("counts each step from the family's own events, apart from another family's", async () => {
    await happened("answer_recorded");
    await happened("answer_recorded");
    await happened("reply_posted", "app");
    await happened("stop_said");
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "Other",
      organiserExternalId: "9101",
      memberExternalId: "9102",
    });
    await recordEvent(
      h.db,
      { name: "readback_delivered", familyId: other.family.id },
      h.clock.now(),
    );

    const report = await loadAdminTestWeek(h.deps, ctx, seed.family.id);
    const step = (key: string) => report?.steps.find((one) => one.key === key);
    expect(step("answer")).toMatchObject({ count: 2, firstAt: h.clock.now(), required: true });
    expect(step("reply_app")?.count).toBe(1);
    expect(step("reply_group")?.count).toBe(0);
    expect(step("stop")?.count).toBe(1);
    expect(step("readback")?.count).toBe(0);
    expect(step("start")).toMatchObject({ count: 0, firstAt: null });
  });

  it("tells a group reply from an app reply", async () => {
    await happened("reply_posted", "telegram");
    const report = await loadAdminTestWeek(h.deps, ctx, seed.family.id);
    expect(report?.steps.find((one) => one.key === "reply_group")?.count).toBe(1);
    expect(report?.steps.find((one) => one.key === "reply_app")?.count).toBe(0);
  });

  it("is audited, refuses another family's scope, and is null for a family that is gone", async () => {
    const before = (await h.db.select().from(events)).length;
    await loadAdminTestWeek(h.deps, ctx, seed.family.id);
    await expect(
      loadAdminTestWeek(h.deps, { ...ctx, familyId: crypto.randomUUID() }, seed.family.id),
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(await loadAdminTestWeek(h.deps, ctx, crypto.randomUUID())).toBeNull();
    expect((await h.db.select().from(events)).length).toBeGreaterThan(before);
  });
});
