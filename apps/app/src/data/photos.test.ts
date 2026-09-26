import {
  ApiIdempotencyKey,
  ApiTodayExchange,
  COMPOSABLE_EXCHANGE_TYPES,
  ComposeAsk,
  MAX_VOTE_OPTIONS,
} from "@vela/contracts";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.ts";
import { photoKey, photoRefusal } from "../api/upload.ts";
import { composableType, VOTE_OPTIONS } from "./ask.ts";
import {
  askExtras,
  EMPTY_SLOT,
  fitWithin,
  LONG_SIDE,
  loadPhoto,
  type PhotoSlot,
  photoAskText,
  photoCount,
  retryable,
  shownPhoto,
  slotError,
  slotsReady,
  withFreshToken,
} from "./photos.ts";
import { toExchange } from "./useExchanges.ts";
import { toTodayExchange } from "./useToday.ts";

// The Lingui macros compile away as the app is bundled, and nothing compiles them here, so they
// read their English as written: these tests are about what the photos do, not their words.
vi.mock("@lingui/core/macro", () => {
  const join = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (line, part, index) => `${line}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    );
  return {
    t: join,
    // Tagged, or called with a descriptor that carries a comment for the translator.
    msg: (strings: TemplateStringsArray | { message: string }, ...values: unknown[]) => {
      const text = "message" in strings ? strings.message : join(strings, ...values);
      return { id: text, message: text };
    },
  };
});
// Signing in is a native module; nothing here touches it.
vi.mock("../auth/clerk.tsx", () => ({ useAccount: () => ({}) }));

const MOM = "4d9e2f5a-1b3c-4e6d-8f70-a1b2c3d4e5f6";
const FIRST = "0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b";
const SECOND = "1f2a3b4c-5d6e-4f7a-9b8c-9d0e1f2a3b4c";
const EXCHANGE = "2a3b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c5d";

function done(mediaId: string): PhotoSlot {
  return { status: "done", uri: `file:///${mediaId}.jpg`, key: `media:${mediaId}`, mediaId };
}

describe("re-encoding on the phone", () => {
  it("brings the long side down to 1600 and keeps the shape", () => {
    expect(LONG_SIDE).toBe(1600);
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600 });
    expect(fitWithin(3024, 4032)).toEqual({ height: 1600 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 1600 });
  });

  it("leaves a photo that is already small enough", () => {
    expect(fitWithin(1600, 1200)).toBeNull();
    expect(fitWithin(640, 480)).toBeNull();
  });
});

describe("the kinds with photos", () => {
  it("take two photos to pick from, one old photo, and otherwise none", () => {
    expect(photoCount("two_photos")).toBe(2);
    expect(photoCount("old_photo")).toBe(1);
    expect(photoCount("question")).toBe(0);
    expect(photoCount("vote")).toBe(0);
  });

  it("start with words she can answer by looking", () => {
    expect(photoAskText("two_photos")).toBe("Which one do you like more?");
    expect(photoAskText("old_photo")).toBe("Do you remember this?");
    expect(photoAskText("question")).toBeUndefined();
  });

  it("are sent as the contract's photo types, as is a vote", () => {
    expect(composableType.two_photos).toBe("photo_choice");
    expect(composableType.old_photo).toBe("memory_photo");
    expect(composableType.vote).toBe("vote");
    for (const type of Object.values(composableType)) {
      expect(COMPOSABLE_EXCHANGE_TYPES).toContain(type);
    }
    expect(composableType.voice_note).toBeUndefined();
  });
});

