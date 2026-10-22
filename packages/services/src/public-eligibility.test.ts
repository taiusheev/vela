import {
  PUBLIC_ELIGIBILITY_TERMS_VERSION,
  PUBLIC_ELIGIBILITY_TEXT,
  PUBLIC_ELIGIBILITY_VERSION,
} from "@vela/contracts";
import { apiRequestReceipts, channelLinks, consents, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disableApiAccount } from "./api-account-writes.ts";
import { sha256Hex } from "./hash.ts";
import {
  clearOwnPublicEligibility,
  loadOwnPublicEligibility,
  type OwnEligibilityActor,
  recordOwnPublicEligibility,
} from "./public-eligibility.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
const app: OwnEligibilityActor = {
  kind: "app",
  identity: { authSubject: "synthetic|alex", sessionId: "session-test" },
};
const parent: OwnEligibilityActor = {
  kind: "telegram",
  externalId: "2001",
  conversationId: "2001",
  updateId: "10001",
};
const choice = {
  version: PUBLIC_ELIGIBILITY_VERSION,
  terms_version: PUBLIC_ELIGIBILITY_TERMS_VERSION,
  language: "en",
  adult_self_declared: true,
  residence_self_declared: "TW",
  notice_read: true,
  review_terms_acknowledged: true,
};
const eligibility = {
  enabled: true,
  environment: "synthetic-review" as const,
  policyVersion: PUBLIC_ELIGIBILITY_VERSION,
};
const deps = () => ({ ...h.deps, eligibility });
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  await h.db.insert(users).values({ authSubject: "synthetic|alex", displayName: "Alex" });
});
afterAll(async () => {
  await h?.close();
});
describe("review-only self declarations", () => {
  it("collects nothing when absent/off/unreviewed", async () => {
    for (const config of [
      undefined,
      { ...eligibility, enabled: false },
      { ...eligibility, policyVersion: "old" },
    ]) {
      await expect(
        recordOwnPublicEligibility({ ...h.deps, eligibility: config }, app, "off", choice),
      ).rejects.toMatchObject({ code: "not_found" });
    }
    expect(await loadOwnPublicEligibility(h.deps, app)).toBeNull();
    expect(await h.db.select().from(apiRequestReceipts)).toHaveLength(0);
  });
  it("stores a server-dated own declaration with the exact language fingerprints and no duplicate receipt payload", async () => {
    await recordOwnPublicEligibility(deps(), app, "own", choice);
    const row = await loadOwnPublicEligibility(h.deps, app);
    expect(row).toMatchObject({
      ...choice,
      status: "review_only",
      source: "app_account",
      recorded_at: h.clock.now().toISOString(),
      notice_sha256: await sha256Hex(PUBLIC_ELIGIBILITY_TEXT.en),
    });
    const [receipt] = await h.db.select().from(apiRequestReceipts);
    expect(JSON.stringify(receipt?.result)).not.toContain("adult_self_declared");
  });
  it("replays without changing evidence, but a changed answer with the same key conflicts", async () => {
    await recordOwnPublicEligibility(deps(), app, "retry", choice);
    const before = await loadOwnPublicEligibility(h.deps, app);
    h.clock.advance(60_000);
    expect((await recordOwnPublicEligibility(deps(), app, "retry", choice)).replayed).toBe(true);
    expect(await loadOwnPublicEligibility(h.deps, app)).toEqual(before);
    await expect(
      recordOwnPublicEligibility(deps(), app, "retry", { ...choice, language: "zh-TW" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("cannot target a parent by injecting a body member ID", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await expect(
      recordOwnPublicEligibility(deps(), app, "for-parent", {
        ...choice,
        member_id: seed.member.id,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      (await h.db.select().from(members).where(eq(members.id, seed.member.id)))[0]
        ?.publicEligibility,
    ).toBeNull();
  });
  it("records only the private sender's declaration without changing existing family consent", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), memberExternalId: "2001" });
    const before = await h.db.select().from(consents);
    await recordOwnPublicEligibility(deps(), parent, "parent-own", {
      ...choice,
      language: "zh-TW",
    });
    expect(await loadOwnPublicEligibility(h.deps, parent)).toMatchObject({
      source: "telegram_self",
      language: "zh-TW",
      notice_sha256: await sha256Hex(PUBLIC_ELIGIBILITY_TEXT["zh-TW"]),
    });
    expect(
      (await h.db.select().from(members).where(eq(members.id, seed.organiser.id)))[0]
        ?.publicEligibility,
    ).toBeNull();
    expect(await h.db.select().from(consents)).toEqual(before);
  });
  it("rejects group IDs, blocked senders and departed participants", async () => {
    await expect(
      recordOwnPublicEligibility(
        deps(),
        { ...parent, conversationId: "-100123" },
        "group-sender",
        choice,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const seed = await seedFamily(h.db, { now: h.clock.now(), memberExternalId: "2001" });
    await expect(
      recordOwnPublicEligibility(deps(), { ...parent, externalId: "-100123" }, "group", choice),
    ).rejects.toMatchObject({ code: "invalid" });
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.memberLink.id));
    await expect(
      recordOwnPublicEligibility(deps(), parent, "blocked", choice),
    ).rejects.toMatchObject({ code: "not_found" });
    await h.db
      .update(channelLinks)
      .set({ blockedAt: null })
      .where(eq(channelLinks.id, seed.memberLink.id));
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    await expect(recordOwnPublicEligibility(deps(), parent, "left", choice)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("never exposes one account's declaration to another", async () => {
    await h.db.insert(users).values({ authSubject: "synthetic|other", displayName: "River" });
    await recordOwnPublicEligibility(deps(), app, "alex", choice);
    expect(
      await loadOwnPublicEligibility(h.deps, {
        kind: "app",
        identity: { authSubject: "synthetic|other", sessionId: "other-session" },
      }),
    ).toBeNull();
  });
  it("does not inherit a prior declaration when the Telegram identity changes", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), memberExternalId: "2001" });
    await recordOwnPublicEligibility(deps(), parent, "before-relink", choice);
    await h.db
      .update(channelLinks)
      .set({ externalId: "2002" })
      .where(eq(channelLinks.id, seed.memberLink.id));
    expect(
      await loadOwnPublicEligibility(h.deps, {
        ...parent,
        externalId: "2002",
        conversationId: "2002",
      }),
    ).toBeNull();
  });
  it("clears own evidence with collection off and never resurrects it from a save replay", async () => {
    await recordOwnPublicEligibility(deps(), app, "save-first", choice);
    await clearOwnPublicEligibility(h.deps, app, "clear");
    expect(await loadOwnPublicEligibility(h.deps, app)).toBeNull();
    await recordOwnPublicEligibility(deps(), app, "save-first", choice);
    expect(await loadOwnPublicEligibility(h.deps, app)).toBeNull();
  });
  it("account deletion clears evidence and old mutation retries cannot restore it", async () => {
    await recordOwnPublicEligibility(deps(), app, "before-delete", choice);
    await disableApiAccount(h.deps, "synthetic|alex");
    expect((await h.db.select().from(users))[0]?.publicEligibility).toBeNull();
    await expect(
      recordOwnPublicEligibility(deps(), app, "before-delete", choice),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
