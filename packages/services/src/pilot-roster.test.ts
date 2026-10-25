import { adminAccessLog } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pilotAllowsTelegram, pilotFamilyAllowed } from "./pilot-admission.ts";
import {
  addToRoster,
  admissionWithRoster,
  approveFamily,
  loadPilotFamilies,
  loadRoster,
  removeFromRoster,
  rosterIds,
  unapproveFamily,
} from "./pilot-roster.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
const ctx = { admin: "founder@vela.test" };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  h.clock.set(new Date("2026-10-11T02:00:00Z"));
});
afterAll(async () => {
  await h.close();
});

describe("the trial roster on the admin page", () => {
  it("approves an id once, logs who did it, and lists it", async () => {
    expect(await addToRoster(h.deps, ctx, " 2001 ")).toBe("added");
    expect(await addToRoster(h.deps, ctx, "2001")).toBe("already");

    expect(await loadRoster(h.deps)).toEqual([
      { telegramUserId: "2001", addedAt: new Date("2026-10-11T02:00:00Z") },
    ]);
    expect(
      (await h.db.select().from(adminAccessLog)).map((row) => [row.action, row.what, row.admin]),
    ).toEqual([["roster_add", "telegram:2001", "founder@vela.test"]]);
  });

  it("removes an id, logging it, and says when there was nothing to remove", async () => {
    await addToRoster(h.deps, ctx, "2001");
    expect(await removeFromRoster(h.deps, ctx, "2001")).toBe("removed");
    expect(await removeFromRoster(h.deps, ctx, "2001")).toBe("absent");

    expect(await rosterIds(h.db)).toEqual([]);
    expect((await h.db.select().from(adminAccessLog)).map((row) => row.action)).toEqual([
      "roster_add",
      "roster_remove",
    ]);
  });

  it.each(["", "0123", "-5", "Mia", "1099511627776", "2001,3001"])(
    "refuses %j as a Telegram id and changes nothing",
    async (id) => {
      await expect(addToRoster(h.deps, ctx, id)).rejects.toMatchObject({ code: "invalid_payload" });
      expect(await rosterIds(h.db)).toEqual([]);
      expect(await h.db.select().from(adminAccessLog)).toEqual([]);
    },
  );

  it("refuses a change without an admin identity", async () => {
    await expect(addToRoster(h.deps, { admin: " " }, "2001")).rejects.toMatchObject({
      code: "invalid_payload",
    });
  });
});

describe("admission with the roster", () => {
  it("leaves admission off when there is no closed pilot", async () => {
    await addToRoster(h.deps, ctx, "2001");
    expect(await admissionWithRoster(h.db, null)).toBeNull();
  });

  it("adds the founder's approved ids to the private allowlist", async () => {
    await addToRoster(h.deps, ctx, "2001");
    await addToRoster(h.deps, ctx, "1001");
    const admission = await admissionWithRoster(h.db, { telegramUserIds: ["1001"] });

    expect(admission).toEqual({ telegramUserIds: ["1001", "2001"] });
    expect(pilotAllowsTelegram(admission, "2001")).toBe(true);
    expect(pilotAllowsTelegram(admission, "3001")).toBe(false);
  });

  it("admits nobody with an empty allowlist and an empty roster", async () => {
    const admission = await admissionWithRoster(h.db, { telegramUserIds: [] });
    expect(admission).toEqual({ telegramUserIds: [] });
    expect(pilotAllowsTelegram(admission, "1001")).toBe(false);
  });

  it("admits a family once every member's Telegram id is approved, and pauses it on removal", async () => {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1001",
      memberExternalId: "2001",
    });
    const base = { telegramUserIds: [] as string[] };

    await addToRoster(h.deps, ctx, "1001");
    expect(
      await pilotFamilyAllowed(h.db, await admissionWithRoster(h.db, base), seed.family.id),
    ).toBe(false);

    await addToRoster(h.deps, ctx, "2001");
    expect(
      await pilotFamilyAllowed(h.db, await admissionWithRoster(h.db, base), seed.family.id),
    ).toBe(true);

    await removeFromRoster(h.deps, ctx, "2001");
    expect(
      await pilotFamilyAllowed(h.db, await admissionWithRoster(h.db, base), seed.family.id),
    ).toBe(false);
  });
});

describe("approved families on the admin page (ADR-52)", () => {
  it("lists every family waiting, approves one once, logs it, and admits it", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    expect(await loadPilotFamilies(h.deps)).toEqual([
      {
        familyId: seed.family.id,
        createdAt: seed.family.createdAt,
        language: "en",
        members: 2,
        messengers: ["telegram"],
        approvedAt: null,
      },
    ]);
    expect(await approveFamily(h.deps, ctx, seed.family.id.toUpperCase())).toBe("approved");
    expect(await approveFamily(h.deps, ctx, seed.family.id)).toBe("already");
    expect((await loadPilotFamilies(h.deps))[0]?.approvedAt).toEqual(h.clock.now());
    expect(
      (await h.db.select().from(adminAccessLog)).map((row) => [
        row.action,
        row.familyId,
        row.admin,
      ]),
    ).toEqual([["family_approve", seed.family.id, "founder@vela.test"]]);

    const base = { telegramUserIds: [], familyIds: [], languages: ["en", "zh-TW"] };
    const admission = await admissionWithRoster(h.db, base);
    expect(admission?.familyIds).toEqual([seed.family.id]);
    expect(await pilotFamilyAllowed(h.db, admission, seed.family.id)).toBe(true);
    // With family approval off, the table is not read.
    expect(await admissionWithRoster(h.db, { telegramUserIds: [] })).toEqual({
      telegramUserIds: [],
    });
  });

  it("removes approval, pausing the family, and says when there was none", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await approveFamily(h.deps, ctx, seed.family.id);
    expect(await unapproveFamily(h.deps, ctx, seed.family.id)).toBe("unapproved");
    expect(await unapproveFamily(h.deps, ctx, seed.family.id)).toBe("absent");
    const admission = await admissionWithRoster(h.db, { telegramUserIds: [], familyIds: [] });
    expect(await pilotFamilyAllowed(h.db, admission, seed.family.id)).toBe(false);
    expect((await h.db.select().from(adminAccessLog)).map((row) => row.action)).toEqual([
      "family_approve",
      "family_unapprove",
    ]);
  });

  it("refuses an id that is not a family, or a family that does not exist", async () => {
    await expect(approveFamily(h.deps, ctx, "Mia")).rejects.toMatchObject({
      code: "invalid_payload",
    });
    await expect(
      approveFamily(h.deps, ctx, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await h.db.select().from(adminAccessLog)).toEqual([]);
  });
});
