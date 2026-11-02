import {
  MEMORY_PERMISSION_TEXT_EN,
  MEMORY_PERMISSION_VERSION,
  MemoryPermissionPreview,
} from "@vela/contracts";
import { consents, members, memoryPermissionPresentations, users } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.ts";
import { withdrawOwnMemoryConsent } from "./memory-consent.ts";
import {
  answerMemoryPermission,
  loadMemoryPermission,
  loadMemoryPermissionPresentation,
  prepareMemoryPermission,
} from "./memory-permission.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
let familyId: string;
let memberId: string;
const owner = { authSubject: "synthetic|permission-owner", sessionId: "owner" };
const organiser = { authSubject: "synthetic|permission-organiser", sessionId: "organiser" };
beforeAll(async () => {
  h = await createHarness({ config: { richMemories: true } });
}, 60_000);
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  h.config.richMemories = true;
  const family = await seedFamily(h.db, { now: h.clock.now() });
  familyId = family.family.id;
  memberId = family.member.id;
  for (const [identity, id] of [
    [owner, memberId],
    [organiser, family.organiser.id],
  ] as const) {
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
      .returning();
    if (!user) throw new Error("Missing synthetic user");
    await h.db.update(members).set({ userId: user.id }).where(eq(members.id, id));
  }
});

async function prepare(key = "synthetic:prepare", who = owner) {
  const result = await prepareMemoryPermission(h.deps, who, key, familyId, { lang: "en" });
  return (result.response.body as { id: string }).id;
}
async function answer(id: string, value: "yes" | "no", key = "synthetic:answer", who = owner) {
  return answerMemoryPermission(h.deps, who, key, familyId, {
    presentation_id: id,
    answer: value,
    text_version: MEMORY_PERMISSION_VERSION,
    text_sha256: await sha256Hex(MEMORY_PERMISSION_TEXT_EN),
  });
}
const memoryConsents = () => h.db.select().from(consents).where(eq(consents.kind, "rich_memories"));
const state = (who = owner) => loadMemoryPermission(h.deps, who, familyId);

describe("the author's own memory permission", () => {
  it("shows the exact words and records a yes bound to them", async () => {
    expect(await state()).toEqual({ state: "none", outdated: false });
    const id = await prepare();
    const preview = await loadMemoryPermissionPresentation(h.deps, owner, familyId, id);
    expect(MemoryPermissionPreview.parse(preview).text).toBe(MEMORY_PERMISSION_TEXT_EN);
    const result = await answer(id, "yes");
    expect(result.response.body).toEqual({ answer: "yes" });
    expect(await state()).toEqual({ state: "yes", outdated: false });
    const [row] = await h.db
      .select()
      .from(consents)
      .where(and(eq(consents.memberId, memberId), eq(consents.kind, "rich_memories")));
    expect(row).toMatchObject({
      kind: "rich_memories",
      answer: "yes",
      textVersion: MEMORY_PERMISSION_VERSION,
      channel: "app",
    });
    expect(row?.evidence).toEqual({
      presentation_id: id,
      text_sha256: await sha256Hex(MEMORY_PERMISSION_TEXT_EN),
      notice_version: "privacy-notice.v7",
    });
  });

  it("records a no without turning anything on", async () => {
    await answer(await prepare(), "no");
    expect(await state()).toEqual({ state: "no", outdated: false });
  });

  it("replays the same request but refuses a second use of one presentation", async () => {
    const id = await prepare();
    await answer(id, "yes");
    const replay = await answer(id, "yes");
    expect(replay.response.body).toEqual({ answer: "yes" });
    await expect(answer(id, "no", "synthetic:other")).rejects.toMatchObject({
      code: "illegal_state",
    });
    expect(await memoryConsents()).toHaveLength(1);
  });

  it("refuses wrong words, an expired question and an organiser answering for someone", async () => {
    const id = await prepare();
    await expect(
      answerMemoryPermission(h.deps, owner, "synthetic:wrong", familyId, {
        presentation_id: id,
        answer: "yes",
        text_version: MEMORY_PERMISSION_VERSION,
        text_sha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "illegal_state" });
    await expect(answer(id, "yes", "synthetic:organiser", organiser)).rejects.toMatchObject({
      code: "illegal_state",
    });
    h.clock.advance(5 * 60_000);
    expect(await loadMemoryPermissionPresentation(h.deps, owner, familyId, id)).toBeNull();
    await expect(answer(id, "yes", "synthetic:late")).rejects.toMatchObject({
      code: "illegal_state",
    });
    expect(await memoryConsents()).toHaveLength(0);
  });

  it("does not let a question shown before 'turn off and clear' turn memories back on", async () => {
    await answer(await prepare(), "yes");
    const stale = await prepare("synthetic:prepare:stale");
    // Bypass the delete in withdrawal to prove the issued-before-withdrawal check on its own.
    const [kept] = await h.db
      .select()
      .from(memoryPermissionPresentations)
      .where(eq(memoryPermissionPresentations.id, stale));
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw", familyId);
    expect(await h.db.select().from(memoryPermissionPresentations)).toHaveLength(0);
    const [now] = await h.db.select().from(members).where(eq(members.id, memberId));
    if (!kept || !now) throw new Error("Missing synthetic presentation");
    await h.db
      .insert(memoryPermissionPresentations)
      .values({ ...kept, membershipRevision: now.memoryMembershipRevision });
    await expect(answer(stale, "yes", "synthetic:late-yes")).rejects.toMatchObject({
      code: "illegal_state",
    });
    expect(await state()).toEqual({ state: "withdrawn", outdated: false });
    h.clock.advance(1000);
    await answer(await prepare("synthetic:prepare:again"), "yes", "synthetic:again");
    expect(await state()).toEqual({ state: "yes", outdated: false });
  });

  it("refuses a question whose membership changed after it was shown", async () => {
    const id = await prepare();
    await h.db
      .update(members)
      .set({ memoryMembershipRevision: crypto.randomUUID() })
      .where(eq(members.id, memberId));
    await expect(answer(id, "yes")).rejects.toMatchObject({ code: "illegal_state" });
  });

  it("is absent everywhere while the switch is off", async () => {
    const id = await prepare();
    h.config.richMemories = false;
    expect(await state()).toBeNull();
    expect(await loadMemoryPermissionPresentation(h.deps, owner, familyId, id)).toBeNull();
    await expect(
      prepareMemoryPermission(h.deps, owner, "synthetic:off", familyId, { lang: "en" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(answer(id, "yes", "synthetic:off-answer")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
