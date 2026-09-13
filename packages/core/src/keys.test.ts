import { OUTBOUND_KINDS, type OutboundKind } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import {
  OUTBOUND_KEY_MAX_LENGTH,
  OUTBOUND_KEY_SHAPES,
  type OutboundKeyParts,
  outboundKey,
} from "./keys.ts";

const MEMBER = "01920f3e-7a4b-7c5d-8e9f-0a1b2c3d4e5f";
const OTHER_MEMBER = "01920f3e-7a4b-7c5d-8e9f-0a1b2c3d4e60";
const EXCHANGE = "01920f40-1111-7222-9333-444455556666";
const QUIET = "01920f41-aaaa-7bbb-accc-ddddeeeeffff";
const HEART_ANSWER = "01920f42-0000-7111-8222-333344445555";
const VOICE_ANSWER = "01920f42-0000-7111-8222-333344445556";
const DATE = "2026-09-16";
const CONVERSATION = "-1001234567890";

/** Every part, so each kind takes what it needs. */
const ALL: OutboundKeyParts = {
  memberId: MEMBER,
  date: DATE,
  exchangeId: EXCHANGE,
  quietEventId: QUIET,
  conversationId: CONVERSATION,
};

function keyFor(kind: OutboundKind, parts: OutboundKeyParts = ALL): string {
  const shape = OUTBOUND_KEY_SHAPES[kind];
  return outboundKey(kind, shape.suffix === "required" ? { suffix: "1", ...parts } : parts);
}

