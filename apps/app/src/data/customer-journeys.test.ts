import type { ApiFamily } from "@vela/contracts";
import { describe, expect, it, vi } from "vitest";
import { acceptedAsk } from "./ask-outcome.tsx";
import { exchangeFamily } from "./exchange-family.ts";
import { toYouFamily } from "./family.ts";
import { type Membership, selectedMembership } from "./membership.ts";
import { selectedLight } from "./selected-light.ts";
import type { TodayLight } from "./today.ts";

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | { message: string }) => ({
    id: "message" in strings ? strings.message : strings.join(""),
  }),
  t: (strings: TemplateStringsArray | { message: string }, ...values: unknown[]) =>
    "message" in strings
      ? strings.message
      : strings.reduce(
          (line, part, index) => line + part + (index < values.length ? String(values[index]) : ""),
          "",
        ),
}));
const mom: TodayLight = {
  memberId: "mom",
  displayName: "Mom",
  state: "paused",
  stateText: "paused",
};
const dad: TodayLight = {
  memberId: "dad",
  displayName: "Dad",
  state: "resting",
  stateText: "resting",
};
const first: Membership = {
  member_id: "me-1",
  role: "organiser",
  status: "active",
  family: { id: "f1", name: "One", region: "apac", plan: "free" },
};
const second: Membership = {
  ...first,
  member_id: "me-2",
  role: "member",
  family: { ...first.family, id: "f2", name: "Two" },
};

describe("customer journeys across families and parents", () => {
  it("selects the chosen family's own membership and never carries organiser privileges across it", () => {
    expect(selectedMembership([first, second], "f2")).toBe(second);
    expect(selectedMembership([first, second], undefined)).toBe(first);
    expect(selectedMembership([first], "f2")).toBe(first);
    expect(selectedMembership([], "f2")).toBeUndefined();
  });
  it("keeps an explicit paused parent's identity and refuses unknown links", () => {
    expect(selectedLight([mom, dad], "mom")).toBe(mom);
    expect(selectedLight([mom, dad], "dad")).toBe(dad);
    expect(selectedLight([mom, dad], "someone-else")).toBeUndefined();
    expect(selectedLight([], undefined)).toBeUndefined();
  });
  it("does not upload or play cold-linked exchange media under another family's identity", () => {
    expect(exchangeFamily("f1", [mom], "dad")).toBeUndefined();
    expect(exchangeFamily("f2", [dad], "dad")).toBe("f2");
    expect(exchangeFamily("f2", [dad], undefined)).toBeUndefined();
    expect(exchangeFamily(undefined, [dad], "dad")).toBeUndefined();
  });
  it("confirms the server's recipient and date, including a queued ask without a date", () => {
    const result = acceptedAsk({
      family_id: "f2",
      recipient_name: "Dad",
      scheduled_for: "2026-10-09",
    });
    expect(result).toEqual({ familyId: "f2", recipient: "Dad", date: "2026-10-09", demo: false });
    expect(
      acceptedAsk({ family_id: "f1", recipient_name: "Mom", scheduled_for: null }).date,
    ).toBeNull();
  });
  it("shows nearby contacts and their consent under the parent they belong to", () => {
    const family: ApiFamily = {
      family: { id: "f1", name: "Family", plan: "free" },
      me: { member_id: "me", role: "organiser" },
      told_if_quiet: null,
      members: [
        {
          member_id: "me",
          display_name: "Anna",
          role: "organiser",
          status: "active",
          light: "off",
          subscription: null,
        },
        ...["mom", "dad"].map((member_id) => ({
          member_id,
          display_name: member_id,
          role: "member" as const,
          status: "active" as const,
          light: "on" as const,
          subscription: null,
        })),
      ],
      nearby: [
        { id: "c1", near_member_id: "mom", name: "Lena", relation: null, consent: "yes" },
        { id: "c2", near_member_id: "dad", name: "Wei", relation: null, consent: "waiting" },
      ],
    };
    const view = toYouFamily(family, undefined);
    expect(view.keptLight[0]?.nearby).toEqual({ names: "Nearby: Lena", line: "Said yes" });
    expect(view.keptLight[1]?.nearby).toEqual({
      names: "Nearby: Wei",
      line: "Wei has not said yes yet",
    });
    expect(
      toYouFamily({ ...family, nearby: null }, undefined).keptLight.every(
        (parent) => parent.nearby === undefined,
      ),
    ).toBe(true);
  });
});
