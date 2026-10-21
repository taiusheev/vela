import { MemoryCandidatePage } from "@vela/contracts";
import { answers, consents, families, members, memoryCandidates, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyRetention } from "./jobs.ts";
import {
  dismissMemoryCandidate,
  loadMemoryCandidates,
  MAX_MEMORY_CANDIDATES_PER_SOURCE,
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
const owner = { authSubject: "synthetic|memory-owner", sessionId: "owner-session" };
const organiser = { authSubject: "synthetic|memory-organiser", sessionId: "organiser-session" };
const stranger = { authSubject: "synthetic|stranger", sessionId: "stranger-session" };
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
  for (const [identity, person] of [
    [owner, memberId],
    [organiser, family.organiser.id],
  ] as const) {
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
      .returning();
    if (user === undefined) throw new Error("Missing account");
    await h.db.update(members).set({ userId: user.id }).where(eq(members.id, person));
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
  if (consent === undefined) throw new Error("Missing consent");
  consentId = consent.id;
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
  if (answer === undefined) throw new Error("Missing answer");
  answerId = answer.id;
});

function propose() {
  return proposeMemoryCandidate(
    h.deps,
    { source_answer_id: answerId, kind: "preference", start: 0, end: 22 },
    { answerId, ordinaryText: words },
  );
}
function read(who = owner, cursor: string | null = null) {
  return loadMemoryCandidates(h.deps, who, familyId, cursor);
}

