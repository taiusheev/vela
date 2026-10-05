import { EXCHANGE_STATES, type ExchangeState } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { IllegalTransitionError } from "./errors.ts";
import { canApply, EXCHANGE_EVENTS, type ExchangeEvent, nextExchangeState } from "./exchange.ts";

/**
 * The transition table of code design §5, copied cell for cell. A dash is illegal; `=` keeps the
 * state. Written out independently of the implementation so a changed cell fails here.
 */
const TABLE = `
            schedule   deliver    see        answer     reply      read_back  archive    withdraw
composed    scheduled  -          -          -          -          -          -          withdrawn
scheduled   =          delivered  -          -          -          -          -          withdrawn
delivered   -          =          seen       answered   -          -          archived   -
seen        -          -          =          answered   -          -          archived   -
answered    -          -          =          =          replied    read_back  archived   -
replied     -          -          =          =          =          read_back  archived   -
read_back   -          -          =          =          =          =          archived   -
archived    -          -          =          =          =          =          =          -
withdrawn   -          -          -          -          -          -          -          =
`;

interface Cell {
  state: ExchangeState;
  event: ExchangeEvent;
  expected: ExchangeState | null;
}

function parseTable(table: string): { events: string[]; states: string[]; cells: Cell[] } {
  const [header, ...rows] = table
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const events = header ?? [];
  const states: string[] = [];
  const cells: Cell[] = [];
  for (const [state, ...targets] of rows) {
    if (state === undefined) {
      continue;
    }
    states.push(state);
    targets.forEach((target, column) => {
      const event = events[column];
      if (event === undefined) {
        throw new Error(`row ${state} has more cells than the header`);
      }
      cells.push({
        state: state as ExchangeState,
        event: event as ExchangeEvent,
        expected:
          target === "-"
            ? null
            : target === "="
              ? (state as ExchangeState)
              : (target as ExchangeState),
      });
    });
  }
  return { events, states, cells };
}

const { events, states, cells } = parseTable(TABLE);

describe("the exchange transition table", () => {
  it("covers every state and every event exactly once", () => {
    expect(states).toEqual([...EXCHANGE_STATES]);
    expect(events).toEqual([...EXCHANGE_EVENTS]);
    expect(cells).toHaveLength(EXCHANGE_STATES.length * EXCHANGE_EVENTS.length);
  });

  describe.each(cells.filter((cell) => cell.expected !== null))(
    "from $state on $event",
    ({ state, event, expected }) => {
      it(`moves to ${expected}`, () => {
        expect(canApply(state, event)).toBe(true);
        expect(nextExchangeState(state, event)).toBe(expected);
      });
    },
  );

  describe.each(cells.filter((cell) => cell.expected === null))(
    "from $state on $event",
    ({ state, event }) => {
      it("is illegal and throws an IllegalTransitionError naming both", () => {
        expect(canApply(state, event)).toBe(false);
        let thrown: unknown;
        try {
          nextExchangeState(state, event);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(IllegalTransitionError);
        expect(thrown).toMatchObject({ name: "IllegalTransitionError", from: state, event });
      });
    },
  );
});

describe("exchange lifecycle", () => {
  it("walks the whole happy path from composed to archived", () => {
    const path: ExchangeEvent[] = ["schedule", "deliver", "see", "answer", "reply", "read_back"];
    let state: ExchangeState = "composed";
    for (const event of path) {
      state = nextExchangeState(state, event);
    }
    expect(state).toBe("read_back");
    expect(nextExchangeState(state, "archive")).toBe("archived");
  });

  it("allows withdrawal only before delivery", () => {
    const withdrawable = EXCHANGE_STATES.filter((state) => canApply(state, "withdraw"));
    expect(withdrawable).toEqual(["composed", "scheduled", "withdrawn"]);
  });

  it("treats a state or event that names an Object.prototype member as illegal", () => {
    expect(canApply("constructor" as ExchangeState, "schedule")).toBe(false);
    expect(canApply("composed", "toString" as ExchangeEvent)).toBe(false);
    expect(() => nextExchangeState("answered", "hasOwnProperty" as ExchangeEvent)).toThrow(
      IllegalTransitionError,
    );
  });
});
