/**
 * Vela's drafts of a question about a box photo (ADR-61): who may ask, the switch, what the model
 * is shown, and which drafts are offered back.
 */
import { createFakeAi } from "@vela/ai";
import { ApiUploadedMedia } from "@vela/contracts";
import { aiCalls, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { uploadApiMedia } from "./api-media.ts";
import { addToApiPhotoBox } from "./photo-box.ts";
import { acceptedQuestions, draftPhotoQuestions } from "./photo-questions.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { testJpeg } from "./testing/jpeg.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const stranger: SessionIdentity = { authSubject: "auth|Zed", sessionId: "session-zed" };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now(), memberLanguage: "zh-TW" });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("no account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
  await h.db.insert(users).values({ authSubject: stranger.authSubject, displayName: "Zed" });
});

async function uploaded(): Promise<string> {
  const upload = await uploadApiMedia(
    { db: h.db, clock: h.clock, random: h.random, store: h.media, logger: h.logger },
    mia,
    "upload-1",
    seed.family.id,
    testJpeg({ scan: [1, 0x21, 0x43] }),
  );
  return ApiUploadedMedia.parse(upload.response.body).id;
}

function deps(options: { on?: boolean; ai?: ReturnType<typeof createFakeAi> } = {}) {
  return {
    db: h.db,
    clock: h.clock,
    ai: options.ai ?? h.ai,
    media: h.media,
    logger: h.logger,
    config: { photoQuestionAi: options.on ?? true },
  };
}

describe("draftPhotoQuestions", () => {
  it("shows the model the photo, the adder, her language and how they call her, and logs only counts", async () => {
    const mediaId = await uploaded();

    const drafts = await draftPhotoQuestions(deps(), mia, seed.family.id, {
      media_id: mediaId,
      era: "old",
      caption: "外婆家",
    });

    expect(drafts.questions).toEqual(["這是在哪裡呢？", "那天發生了什麼事？"]);
    const [call] = h.ai.calls;
    expect(call?.call).toBe("photo_question");
    expect(call?.input).toMatchObject({
      lang: "zh-TW",
      askerName: "Mia",
      addressForm: "Mom",
      era: "old",
      caption: "外婆家",
      image: { mime: "image/jpeg" },
    });
    const sent = call?.input as { image: { base64: string } } | undefined;
    expect(sent?.image.base64.length).toBeGreaterThan(10);
    const [logged] = await h.db.select().from(aiCalls);
    expect(logged?.call).toBe("photo_question");
    expect(logged?.inputRef).toEqual({});
    expect(logged?.output).toEqual({});
  });

  it("drafts for a photo already in the box, for whoever may change it", async () => {
    const mediaId = await uploaded();
    await addToApiPhotoBox(h.deps, mia, "box-1", seed.family.id, { media_id: mediaId, era: "new" });

    const drafts = await draftPhotoQuestions(deps(), mia, seed.family.id, {
      media_id: mediaId,
      era: "new",
    });

    expect(drafts.questions).toHaveLength(2);
  });

  it("calls no model with the switch off, and the adder writes their own", async () => {
    const mediaId = await uploaded();

    const drafts = await draftPhotoQuestions(deps({ on: false }), mia, seed.family.id, {
      media_id: mediaId,
      era: "new",
    });

    expect(drafts).toEqual({ questions: [] });
    expect(h.ai.calls).toEqual([]);
  });

  it("is 404 for someone outside the family, and calls no model", async () => {
    const mediaId = await uploaded();

    await expect(
      draftPhotoQuestions(deps(), stranger, seed.family.id, { media_id: mediaId, era: "new" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(h.ai.calls).toEqual([]);
  });

  it("is 404 for a photo that is not there", async () => {
    await expect(
      draftPhotoQuestions(deps(), mia, seed.family.id, {
        media_id: "0190f5a2-0000-7000-8000-000000000000",
        era: "new",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("offers nothing when the model fails", async () => {
    const mediaId = await uploaded();
    const ai = createFakeAi({
      photoQuestion: async () => ({
        ok: false,
        value: { questions: [] },
        record: {
          call: "photo_question",
          promptVersion: "photo_question.v1",
          model: "gpt-5.6-terra",
          ok: false,
          tokensIn: 0,
          tokensOut: 0,
          tokensCached: 0,
          latencyMs: 1,
          costUsd: 0,
          error: "http_500",
        },
        error: "http_500",
      }),
    });

    const drafts = await draftPhotoQuestions(deps({ ai }), mia, seed.family.id, {
      media_id: mediaId,
      era: "new",
    });

    expect(drafts).toEqual({ questions: [] });
  });
});

describe("acceptedQuestions", () => {
  it("keeps one question each, drops the caption repeated, health checks, pronouns and repeats", () => {
    expect(
      acceptedQuestions(
        [
          "What would you cook with these?",
          "From the market today, right?",
          "Are you OK today?",
          "Is she your sister?",
          "What would you cook with these?",
          "Where? When?",
          "這是誰的腳踏車？",
          "他是誰？",
        ],
        "From the market today",
      ),
    ).toEqual(["What would you cook with these?", "這是誰的腳踏車？"]);
  });

  it("offers at most three", () => {
    expect(acceptedQuestions(["A?", "B?", "C?", "D?"], null)).toEqual(["A?", "B?", "C?"]);
  });
});