describe("outboundKey", () => {
  it("names the messages the gateway sends in the documented shape", () => {
    expect(outboundKey("arrival", { memberId: MEMBER, date: DATE })).toBe(
      `arrival:${MEMBER}:${DATE}`,
    );
    expect(outboundKey("repeat", { memberId: MEMBER, date: DATE })).toBe(
      `repeat:${MEMBER}:${DATE}`,
    );
    expect(outboundKey("answer_post", { exchangeId: EXCHANGE, suffix: HEART_ANSWER })).toBe(
      `answer_post:${EXCHANGE}:${HEART_ANSWER}`,
    );
    expect(outboundKey("answer_receipt", { exchangeId: EXCHANGE })).toBe(
      `answer_receipt:${EXCHANGE}`,
    );
    expect(outboundKey("turn_prompt", { memberId: MEMBER, date: DATE })).toBe(
      `turn_prompt:${MEMBER}:${DATE}`,
    );
    expect(
      outboundKey("quiet_notice", { quietEventId: QUIET, memberId: MEMBER, suffix: "2" }),
    ).toBe(`quiet_notice:${QUIET}:${MEMBER}:2`);
    expect(outboundKey("nearby_ask", { quietEventId: QUIET, conversationId: CONVERSATION })).toBe(
      `nearby_ask:${QUIET}:${CONVERSATION}`,
    );
  });

  it("gives every kind a different key for the same parts", () => {
    const keys = OUTBOUND_KINDS.map((kind) => keyFor(kind));
    expect(new Set(keys).size).toBe(OUTBOUND_KINDS.length);
  });

  it("is stable: the same message gets the same key whatever else the caller passes", () => {
    for (const kind of OUTBOUND_KINDS) {
      const shape = OUTBOUND_KEY_SHAPES[kind];
      const minimal: OutboundKeyParts = Object.fromEntries(
        shape.parts.map((name) => [name, ALL[name]]),
      );
      expect(keyFor(kind, minimal)).toBe(keyFor(kind));
      expect(keyFor(kind, { ...ALL })).toBe(keyFor(kind));
    }
  });

  it("gives the same key for an id written in upper case", () => {
    expect(outboundKey("arrival", { memberId: MEMBER.toUpperCase(), date: DATE })).toBe(
      outboundKey("arrival", { memberId: MEMBER, date: DATE }),
    );
  });

  it("changes the key when any identifying part or the suffix changes", () => {
    const changed: Record<keyof OutboundKeyParts, string> = {
      memberId: OTHER_MEMBER,
      date: "2026-09-17",
      exchangeId: "01920f40-1111-7222-9333-444455556667",
      quietEventId: "01920f41-aaaa-7bbb-accc-ddddeeeefff0",
      conversationId: "-1009999999999",
      suffix: "2",
    };
    for (const kind of OUTBOUND_KINDS) {
      const shape = OUTBOUND_KEY_SHAPES[kind];
      const base = keyFor(kind);
      for (const name of shape.parts) {
        expect(keyFor(kind, { ...ALL, [name]: changed[name] })).not.toBe(base);
      }
      if (shape.suffix === "required") {
        expect(outboundKey(kind, { ...ALL, suffix: "2" })).not.toBe(base);
      }
    }
  });

  it("keeps one arrival and one repeat per member per date", () => {
    const keys = new Set<string>();
    for (const memberId of [MEMBER, OTHER_MEMBER]) {
      for (const date of ["2026-09-16", "2026-09-17"]) {
        keys.add(outboundKey("arrival", { memberId, date }));
        keys.add(outboundKey("repeat", { memberId, date }));
      }
    }
    expect(keys.size).toBe(8);
  });

  it("gives each organiser and each notification round its own quiet notice", () => {
    const first = outboundKey("quiet_notice", {
      quietEventId: QUIET,
      memberId: MEMBER,
      suffix: "1",
    });
    const again = outboundKey("quiet_notice", {
      quietEventId: QUIET,
      memberId: MEMBER,
      suffix: "1",
    });
    const afterWait = outboundKey("quiet_notice", {
      quietEventId: QUIET,
      memberId: MEMBER,
      suffix: "2",
    });
    const otherOrganiser = outboundKey("quiet_notice", {
      quietEventId: QUIET,
      memberId: OTHER_MEMBER,
      suffix: "1",
    });
    expect(again).toBe(first);
    expect(new Set([first, afterWait, otherOrganiser]).size).toBe(3);
  });

  it("posts every answer to one exchange to the group, each once", () => {
    const heart = outboundKey("answer_post", { exchangeId: EXCHANGE, suffix: HEART_ANSWER });
    const voice = outboundKey("answer_post", { exchangeId: EXCHANGE, suffix: VOICE_ANSWER });
    const heartAgain = outboundKey("answer_post", { exchangeId: EXCHANGE, suffix: HEART_ANSWER });
    expect(voice).not.toBe(heart);
    expect(heartAgain).toBe(heart);
  });

  it("keeps free text from forging another key's parts", () => {
    const joined = outboundKey("system", { conversationId: "a:b", suffix: "c" });
    const split = outboundKey("system", { conversationId: "a", suffix: "b:c" });
    expect(joined).not.toBe(split);
    expect(joined.split(":")).toHaveLength(3);
    expect(split.split(":")).toHaveLength(3);
  });

  it.each<[string, OutboundKind, OutboundKeyParts]>([
    ["a member for an arrival", "arrival", { date: DATE }],
    ["a date for a repeat", "repeat", { memberId: MEMBER }],
    ["an exchange for an answer post", "answer_post", { memberId: MEMBER, suffix: HEART_ANSWER }],
    ["the answer for an answer post", "answer_post", { exchangeId: EXCHANGE }],
    [
      "a notification round for a quiet notice",
      "quiet_notice",
      { quietEventId: QUIET, memberId: MEMBER },
    ],
    ["an empty suffix", "onboarding", { conversationId: CONVERSATION, suffix: "" }],
    ["a conversation for a system message", "system", { suffix: "evt" }],
    ["an empty conversation", "consent", { conversationId: "", suffix: "evt" }],
  ])("refuses a key without %s", (_name, kind, parts) => {
    expect(() => outboundKey(kind, parts)).toThrow(RangeError);
  });

  it.each<[string, OutboundKind, OutboundKeyParts]>([
    ["a member id that is not a uuid", "arrival", { memberId: "member-1", date: DATE }],
    ["a date that is not a calendar date", "arrival", { memberId: MEMBER, date: "2026-02-30" }],
    ["a date in another format", "ack", { memberId: MEMBER, date: "16/09/2026" }],
    ["an exchange id that is not a uuid", "answer_receipt", { exchangeId: DATE }],
    [
      "a suffix on the one receipt an exchange gets",
      "answer_receipt",
      { exchangeId: EXCHANGE, suffix: HEART_ANSWER },
    ],
    [
      "a suffix on a kind named by its parts",
      "arrival",
      { memberId: MEMBER, date: DATE, suffix: "2" },
    ],
    ["an unknown kind", "postcard" as OutboundKind, ALL],
    [
      "a key longer than 200 characters",
      "system",
      { conversationId: CONVERSATION, suffix: "x".repeat(200) },
    ],
  ])("refuses %s", (_name, kind, parts) => {
    expect(() => outboundKey(kind, parts)).toThrow(RangeError);
  });

  it("fits every kind's key within the idempotency key limit with ordinary parts", () => {
    for (const kind of OUTBOUND_KINDS) {
      const suffix =
        OUTBOUND_KEY_SHAPES[kind].suffix === "required" ? "tg:123456789:welcome" : undefined;
      const key = outboundKey(kind, { ...ALL, suffix });
      expect(key.length).toBeLessThanOrEqual(OUTBOUND_KEY_MAX_LENGTH);
    }
  });
});
