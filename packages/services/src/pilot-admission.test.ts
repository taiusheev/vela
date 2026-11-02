import type { InboundEvent } from "@vela/contracts";
import { channelLinks, families, familyChannels, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverOutbound, enqueueOutbound } from "./gateway.ts";
import { handleParentCommand } from "./parent-commands.ts";
import {
  pilotAdmitsInbound,
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

const ORGANISER_LINE = `U${"a".repeat(32)}`;
const HER_LINE = `U${"b".repeat(32)}`;
const GROUP_LINE = `C${"c".repeat(32)}`;

function lineInbound(id: string, group?: string): InboundEvent {
  return {
    channel: "line",
    eventId: `line-${id}-${group ?? "private"}`,
    at: h.clock.now().toISOString(),
    kind: "text",
    sender: { externalUserId: id },
    conversation: { externalId: group ?? id, kind: group === undefined ? "private" : "group" },
    text: "早安",
  };
}

/** A Taiwan family on LINE, in Chinese (ADR-52): her chat and the organiser's both on LINE. */
async function seedLineFamily() {
  const seed = await seedFamily(h.db, { now: h.clock.now(), language: "zh-TW" });
  await h.db
    .update(channelLinks)
    .set({ channel: "line", externalId: ORGANISER_LINE })
    .where(eq(channelLinks.id, seed.organiserLink.id));
  await h.db
    .update(channelLinks)
    .set({ channel: "line", externalId: HER_LINE })
    .where(eq(channelLinks.id, seed.memberLink.id));
  return seed;
}

function approving(familyIds: string[], languages = ["en", "zh-TW"]) {
  return { telegramUserIds: ["1001", "2001"], familyIds, languages };
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
  it("admits only rostered Telegram accounts when enabled", async () => {
    expect(await pilotAdmitsInbound(h.db, null, inbound("9999"))).toBe(true);
    expect(await pilotAdmitsInbound(h.db, admission, inbound("1001"))).toBe(true);
    expect(await pilotAdmitsInbound(h.db, admission, inbound("9999"))).toBe(false);
    expect(await pilotAdmitsInbound(h.db, admission, lineInbound(HER_LINE))).toBe(false);
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

describe("approved families (ADR-52)", () => {
  it("admits an approved family on LINE in Chinese, and nobody in it once approval is removed", async () => {
    const seed = await seedLineFamily();
    const approved = approving([seed.family.id]);
    expect(await pilotFamilyAllowed(h.db, approved, seed.family.id)).toBe(true);
    expect(await pilotMemberAllowed(h.db, approved, seed.family.id, seed.member.id)).toBe(true);
    const removed = approving([]);
    expect(await pilotFamilyAllowed(h.db, removed, seed.family.id)).toBe(false);
    expect(await pilotMemberAllowed(h.db, removed, seed.family.id, seed.member.id)).toBe(false);
  });

  it("keeps an approved family out in a language the test does not run in", async () => {
    const seed = await seedLineFamily();
    const englishOnly = approving([seed.family.id], ["en"]);
    expect(await pilotFamilyAllowed(h.db, englishOnly, seed.family.id)).toBe(false);
    expect(await pilotMemberAllowed(h.db, englishOnly, seed.family.id, seed.member.id)).toBe(false);
  });

  it("lets a LINE newcomer in to start or join, but not a known family that is not approved", async () => {
    const seed = await seedLineFamily();
    const stranger = `U${"d".repeat(32)}`;
    // Family approval off: LINE stays closed, as before.
    expect(await pilotAdmitsInbound(h.db, admission, lineInbound(stranger))).toBe(false);
    expect(await pilotAdmitsInbound(h.db, approving([]), lineInbound(stranger))).toBe(true);
    expect(await pilotAdmitsInbound(h.db, approving([]), lineInbound(HER_LINE))).toBe(false);
    expect(await pilotAdmitsInbound(h.db, approving([seed.family.id]), lineInbound(HER_LINE))).toBe(
      true,
    );
    // A Telegram stranger still needs the roster.
    expect(await pilotAdmitsInbound(h.db, approving([]), inbound("9999"))).toBe(false);
  });

  it("follows the family's linked group: approved, not approved, or nobody's yet", async () => {
    const seed = await seedLineFamily();
    const newcomer = `U${"e".repeat(32)}`;
    expect(await pilotAdmitsInbound(h.db, approving([]), lineInbound(newcomer, GROUP_LINE))).toBe(
      true,
    );
    await h.db.insert(familyChannels).values({
      familyId: seed.family.id,
      channel: "line",
      conversationId: GROUP_LINE,
      kind: "group",
      linkedByMemberId: seed.organiser.id,
      linkedTextSha256: "0".repeat(64),
    });
    expect(await pilotAdmitsInbound(h.db, approving([]), lineInbound(newcomer, GROUP_LINE))).toBe(
      false,
    );
    expect(
      await pilotAdmitsInbound(
        h.db,
        approving([seed.family.id]),
        lineInbound(newcomer, GROUP_LINE),
      ),
    ).toBe(true);
  });

  it("starts her light only once a message reached the LINE organiser", async () => {
    const seed = await seedLineFamily();
    const approved = approving([seed.family.id]);
    expect(await pilotCanActivate(h.db, approved, seed.family.id, seed.member.id)).toBe(false);
    const queued = await enqueueOutbound(h.deps, h.db, {
      kind: "system",
      idempotencyKey: `trial-line-organiser-${seed.organiser.id}`,
      memberId: seed.organiser.id,
      channel: "line",
      conversationId: ORGANISER_LINE,
      lang: "zh-TW",
      text: "設定完成。",
    });
    if (!("outboundId" in queued)) throw new Error("Duplicate organiser proof");
    await deliverOutbound(h.deps, queued.outboundId);
    expect(await pilotCanActivate(h.db, approved, seed.family.id, seed.member.id)).toBe(true);
    expect(await pilotCanActivate(h.db, approving([]), seed.family.id, seed.member.id)).toBe(false);
  });

  it("lets an organiser of an approved Chinese family use the app", async () => {
    const identity = { authSubject: "taiwan-app-user", sessionId: "taiwan-app-session" };
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Organiser" })
      .returning();
    if (user === undefined) throw new Error("Missing account");
    const seed = await seedLineFamily();
    await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
    expect(await pilotApiAccountAllowed(h.db, identity, approving([seed.family.id]))).toBe(true);
    expect(await pilotApiAccountAllowed(h.db, identity, approving([]))).toBe(false);
  });
});
