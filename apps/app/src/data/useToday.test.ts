import { i18n } from "@lingui/core";
import {
  ApiToday,
  type ApiTodayExchange,
  ApiTomorrowTurn,
  type MemberLight,
} from "@vela/contracts";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppLocale } from "../i18n/locale.ts";
import { toToday, toTomorrowTurn } from "./useToday.ts";

// The Lingui macros compile away as the app is bundled, and nothing compiles them here. `t` stands
// in for what the macro compiles to: in English the words as written, and in Traditional Chinese
// the catalog's entry whose English has the same words around its placeholders, filled in by
// name. So a line Today builds is read here as the reader would read it, in either language.
vi.mock("@lingui/core/macro", async () => {
  const { readFileSync } = await import("node:fs");
  const { i18n: active } = await import("@lingui/core");
  const { parsePo } = await import("pofile-ts");
  const placeholder = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  const chinese = parsePo(
    readFileSync(new URL("../i18n/locales/zh-TW.po", import.meta.url), "utf8"),
  ).items.filter((item) => !item.obsolete && item.msgctxt === null);
  const wordsOf = (msgid: string): string[] => msgid.split(/\{[A-Za-z_][A-Za-z0-9_]*\}/);
  return {
    t: (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (active.locale !== "zh-TW") {
        return strings.reduce(
          (line, part, index) =>
            `${line}${part}${index < values.length ? String(values[index]) : ""}`,
          "",
        );
      }
      const entry = chinese.find(
        (item) => JSON.stringify(wordsOf(item.msgid)) === JSON.stringify([...strings]),
      );
      if (entry === undefined) {
        throw new Error(`no zh-TW entry for "${strings.join("{…}")}"`);
      }
      const names = [...entry.msgid.matchAll(placeholder)].map((match) => match[1]);
      return (entry.msgstr[0] ?? "").replace(placeholder, (_whole, name: string) =>
        String(values[names.indexOf(name)]),
      );
    },
  };
});
// Signing in is a native module; the mappers never touch it.
vi.mock("../auth/clerk.tsx", () => ({ useAccount: () => ({}) }));

// The reader's zone decides the clock time; the samples are read in Taipei.
process.env.TZ = "Asia/Taipei";

beforeAll(() => {
  i18n.load({ en: {}, "zh-TW": {} });
  i18n.activate("en");
});

function inLocale<T>(locale: AppLocale, read: () => T): T {
  i18n.activate(locale);
  try {
    return read();
  } finally {
    i18n.activate("en");
  }
}

const MOM = "4d9e2f5a-1b3c-4e6d-8f70-a1b2c3d4e5f6";
const DAD = "5e0f3a6b-2c4d-4f7e-9a81-b2c3d4e5f6a7";
const ANNA = "6f1a4b7c-3d5e-4a8f-8b92-c3d4e5f6a7b8";
const SUGGESTION = "7a2b5c8d-4e6f-4b90-9ca3-d4e5f6a7b8c9";
const ASK = "8b3c6d9e-5f7a-4ca1-8db4-e5f6a7b8c9d0";

/** A turn as the API sends it, checked against the contract so the samples cannot drift from it. */
function turn(fields: Partial<ApiTomorrowTurn> = {}): ApiTomorrowTurn {
  return ApiTomorrowTurn.parse({
    local_day: "2026-10-13",
    recipient_id: MOM,
    recipient_name: "Mom",
    holder_id: ANNA,
    holder_name: "Anna",
    ask: null,
    suggestion: {
      id: SUGGESTION,
      text: "What seeds did you save from last year's garden?",
      type: "story",
      from_her_words: true,
    },
    turn_pending: false,
    ...fields,
  });
}

describe("tomorrow's turn", () => {
  it("keeps the suggestion's id, kind and origin, and whose morning it is for", () => {
    expect(toTomorrowTurn(turn())).toEqual({
      recipientId: MOM,
      recipient: "Mom",
      name: "Anna",
      mine: false,
      pending: false,
      suggestion: {
        id: SUGGESTION,
        text: "What seeds did you save from last year's garden?",
        type: "story",
        fromHerWords: true,
      },
    });
  });

  it("says a bank suggestion is not from her words", () => {
    const bank = turn({
      suggestion: {
        id: SUGGESTION,
        text: "Teach me a saying.",
        type: "word",
        from_her_words: false,
      },
    });
    expect(toTomorrowTurn(bank).suggestion).toEqual({
      id: SUGGESTION,
      text: "Teach me a saying.",
      type: "word",
      fromHerWords: false,
    });
  });

  it("is pending until the evening prompt chooses a holder", () => {
    const pending = toTomorrowTurn(
      turn({ holder_id: null, holder_name: null, turn_pending: true }),
      ANNA,
    );
    expect(pending).toMatchObject({ pending: true, mine: false, recipientId: MOM });
  });

  it("is the reader's own turn when they hold it", () => {
    expect(toTomorrowTurn(turn(), ANNA).mine).toBe(true);
    expect(toTomorrowTurn(turn(), DAD).mine).toBe(false);
  });

  it("offers no suggestion when the API sends none", () => {
    expect(toTomorrowTurn(turn({ suggestion: null }))).not.toHaveProperty("suggestion");
  });

  it("shows the ask that claimed the morning", () => {
    const claimed = toTomorrowTurn(
      turn({
        suggestion: null,
        ask: {
          id: ASK,
          type: "question",
          text: " What did you plant? ",
          asker_name: "Anna",
          on_behalf_of: null,
        },
      }),
    );
    expect(claimed.asked).toEqual({ by: "Anna", text: "What did you plant?" });
    expect(claimed).not.toHaveProperty("suggestion");
  });
});

