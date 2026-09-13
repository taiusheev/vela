import { describe, expect, it } from "vitest";
import { nextTurnHolder, type TurnHolder } from "./turns.ts";

function joined(day: number): Date {
  return new Date(Date.UTC(2026, 8, day, 9, 0));
}

const ANNA: TurnHolder = { memberId: "anna", joinedAt: joined(1) };
const SAM: TurnHolder = { memberId: "sam", joinedAt: joined(2) };
const MIA: TurnHolder = { memberId: "mia", joinedAt: joined(3) };
const LEO: TurnHolder = { memberId: "leo", joinedAt: joined(4) };

describe("nextTurnHolder", () => {
  it("has no holder when nobody holds turns", () => {
    expect(nextTurnHolder([], null)).toBeNull();
    expect(nextTurnHolder([], "anna")).toBeNull();
  });

  it("starts with whoever joined first", () => {
    expect(nextTurnHolder([MIA, ANNA, SAM], null)).toBe("anna");
  });

  it("passes the turn to the next person in join order, whatever order holders are listed in", () => {
    expect(nextTurnHolder([MIA, SAM, ANNA], "anna")).toBe("sam");
    expect(nextTurnHolder([SAM, ANNA, MIA], "sam")).toBe("mia");
  });

  it("wraps from the last to join back to the first", () => {
    expect(nextTurnHolder([ANNA, SAM, MIA], "mia")).toBe("anna");
  });

  it("skips nobody over a full rotation", () => {
    const holders = [LEO, MIA, SAM, ANNA];
    const sequence: string[] = [];
    let previous: string | null = null;
    for (let day = 0; day < 8; day += 1) {
      previous = nextTurnHolder(holders, previous);
      sequence.push(previous ?? "none");
    }
    expect(sequence).toEqual(["anna", "sam", "mia", "leo", "anna", "sam", "mia", "leo"]);
  });

  it("gives the only holder every turn", () => {
    expect(nextTurnHolder([SAM], "sam")).toBe("sam");
    expect(nextTurnHolder([SAM], null)).toBe("sam");
  });

  it("orders people who joined in the same instant by member id", () => {
    const b = { memberId: "b", joinedAt: joined(5) };
    const a = { memberId: "a", joinedAt: joined(5) };
    expect(nextTurnHolder([b, a], null)).toBe("a");
    expect(nextTurnHolder([b, a], "a")).toBe("b");
    expect(nextTurnHolder([a, b], "b")).toBe("a");
  });

  it("passes the turn to whoever joined next when the previous holder has left", () => {
    expect(nextTurnHolder([ANNA, MIA, LEO], "sam", SAM.joinedAt)).toBe("mia");
    expect(nextTurnHolder([ANNA, SAM, MIA], "leo", LEO.joinedAt)).toBe("anna");
  });

  it("restarts from the first holder when the previous holder has left and their join time is unknown", () => {
    expect(nextTurnHolder([MIA, ANNA, LEO], "sam")).toBe("anna");
    expect(nextTurnHolder([MIA, ANNA, LEO], "sam")).toBe(nextTurnHolder([LEO, MIA, ANNA], "sam"));
  });

  it("ignores the given join time when the previous holder is still present", () => {
    expect(nextTurnHolder([ANNA, SAM, MIA], "anna", joined(30))).toBe("sam");
  });

  it("does not reorder the caller's list", () => {
    const holders = [MIA, ANNA, SAM];
    nextTurnHolder(holders, "anna");
    expect(holders).toEqual([MIA, ANNA, SAM]);
  });
});
