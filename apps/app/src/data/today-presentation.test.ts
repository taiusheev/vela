import { describe, expect, it } from "vitest";
import type { Today, TodayExchange, TodayLight } from "./today.ts";
import { openableExchange, parentAnsweredToday, todayParentRows } from "./today-presentation.ts";

const mom: TodayLight = {
  memberId: "mom",
  displayName: "Mom",
  state: "lit",
  stateText: "Answered at 08:42",
};
const dad: TodayLight = {
  memberId: "dad",
  displayName: "Dad",
  state: "resting",
  stateText: "No answer yet",
};
function exchange(id: string, recipientId: string): TodayExchange {
  return { id, recipientId, recipient: recipientId, replies: [] };
}
function day(exchanges: TodayExchange[]): Today {
  return { lights: [mom, dad], exchanges, tomorrow: [] };
}

describe("the family inbox", () => {
  it("retains parents without an exchange and does not borrow another parent's answer", () => {
    const rows = todayParentRows(day([exchange("mom-today", "mom")]));
    expect(rows.map((row) => row.recipient)).toEqual(["Mom", "Dad"]);
    expect(rows[0]?.exchanges.map((row) => row.id)).toEqual(["mom-today"]);
    expect(rows[1]?.exchanges).toEqual([]);
    expect(rows[1]?.light).toBe(dad);
  });

  it("keeps late and current exchanges associated with their actual recipients", () => {
    const earlier = exchange("mom-earlier", "mom");
    const current = exchange("mom-current", "mom");
    const other = exchange("relative", "other");
    const rows = todayParentRows(day([earlier, other, current]));
    expect(rows.map((row) => row.recipientId)).toEqual(["mom", "dad", "other"]);
    expect(rows[0]?.exchanges).toEqual([earlier, current]);
    expect(rows[2]?.light).toBeUndefined();
    expect(rows[2]?.exchanges).toEqual([other]);
  });

  it("does not route a pending arrival to the delivered-exchange reader", () => {
    const pending = { ...exchange("pending", "mom"), deliveryPending: true as const };
    const delivered = exchange("delivered", "mom");
    const [row] = todayParentRows(day([pending, delivered]));
    expect(row).toBeDefined();
    if (row !== undefined) expect(openableExchange(row)?.id).toBe("delivered");
    const [onlyPending] = todayParentRows(day([pending]));
    if (onlyPending !== undefined) expect(openableExchange(onlyPending)).toBeUndefined();
  });

  it("lights an answered local day while keeping away or pause as a separate choice", () => {
    expect(parentAnsweredToday(mom)).toBe(true);
    expect(parentAnsweredToday(dad)).toBe(false);
    expect(parentAnsweredToday({ ...dad, state: "away", answerReceived: true })).toBe(true);
    expect(parentAnsweredToday({ ...dad, state: "paused", answerReceived: true })).toBe(true);
    expect(parentAnsweredToday({ ...mom, invited: true })).toBe(false);
  });
});
