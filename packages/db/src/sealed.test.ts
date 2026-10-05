import { describe, expect, it } from "vitest";
import {
  ANSWER_PAYLOAD_SEALING,
  decodeSealedJsonb,
  encodeSealedJsonb,
  OUTBOUND_PAYLOAD_SEALING,
  openContent,
  resealJsonb,
  SealedValueError,
  sealContent,
} from "./sealed.ts";

const key = new Uint8Array(32).fill(17);

describe("content sealing", () => {
  it("round-trips Unicode exactly with a fresh nonce, including a leading BOM", () => {
    const text = "\uFEFFMom's morning 🌅 — photo 2";
    const first = sealContent(text, "answers.transcript", key);
    const second = sealContent(text, "answers.transcript", key);
    expect(first).not.toBe(second);
    expect(first).not.toContain("Mom");
    expect(openContent(first, "answers.transcript", key)).toBe(text);
  });

  it("fails closed on a wrong key, column, JSON field, truncated tag or legacy plaintext", () => {
    const value = sealContent("private", "answers.payload", key, ["text"]);
    expect(() =>
      openContent(value, "answers.payload", new Uint8Array(32).fill(18), ["text"]),
    ).toThrow(SealedValueError);
    expect(() => openContent(value, "replies.text", key, ["text"])).toThrow(SealedValueError);
    expect(() => openContent(value, "answers.payload", key, ["choice"])).toThrow(SealedValueError);
    expect(() => openContent(value.slice(0, -4), "answers.payload", key, ["text"])).toThrow(
      SealedValueError,
    );
    expect(() => openContent("private", "answers.payload", key)).toThrow(SealedValueError);
  });

  it("seals content while preserving gateway routing and source identifiers for SQL", () => {
    const payload = {
      message: { text: "a sensitive quote", replyToMessageId: "telegram-12" },
      healthWordsFor: { memberId: "member-1", answerId: "answer-1" },
      attempts: 1,
    };
    const sealed = encodeSealedJsonb(payload, "outbound.payload", OUTBOUND_PAYLOAD_SEALING, key);
    expect(sealed).not.toContain("sensitive quote");
    expect(sealed).toContain("telegram-12");
    expect(sealed).toContain("member-1");
    expect(decodeSealedJsonb(sealed, "outbound.payload", OUTBOUND_PAYLOAD_SEALING, key)).toEqual(
      payload,
    );
  });

  it("preserves structural photo choices and rejects swapping sealed content fields", () => {
    const payload = { text: "caption", choice: "the garden", index: 1, media_id: "photo-2" };
    const sealed = encodeSealedJsonb(payload, "answers.payload", ANSWER_PAYLOAD_SEALING, key);
    const structured = JSON.parse(sealed) as Record<string, unknown>;
    expect(structured.index).toBe(1);
    expect(structured.media_id).toBe("photo-2");
    const swapped = { ...structured, text: structured.choice, choice: structured.text };
    expect(() =>
      decodeSealedJsonb(swapped, "answers.payload", ANSWER_PAYLOAD_SEALING, key),
    ).toThrow(SealedValueError);
  });

  it("allows SQL to remove an array element without invalidating the remaining content", () => {
    const sealed = encodeSealedJsonb(["one", "two"], "weekly_reads.lines", undefined, key);
    const values = JSON.parse(sealed) as string[];
    expect(decodeSealedJsonb(values.slice(1), "weekly_reads.lines", undefined, key)).toEqual([
      "two",
    ]);
  });

  it("reseals legacy content once and refuses an invalid reserved v1 envelope", () => {
    const legacy = { text: "caption", index: 1 };
    const first = resealJsonb(legacy, "answers.payload", ANSWER_PAYLOAD_SEALING, key);
    expect(resealJsonb(JSON.parse(first), "answers.payload", ANSWER_PAYLOAD_SEALING, key)).toBe(
      first,
    );
    expect(() =>
      resealJsonb({ text: "v1.invalid.invalid" }, "answers.payload", ANSWER_PAYLOAD_SEALING, key),
    ).toThrow(SealedValueError);
  });
});
