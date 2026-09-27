import { describe, expect, it } from "vitest";
import { ApiToday, ApiTodayExchange, ApiTomorrowTurn, ComposeAsk } from "./index.ts";

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
    picked_media_id: null,
  },
  replies: [
    { from: "Mia", kind: "heart", text: null },
    { from: "Anna", kind: "text", text: "Those are the seeds you saved" },
  ],
  seen_at: "2026-09-23T08:10:00+08:00",
  replies_reach_her: true,
  photos: [],
};

const turn = {
  local_day: "2026-09-24",
  recipient_id: MEMBER,
  recipient_name: "Mom",
  holder_id: ASKER,
  holder_name: "Anna",
  ask: null,
  suggestion: {
    id: SUGGESTION,
    text: "What seeds did you save from last year's garden?",
    type: "question",
    from_her_words: true,
  },
  turn_pending: false,
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

  it("accepts a day before its evening prompt: no holder yet, and the bank's suggestion", () => {
    const pending = {
      ...turn,
      holder_id: null,
      holder_name: null,
      suggestion: {
        id: SUGGESTION,
        text: "Tell me about your grandparents.",
        type: "story",
        from_her_words: false,
      },
      turn_pending: true,
    };
    expect(ApiTomorrowTurn.parse(pending)).toStrictEqual(pending);
  });

  it("requires whether the turn is pending and where a suggestion came from", () => {
    const { turn_pending: _pending, ...noPending } = turn;
    expect(ApiTomorrowTurn.safeParse(noPending).success).toBe(false);
    for (const field of ["type", "from_her_words"]) {
      const suggestion = Object.fromEntries(
        Object.entries(turn.suggestion).filter(([key]) => key !== field),
      );
      expect(ApiTomorrowTurn.safeParse({ ...turn, suggestion }).success, field).toBe(false);
    }
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

  it("rejects a day that is not a calendar date, and a suggestion without its id, words or type", () => {
    for (const invalid of [
      { local_day: "2026-09-31" },
      { local_day: "2026-09-24T00:00:00Z" },
      { suggestion: { ...turn.suggestion, id: undefined } },
      { suggestion: { ...turn.suggestion, text: "" } },
      { suggestion: { ...turn.suggestion, type: "gossip" } },
      { holder_id: "not-a-uuid" },
    ]) {
      expect(ApiTomorrowTurn.safeParse({ ...turn, ...invalid }).success).toBe(false);
    }
  });
});

describe("ComposeAsk", () => {
  const ask = {
    recipient_id: MEMBER,
    type: "question",
    text: "What seeds did you save from last year's garden?",
    when: "tomorrow",
  };

  it("takes an ask on its own, and one that says which suggestion it started from", () => {
    expect(ComposeAsk.parse(ask)).toStrictEqual(ask);
    const used = { ...ask, suggestion_id: SUGGESTION };
    expect(ComposeAsk.parse(used)).toStrictEqual(used);
  });

  it("refuses a suggestion id that is not an id", () => {
    for (const id of ["not-a-uuid", "", null, 7]) {
      expect(ComposeAsk.safeParse({ ...ask, suggestion_id: id }).success, String(id)).toBe(false);
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
