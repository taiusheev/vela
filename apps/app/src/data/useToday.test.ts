import { ApiToday, ApiTomorrowTurn } from "@vela/contracts";
import { describe, expect, it, vi } from "vitest";
import { toToday, toTomorrowTurn } from "./useToday.ts";

// The Lingui macros compile away as the app is bundled, and nothing compiles them here, so `t`
// reads its English as written: these tests are about what Today keeps, not its words.
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (line, part, index) => `${line}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));
// Signing in is a native module; the mappers never touch it.
vi.mock("../auth/clerk.tsx", () => ({ useAccount: () => ({}) }));

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
