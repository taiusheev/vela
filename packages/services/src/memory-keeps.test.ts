import { KeptMemoryPage, MEMORY_KEEP_EXPLANATION_EN, MEMORY_KEEP_VERSION } from "@vela/contracts";
import {
  answers,
  apiRequestReceipts,
  consents,
  exchanges,
  families,
  members,
  memoryCandidates,
  memoryKeeps,
  users,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.ts";
import { applyRetention } from "./jobs.ts";
import { withdrawOwnMemoryConsent } from "./memory-consent.ts";
import {
  keepMemoryCandidate,
  loadKeptMemories,
  loadOwnKeptMemoriesForExport,
  removeKeptMemory,
} from "./memory-keeps.ts";
import {
  loadMemoryCandidates,
  proposeMemoryCandidate,
  RICH_MEMORY_CONSENT_VERSION,
} from "./rich-memories.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let familyId: string;
let memberId: string;
let answerId: string;
let consentId: string;
let candidateId: string;
const owner = { authSubject: "synthetic|kept-owner", sessionId: "owner" };
const organiser = { authSubject: "synthetic|kept-organiser", sessionId: "organiser" };
const stranger = { authSubject: "synthetic|kept-stranger", sessionId: "stranger" };
const words = "I love yellow flowers. The cat stole my chair!";
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
  const [consent] = await h.db
    .insert(consents)
    .values({
      memberId,
      subjectRef: `member:${memberId}`,
      kind: "rich_memories",
      answer: "yes",
      textVersion: RICH_MEMORY_CONSENT_VERSION,
      lang: "en",
      channel: "app",
      givenAt: new Date(h.clock.now().getTime() - 1000),
    })
    .returning();
  const exchange = await seedExchange(h.db, family, { date: "2026-09-14" });
  const [answer] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId,
      kind: "text",
      channel: "telegram",
      payload: { text: words },
      receivedAt: h.clock.now(),
    })
    .returning();
  if (!consent || !answer) throw new Error("Missing synthetic source");
  consentId = consent.id;
  answerId = answer.id;
  const candidate = await proposeMemoryCandidate(
    h.deps,
    { source_answer_id: answerId, kind: "preference", start: 0, end: 22 },
    { answerId, ordinaryText: words },
  );
  if (!candidate) throw new Error("Missing synthetic candidate");
  candidateId = candidate;
});
async function choice() {
  return {
    candidate_id: candidateId,
    confirmation_version: MEMORY_KEEP_VERSION,
    confirmation_sha256: await sha256Hex(MEMORY_KEEP_EXPLANATION_EN),
  };
}
async function keep(key = "synthetic:keep:operation", who = owner) {
  return keepMemoryCandidate(h.deps, who, key, familyId, await choice());
}
const read = (who = owner) => loadKeptMemories(h.deps, who, familyId);
const copy = (who = owner, cursor: string | null = null) =>
  loadOwnKeptMemoriesForExport(h.deps, who, familyId, cursor);
async function keptId() {
  await keep();
  const [row] = await h.db.select().from(memoryKeeps);
  if (!row) throw new Error("Missing keep");
  return row.id;
}