describe("what an ask adds to its words", () => {
  it("names both photos of a photo choice in the order she sees them", () => {
    expect(askExtras("two_photos", [done(FIRST), done(SECOND)], [])).toEqual({
      media_ids: [FIRST, SECOND],
    });
  });

  it("waits while a photo is missing, going up, or failed", () => {
    const uploading: PhotoSlot = {
      status: "uploading",
      uri: "file:///a.jpg",
      key: "k",
      progress: 0.5,
    };
    const failed: PhotoSlot = {
      status: "failed",
      uri: "file:///b.jpg",
      key: "k",
      error: "trouble",
    };
    expect(askExtras("two_photos", [done(FIRST), EMPTY_SLOT], [])).toBeUndefined();
    expect(askExtras("two_photos", [done(FIRST), uploading], [])).toBeUndefined();
    expect(askExtras("two_photos", [failed, done(SECOND)], [])).toBeUndefined();
    expect(slotsReady([done(FIRST), uploading], 2)).toBe(false);
    expect(slotsReady([done(FIRST), done(SECOND)], 2)).toBe(true);
  });

  it("names only the first photo for an old photo", () => {
    expect(askExtras("old_photo", [done(FIRST), done(SECOND)], [])).toEqual({
      media_ids: [FIRST],
    });
    expect(askExtras("old_photo", [EMPTY_SLOT, done(SECOND)], [])).toBeUndefined();
  });

  it("sends a vote's options trimmed, leaving blank ones out, once there are two", () => {
    expect(askExtras("vote", [], [" Tea ", "", "Coffee"])).toEqual({
      vote_options: ["Tea", "Coffee"],
    });
    expect(askExtras("vote", [], ["Tea", "  "])).toBeUndefined();
  });

  it("adds nothing to words alone", () => {
    expect(askExtras("question", [done(FIRST)], ["Tea", "Coffee"])).toEqual({});
  });

  it("makes asks the contract takes, and never a whenever photo ask", () => {
    const photoChoice = {
      recipient_id: MOM,
      type: "photo_choice",
      text: "Which one do you like more?",
      when: "tomorrow",
      ...askExtras("two_photos", [done(FIRST), done(SECOND)], []),
    };
    expect(ComposeAsk.safeParse(photoChoice).success).toBe(true);
    expect(ComposeAsk.safeParse({ ...photoChoice, when: "whenever" }).success).toBe(false);
    const vote = {
      recipient_id: MOM,
      type: "vote",
      text: "Which one for Sunday?",
      when: "whenever",
      ...askExtras("vote", [], ["Tea", "Coffee"]),
    };
    expect(ComposeAsk.safeParse(vote).success).toBe(true);
  });

  it("hold a vote to the contract's own limits", () => {
    expect(VOTE_OPTIONS.most).toBe(MAX_VOTE_OPTIONS);
    const vote = (options: string[]) =>
      ComposeAsk.safeParse({
        recipient_id: MOM,
        type: "vote",
        text: "Which?",
        when: "tomorrow",
        vote_options: options,
      }).success;
    const longest = "a".repeat(VOTE_OPTIONS.longest);
    expect(vote([longest, "b"])).toBe(true);
    expect(vote([`${longest}a`, "b"])).toBe(false);
    expect(vote(Array.from({ length: VOTE_OPTIONS.most }, (_, index) => `o${index}`))).toBe(true);
    expect(vote(Array.from({ length: VOTE_OPTIONS.most + 1 }, (_, index) => `o${index}`))).toBe(
      false,
    );
    expect(vote(Array.from({ length: VOTE_OPTIONS.fewest - 1 }, () => "a"))).toBe(false);
  });
});

describe("a refused upload", () => {
  const refused = (status: number, code: string, reason?: string) =>
    new ApiError(status, code, reason === undefined ? undefined : { reason });

  it("says photos are off here when the API keeps none", () => {
    expect(slotError(refused(503, "unavailable", "media_storage_off"))).toBe("off");
    expect(slotError(refused(503, "unavailable", "media_storage_unavailable"))).toBe("off");
  });

  it("asks for another photo when this one will never be taken", () => {
    expect(slotError(refused(413, "invalid"))).toBe("unusable");
    expect(slotError(refused(415, "invalid", "jpeg_only"))).toBe("unusable");
    expect(slotError(refused(400, "invalid", "malformed"))).toBe("unusable");
    expect(slotError(refused(400, "invalid", "dimensions"))).toBe("unusable");
  });

  it("says when the photos for now are used up", () => {
    expect(slotError(refused(429, "rate_limited", "photo_limit"))).toBe("limit");
  });

  it("offers the same file again for anything else", () => {
    expect(slotError(refused(0, "network"))).toBe("trouble");
    expect(slotError(refused(500, "internal"))).toBe("trouble");
    expect(slotError(refused(503, "unavailable"))).toBe("trouble");
    expect(slotError(refused(429, "rate_limited"))).toBe("trouble");
    expect(slotError(refused(400, "invalid"))).toBe("trouble");
    expect(slotError(new Error("offline"))).toBe("trouble");
    expect(retryable("trouble")).toBe(true);
    expect(retryable("limit")).toBe(true);
    expect(retryable("unusable")).toBe(false);
    expect(retryable("off")).toBe(false);
  });

  it("knows the compose route's photo_missing, which empties the slots", () => {
    expect(photoRefusal(refused(404, "not_found", "photo_missing"))).toBe("missing");
    expect(photoRefusal(refused(404, "not_found"))).toBeNull();
    expect(slotError(refused(404, "not_found", "photo_missing"))).toBe("trouble");
  });
});

