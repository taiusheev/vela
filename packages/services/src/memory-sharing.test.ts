import {
  MEMORY_KEEP_EXPLANATION_EN,
  MEMORY_KEEP_VERSION,
  MEMORY_SHARE_VERSION,
} from "@vela/contracts";
import {
  answers,
  apiRequestReceipts,
  consents,
  families,
  members,
  memoryKeeps,
  memoryShares,
  memorySharingPresentations,
  users,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.ts";
import { applyRetention } from "./jobs.ts";
import { withdrawOwnMemoryConsent } from "./memory-consent.ts";
import {
  keepMemoryCandidate,
  loadKeptMemories,
  loadOwnKeptMemoriesForExport,
  loadSharedKeptMemories,
  removeKeptMemory,
} from "./memory-keeps.ts";
import {
  confirmMemorySharing,
  createMemorySharingPresentation,
  loadMemorySharingPresentation,
  stopSharingMemory,
} from "./memory-sharing.ts";
import { proposeMemoryCandidate, RICH_MEMORY_CONSENT_VERSION } from "./rich-memories.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let familyId: string;
let ownerId: string;
let recipientId: string;
let recipientUserId: string;
let answerId: string;
let memoryId: string;
const owner = { authSubject: "synthetic|sharing-owner", sessionId: "owner" };
const recipient = { authSubject: "synthetic|sharing-recipient", sessionId: "recipient" };
const words = "I love yellow flowers.";
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
  ownerId = family.member.id;
  recipientId = family.organiser.id;
  for (const [identity, memberId] of [
    [owner, ownerId],
    [recipient, recipientId],
  ] as const) {
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
      .returning();
    if (!user) throw new Error("Missing synthetic account");
    await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
    if (memberId === recipientId) recipientUserId = user.id;
  }
  await h.db.insert(consents).values({
    memberId: ownerId,
    subjectRef: `member:${ownerId}`,
    kind: "rich_memories",
    answer: "yes",
    textVersion: RICH_MEMORY_CONSENT_VERSION,
    lang: "en",
    channel: "app",
    givenAt: new Date(h.clock.now().getTime() - 1000),
  });
  const exchange = await seedExchange(h.db, family, { date: "2026-09-14" });
  const [answer] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: ownerId,
      kind: "text",
      channel: "telegram",
      payload: { text: words },
      receivedAt: h.clock.now(),
    })
    .returning();
  if (!answer) throw new Error("Missing synthetic answer");
  answerId = answer.id;
  const candidateId = await proposeMemoryCandidate(
    h.deps,
    { source_answer_id: answerId, kind: "preference", start: 0, end: words.length },
    { answerId, ordinaryText: words },
  );
  if (!candidateId) throw new Error("Missing synthetic candidate");
  await keepMemoryCandidate(h.deps, owner, "keep-synthetic-memory", familyId, {
    candidate_id: candidateId,
    confirmation_version: MEMORY_KEEP_VERSION,
    confirmation_sha256: await sha256Hex(MEMORY_KEEP_EXPLANATION_EN),
  });
  const [kept] = await h.db.select().from(memoryKeeps);
  if (!kept) throw new Error("Missing synthetic keep");
  memoryId = kept.id;
});
let sequence = 0;
const key = () => `synthetic-sharing-${++sequence}`;
async function prepare(ids = [recipientId]) {
  const created = await createMemorySharingPresentation(h.deps, owner, key(), familyId, {
    memory_id: memoryId,
    recipient_ids: ids,
  });
  const body = created.response.body;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.id !== "string"
  )
    throw new Error("Missing presentation ID");
  const id = body.id;
  const preview = await loadMemorySharingPresentation(h.deps, owner, familyId, id);
  if (!preview) throw new Error("Missing synthetic preview");
  return {
    preview,
    choice: {
      presentation_id: id,
      presentation_sha256: preview.presentation_sha256,
      confirmation_version: MEMORY_SHARE_VERSION,
    },
  };
}
async function additionalRecipient(name = "Sam") {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: `synthetic|${key()}`, displayName: name })
    .returning();
  if (!user) throw new Error("Missing synthetic user");
  const [member] = await h.db
    .insert(members)
    .values({
      familyId,
      userId: user.id,
      displayName: name,
      status: "active",
      tz: "Asia/Taipei",
      country: "TW",
    })
    .returning();
  if (!member) throw new Error("Missing synthetic member");
  return member;
}