describe("explicit durable conversational memories", () => {
  it("does not share historical keeps with later members or organisers without an audience grant", async () => {
    await keep();
    h.clock.advance(1000);
    const identity = { authSubject: "synthetic|later-kept-reader", sessionId: "later" };
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Synthetic later reader" })
      .returning();
    if (!user) throw new Error("Missing synthetic account");
    const [joined] = await h.db
      .insert(members)
      .values({
        familyId,
        userId: user.id,
        role: "member",
        status: "active",
        displayName: "Synthetic later reader",
        language: "en",
        tz: "Asia/Taipei",
        country: "TW",
        primarySurface: "telegram",
        createdAt: h.clock.now(),
      })
      .returning();
    if (!joined) throw new Error("Missing synthetic membership");
    expect(await read(identity)).toEqual({ items: [], next_cursor: null });
    expect(await copy(identity)).toEqual({ items: [], next_cursor: null });
    await h.db.update(members).set({ role: "organiser" }).where(eq(members.id, joined.id));
    expect(await read(identity)).toEqual({ items: [], next_cursor: null });
    expect((await read())?.items).toHaveLength(1);
  });
  it("withdraws purpose and keep proofs and deletes candidates/copies with processing off, not original messages", async () => {
    await keep();
    h.config.richMemories = false;
    const unrelated = (await h.db.select().from(consents)).filter(
      (row) => row.kind !== "rich_memories" && row.kind !== "memory_keep",
    );
    const result = await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw", familyId);
    expect(result.response.body).toEqual({ withdrawn: true });
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(0);
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(0);
    const proofs = await h.db.select().from(consents);
    expect(
      proofs.filter((row) => row.kind === "rich_memories" || row.kind === "memory_keep"),
    ).toSatisfy((rows: typeof proofs) => rows.every((row) => row.withdrawnAt !== null));
    expect(
      proofs.filter((row) => row.kind !== "rich_memories" && row.kind !== "memory_keep"),
    ).toEqual(unrelated);
    expect((await h.db.select().from(answers))[0]?.payload.text).toBe(words);
    expect(JSON.stringify(await h.db.select().from(apiRequestReceipts))).not.toContain("yellow");
    expect((await read())?.items).toEqual([]);
    expect((await copy())?.items).toEqual([]);
  });
  it("derives withdrawal's author from the session, never the organiser's family role", async () => {
    await keep();
    const before = await h.db.select().from(consents);
    await withdrawOwnMemoryConsent(h.deps, organiser, "synthetic:withdraw:organiser", familyId);
    expect(await h.db.select().from(consents)).toEqual(before);
    expect((await read())?.items).toHaveLength(1);
  });
  it("withdraws pending processing without first keeping and prevents old selections from returning", async () => {
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:pending", familyId);
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(0);
    expect(
      await proposeMemoryCandidate(
        h.deps,
        { source_answer_id: answerId, kind: "preference", start: 0, end: 22 },
        { answerId, ordinaryText: words },
      ),
    ).toBeNull();
    await expect(keep()).rejects.toMatchObject({ code: "not_found" });
  });
  it("makes repeated withdrawal safe without inventing acceptance or replacing an earlier withdrawal date", async () => {
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:once", familyId);
    const before = await h.db.select().from(consents);
    h.clock.advance(1000);
    expect(
      (await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:once", familyId)).replayed,
    ).toBe(true);
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:again", familyId);
    expect(await h.db.select().from(consents)).toEqual(before);
  });
  it("does not apply an old retry to a later synthetic consent; a new withdrawal does", async () => {
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:old", familyId);
    h.clock.advance(1000);
    const [laterProof] = await h.db
      .insert(consents)
      .values({
        memberId,
        subjectRef: `member:${memberId}`,
        kind: "rich_memories",
        answer: "yes",
        textVersion: RICH_MEMORY_CONSENT_VERSION,
        lang: "en",
        channel: "app",
        givenAt: h.clock.now(),
      })
      .returning();
    if (!laterProof) throw new Error("Missing synthetic proof");
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:old", familyId);
    expect(
      (await h.db.select().from(consents).where(eq(consents.id, laterProof.id)))[0]?.withdrawnAt,
    ).toBeNull();
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:new", familyId);
    expect(
      (await h.db.select().from(consents).where(eq(consents.id, laterProof.id)))[0]?.withdrawnAt,
    ).not.toBeNull();
  });
  it("rejects foreign sessions/families and reauthorises withdrawal receipts after leaving", async () => {
    await expect(
      withdrawOwnMemoryConsent(h.deps, stranger, "synthetic:withdraw:unknown", familyId),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:bad", "not-a-family"),
    ).rejects.toMatchObject({ code: "invalid" });
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "50001",
      memberExternalId: "50002",
    });
    await expect(
      withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:foreign", other.family.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:leave", familyId);
    await h.db.update(members).set({ leftAt: h.clock.now() }).where(eq(members.id, memberId));
    await expect(
      withdrawOwnMemoryConsent(h.deps, owner, "synthetic:withdraw:leave", familyId),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("keeps only the exact selected quote, sealed, with a content-free confirmation proof and receipt", async () => {
    await keep();
    const page = await read();
    expect(KeptMemoryPage.safeParse(page).success).toBe(true);
    expect(page?.items).toMatchObject([
      { quote: "I love yellow flowers.", source_available: true },
    ]);
    const [kept] = await h.db.select().from(memoryKeeps);
    expect(kept?.quote).not.toContain("cat");
    const raw = await h.db.execute<{ quote: string }>(sql`select quote from memory_keeps`);
    expect(raw.rows[0]?.quote).not.toContain("yellow");
    const [proof] = await h.db.select().from(consents).where(eq(consents.kind, "memory_keep"));
    expect(proof).toMatchObject({ memberId, answer: "yes", textVersion: MEMORY_KEEP_VERSION });
    expect(JSON.stringify(proof?.evidence)).not.toContain("yellow");
    const receipts = await h.db.select().from(apiRequestReceipts);
    expect(JSON.stringify(receipts)).not.toContain("yellow");
    expect((await loadMemoryCandidates(h.deps, organiser, familyId))?.items).toEqual([]);
  });
  it("requires the switch and the exact versioned confirmation", async () => {
    h.config.richMemories = false;
    await expect(keep()).rejects.toMatchObject({ code: "not_found" });
    h.config.richMemories = true;
    await expect(
      keepMemoryCandidate(h.deps, owner, "synthetic:bad:version", familyId, {
        ...(await choice()),
        confirmation_version: "memory.keep@1",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      keepMemoryCandidate(h.deps, owner, "synthetic:bad:hash", familyId, {
        ...(await choice()),
        confirmation_sha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "illegal_state" });
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(0);
  });
  it("rejects another family or an organiser deciding for the author", async () => {
    await expect(keep("synthetic:other:owner", organiser)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(keep("synthetic:other:stranger", stranger)).rejects.toMatchObject({
      code: "not_found",
    });
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "20001",
      memberExternalId: "20002",
    });
    await expect(
      keepMemoryCandidate(h.deps, owner, "synthetic:wrong:family", other.family.id, await choice()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await read(stranger)).toBeNull();
  });
  it("replays safely and deduplicates different request keys without duplicate proofs", async () => {
    const first = await keep();
    expect((await keep()).replayed).toBe(true);
    expect((await keep("synthetic:keep:second")).response).toEqual(first.response);
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(1);
    expect(await h.db.select().from(consents).where(eq(consents.kind, "memory_keep"))).toHaveLength(
      1,
    );
  });
  it("retains the quote but clears all original words at 30 days", async () => {
    await keep();
    h.clock.advance(31 * 86_400_000);
    await applyRetention(h.deps);
    const [answer] = await h.db.select().from(answers).where(eq(answers.id, answerId));
    expect(answer?.payload).not.toHaveProperty("text");
    expect(answer?.wordsExpiredAt).not.toBeNull();
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(0);
    expect((await read())?.items).toMatchObject([
      { quote: "I love yellow flowers.", source_available: false },
    ]);
    expect(JSON.stringify(await read())).not.toContain("cat");
    await applyRetention(h.deps);
    expect((await read())?.items).toHaveLength(1);
  });
  it("keeps reading/removal available with processing off and makes removal retries content-free", async () => {
    const id = await keptId();
    h.config.richMemories = false;
    expect((await read())?.items).toHaveLength(1);
    await expect(
      removeKeptMemory(h.deps, organiser, "synthetic:remove:other", familyId, id),
    ).rejects.toMatchObject({ code: "not_found" });
    const result = await removeKeptMemory(h.deps, owner, "synthetic:remove:once", familyId, id);
    expect(
      (await removeKeptMemory(h.deps, owner, "synthetic:remove:once", familyId, id)).response,
    ).toEqual(result.response);
    expect((await read())?.items).toHaveLength(0);
    expect((await h.db.select().from(memoryKeeps))[0]).toMatchObject({
      quote: "",
      sourceDigest: "",
    });
    expect(
      (await h.db.select().from(consents).where(eq(consents.kind, "memory_keep")))[0]?.withdrawnAt,
    ).not.toBeNull();
    h.config.richMemories = true;
    await expect(keep("synthetic:keep:after:remove")).rejects.toMatchObject({
      code: "illegal_state",
    });
    h.clock.advance(31 * 86_400_000);
    await applyRetention(h.deps);
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(0);
  });
  it.each([
    "correction",
    "erase",
    "health",
    "flag",
    "withdraw",
    "withdraw-keep",
    "new-consent",
    "leave",
    "family-delete",
    "source-delete",
    "exchange-delete",
    "exchange-transfer",
  ] as const)(
    "physically removes saved words when %s occurs, without waiting for a read",
    async (change) => {
      await keep();
      if (change === "correction")
        await h.db
          .update(answers)
          .set({ payload: { text: "Changed words." } })
          .where(eq(answers.id, answerId));
      if (change === "erase") {
        h.clock.advance(31 * 86_400_000);
        await h.db.update(answers).set({ payload: {} }).where(eq(answers.id, answerId));
      }
      if (change === "health")
        await h.db
          .update(answers)
          .set({ mentions: { health: ["Synthetic health words"] } })
          .where(eq(answers.id, answerId));
      if (change === "flag")
        await h.db.update(answers).set({ flag: true }).where(eq(answers.id, answerId));
      if (change === "withdraw")
        await h.db
          .update(consents)
          .set({ withdrawnAt: h.clock.now() })
          .where(eq(consents.id, consentId));
      if (change === "new-consent")
        await h.db.insert(consents).values({
          memberId,
          subjectRef: `member:${memberId}`,
          kind: "rich_memories",
          answer: "no",
          textVersion: RICH_MEMORY_CONSENT_VERSION,
          lang: "en",
          channel: "app",
          givenAt: h.clock.now(),
        });
      if (change === "leave")
        await h.db
          .update(members)
          .set({ leftAt: h.clock.now(), status: "left" })
          .where(eq(members.id, memberId));
      if (change === "family-delete")
        await h.db
          .update(families)
          .set({ deletedAt: h.clock.now() })
          .where(eq(families.id, familyId));
      if (change === "source-delete") await h.db.delete(answers).where(eq(answers.id, answerId));
      if (change === "withdraw-keep")
        await h.db
          .update(consents)
          .set({ withdrawnAt: h.clock.now() })
          .where(eq(consents.kind, "memory_keep"));
      if (change === "exchange-delete" || change === "exchange-transfer") {
        const [answer] = await h.db.select().from(answers).where(eq(answers.id, answerId));
        if (!answer) throw new Error("Missing source");
        if (change === "exchange-delete")
          await h.db.delete(exchanges).where(eq(exchanges.id, answer.exchangeId));
        else {
          const other = await seedFamily(h.db, {
            now: h.clock.now(),
            organiserExternalId: "30001",
            memberExternalId: "30002",
          });
          await h.db
            .update(exchanges)
            .set({ familyId: other.family.id })
            .where(eq(exchanges.id, answer.exchangeId));
        }
      }
      expect(await h.db.select().from(memoryKeeps)).toHaveLength(0);
      expect((await read())?.items ?? []).toEqual([]);
    },
  );
  it("closes orphaned keep proofs under the existing consent retention rule", async () => {
    await keep();
    await h.db.delete(answers).where(eq(answers.id, answerId));
    await applyRetention(h.deps);
    const [proof] = await h.db.select().from(consents).where(eq(consents.kind, "memory_keep"));
    expect(proof?.withdrawnAt).not.toBeNull();
    expect(JSON.stringify(proof)).not.toContain("yellow");
  });
  it("never revives a saved quote after withdrawing and then restoring consent", async () => {
    await keep();
    await h.db
      .update(consents)
      .set({ withdrawnAt: h.clock.now() })
      .where(eq(consents.id, consentId));
    await h.db.update(consents).set({ withdrawnAt: null }).where(eq(consents.id, consentId));
    expect((await read())?.items).toEqual([]);
    await expect(keep()).rejects.toMatchObject({ code: "illegal_state" });
    expect((await loadMemoryCandidates(h.deps, organiser, familyId))?.items).toEqual([]);
  });
  it("rejects old save receipts when corrected source words later return", async () => {
    await keep();
    await h.db
      .update(answers)
      .set({ payload: { text: "Corrected words." } })
      .where(eq(answers.id, answerId));
    await h.db
      .update(answers)
      .set({ payload: { text: words } })
      .where(eq(answers.id, answerId));
    await expect(keep()).rejects.toMatchObject({ code: "illegal_state" });
    await expect(keep("synthetic:new:key:old:words")).rejects.toMatchObject({
      code: "illegal_state",
    });
    expect((await loadMemoryCandidates(h.deps, organiser, familyId))?.items).toEqual([]);
  });
  it("preserves chosen words when retention clears only non-health analysis", async () => {
    await h.db
      .update(answers)
      .set({ mentions: { people: ["Synthetic friend"] } })
      .where(eq(answers.id, answerId));
    await keep();
    await h.db.update(answers).set({ mentions: {} }).where(eq(answers.id, answerId));
    expect((await read())?.items).toHaveLength(1);
  });
  it("still removes a retained quote when its source is deleted after ordinary expiry", async () => {
    await keep();
    h.clock.advance(31 * 86_400_000);
    await applyRetention(h.deps);
    expect((await read())?.items).toHaveLength(1);
    await h.db.delete(answers).where(eq(answers.id, answerId));
    expect(await h.db.select().from(memoryKeeps)).toHaveLength(0);
  });
  it("keeps both collection reads and personal copies private to the author", async () => {
    await keep();
    expect(await read(organiser)).toEqual({ items: [], next_cursor: null });
    expect(await copy(organiser)).toEqual({ items: [], next_cursor: null });
    const page = await copy();
    expect(KeptMemoryPage.safeParse(page).success).toBe(true);
    expect(page?.items).toMatchObject([{ member_id: memberId, quote: "I love yellow flowers." }]);
    expect(JSON.stringify(page)).not.toContain("cat");
    expect(JSON.stringify(page)).not.toContain("confirmation_sha256");
  });
  it("allows a free copy with processing off and after ordinary conversation expiry", async () => {
    await keep();
    h.config.richMemories = false;
    h.clock.advance(31 * 86_400_000);
    await applyRetention(h.deps);
    expect((await copy())?.items).toMatchObject([
      { quote: "I love yellow flowers.", source_available: false },
    ]);
    expect(JSON.stringify(await copy())).not.toContain("cat");
  });
  it("rejects unknown sessions, foreign families and malformed copy cursors", async () => {
    await keep();
    expect(await copy(stranger)).toBeNull();
    expect(await copy(owner, "not-a-cursor")).toBeNull();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "40001",
      memberExternalId: "40002",
    });
    expect(await loadOwnKeptMemoriesForExport(h.deps, owner, other.family.id)).toBeNull();
  });
  it.each(["withdraw", "remove", "source-change", "leave", "session-change"] as const)(
    "rechecks a data copy after %s rather than replaying saved words",
    async (change) => {
      const id = await keptId();
      expect((await copy())?.items).toHaveLength(1);
      if (change === "withdraw")
        await h.db
          .update(consents)
          .set({ withdrawnAt: h.clock.now() })
          .where(eq(consents.id, consentId));
      if (change === "remove")
        await removeKeptMemory(h.deps, owner, "synthetic:copy:remove", familyId, id);
      if (change === "source-change")
        await h.db
          .update(answers)
          .set({ payload: { text: "Changed synthetic words." } })
          .where(eq(answers.id, answerId));
      if (change === "leave")
        await h.db.update(members).set({ leftAt: h.clock.now() }).where(eq(members.id, memberId));
      if (change === "session-change")
        await h.db
          .update(users)
          .set({ authSubject: "synthetic|replacement" })
          .where(eq(users.authSubject, owner.authSubject));
      expect((await copy())?.items ?? []).toEqual([]);
      expect((await copy(owner, id))?.items ?? []).toEqual([]);
    },
  );
  it.each(["collection", "own-copy"] as const)(
    "reads a larger %s in bounded cursor pages without gaps or duplicates",
    async (mode) => {
      await keep();
      const [original] = await h.db.select().from(answers).where(eq(answers.id, answerId));
      if (!original) throw new Error("Missing synthetic answer");
      for (let index = 1; index <= 50; index++) {
        const [answer] = await h.db
          .insert(answers)
          .values({
            exchangeId: original.exchangeId,
            memberId,
            kind: "text",
            channel: "telegram",
            payload: { text: words },
            receivedAt: h.clock.now(),
          })
          .returning();
        if (!answer) throw new Error("Missing synthetic answer");
        const candidate = await proposeMemoryCandidate(
          h.deps,
          { source_answer_id: answer.id, kind: "preference", start: 0, end: 22 },
          { answerId: answer.id, ordinaryText: words },
        );
        if (!candidate) throw new Error("Missing synthetic candidate");
        await keepMemoryCandidate(h.deps, owner, `synthetic:page:keep:${index}`, familyId, {
          ...(await choice()),
          candidate_id: candidate,
        });
      }
      const page = (cursor: string | null = null) =>
        mode === "collection"
          ? loadKeptMemories(h.deps, owner, familyId, cursor)
          : copy(owner, cursor);
      const first = await page();
      expect(await read(organiser)).toEqual({ items: [], next_cursor: null });
      // Another reader's 51 quotes must not fill this author's page or expose a cursor.
      if (mode === "own-copy")
        expect(await copy(organiser)).toEqual({ items: [], next_cursor: null });
      expect(first?.items).toHaveLength(50);
      expect(first?.next_cursor).toBeTruthy();
      const second = await page(first?.next_cursor);
      expect(second?.items).toHaveLength(1);
      expect(second?.next_cursor).toBeNull();
      expect(
        new Set([...(first?.items ?? []), ...(second?.items ?? [])].map((item) => item.id)).size,
      ).toBe(51);
    },
  );
});
