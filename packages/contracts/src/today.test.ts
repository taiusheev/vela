import { describe, expect, it } from "vitest";
import { ApiToday, ApiTodayExchange, ApiTomorrowTurn } from "./index.ts";

const MEMBER = "0198f6aa-0000-7000-8000-000000000001";
const ASKER = "0198f6aa-0000-7000-8000-000000000002";
const EXCHANGE = "0198f6aa-0000-7000-8000-000000000003";
const SUGGESTION = "0198f6aa-0000-7000-8000-000000000004";

const light = {
  member_id: MEMBER,
  display_name: "Mom",
  state: "lit",
  answered_at: "2026-09-23T08:12:00+08:00",
  usual_time: "08:00",
  away_until: null,
  quiet_event_id: null,
};

const exchange = {
  id: EXCHANGE,
  recipient_id: MEMBER,
  recipient_name: "Mom",
  asker_name: "Mia",
  on_behalf_of: null,
  type: "question",
  ask: "What did the garden look like this morning?",
  answer: {
    kind: "text",
    text: "The tomatoes finally turned.",
    at: "2026-09-23T08:12:00+08:00",
  },
  replies: [
    { from: "Mia", kind: "heart", text: null },
    { from: "Anna", kind: "text", text: "Those are the seeds you saved" },
  ],
  seen_at: "2026-09-23T08:10:00+08:00",
  replies_reach_her: true,
};

const turn = {
  local_day: "2026-09-24",
  recipient_id: MEMBER,
  recipient_name: "Mom",
  holder_id: ASKER,
  holder_name: "Anna",
  ask: null,
  suggestion: { id: SUGGESTION, text: "Ask her about the seeds she saved" },
};

describe("ApiTodayExchange", () => {
  it("accepts a whole day: the ask, her words, the replies in order and the receipt", () => {
    expect(ApiTodayExchange.parse(exchange)).toStrictEqual(exchange);
  });

  it("accepts a hello, which has no asker, no question and nothing said back yet", () => {
    const hello = {
      ...exchange,
      asker_name: null,
      type: "hello",
      ask: null,
      answer: null,
      replies: [],
      seen_at: null,
    };
    expect(ApiTodayExchange.parse(hello)).toStrictEqual(hello);
  });

  it("accepts an answer that carried no words, so the reader names the tap", () => {
    for (const kind of ["heart", "fine", "photo_pick", "vote", "voice"]) {
      const wordless = { ...exchange, answer: { ...exchange.answer, kind, text: null } };
      expect(ApiTodayExchange.parse(wordless)).toStrictEqual(wordless);
    }
  });

  it("rejects malformed ids, kinds and timestamps", () => {
    for (const invalid of [
      { id: "not-a-uuid" },
      { recipient_id: "not-a-uuid" },
      { type: "gossip" },
      { seen_at: "2026-09-23T08:10:00" },
      { answer: { ...exchange.answer, kind: "shrug" } },
      { answer: { ...exchange.answer, at: "2026-09-23" } },
      { replies: [{ from: "Mia", kind: "shrug", text: null }] },
      { replies: [{ kind: "heart", text: null }] },
    ]) {
      expect(ApiTodayExchange.safeParse({ ...exchange, ...invalid }).success).toBe(false);
    }
  });

  it("requires nullable fields to be present rather than silently defaulting them", () => {
    for (const field of Object.keys(exchange)) {
      const incomplete = Object.fromEntries(
        Object.entries(exchange).filter(([key]) => key !== field),
      );
      expect(ApiTodayExchange.safeParse(incomplete).success, field).toBe(false);
    }
  });

  it("returns only the day's fields, never what else the row holds about her", () => {
    expect(
      ApiTodayExchange.parse({ ...exchange, mood_words: ["tired"], flag_reason: "health" }),
    ).toStrictEqual(exchange);
  });
});

describe("ApiTomorrowTurn", () => {
  it("accepts a turn with its holder and the suggestion waiting for them", () => {
    expect(ApiTomorrowTurn.parse(turn)).toStrictEqual(turn);
  });

  it("accepts a turn nobody holds and one with nothing suggested yet", () => {
    const open = { ...turn, holder_id: null, holder_name: null, suggestion: null };
    expect(ApiTomorrowTurn.parse(open)).toStrictEqual(open);
  });

  it("accepts a claimed morning, which carries the ask instead of a suggestion", () => {
    const claimed = {
      ...turn,
      ask: {
        id: EXCHANGE,
        type: "question",
        text: "What did the garden look like this morning?",
        asker_name: "Anna",
        on_behalf_of: null,
      },
      suggestion: null,
    };
    expect(ApiTomorrowTurn.parse(claimed)).toStrictEqual(claimed);
  });

  it("requires the ask to be present, so a claimed morning cannot read as a free one", () => {
    const incomplete = Object.fromEntries(Object.entries(turn).filter(([k]) => k !== "ask"));
    expect(ApiTomorrowTurn.safeParse(incomplete).success).toBe(false);
  });

  it("rejects a day that is not a calendar date and a suggestion without its id", () => {
    for (const invalid of [
      { local_day: "2026-09-31" },
      { local_day: "2026-09-24T00:00:00Z" },
      { suggestion: { text: "Ask her about the seeds she saved" } },
      { holder_id: "not-a-uuid" },
    ]) {
      expect(ApiTomorrowTurn.safeParse({ ...turn, ...invalid }).success).toBe(false);
    }
  });
});

describe("ApiToday", () => {
  it("accepts a family's whole day, and an empty one", () => {
    const day = { lights: [light], exchanges: [exchange], tomorrow: [turn] };
    expect(ApiToday.parse(day)).toStrictEqual(day);
    const quiet = { lights: [], exchanges: [], tomorrow: [] };
    expect(ApiToday.parse(quiet)).toStrictEqual(quiet);
  });

  it("requires all three lists, so a missing one cannot read as an empty day", () => {
    for (const field of ["lights", "exchanges", "tomorrow"]) {
      const day: Record<string, unknown> = {
        lights: [light],
        exchanges: [exchange],
        tomorrow: [turn],
      };
      delete day[field];
      expect(ApiToday.safeParse(day).success, field).toBe(false);
    }
  });
});