describe("persistent conversational candidates", () => {
  it("proposes once and lets only the author review the exact live source without another quote copy", async () => {
    const id = await propose();
    expect(id).not.toBeNull();
    expect(await propose()).toBe(id);
    const page = MemoryCandidatePage.parse(await read());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.quote).toBe("I love yellow flowers.");
    expect(page.items[0]?.expires_at).toBe("2026-10-14T00:00:00.000Z");
    expect(await read(organiser)).toEqual({ items: [], next_cursor: null });
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(1);
    expect(h.ai.calls).toHaveLength(0);
  });

  it("refuses absent/disabled configuration without creating data", async () => {
    h.config.richMemories = false;
    expect(await propose()).toBeNull();
    expect(await read()).toBeNull();
    delete h.config.richMemories;
    expect(await propose()).toBeNull();
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(0);
  });

  it("never gives a later family member historical suggestions, even after promotion", async () => {
    await propose();
    h.clock.advance(1000);
    const identity = { authSubject: "synthetic|later-candidate-reader", sessionId: "later" };
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
    await h.db.update(members).set({ role: "organiser" }).where(eq(members.id, joined.id));
    expect(await read(identity)).toEqual({ items: [], next_cursor: null });
    expect((await read())?.items).toHaveLength(1);
  });

  it("does not treat the former family-wide purpose version as private-review permission", async () => {
    await propose();
    await h.db
      .update(consents)
      .set({ textVersion: "consent.rich_memories@1" })
      .where(eq(consents.id, consentId));
    expect((await read())?.items).toEqual([]);
    expect(await propose()).toBeNull();
  });

  it("does not expose a family to a stranger, malformed family or malformed cursor", async () => {
    await propose();
    expect(await read(stranger)).toBeNull();
    expect(await read(organiser, "invalid")).toBeNull();
    expect(await loadMemoryCandidates(h.deps, organiser, "invalid")).toBeNull();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "memory-other-organiser",
      memberExternalId: "memory-other-member",
    });
    expect(await loadMemoryCandidates(h.deps, organiser, other.family.id)).toBeNull();
  });

  it("requires exact trusted review and refuses health/flagged sources", async () => {
    expect(
      await proposeMemoryCandidate(
        h.deps,
        { source_answer_id: answerId, kind: "story", start: 0, end: 22 },
        { answerId, ordinaryText: "invented words" },
      ),
    ).toBeNull();
    await h.db
      .update(answers)
      .set({ mentions: { health: ["synthetic mention"] } })
      .where(eq(answers.id, answerId));
    expect(await propose()).toBeNull();
    await h.db.update(answers).set({ mentions: {}, flag: true }).where(eq(answers.id, answerId));
    expect(await propose()).toBeNull();
  });

  it("hides sources when health screening changes after proposal", async () => {
    await propose();
    await h.db.update(answers).set({ flag: true }).where(eq(answers.id, answerId));
    expect((await read())?.items).toEqual([]);
  });

  it("rejects a source correction and never presents an old quote as current", async () => {
    await propose();
    await h.db
      .update(answers)
      .set({ payload: { text: "I prefer red flowers." } })
      .where(eq(answers.id, answerId));
    expect((await read())?.items).toEqual([]);
    expect(await propose()).toBeNull();
  });

  it.each(["withdrawn", "wrong-version", "pre-consent", "declined"] as const)(
    "requires current purpose consent: %s",
    async (mode) => {
      await propose();
      if (mode === "withdrawn")
        await h.db
          .update(consents)
          .set({ withdrawnAt: h.clock.now() })
          .where(eq(consents.id, consentId));
      if (mode === "wrong-version")
        await h.db
          .update(consents)
          .set({ textVersion: "consent.health_words@2" })
          .where(eq(consents.id, consentId));
      if (mode === "pre-consent")
        await h.db
          .update(consents)
          .set({ givenAt: new Date(h.clock.now().getTime() + 1) })
          .where(eq(consents.id, consentId));
      if (mode === "declined")
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
      expect(await propose()).toBeNull();
      expect((await read())?.items).toEqual([]);
    },
  );

  it("lets only the author dismiss, rechecks permission on replay, and prevents rediscovery", async () => {
    const id = await propose();
    if (id === null) throw new Error("Missing candidate");
    await expect(
      dismissMemoryCandidate(h.deps, organiser, "dismiss", familyId, id),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await dismissMemoryCandidate(h.deps, owner, "dismiss", familyId, id)).replayed).toBe(
      false,
    );
    expect((await dismissMemoryCandidate(h.deps, owner, "dismiss", familyId, id)).replayed).toBe(
      true,
    );
    expect(await propose()).toBeNull();
    expect((await read())?.items).toEqual([]);
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, memberId));
    await expect(
      dismissMemoryCandidate(h.deps, owner, "dismiss", familyId, id),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps author removal available when the feature is switched off", async () => {
    const id = await propose();
    if (id === null) throw new Error("Missing candidate");
    h.config.richMemories = false;
    await expect(
      dismissMemoryCandidate(h.deps, organiser, "off-dismiss", familyId, id),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await dismissMemoryCandidate(h.deps, owner, "off-dismiss", familyId, id)).response.status,
    ).toBe(200);
    h.config.richMemories = true;
    expect((await read())?.items).toEqual([]);
  });

  it("hides a departed subject and a deleted family", async () => {
    await propose();
    await h.db.update(members).set({ leftAt: h.clock.now() }).where(eq(members.id, memberId));
    expect(await read()).toBeNull();
    expect(await read(organiser)).toEqual({ items: [], next_cursor: null });
    await h.db.update(families).set({ deletedAt: h.clock.now() }).where(eq(families.id, familyId));
    expect(await read()).toBeNull();
  });

  it("cascades source deletion, and expiry hides candidates before the nightly sweep", async () => {
    await propose();
    await h.db.delete(answers).where(eq(answers.id, answerId));
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(0);
    expect((await read())?.items).toEqual([]);
  });

  it("expires and physically removes pending selections and dismissals with source retention", async () => {
    await propose();
    h.clock.advance(30 * 86_400_000);
    expect((await read())?.items).toEqual([]);
    expect(await propose()).toBeNull();
    await applyRetention(h.deps);
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(0);
  });

  it("bounds scans and advances past stale rows instead of looping or reading the whole family", async () => {
    await propose();
    const [row] = await h.db.select().from(memoryCandidates);
    if (row === undefined) throw new Error("Missing candidate");
    const { id: _id, ...base } = row;
    await h.db.insert(memoryCandidates).values(
      Array.from({ length: 51 }, (_, i) => ({
        ...base,
        start: i + 1,
        end: i + 2,
      })),
    );
    await h.db
      .update(answers)
      .set({ payload: { text: "Corrected source" } })
      .where(eq(answers.id, answerId));
    const first = await read();
    expect(first?.items).toEqual([]);
    expect(await read(organiser)).toEqual({ items: [], next_cursor: null });
    expect(first?.next_cursor).not.toBeNull();
    const second = await read(owner, first?.next_cursor ?? null);
    expect(second?.items).toEqual([]);
    expect(second?.next_cursor).toBeNull();
  });

  it("caps proposals per source, including dismissed spans, while allowing an existing retry", async () => {
    const first = await propose();
    for (let i = 1; i < MAX_MEMORY_CANDIDATES_PER_SOURCE; i++) {
      // The initial sentence contains no blank at these positions except ones explicitly skipped.
      const start = [0, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12][i - 1] ?? i;
      expect(
        await proposeMemoryCandidate(
          h.deps,
          { source_answer_id: answerId, kind: "moment", start, end: start + 1 },
          { answerId, ordinaryText: words },
        ),
      ).not.toBeNull();
    }
    expect(
      await proposeMemoryCandidate(
        h.deps,
        { source_answer_id: answerId, kind: "moment", start: 14, end: 15 },
        { answerId, ordinaryText: words },
      ),
    ).toBeNull();
    expect(await propose()).toBe(first);
    expect(await h.db.select().from(memoryCandidates)).toHaveLength(
      MAX_MEMORY_CANDIDATES_PER_SOURCE,
    );
  });

  it("binds voice memories to transcript words and language, and invalidates corrected transcripts", async () => {
    await h.db
      .update(answers)
      .set({ kind: "voice", payload: {}, transcript: words, transcriptLang: "en" })
      .where(eq(answers.id, answerId));
    expect(await propose()).not.toBeNull();
    expect((await read())?.items[0]?.quote).toBe("I love yellow flowers.");
    await h.db.update(answers).set({ transcriptLang: "zh-TW" }).where(eq(answers.id, answerId));
    expect((await read())?.items).toEqual([]);
  });
});