describe("Today", () => {
  it("keeps one tomorrow for each person whose morning is coming", () => {
    const day = ApiToday.parse({
      lights: [],
      exchanges: [],
      tomorrow: [turn(), turn({ recipient_id: DAD, recipient_name: "Dad", suggestion: null })],
    });
    expect(toToday(day).tomorrow.map((next) => [next.recipientId, next.recipient])).toEqual([
      [MOM, "Mom"],
      [DAD, "Dad"],
    ]);
  });

  it("has no tomorrow when nobody's morning holds anything", () => {
    expect(toToday(ApiToday.parse({ lights: [], exchanges: [], tomorrow: [] })).tomorrow).toEqual(
      [],
    );
  });
});

const EXCHANGE = "9c4d7e0f-6a8b-4db2-9ec5-f6a7b8c9d0e1";
const TWO_THIRTY_TWO = "2026-10-12T06:32:00Z"; // 14:32 in Taipei

function light(fields: Partial<MemberLight> = {}): MemberLight {
  return {
    member_id: MOM,
    display_name: "Mom",
    state: "resting",
    answered_at: null,
    usual_time: "08:00",
    away_until: null,
    quiet_event_id: null,
    ...fields,
  };
}

function exchange(fields: Partial<ApiTodayExchange> = {}): ApiTodayExchange {
  return {
    id: EXCHANGE,
    recipient_id: MOM,
    recipient_name: "Mom",
    asker_name: "Anna",
    on_behalf_of: null,
    type: "question",
    ask: "What did you plant?",
    answer: null,
    replies: [],
    seen_at: null,
    replies_reach_her: true,
    ...fields,
  };
}

/** Today's card, as the reader sees it in each language. */
function cardIn(locale: AppLocale, lights: MemberLight[], card: ApiTodayExchange) {
  return inLocale(
    locale,
    () => toToday(ApiToday.parse({ lights, exchanges: [card], tomorrow: [] }), ANNA).exchange,
  );
}

// Flows §3.9: an answer counts for the local date it arrives on, whichever exchange it attaches
// to. Her tap today on yesterday's arrival, or her message before today's arrival, lights her day
// while today's ask has no answer of its own, so the lights row reads "answered 14:32" above it.
describe("Today's card while its ask has no answer", () => {
  it.each(["lit", "away"] as const)(
    "says she answered an earlier ask, never that she sent no word today, when her day is answered (%s)",
    (state) => {
      const lights = [light({ state, answered_at: TWO_THIRTY_TWO })];
      expect(cardIn("en", lights, exchange())?.unanswered).toBe(
        "Mom answered an earlier ask at 14:32. This one has no answer yet.",
      );
      expect(cardIn("zh-TW", lights, exchange())?.unanswered).toBe(
        "Mom在 14:32 回覆了之前的提問，這則提問還沒有回覆。",
      );
    },
  );

  it("says no word yet today while her day has no answer", () => {
    const lights = [light({ state: "quiet" })];
    expect(cardIn("en", lights, exchange())?.unanswered).toBe("No word yet today.");
    expect(cardIn("zh-TW", lights, exchange())?.unanswered).toBe("今天還沒有回覆。");
  });

  it("reads the day of the person the ask is for, not the first light in the row", () => {
    const lights = [
      light({ member_id: DAD, display_name: "Dad", state: "lit", answered_at: TWO_THIRTY_TWO }),
      light(),
    ];
    expect(cardIn("en", lights, exchange())?.unanswered).toBe("No word yet today.");
  });

  it("has no such line once the ask has her answer", () => {
    const answered = exchange({
      answer: { kind: "text", text: "Beans.", at: TWO_THIRTY_TWO },
    });
    const card = cardIn("en", [light({ state: "lit", answered_at: TWO_THIRTY_TWO })], answered);
    expect(card?.answer).toEqual({ text: "Beans.", at: "14:32" });
    expect(card).not.toHaveProperty("unanswered");
  });
});
