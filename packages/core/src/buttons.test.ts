import { describe, expect, it } from "vitest";
import {
  BUTTON_DATA_MAX_BYTES,
  type ButtonAction,
  decodeButton,
  encodeButton,
  isUuid,
  MAX_BUTTON_INDEX,
} from "./buttons.ts";

/** mulberry32: a small seeded generator, so every run tests the same thousands of actions. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("pick from an empty list");
  }
  return item;
}

function hex(random: () => number, digits: number): string {
  let out = "";
  for (let i = 0; i < digits; i += 1) {
    out += Math.floor(random() * 16).toString(16);
  }
  return out;
}

/** A uuidv7 as Postgres writes it: 48-bit milliseconds, version 7, variant 10. */
function uuidv7(random: () => number): string {
  const millis = Math.floor(1_780_000_000_000 + random() * 1_000_000_000_000)
    .toString(16)
    .padStart(12, "0");
  const variant = pick(random, ["8", "9", "a", "b"]);
  return `${millis.slice(0, 8)}-${millis.slice(8, 12)}-7${hex(random, 3)}-${variant}${hex(random, 3)}-${hex(random, 12)}`;
}

function text(random: () => number, alphabet: string, min: number, max: number): string {
  const length = min + Math.floor(random() * (max - min + 1));
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += pick(random, [...alphabet]);
  }
  return out;
}

const STEP_REST = "abcdefghijklmnopqrstuvwxyz0123456789_";
const VALUE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+-./:";

function randomAction(random: () => number): ButtonAction {
  const index = Math.floor(random() * (MAX_BUTTON_INDEX + 1));
  switch (
    pick(random, ["answer", "chip", "pick", "vote", "consent", "fine", "wait", "onboarding"])
  ) {
    case "answer":
      return {
        type: "answer",
        exchangeId: uuidv7(random),
        answer: pick(random, ["fine", "heart"]),
      };
    case "chip":
      return { type: "chip", exchangeId: uuidv7(random), index };
    case "pick":
      return { type: "pick", exchangeId: uuidv7(random), index };
    case "vote":
      return { type: "vote", exchangeId: uuidv7(random), index };
    case "consent":
      return { type: "consent", memberId: uuidv7(random), accept: random() < 0.5 };
    case "fine":
      return { type: "quiet_fine", quietEventId: uuidv7(random) };
    case "wait":
      return { type: "quiet_wait", quietEventId: uuidv7(random) };
    default:
      return {
        type: "onboarding",
        step: text(random, "abcdefghijklmnopqrstuvwxyz", 1, 1) + text(random, STEP_REST, 0, 15),
        value: text(random, VALUE_ALPHABET, 1, 45),
      };
  }
}

const utf8 = new TextEncoder();

function bytes(value: string): number {
  return utf8.encode(value).length;
}

const EXCHANGE = "01920f3e-7a4b-7c5d-8e9f-0a1b2c3d4e5f";

describe("encodeButton and decodeButton", () => {
  const random = seeded(20260913);
  const actions = Array.from({ length: 5000 }, () => randomAction(random));

  it("round-trips thousands of generated actions with real uuidv7 ids", () => {
    for (const action of actions) {
      expect(decodeButton(encodeButton(action))).toEqual(action);
    }
  });

  it("never exceeds 64 bytes, including the longest onboarding step and value", () => {
    for (const action of actions) {
      expect(bytes(encodeButton(action))).toBeLessThanOrEqual(BUTTON_DATA_MAX_BYTES);
    }
    const longest = encodeButton({
      type: "onboarding",
      step: "a".repeat(16),
      value: "America/Argentina/Buenos_Aires/".padEnd(45, "x"),
    });
    expect(bytes(longest)).toBe(BUTTON_DATA_MAX_BYTES);
  });

  it("gives different actions different payloads", () => {
    const byPayload = new Map<string, string>();
    for (const action of actions) {
      const payload = encodeButton(action);
      const described = JSON.stringify(action);
      const previous = byPayload.get(payload);
      if (previous !== undefined) {
        expect(described).toBe(previous);
      }
      byPayload.set(payload, described);
    }
  });

  it("keeps id-bearing payloads compact", () => {
    expect(encodeButton({ type: "chip", exchangeId: EXCHANGE, index: 2 })).toBe(
      "c:01920f3e7a4b7c5d8e9f0a1b2c3d4e5f:2",
    );
    expect(encodeButton({ type: "quiet_wait", quietEventId: EXCHANGE })).toHaveLength(36);
  });

  it("encodes an id written in upper case the same way and decodes it in lower case", () => {
    const upper = { type: "pick", exchangeId: EXCHANGE.toUpperCase(), index: 1 } as const;
    const payload = encodeButton(upper);
    expect(payload).toBe(encodeButton({ ...upper, exchangeId: EXCHANGE }));
    expect(decodeButton(payload)).toEqual({ type: "pick", exchangeId: EXCHANGE, index: 1 });
  });

  it("decodes only the payload it would encode, for thousands of mutated payloads", () => {
    const mutate = seeded(7);
    const noise = `${VALUE_ALPHABET}ABCDEF: é停`;
    for (const action of actions.slice(0, 2000)) {
      const payload = encodeButton(action);
      const at = Math.floor(mutate() * (payload.length + 1));
      const variants = [
        payload.slice(0, at) + pick(mutate, [...noise]) + payload.slice(at + 1),
        payload.slice(0, at) + pick(mutate, [...noise]) + payload.slice(at),
        payload.slice(0, at) + payload.slice(at + 1),
      ];
      for (const variant of variants) {
        const decoded = decodeButton(variant);
        if (decoded !== null) {
          expect(encodeButton(decoded)).toBe(variant);
        }
      }
    }
  });
});

