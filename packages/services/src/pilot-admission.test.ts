import type { InboundEvent } from "@vela/contracts";
import { channelLinks, families, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverOutbound, enqueueOutbound } from "./gateway.ts";
import { handleParentCommand } from "./parent-commands.ts";
import {
  pilotAllowsInbound,
  pilotApiAccountAllowed,
  pilotCanActivate,
  pilotFamilyAllowed,
  pilotMemberAllowed,
} from "./pilot-admission.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
const admission = { telegramUserIds: ["1001", "2001"] };
beforeAll(async () => {
  h = await createHarness({ config: { pilotAdmission: admission } });
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

function inbound(id: string, text = "hello"): InboundEvent {
  return {
    channel: "telegram",
    eventId: `trial-${id}-${text}`,
    at: h.clock.now().toISOString(),
    kind: "text",
    sender: { externalUserId: id },
    conversation: { externalId: id, kind: "private" },
    text,
  };
}

async function proveOrganiser(memberId: string): Promise<void> {
  const queued = await enqueueOutbound(h.deps, h.db, {
    kind: "system",
    idempotencyKey: `trial-organiser-${memberId}`,
    memberId,
    channel: "telegram",
    conversationId: "1001",
    lang: "en",
    text: "Trial setup ready.",
  });
  if (!("outboundId" in queued)) throw new Error("Duplicate organiser proof");
  await deliverOutbound(h.deps, queued.outboundId);
}

describe("closed pilot admission", () => {
  it("pauses automatic family content until a roster-removed member formally leaves", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    expect(await pilotFamilyAllowed(h.db, null, "missing-family")).toBe(true);
    expect(await pilotFamilyAllowed(h.db, admission, seed.family.id)).toBe(true);
    const removed = { telegramUserIds: ["1001"] };
    expect(await pilotFamilyAllowed(h.db, removed, seed.family.id)).toBe(false);
    await h.db.update(members).set({ leftAt: h.clock.now() }).where(eq(members.id, seed.member.id));
    expect(await pilotFamilyAllowed(h.db, removed, seed.family.id)).toBe(true);
  });

  it("requires a live English family with at least one admitted current member", async () => {
    expect(await pilotFamilyAllowed(h.db, admission, "11111111-1111-7111-8111-111111111111")).toBe(
      false,
    );
    const [empty] = await h.db
      .insert(families)
      .values({ name: "Empty family", region: "apac", country: "VN", language: "en" })
      .returning();
    if (empty === undefined) throw new Error("Missing empty family");
    expect(await pilotFamilyAllowed(h.db, admission, empty.id)).toBe(false);
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db.update(members).set({ language: "zh-TW" }).where(eq(members.id, seed.member.id));
    expect(await pilotFamilyAllowed(h.db, admission, seed.family.id)).toBe(false);
    await h.db.update(members).set({ language: "en" }).where(eq(members.id, seed.member.id));
    await h.db.update(families).set({ language: "zh-TW" }).where(eq(families.id, seed.family.id));
    expect(await pilotFamilyAllowed(h.db, admission, seed.family.id)).toBe(false);
    await h.db
      .update(families)
      .set({ language: "en", deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    expect(await pilotFamilyAllowed(h.db, admission, seed.family.id)).toBe(false);
  });
  it("uses current role-independent membership and Telegram admission for automatic work", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    expect(await pilotMemberAllowed(h.db, null, "missing-family", "missing-member")).toBe(true);
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.organiser.id)).toBe(true);
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(true);
    expect(
      await pilotMemberAllowed(
        h.db,
        admission,
        "11111111-1111-7111-8111-111111111111",
        seed.member.id,
      ),
    ).toBe(false);
    expect(
      await pilotMemberAllowed(h.db, { telegramUserIds: ["1001"] }, seed.family.id, seed.member.id),
    ).toBe(false);
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(true);
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.memberLink.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
  });

  it("refuses stale, non-English, departed and deleted family subjects", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db.update(members).set({ language: "zh-TW" }).where(eq(members.id, seed.member.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
    await h.db
      .update(members)
      .set({ language: "en", leftAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
    await h.db
      .update(members)
      .set({ leftAt: null, status: "deceased" })
      .where(eq(members.id, seed.member.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
    await h.db.update(members).set({ status: "active" }).where(eq(members.id, seed.member.id));
    await h.db.update(families).set({ language: "zh-TW" }).where(eq(families.id, seed.family.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
    await h.db
      .update(families)
      .set({ language: "en", deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    expect(await pilotMemberAllowed(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
  });
  it("admits only rostered Telegram accounts when enabled", () => {
    expect(pilotAllowsInbound(null, inbound("9999"))).toBe(true);
    expect(pilotAllowsInbound(admission, inbound("1001"))).toBe(true);
    expect(pilotAllowsInbound(admission, inbound("9999"))).toBe(false);
    expect(pilotAllowsInbound(admission, { ...inbound("1001"), channel: "line" })).toBe(false);
  });

  it("allows account provisioning, then requires every live membership to be approved English Telegram", async () => {
    const identity = { authSubject: "trial-app-user", sessionId: "trial-app-session" };
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Organiser" })
      .returning();
    if (user === undefined) throw new Error("Missing account");
    expect(await pilotApiAccountAllowed(h.db, identity, admission)).toBe(true);
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
    expect(await pilotApiAccountAllowed(h.db, identity, admission)).toBe(true);
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.organiserLink.id));
    expect(await pilotApiAccountAllowed(h.db, identity, admission)).toBe(false);
    await h.db
      .update(channelLinks)
      .set({ blockedAt: null })
      .where(eq(channelLinks.id, seed.organiserLink.id));
    await h.db.update(members).set({ language: "zh-TW" }).where(eq(members.id, seed.organiser.id));
    expect(await pilotApiAccountAllowed(h.db, identity, admission)).toBe(false);
  });

  it("requires actual organiser delivery before activation and rejects a blocked organiser", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    expect(await pilotCanActivate(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
    await proveOrganiser(seed.organiser.id);
    expect(await pilotCanActivate(h.db, admission, seed.family.id, seed.member.id)).toBe(true);
    expect(
      await pilotCanActivate(h.db, { telegramUserIds: ["1001"] }, seed.family.id, seed.member.id),
    ).toBe(false);
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.organiserLink.id));
    expect(await pilotCanActivate(h.db, admission, seed.family.id, seed.member.id)).toBe(false);
  });

  it("keeps pause available after roster removal and waits for proven delivery to resume", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const removedDeps = {
      ...h.deps,
      config: { ...h.config, pilotAdmission: { telegramUserIds: [] } },
    };
    await handleParentCommand(removedDeps, seed.member, "stop", inbound("2001", "stop"));
    const [paused] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    if (paused === undefined) throw new Error("Missing parent");
    expect(paused.status).toBe("paused");
    await handleParentCommand(h.deps, paused, "start", inbound("2001", "start"));
    expect(
      (await h.db.select().from(members).where(eq(members.id, seed.member.id)))[0]?.status,
    ).toBe("paused");
    await proveOrganiser(seed.organiser.id);
    await handleParentCommand(h.deps, paused, "start", {
      ...inbound("2001", "start"),
      eventId: "resume-after-delivery",
    });
    expect(
      (await h.db.select().from(members).where(eq(members.id, seed.member.id)))[0]?.status,
    ).toBe("active");
  });
});
