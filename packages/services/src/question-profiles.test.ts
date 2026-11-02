import { createFakeAi, fakeRecord } from "@vela/ai";
import { ApiQuestionProfileSaved, QUESTION_PROFILE_NOTICE_VERSION } from "@vela/contracts";
import {
  apiRequestReceipts,
  exchanges,
  families,
  members,
  questionProfiles,
  users,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeApiAsk } from "./api-asks.ts";
import { draftApiPersonalQuestion } from "./api-personal-questions.ts";
import { applyRetention } from "./jobs.ts";
import {
  assertQuestionProfileRevision,
  forgetApiQuestionProfile,
  loadApiQuestionProfile,
  saveApiQuestionProfile,
} from "./question-profiles.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let ownerId: string;
const identity = { authSubject: "auth|private-profile", sessionId: "profile-test" };
const settings = {
  language: "en" as const,
  address_form: "dad",
  context: {
    connection: "practical" as const,
    talking_rhythm: "rarely" as const,
    avoid_topics: ["money"],
    never_say: ["darling"],
  },
  writing_examples: ["dad how's the garden"],
};
const deps = () => ({ ...h.deps, savingEnabled: true });
const load = (who = identity) =>
  loadApiQuestionProfile(deps(), who, seed.family.id, seed.member.id);
const save = (key: string, revision: string | null = null) =>
  saveApiQuestionProfile(deps(), identity, key, seed.family.id, seed.member.id, {
    settings,
    expected_revision: revision,
    notice_version: QUESTION_PROFILE_NOTICE_VERSION,
  });
const forget = (key = "profile-forget") =>
  forgetApiQuestionProfile(deps(), identity, key, seed.family.id, seed.member.id, {});
const revision = async () => {
  const value = (await load()).revision;
  if (!value) throw new Error("missing revision");
  return value;
};

beforeAll(async () => {
  h = await createHarness();
}, 60000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (!user) throw new Error("Missing user");
  ownerId = user.id;
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});

