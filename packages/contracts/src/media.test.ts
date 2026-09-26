import { describe, expect, it } from "vitest";
import {
  ApiErrorBody,
  ApiExchangeSummary,
  ApiTodayExchange,
  ApiUploadedMedia,
  ASK_PHOTO_COUNT,
  COMPOSABLE_EXCHANGE_TYPES,
  ComposeAsk,
  MEDIA_REFUSALS,
  MEDIA_UNAVAILABLE_REASONS,
  MediaRef,
  MediaRefusal,
  MediaUnavailableReason,
  OutboundMediaRef,
  OutboundMessage,
} from "./index.ts";

const uploaded = {
  id: "0199a0b2-4c5d-7e6f-8a9b-0c1d2e3f4a5b",
  kind: "image",
  width: 1600,
  height: 1200,
  bytes: 412_345,
  expires_at: "2026-10-26T00:00:00.000Z",
} as const;

describe("ApiUploadedMedia", () => {
  it("answers an upload with the photo's id, its size and when it is deleted, and nothing else", () => {
    expect(ApiUploadedMedia.parse({ ...uploaded, storage_key: "asks/private.jpg" })).toEqual(
      uploaded,
    );
  });

  it("is an image with a real size", () => {
    expect(ApiUploadedMedia.safeParse({ ...uploaded, kind: "audio" }).success).toBe(false);
    for (const field of ["width", "height", "bytes"] as const) {
      expect(ApiUploadedMedia.safeParse({ ...uploaded, [field]: 0 }).success, field).toBe(false);
      expect(ApiUploadedMedia.safeParse({ ...uploaded, [field]: 1.5 }).success, field).toBe(false);
    }
    expect(ApiUploadedMedia.safeParse({ ...uploaded, id: "not-a-uuid" }).success).toBe(false);
    expect(ApiUploadedMedia.safeParse({ ...uploaded, expires_at: "tomorrow" }).success).toBe(false);
  });
});

describe("why a photo was refused", () => {
  it("names each refusal and each reason storage is unavailable, as an error body carries them", () => {
    expect(MEDIA_REFUSALS).toEqual(["jpeg_only", "malformed", "dimensions", "photo_limit"]);
    expect(MEDIA_UNAVAILABLE_REASONS).toEqual(["media_storage_off", "media_storage_unavailable"]);
    for (const reason of MEDIA_REFUSALS) expect(MediaRefusal.parse(reason)).toBe(reason);
    for (const reason of MEDIA_UNAVAILABLE_REASONS) {
      expect(MediaUnavailableReason.parse(reason)).toBe(reason);
    }
    expect(MediaRefusal.safeParse("too_big").success).toBe(false);
    expect(
      ApiErrorBody.safeParse({
        error: {
          code: "unavailable",
          message: "Photos are not switched on here.",
          details: { reason: "media_storage_off" },
        },
      }).success,
    ).toBe(true);
  });
});

const RECIPIENT = "0199a0b2-4c5d-7e6f-8a9b-000000000001";
const PHOTO_ONE = "0199a0b2-4c5d-7e6f-8a9b-0c1d2e3f4a51";
const PHOTO_TWO = "0199a0b2-4c5d-7e6f-8a9b-0c1d2e3f4a52";