describe("disabled persisted named-memory sharing", () => {
  it("persists only explicit recipients and content-free evidence, while all read paths stay private", async () => {
    const { preview, choice } = await prepare();
    expect(preview.quote).toBe(words);
    expect(preview.recipients.map((r) => r.member_id)).toEqual([recipientId]);
    expect(await h.db.select().from(memoryShares)).toEqual([]);
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    const [grant] = await h.db.select().from(memoryShares);
    expect(grant).toMatchObject({
      keepId: memoryId,
      recipientMemberId: recipientId,
      recipientUserId,
      confirmationVersion: MEMORY_SHARE_VERSION,
    });
    const serialized = JSON.stringify({
      grants: await h.db.select().from(memoryShares),
      pending: await h.db.select().from(memorySharingPresentations),
      receipts: await h.db.select().from(apiRequestReceipts),
    });
    expect(serialized).not.toContain(words);
    expect(serialized).not.toContain(preview.recipients[0]?.display_name);
    expect((await loadKeptMemories(h.deps, recipient, familyId))?.items).toEqual([]);
    const shared = await loadSharedKeptMemories(h.deps, recipient, familyId);
    expect(shared?.items.map((item) => item.id)).toEqual([memoryId]);
    expect(shared?.items[0]?.quote).toBe(words);
    expect(shared?.items[0]).not.toHaveProperty("source_answer_id");
    expect(shared?.items[0]).not.toHaveProperty("source_available");
    expect((await loadSharedKeptMemories(h.deps, owner, familyId))?.items).toEqual([]);
    expect((await loadOwnKeptMemoriesForExport(h.deps, recipient, familyId))?.items).toEqual([]);
    expect((await loadOwnKeptMemoriesForExport(h.deps, owner, familyId))?.items).toHaveLength(1);
  });

  it("replays an unchanged successful choice without duplicate grants, but consumes once across new keys", async () => {
    const { choice } = await prepare();
    const confirmationKey = key();
    expect(
      (await confirmMemorySharing(h.deps, owner, confirmationKey, familyId, choice)).replayed,
    ).toBe(false);
    expect(
      (await confirmMemorySharing(h.deps, owner, confirmationKey, familyId, choice)).replayed,
    ).toBe(true);
    await expect(
      confirmMemorySharing(h.deps, owner, key(), familyId, choice),
    ).rejects.toMatchObject({ code: "illegal_state" });
    expect(await h.db.select().from(memoryShares)).toHaveLength(1);
  });

  it("replaces the entire audience, invalidates other pending choices, and never adds later joiners", async () => {
    const later = await additionalRecipient();
    const old = await prepare();
    const next = await prepare([later.id]);
    await confirmMemorySharing(h.deps, owner, key(), familyId, old.choice);
    expect(
      await loadMemorySharingPresentation(h.deps, owner, familyId, next.preview.presentation_id),
    ).toBeNull();
    const latest = await prepare([later.id]);
    await confirmMemorySharing(h.deps, owner, key(), familyId, latest.choice);
    const joined = await additionalRecipient("Newcomer");
    const grants = await h.db.select().from(memoryShares);
    expect(grants.map((g) => g.recipientMemberId)).toEqual([later.id]);
    expect(
      grants.some((g) => g.recipientMemberId === recipientId || g.recipientMemberId === joined.id),
    ).toBe(false);
  });

  it("stops sharing with processing off and never revives a revoked choice or its successful receipt", async () => {
    const { choice } = await prepare();
    const confirmationKey = key();
    await confirmMemorySharing(h.deps, owner, confirmationKey, familyId, choice);
    h.config.richMemories = false;
    await stopSharingMemory(h.deps, owner, key(), familyId, memoryId);
    expect(await h.db.select().from(memoryShares)).toEqual([]);
    expect(await h.db.select().from(memorySharingPresentations)).toEqual([]);
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(1);
    expect((await loadSharedKeptMemories(h.deps, recipient, familyId))?.items).toEqual([]);
    h.config.richMemories = true;
    await expect(
      confirmMemorySharing(h.deps, owner, confirmationKey, familyId, choice),
    ).rejects.toMatchObject({ code: "illegal_state" });
    await expect(
      confirmMemorySharing(h.deps, owner, key(), familyId, choice),
    ).rejects.toMatchObject({ code: "illegal_state" });
    const fresh = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, fresh.choice);
    expect(await h.db.select().from(memoryShares)).toHaveLength(1);
  });

  it("treats a stop-sharing replay as an acknowledgement, not permission to cancel a later fresh choice", async () => {
    const stopKey = key();
    await stopSharingMemory(h.deps, owner, stopKey, familyId, memoryId);
    const fresh = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, fresh.choice);
    expect((await stopSharingMemory(h.deps, owner, stopKey, familyId, memoryId)).replayed).toBe(
      true,
    );
    expect(await h.db.select().from(memoryShares)).toHaveLength(1);
  });

  it("does not revive grants when the same member leaves and rejoins", async () => {
    const { choice } = await prepare();
    const confirmationKey = key();
    await confirmMemorySharing(h.deps, owner, confirmationKey, familyId, choice);
    const [before] = await h.db.select().from(members).where(eq(members.id, recipientId));
    await h.db.update(members).set({ leftAt: h.clock.now() }).where(eq(members.id, recipientId));
    await h.db
      .update(members)
      .set({ leftAt: null, status: "active" })
      .where(eq(members.id, recipientId));
    const [after] = await h.db.select().from(members).where(eq(members.id, recipientId));
    expect(after?.memoryMembershipRevision).not.toBe(before?.memoryMembershipRevision);
    expect(await h.db.select().from(memoryShares)).toEqual([]);
    await expect(
      confirmMemorySharing(h.deps, owner, confirmationKey, familyId, choice),
    ).rejects.toMatchObject({ code: "illegal_state" });
    expect((await loadSharedKeptMemories(h.deps, recipient, familyId))?.items).toEqual([]);
  });

  it.each([
    "recipient account",
    "recipient auth subject",
    "recipient deletion",
    "recipient hard delete",
    "recipient family",
  ])("invalidates on %s changes", async (change) => {
    const { choice } = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    if (change === "recipient account") {
      const [newUser] = await h.db.insert(users).values({ displayName: "Replacement" }).returning();
      if (!newUser) throw new Error("Missing replacement");
      await h.db.update(members).set({ userId: newUser.id }).where(eq(members.id, recipientId));
    } else if (change === "recipient auth subject") {
      await h.db
        .update(users)
        .set({ authSubject: "synthetic|replacement" })
        .where(eq(users.id, recipientUserId));
    } else if (change === "recipient deletion") {
      await h.db
        .update(users)
        .set({ deletedAt: h.clock.now() })
        .where(eq(users.id, recipientUserId));
    } else if (change === "recipient hard delete") {
      await h.db.delete(members).where(eq(members.id, recipientId));
    } else {
      const other = await seedFamily(h.db, {
        now: h.clock.now(),
        organiserExternalId: key(),
        memberExternalId: key(),
      });
      await h.db
        .update(members)
        .set({ familyId: other.family.id })
        .where(eq(members.id, recipientId));
    }
    expect(await h.db.select().from(memoryShares)).toEqual([]);
    expect(await h.db.select().from(memorySharingPresentations)).toEqual([]);
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(1);
  });

  it.each([
    "owner account",
    "withdrawal",
    "source correction",
    "health",
    "removal",
    "family erasure",
  ])("purges grants and pending choices on %s", async (change) => {
    const { choice } = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    await prepare();
    if (change === "owner account") {
      const [newUser] = await h.db.insert(users).values({ displayName: "Replacement" }).returning();
      if (!newUser) throw new Error("Missing replacement");
      await h.db.update(members).set({ userId: newUser.id }).where(eq(members.id, ownerId));
    } else if (change === "withdrawal")
      await withdrawOwnMemoryConsent(h.deps, owner, key(), familyId);
    else if (change === "source correction")
      await h.db
        .update(answers)
        .set({ payload: { text: "A different picnic." } })
        .where(eq(answers.id, answerId));
    else if (change === "health")
      await h.db
        .update(answers)
        .set({ mentions: { health: ["synthetic health words"] } })
        .where(eq(answers.id, answerId));
    else if (change === "family erasure")
      await h.db
        .update(families)
        .set({ deletedAt: h.clock.now() })
        .where(eq(families.id, familyId));
    else await removeKeptMemory(h.deps, owner, key(), familyId, memoryId);
    expect(await h.db.select().from(memoryShares)).toEqual([]);
    expect(await h.db.select().from(memorySharingPresentations)).toEqual([]);
  });

  it("invalidates a renamed recipient's pending confirmation without removing a current grant", async () => {
    const first = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, first.choice);
    const pending = await prepare();
    await h.db
      .update(members)
      .set({ displayName: "A new label" })
      .where(eq(members.id, recipientId));
    expect(
      await loadMemorySharingPresentation(h.deps, owner, familyId, pending.preview.presentation_id),
    ).toBeNull();
    expect(await h.db.select().from(memoryShares)).toHaveLength(1);
  });

  it("never accepts a stale/tampered confirmation and creates no grants on failure", async () => {
    const { choice } = await prepare();
    await expect(
      confirmMemorySharing(h.deps, owner, key(), familyId, {
        ...choice,
        presentation_sha256: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "illegal_state" });
    await expect(
      confirmMemorySharing(h.deps, recipient, key(), familyId, choice),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await loadMemorySharingPresentation(h.deps, recipient, familyId, choice.presentation_id),
    ).toBeNull();
    expect(await h.db.select().from(memoryShares)).toEqual([]);
  });

  it("expires at five minutes and retention removes records without deleting live grants", async () => {
    const { choice } = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    const pending = await prepare();
    h.clock.advance(5 * 60_000);
    expect(
      await loadMemorySharingPresentation(h.deps, owner, familyId, pending.preview.presentation_id),
    ).toBeNull();
    await expect(
      confirmMemorySharing(h.deps, owner, key(), familyId, pending.choice),
    ).rejects.toMatchObject({ code: "illegal_state" });
    const counts = await applyRetention(h.deps);
    expect(counts.memory_sharing_presentations_deleted).toBe(2);
    expect(await h.db.select().from(memorySharingPresentations)).toEqual([]);
    const [grant] = await h.db.select().from(memoryShares);
    expect(grant?.presentationId).toBeNull();
    expect((await loadSharedKeptMemories(h.deps, recipient, familyId))?.items).toHaveLength(1);
  });

  it("keeps chosen words and grants through ordinary 30-day source cleanup only", async () => {
    const { choice } = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    h.clock.advance(31 * 86_400_000);
    await applyRetention(h.deps);
    expect(await h.db.select().from(memoryShares)).toHaveLength(1);
    expect((await loadKeptMemories(h.deps, owner, familyId))?.items[0]?.quote).toBe(words);
    expect((await loadKeptMemories(h.deps, recipient, familyId))?.items).toEqual([]);
    expect((await loadSharedKeptMemories(h.deps, recipient, familyId))?.items[0]?.quote).toBe(
      words,
    );
  });

  it("denies wildcard, duplicate, self, ambiguous, unbound or cross-family recipients", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: key(),
      memberExternalId: key(),
    });
    const ambiguous = await additionalRecipient("Mia");
    for (const ids of [
      [],
      [recipientId, recipientId],
      [ownerId],
      [other.organiser.id],
      [recipientId, ambiguous.id],
      ["not-a-uuid"],
    ]) {
      await expect(
        createMemorySharingPresentation(h.deps, owner, key(), familyId, {
          memory_id: memoryId,
          recipient_ids: ids,
        }),
      ).rejects.toBeDefined();
    }
    await expect(
      createMemorySharingPresentation(h.deps, recipient, key(), familyId, {
        memory_id: memoryId,
        recipient_ids: [ownerId],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await h.db.select().from(memoryShares)).toEqual([]);
    expect(await h.db.select().from(memorySharingPresentations)).toEqual([]);
  });

  it("stores two named permissions and removes only a departing recipient's permission", async () => {
    const second = await additionalRecipient();
    const { choice } = await prepare([recipientId, second.id]);
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    expect(await h.db.select().from(memoryShares)).toHaveLength(2);
    await h.db.update(members).set({ leftAt: h.clock.now() }).where(eq(members.id, recipientId));
    const grants = await h.db.select().from(memoryShares);
    expect(grants.map((grant) => grant.recipientMemberId)).toEqual([second.id]);
    expect(grants[0]?.presentationId).toBeNull();
  });

  it("never creates or confirms new sharing while processing is off", async () => {
    const { choice } = await prepare();
    h.config.richMemories = false;
    await expect(
      createMemorySharingPresentation(h.deps, owner, key(), familyId, {
        memory_id: memoryId,
        recipient_ids: [recipientId],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      confirmMemorySharing(h.deps, owner, key(), familyId, choice),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await loadMemorySharingPresentation(h.deps, owner, familyId, choice.presentation_id),
    ).not.toBeNull();
    expect(await h.db.select().from(memoryShares)).toEqual([]);
  });

  it.each(["recipient generation", "sharing generation", "old version", "future grant"])(
    "rejects a stale %s at read time even while the permission row exists",
    async (field) => {
      const { choice } = await prepare();
      await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
      const change =
        field === "recipient generation"
          ? { recipientMembershipRevision: crypto.randomUUID() }
          : field === "sharing generation"
            ? { sharingRevision: crypto.randomUUID() }
            : field === "old version"
              ? { confirmationVersion: "memory.share@0" }
              : { grantedAt: new Date(h.clock.now().getTime() + 1) };
      await h.db.update(memoryShares).set(change);
      expect(await h.db.select().from(memoryShares)).toHaveLength(1);
      expect((await loadSharedKeptMemories(h.deps, recipient, familyId))?.items).toEqual([]);
    },
  );

  it("never grants historical words to a later joiner or promoted organiser", async () => {
    const { choice } = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    const newcomer = await additionalRecipient("New reader");
    const [account] = await h.db
      .select()
      .from(users)
      .where(eq(users.id, newcomer.userId ?? ""));
    if (!account?.authSubject) throw new Error("Missing synthetic account");
    const actor = { authSubject: account.authSubject, sessionId: "newcomer" };
    expect((await loadSharedKeptMemories(h.deps, actor, familyId))?.items).toEqual([]);
    await h.db.update(members).set({ role: "organiser" }).where(eq(members.id, newcomer.id));
    expect((await loadSharedKeptMemories(h.deps, actor, familyId))?.items).toEqual([]);
    expect(await loadSharedKeptMemories(h.deps, actor, crypto.randomUUID())).toBeNull();
    expect(await loadSharedKeptMemories(h.deps, actor, familyId, "invalid")).toBeNull();
  });

  it("keeps shared reads available when processing stops without widening private copies", async () => {
    const { choice } = await prepare();
    await confirmMemorySharing(h.deps, owner, key(), familyId, choice);
    h.config.richMemories = false;
    expect((await loadSharedKeptMemories(h.deps, recipient, familyId))?.items).toHaveLength(1);
    expect((await loadOwnKeptMemoriesForExport(h.deps, recipient, familyId))?.items).toEqual([]);
  });

  it("filters named permissions before 50-row pagination", async () => {
    const [originalAnswer] = await h.db.select().from(answers).where(eq(answers.id, answerId));
    if (!originalAnswer) throw new Error("Missing synthetic original");
    for (let i = 0; i < 51; i++) {
      const [answer] = await h.db
        .insert(answers)
        .values({
          exchangeId: originalAnswer.exchangeId,
          memberId: ownerId,
          kind: "text",
          channel: "telegram",
          payload: { text: words },
          receivedAt: h.clock.now(),
        })
        .returning();
      if (!answer) throw new Error("Missing synthetic answer");
      const candidate = await proposeMemoryCandidate(
        h.deps,
        { source_answer_id: answer.id, kind: "preference", start: 0, end: words.length },
        { answerId: answer.id, ordinaryText: words },
      );
      if (!candidate) throw new Error("Missing synthetic candidate");
      const kept = await keepMemoryCandidate(h.deps, owner, key(), familyId, {
        candidate_id: candidate,
        confirmation_version: MEMORY_KEEP_VERSION,
        confirmation_sha256: await sha256Hex(MEMORY_KEEP_EXPLANATION_EN),
      });
      const body = kept.response.body;
      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.id !== "string"
      )
        throw new Error("Missing synthetic keep");
      const created = await createMemorySharingPresentation(h.deps, owner, key(), familyId, {
        memory_id: body.id,
        recipient_ids: [recipientId],
      });
      const presented = created.response.body;
      if (
        presented === null ||
        typeof presented !== "object" ||
        Array.isArray(presented) ||
        typeof presented.id !== "string"
      )
        throw new Error("Missing synthetic presentation");
      const preview = await loadMemorySharingPresentation(h.deps, owner, familyId, presented.id);
      if (!preview) throw new Error("Missing synthetic preview");
      await confirmMemorySharing(h.deps, owner, key(), familyId, {
        presentation_id: preview.presentation_id,
        presentation_sha256: preview.presentation_sha256,
        confirmation_version: MEMORY_SHARE_VERSION,
      });
    }
    const first = await loadSharedKeptMemories(h.deps, recipient, familyId);
    expect(first?.items).toHaveLength(50);
    expect(first?.next_cursor).not.toBeNull();
    const second = await loadSharedKeptMemories(
      h.deps,
      recipient,
      familyId,
      first?.next_cursor ?? null,
    );
    expect(second?.items).toHaveLength(1);
    expect(second?.next_cursor).toBeNull();
    const ids = [...(first?.items ?? []), ...(second?.items ?? [])].map((item) => item.id);
    expect(new Set(ids).size).toBe(51);
    expect(ids).not.toContain(memoryId);
  }, 20_000);
});