describe("private, explicitly saved pair choices", () => {
  it("seals all settings; returns metadata receipts without words and does not renew on read", async () => {
    const result = await save("save-private");
    ApiQuestionProfileSaved.parse(result.response.body);
    const first = await load();
    expect(first.profile?.settings).toEqual(settings);
    expect(first.profile?.expires_at).toBe(
      new Date(h.clock.now().getTime() + 30 * 86400000).toISOString(),
    );
    h.clock.advance(86400000);
    expect(await load()).toEqual(first);
    const raw = await h.db.execute(sql`select data from question_profiles`);
    expect(JSON.stringify(raw.rows)).not.toMatch(/garden|money|practical|darling/);
    expect(JSON.stringify(await h.db.select().from(apiRequestReceipts))).not.toMatch(
      /garden|money|darling/,
    );
  });
  it("keeps each sibling's setup separate and rejects cross-family or own-member access", async () => {
    await save("save-mia");
    const brother = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "3001",
    });
    const who = { ...identity, authSubject: "auth|sam" };
    const [u] = await h.db
      .insert(users)
      .values({ authSubject: who.authSubject, displayName: "Sam" })
      .returning();
    if (!u) throw new Error("Missing user");
    await h.db.update(members).set({ userId: u.id }).where(eq(members.id, brother.member.id));
    expect((await load(who)).profile).toBeNull();
    await saveApiQuestionProfile(deps(), who, "sam-save", seed.family.id, seed.member.id, {
      settings: { ...settings, address_form: "papa" },
      expected_revision: null,
      notice_version: QUESTION_PROFILE_NOTICE_VERSION,
    });
    expect((await load()).profile?.settings.address_form).toBe("dad");
    expect((await load(who)).profile?.settings.address_form).toBe("papa");
    await expect(
      loadApiQuestionProfile(deps(), identity, seed.family.id, seed.organiser.id),
    ).rejects.toMatchObject({ code: "not_found" });
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "4001",
      memberExternalId: "4002",
    });
    await expect(
      loadApiQuestionProfile(deps(), identity, other.family.id, other.member.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(load({ ...identity, authSubject: "stranger" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("requires the exact notice and explicit enabled switch", async () => {
    const input = { settings, expected_revision: null, notice_version: "old" };
    await expect(
      saveApiQuestionProfile(deps(), identity, "bad-notice", seed.family.id, seed.member.id, input),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      saveApiQuestionProfile(
        { ...h.deps, savingEnabled: false },
        identity,
        "off-save",
        seed.family.id,
        seed.member.id,
        { ...input, notice_version: QUESTION_PROFILE_NOTICE_VERSION },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await h.db.select().from(questionProfiles)).toEqual([]);
  });
  it("rejects stale edits and stale first saves after forgetting; a replay cannot recreate notes", async () => {
    await save("original");
    const old = await revision();
    await save("new-edit", old);
    const edited = await revision();
    expect(edited).not.toBe(old);
    await expect(save("stale", old)).rejects.toMatchObject({ code: "question_profile_changed" });
    await forget();
    expect((await load()).profile).toBeNull();
    expect((await load()).revision).not.toBe(edited);
    await expect(save("stale-create")).rejects.toMatchObject({ code: "question_profile_changed" });
    expect((await save("original")).replayed).toBe(true);
    expect((await load()).profile).toBeNull();
    await save("intentional-new-save", await revision());
    expect((await load()).profile?.settings).toEqual(settings);
  });
  it("allows read and immediate forget even while collection and pilot admission are off", async () => {
    await save("on-save");
    const off = {
      ...h.deps,
      savingEnabled: false,
      config: { pilotAdmission: { telegramUserIds: [], familyIds: [], languages: ["zh-TW"] } },
    };
    // Processing gates must never prevent a person's own data access or deletion.
    const read = await loadApiQuestionProfile(off, identity, seed.family.id, seed.member.id);
    expect(read.saving_available).toBe(false);
    expect(read.profile?.settings).toEqual(settings);
    await forgetApiQuestionProfile(off, identity, "off-forget", seed.family.id, seed.member.id, {});
    expect((await load()).profile).toBeNull();
    const [row] = await h.db.select().from(questionProfiles);
    expect(row?.data).toBeNull();
  });
  it("expires at the exact boundary, and retention removes words and revision metadata", async () => {
    await save("expires");
    const rev = await revision();
    h.clock.advance(30 * 86400000);
    expect((await load()).profile).toBeNull();
    await expect(
      assertQuestionProfileRevision(
        h.db,
        identity,
        seed.family.id,
        seed.member.id,
        rev,
        h.clock.now(),
      ),
    ).rejects.toMatchObject({ code: "question_profile_changed" });
    expect((await applyRetention(h.deps)).question_profiles_deleted).toBe(1);
    expect(await h.db.select().from(questionProfiles)).toEqual([]);
    await forget("empty-forget");
    h.clock.advance(30 * 86400000);
    expect((await applyRetention(h.deps)).question_profiles_deleted).toBe(1);
  });
  it.each([
    "recipient-withdraws",
    "author-leaves",
    "parent-deceased",
    "owner-deleted",
    "owner-relinked",
    "family-deleted",
  ] as const)("erases setup immediately when %s", async (reason) => {
    await save("cleanup");
    if (reason === "recipient-withdraws")
      await h.db.update(members).set({ lightOn: false }).where(eq(members.id, seed.member.id));
    if (reason === "author-leaves")
      await h.db
        .update(members)
        .set({ status: "left", leftAt: h.clock.now() })
        .where(eq(members.id, seed.organiser.id));
    if (reason === "parent-deceased")
      await h.db.update(members).set({ status: "deceased" }).where(eq(members.id, seed.member.id));
    if (reason === "owner-deleted")
      await h.db.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, ownerId));
    if (reason === "owner-relinked")
      await h.db.update(users).set({ authSubject: "auth|different" }).where(eq(users.id, ownerId));
    if (reason === "family-deleted")
      await h.db
        .update(families)
        .set({ deletedAt: h.clock.now() })
        .where(eq(families.id, seed.family.id));
    expect(await h.db.select().from(questionProfiles)).toEqual([]);
  });
  it("keeps notes during a pause, but refuses new saves", async () => {
    await save("before-pause");
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    expect((await load()).profile?.settings).toEqual(settings);
    await expect(save("paused", await revision())).rejects.toMatchObject({ code: "not_found" });
    await forget();
    expect((await load()).profile).toBeNull();
  });
  it.each(["forgotten", "edited", "expired"] as const)(
    "discards an in-flight AI draft when saved choices are %s",
    async (change) => {
      await save("initial");
      const rev = await revision();
      const ai = createFakeAi({
        suggest: async () => {
          if (change === "forgotten") await forget();
          if (change === "edited") await save("edit-inflight", rev);
          if (change === "expired") h.clock.advance(30 * 86400000);
          return {
            ok: true,
            value: { type: "question", text: "dad how are the tomatoes?", source: "rotation" },
            record: fakeRecord("suggest"),
          };
        },
      });
      await expect(
        draftApiPersonalQuestion({ ...h.deps, ai }, identity, seed.family.id, {
          ...settings,
          recipient_id: seed.member.id,
          profile_revision: rev,
          context: { ...settings.context, intent: "how are the tomatoes" },
        }),
      ).rejects.toMatchObject({ code: "question_profile_changed" });
    },
  );
  it("rejects scheduling a review with forgotten choices, but leaves already-approved questions alone", async () => {
    await save("initial");
    const rev = await revision();
    const input = {
      recipient_id: seed.member.id,
      text: "dad how are the tomatoes?",
      type: "question",
      when: "date",
      date: "2026-09-16",
      ai_assisted: true,
      personal_profile_revision: rev,
      text_language: "en",
    };
    await composeApiAsk(h.deps, identity, "first-schedule", seed.family.id, input);
    await forget();
    expect(await h.db.select().from(exchanges)).toHaveLength(1);
    await expect(
      composeApiAsk(h.deps, identity, "stale-schedule", seed.family.id, {
        ...input,
        date: "2026-09-17",
      }),
    ).rejects.toMatchObject({ code: "question_profile_changed" });
  });
  it("database guards refuse a different family and lifetimes above 30 days", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "4001",
      memberExternalId: "4002",
    });
    const base = {
      familyId: seed.family.id,
      authorId: seed.organiser.id,
      recipientId: other.member.id,
      ownerUserId: ownerId,
      data: settings,
      noticeVersion: QUESTION_PROFILE_NOTICE_VERSION,
      changedAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 86400000),
    };
    await expect(h.db.insert(questionProfiles).values(base)).rejects.toThrow();
    await expect(
      h.db.insert(questionProfiles).values({
        ...base,
        recipientId: seed.member.id,
        expiresAt: new Date(h.clock.now().getTime() + 31 * 86400000),
      }),
    ).rejects.toThrow();
  });
});