describe("a photo ask", () => {
  const choice = {
    recipient_id: RECIPIENT,
    type: "photo_choice",
    text: "Which one do you like more?",
    when: "tomorrow",
    media_ids: [PHOTO_ONE, PHOTO_TWO],
  } as const;

  it("is composable as a photo choice or an old photo, never as a voice note or a hello", () => {
    expect(COMPOSABLE_EXCHANGE_TYPES).toEqual([
      "question",
      "word",
      "story",
      "recipe",
      "vote",
      "photo_choice",
      "memory_photo",
    ]);
    expect(ASK_PHOTO_COUNT).toEqual({ photo_choice: 2, memory_photo: 1 });
  });

  it("names two photos for a choice and one for an old photo, in the order she sees them", () => {
    expect(ComposeAsk.parse(choice)).toStrictEqual(choice);
    const old = { ...choice, type: "memory_photo", media_ids: [PHOTO_TWO] };
    expect(ComposeAsk.parse(old)).toStrictEqual(old);
    const onADate = { ...choice, when: "date", date: "2026-10-01" };
    expect(ComposeAsk.parse(onADate)).toStrictEqual(onADate);
  });

  it("refuses any other number of photos for its type, and photos on any other type", () => {
    for (const invalid of [
      { media_ids: [PHOTO_ONE] },
      { media_ids: undefined },
      { media_ids: [] },
      { media_ids: [PHOTO_ONE, PHOTO_TWO, "0199a0b2-4c5d-7e6f-8a9b-0c1d2e3f4a53"] },
      { type: "memory_photo", media_ids: [PHOTO_ONE, PHOTO_TWO] },
      { type: "memory_photo", media_ids: undefined },
      { type: "question", media_ids: [PHOTO_ONE] },
      { type: "story", media_ids: [PHOTO_ONE, PHOTO_TWO] },
      { type: "vote", vote_options: ["Tea", "Coffee"], media_ids: [PHOTO_ONE] },
    ]) {
      const result = ComposeAsk.safeParse({ ...choice, ...invalid });
      expect(result.success, JSON.stringify(invalid)).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain("media_ids");
    }
  });

  it("refuses the same photo twice, however its id is written", () => {
    for (const ids of [
      [PHOTO_ONE, PHOTO_ONE],
      [PHOTO_ONE, PHOTO_ONE.toUpperCase()],
    ]) {
      expect(ComposeAsk.safeParse({ ...choice, media_ids: ids }).success, ids.join()).toBe(false);
    }
  });

  it("refuses an id that is not one", () => {
    for (const id of ["not-a-uuid", "", 7, null]) {
      expect(ComposeAsk.safeParse({ ...choice, media_ids: [PHOTO_ONE, id] }).success).toBe(false);
    }
  });

  it("names its morning: a whenever ask waits with no end, and a photo is deleted after 30 days", () => {
    const result = ComposeAsk.safeParse({ ...choice, when: "whenever" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["when"]);
    const words = { ...choice, type: "question", when: "whenever", media_ids: undefined };
    expect(ComposeAsk.safeParse(words).success).toBe(true);
  });

  it("leaves a vote, and every ask without photos, as it was", () => {
    const vote = {
      recipient_id: RECIPIENT,
      type: "vote",
      text: "Tea or coffee?",
      vote_options: ["Tea", "Coffee"],
      when: "whenever",
    };
    expect(ComposeAsk.parse(vote)).toStrictEqual(vote);
  });
});

describe("the photos Today and Exchanges show", () => {
  const exchange = {
    id: "0199a0b2-4c5d-7e6f-8a9b-000000000003",
    recipient_id: RECIPIENT,
    recipient_name: "Mom",
    asker_name: "Mia",
    on_behalf_of: null,
    type: "photo_choice",
    ask: "Which one do you like more?",
    answer: {
      kind: "photo_pick",
      text: null,
      at: "2026-09-23T08:12:00+08:00",
      picked_media_id: PHOTO_TWO,
    },
    replies: [],
    seen_at: null,
    replies_reach_her: true,
    photos: [
      { id: PHOTO_ONE, width: 1600, height: 1200, stored: true },
      { id: PHOTO_TWO, width: null, height: null, stored: false },
    ],
  };

  it("lists each photo with its size and whether the API can show it, and her pick", () => {
    expect(ApiTodayExchange.parse(exchange)).toStrictEqual(exchange);
    const summary = { ...exchange, scheduled_for: "2026-09-23", delivered_at: null };
    expect(ApiExchangeSummary.parse(summary)).toStrictEqual(summary);
  });

  it("refuses a photo without a real id or size, and a pick that is not an id", () => {
    for (const invalid of [
      { photos: [{ id: "not-a-uuid", width: 1, height: 1, stored: true }] },
      { photos: [{ id: PHOTO_ONE, width: 0, height: 1, stored: true }] },
      { photos: [{ id: PHOTO_ONE, width: 1, height: 1 }] },
      { photos: undefined },
      { answer: { ...exchange.answer, picked_media_id: "2" } },
      { answer: { ...exchange.answer, picked_media_id: undefined } },
    ]) {
      expect(ApiTodayExchange.safeParse({ ...exchange, ...invalid }).success).toBe(false);
    }
  });
});

describe("a photo an outbound message carries", () => {
  it("may name a file Vela keeps by its storage key, which an inbound event never carries", () => {
    const stored = { kind: "image", storageKey: "asks/family/abc.jpg", mime: "image/jpeg" };
    expect(OutboundMediaRef.parse(stored)).toStrictEqual(stored);
    expect(MediaRef.safeParse(stored).success).toBe(false);
    expect(OutboundMediaRef.safeParse({ kind: "image" }).success).toBe(false);
    expect(OutboundMediaRef.safeParse({ ...stored, storageKey: "" }).success).toBe(false);
    expect(OutboundMediaRef.safeParse({ ...stored, storageKey: "k".repeat(513) }).success).toBe(
      false,
    );
    const message = {
      kind: "arrival",
      idempotencyKey: "arrival:member:2026-09-24",
      lang: "en",
      to: { channel: "telegram", conversationId: "42" },
      text: "Mia asks:",
      media: [stored, { kind: "image", providerFileId: "AgAC" }],
    };
    expect(OutboundMessage.parse(message)).toStrictEqual(message);
  });
});
