import { createFakeAi, fakeRecord } from "@vela/ai";
import type { DraftPersonalQuestion } from "@vela/contracts";
import { aiCalls, events, exchanges, members, outbound, suggestions, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeApiAsk } from "./api-asks.ts";
import { draftApiPersonalQuestion } from "./api-personal-questions.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const identity = { authSubject: "auth|personal-drafts", sessionId: "draft-test" };
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (!user) throw new Error("Missing test user");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});

function brief(): DraftPersonalQuestion {
  return {
    recipient_id: seed.member.id,
    language: "en",
    address_form: "Mom",
    context: {
      intent: "How are the tomatoes growing?",
      connection: "practical",
      talking_rhythm: "rarely",
      avoid_topics: ["money"],
      never_say: ["darling"],
    },
    writing_examples: ["mom how's the garden", "any new leaves"],
  };
}
const good = () => ({
  ok: true as const,
  value: {
    type: "question" as const,
    text: "mom how are the tomatoes growing?",
    source: "rotation" as const,
  },
  record: { ...fakeRecord("suggest"), promptVersion: "suggest.personal.v2" },
});

describe("request-only personal questions", () => {
  it("uses the caller's real identity and only explicitly supplied pair context; stores no words or notes", async () => {
    const ai = createFakeAi({ suggest: async () => good() });
    const result = await draftApiPersonalQuestion(
      { ...h.deps, ai },
      identity,
      seed.family.id,
      brief(),
    );
    expect(result).toEqual({ state: "review", text: good().value.text, language: "en" });
    expect(ai.calls[0]?.input).toMatchObject({
      holderName: "Mia",
      recipientAddress: "Mom",
      holderWritingExamples: brief().writing_examples,
      personalization: brief().context,
      recentMentions: [],
      familyDates: [],
      holderLastAsk: null,
    });
    for (const table of [exchanges, suggestions, outbound])
      expect(await h.db.select().from(table)).toEqual([]);
    const logs = await h.db.select().from(aiCalls);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.output).toEqual({});
    expect(JSON.stringify(logs)).not.toMatch(/tomatoes|darling|rarely/);
    expect(
      (await h.db.select().from(members).where(eq(members.id, seed.member.id)))[0]
        ?.suggestionsSignedBy,
    ).toBeNull();
  });

  it.each(["quiet", "boundary"] as const)(
    "offers no question for %s without calling AI",
    async (reason) => {
      const input = brief();
      if (reason === "quiet") {
        input.context.connection = "quiet";
        input.context.intent = "";
      } else input.context.intent = "Can we talk about money?";
      expect(await draftApiPersonalQuestion(h.deps, identity, seed.family.id, input)).toEqual({
        state: "not_drafted",
        reason,
      });
      expect(h.ai.calls).toEqual([]);
    },
  );

  it.each([
    "darling how are the tomatoes?",
    "How is your MONEY situation?",
    "Ｈｏｗ is your ｍｏｎｅｙ?",
    "I've read your answer, how are the tomatoes?",
    "I'll call tonight, how are the tomatoes?",
    "我剛看了你的回答，番茄長得怎樣？",
    "How are the tomatoes? Are they red?",
    "VELA_NO_DRAFT",
  ])("does not keep flagged provider wording: %s", async (text) => {
    const ai = createFakeAi({
      suggest: async () => ({ ...good(), value: { ...good().value, text } }),
    });
    expect(
      await draftApiPersonalQuestion({ ...h.deps, ai }, identity, seed.family.id, brief()),
    ).toEqual({ state: "not_drafted", reason: "needs_rewording" });
  });

  it.each([
    "stranger",
    "other-parent",
    "paused",
    "withdrawn",
    "left",
    "caller-paused",
    "pilot",
  ] as const)("does not call a provider for %s", async (failure) => {
    const input = brief();
    let who = identity;
    let config = h.deps.config;
    if (failure === "stranger") who = { ...identity, authSubject: "auth|stranger" };
    if (failure === "other-parent") {
      const other = await seedFamily(h.db, {
        now: h.clock.now(),
        organiserExternalId: "3001",
        memberExternalId: "3002",
      });
      input.recipient_id = other.member.id;
    }
    if (failure === "paused")
      await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    if (failure === "withdrawn")
      await h.db.update(members).set({ lightOn: false }).where(eq(members.id, seed.member.id));
    if (failure === "left")
      await h.db
        .update(members)
        .set({ leftAt: h.clock.now() })
        .where(eq(members.id, seed.organiser.id));
    if (failure === "caller-paused")
      await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.organiser.id));
    if (failure === "pilot") config = { ...config, pilotAdmission: { telegramUserIds: [] } };
    await expect(
      draftApiPersonalQuestion({ ...h.deps, config }, who, seed.family.id, input),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(h.ai.calls).toEqual([]);
  });

  it("discards a result when consent changes during provider work", async () => {
    const ai = createFakeAi({
      suggest: async () => {
        await h.db.update(members).set({ lightOn: false }).where(eq(members.id, seed.member.id));
        return good();
      },
    });
    await expect(
      draftApiPersonalQuestion({ ...h.deps, ai }, identity, seed.family.id, brief()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await h.db.select().from(aiCalls)).toEqual([]);
    expect(await h.db.select().from(exchanges)).toEqual([]);
  });

  it("offers no stock substitute when AI is off or fails", async () => {
    const ai = createFakeAi({
      suggest: async () => ({ ok: false, value: good().value, record: null }),
    });
    expect(
      await draftApiPersonalQuestion({ ...h.deps, ai }, identity, seed.family.id, brief()),
    ).toEqual({ state: "not_drafted", reason: "unavailable" });
    expect(await h.db.select().from(exchanges)).toEqual([]);
  });

  it("rejects caller-supplied author identity and oversized inputs before provider work", async () => {
    for (const input of [
      { ...brief(), author_id: seed.member.id },
      { ...brief(), writing_examples: ["x".repeat(181)] },
    ]) {
      await expect(
        draftApiPersonalQuestion(h.deps, identity, seed.family.id, input),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    expect(h.ai.calls).toEqual([]);
  });

  it("records reviewed AI assistance and the words' actual language when composing", async () => {
    const result = await composeApiAsk(
      h.deps,
      identity,
      "reviewed-draft-provenance",
      seed.family.id,
      {
        recipient_id: seed.member.id,
        type: "question",
        text: "媽，番茄長得怎樣？",
        when: "tomorrow",
        ai_assisted: true,
        text_language: "zh-TW",
      },
    );
    expect(result.response.status).toBe(201);
    const rows = await h.db.select().from(exchanges);
    expect(rows[0]).toMatchObject({ textLang: "zh-TW", draftedByVela: false });
    expect(
      (await h.db.select().from(events)).find((event) => event.name === "ask_composed")?.props
        .from_suggestion,
    ).toBe(true);
  });
});