describe("decodeButton rejects", () => {
  const id = EXCHANGE.replaceAll("-", "");

  it.each([
    ["an empty payload", ""],
    ["a payload with no separators", "hello"],
    ["a payload with one separator", `c:${id}`],
    ["an unknown code", `x:${id}:1`],
    ["a multi-letter code", `cc:${id}:1`],
    ["an unknown answer", `a:${id}:x`],
    ["an unknown consent value", `k:${id}:yes`],
    ["an unknown quiet action", `q:${id}:later`],
    ["a trailing field", `c:${id}:1:2`],
    ["an empty index", `c:${id}:`],
    ["a two-digit index", `v:${id}:10`],
    ["a padded index", `p:${id}:01`],
    ["a negative index", `c:${id}:-1`],
    ["a non-numeric index", `c:${id}:x`],
    ["a dashed id", `c:${EXCHANGE}:1`],
    ["an upper-case id", `c:${id.toUpperCase()}:1`],
    ["a short id", `c:${id.slice(1)}:1`],
    ["a long id", `c:${id}0:1`],
    ["an id that is not hex", `c:${id.slice(0, 31)}g:1`],
    ["an id with version 0", `c:${id.slice(0, 12)}0${id.slice(13)}:1`],
    ["an id with version 9", `c:${id.slice(0, 12)}9${id.slice(13)}:1`],
    ["an id with the wrong variant", `c:${id.slice(0, 16)}c${id.slice(17)}:1`],
    ["the nil uuid", `a:${"0".repeat(32)}:f`],
    ["an onboarding step in upper case", "o:Language:en"],
    ["an onboarding step that starts with a digit", "o:1step:en"],
    ["an empty onboarding step", "o::en"],
    ["an empty onboarding value", "o:language:"],
    ["an onboarding value with a space", "o:country:United States"],
    ["an onboarding value with non-ASCII text", "o:language:繁體中文"],
    ["an over-long onboarding step", `o:${"a".repeat(17)}:en`],
    ["an over-long onboarding value", `o:zone:${"a".repeat(46)}`],
    ["anything longer than 64 bytes", `o:${"a".repeat(16)}:${"b".repeat(46)}`],
  ])("%s", (_name, payload) => {
    expect(decodeButton(payload)).toBeNull();
  });
});

describe("encodeButton refuses invalid actions", () => {
  it.each<[string, ButtonAction]>([
    ["a non-uuid exchange id", { type: "chip", exchangeId: "exchange-1", index: 0 }],
    ["a non-uuid member id", { type: "consent", memberId: "", accept: true }],
    ["a non-uuid quiet event id", { type: "quiet_fine", quietEventId: "12345" }],
    ["a negative index", { type: "chip", exchangeId: EXCHANGE, index: -1 }],
    [
      "an index above the maximum",
      { type: "vote", exchangeId: EXCHANGE, index: MAX_BUTTON_INDEX + 1 },
    ],
    ["a fractional index", { type: "pick", exchangeId: EXCHANGE, index: 0.5 }],
    ["an onboarding step with a separator", { type: "onboarding", step: "a:b", value: "en" }],
    [
      "an onboarding value with a space",
      { type: "onboarding", step: "country", value: "New Zealand" },
    ],
    ["an over-long onboarding value", { type: "onboarding", step: "zone", value: "x".repeat(46) }],
  ])("%s", (_name, action) => {
    expect(() => encodeButton(action)).toThrow(RangeError);
  });
});

describe("isUuid", () => {
  it("accepts RFC 9562 uuids and refuses anything else", () => {
    expect(isUuid(EXCHANGE)).toBe(true);
    expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
    expect(isUuid(EXCHANGE.replaceAll("-", ""))).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isUuid(`${EXCHANGE}\n`)).toBe(false);
  });
});