describe("a photo's upload key", () => {
  it("is the contract's shape, and new for every photo chosen", () => {
    const keys = Array.from({ length: 50 }, photoKey);
    for (const key of keys) expect(ApiIdempotencyKey.safeParse(key).success).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("photos shown this session", () => {
  it("load once, however many screens ask at the same moment", async () => {
    const load = vi.fn(async () => "data:image/jpeg;base64,AAAA");
    const [one, two] = await Promise.all([loadPhoto("once", load), loadPhoto("once", load)]);
    expect(one).toBe("data:image/jpeg;base64,AAAA");
    expect(two).toBe(one);
    expect(await loadPhoto("once", load)).toBe(one);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shownPhoto("once")).toBe(one);
  });

  it("keep no failure, so the next look tries again", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(0, "network"))
      .mockResolvedValueOnce("data:image/jpeg;base64,BBBB");
    await expect(loadPhoto("flaky", load)).rejects.toBeInstanceOf(ApiError);
    expect(shownPhoto("flaky")).toBeUndefined();
    expect(await loadPhoto("flaky", load)).toBe("data:image/jpeg;base64,BBBB");
  });

  it("let the oldest go past two dozen, and keep one seen again", async () => {
    await loadPhoto("kept", async () => "data:kept");
    for (let index = 0; index < 23; index += 1) {
      await loadPhoto(`filler-${index}`, async () => `data:${index}`);
    }
    // Seen again, so it is the newest and outlives the next one in.
    await loadPhoto("kept", async () => "data:again");
    await loadPhoto("latest", async () => "data:latest");
    expect(shownPhoto("kept")).toBe("data:kept");
    expect(shownPhoto("filler-0")).toBeUndefined();
    expect(shownPhoto("latest")).toBe("data:latest");
  });
});

describe("a read with a fresh token", () => {
  it("is made once more with a new token after a 401", async () => {
    const tokens = ["old", "new"];
    const token = vi.fn(async () => tokens.shift() ?? null);
    const read = vi.fn(async (current: string | null) => {
      if (current === "old") throw new ApiError(401, "unauthenticated");
      return `read with ${current}`;
    });
    expect(await withFreshToken(token, read)).toBe("read with new");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is not made a third time, nor again after any other refusal", async () => {
    const refused = vi.fn(async () => {
      throw new ApiError(401, "unauthenticated");
    });
    await expect(withFreshToken(async () => "t", refused)).rejects.toMatchObject({ status: 401 });
    expect(refused).toHaveBeenCalledTimes(2);
    const missing = vi.fn(async () => {
      throw new ApiError(404, "not_found");
    });
    await expect(withFreshToken(async () => "t", missing)).rejects.toMatchObject({ status: 404 });
    expect(missing).toHaveBeenCalledTimes(1);
  });
});

describe("photos on the cards", () => {
  function exchange(fields: Partial<ApiTodayExchange> = {}): ApiTodayExchange {
    return ApiTodayExchange.parse({
      id: EXCHANGE,
      recipient_id: MOM,
      recipient_name: "Mom",
      asker_name: "Anna",
      on_behalf_of: null,
      type: "photo_choice",
      ask: "Which one do you like more?",
      answer: null,
      replies: [],
      seen_at: null,
      replies_reach_her: true,
      photos: [
        { id: FIRST, width: 1600, height: 1200, stored: true },
        { id: SECOND, width: null, height: null, stored: false },
      ],
      ...fields,
    });
  }

  it("keep the ask's photos in her order, and whether the API can show each", () => {
    expect(toTodayExchange(exchange()).photos).toEqual([
      { id: FIRST, width: 1600, height: 1200, stored: true },
      { id: SECOND, width: null, height: null, stored: false },
    ]);
  });

  it("keep her pick, even when a later answer is the one shown", () => {
    const answered = exchange({
      answer: {
        kind: "voice",
        text: "The second, from the lake.",
        at: "2026-10-13T08:12:00+08:00",
        picked_media_id: SECOND,
      },
    });
    expect(toTodayExchange(answered).picked).toBe(SECOND);
  });

  it("carry nothing for an ask without photos or a pick", () => {
    const words = toTodayExchange(exchange({ type: "question", photos: [] }));
    expect(words).not.toHaveProperty("photos");
    expect(words).not.toHaveProperty("picked");
  });

  it("reach Exchanges and the detail screen as they reach Today", () => {
    const summary = {
      ...exchange({
        answer: {
          kind: "photo_pick",
          text: null,
          at: "2026-10-13T08:12:00+08:00",
          picked_media_id: FIRST,
        },
      }),
      scheduled_for: "2026-10-13",
      delivered_at: "2026-10-13T07:00:00+08:00",
    };
    const listed = toExchange(summary);
    expect(listed.photos?.map((photo) => photo.id)).toEqual([FIRST, SECOND]);
    expect(listed.picked).toBe(FIRST);
  });
});
