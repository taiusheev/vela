import { describe, expect, it, vi } from "vitest";
import type { PushView } from "../push/provider.tsx";
import { momentLine, nobodyTellsLine, phoneLine, toldOfQuiet } from "./notifications.ts";

// The macro compiles away as the app is bundled; here `t` gives the English as written, which is
// what these tests read (the catalog tests hold every zh-TW entry to its rules).
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (line, part, index) => `${line}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));
// The screens' provider is only a type here; nothing of the phone is loaded.
vi.mock("../push/provider.tsx", () => ({}));

type Phone = Pick<PushView, "availability" | "phone" | "trouble">;
const available = { available: true, projectId: "project" } as const;

function phone(patch: Partial<NonNullable<Phone["phone"]>>, trouble = false): Phone {
  return {
    availability: available,
    phone: { permission: "granted", canAskAgain: true, quietChannelBlocked: false, ...patch },
    trouble,
  };
}

describe("what You says about this phone", () => {
  it("says a browser and a build without push get no notifications (A1)", () => {
    expect(
      phoneLine({ availability: { available: false, reason: "web" }, phone: null, trouble: false }),
    ).toBe("Notifications come to the Vela app on a phone, not to a browser.");
    for (const reason of ["expo_go", "no_project"] as const) {
      expect(
        phoneLine({ availability: { available: false, reason }, phone: null, trouble: false }),
      ).toBe("Notifications are not available in this build of the app.");
    }
  });

  it("says on only while notifications are allowed and the quiet channel is not blocked", () => {
    expect(phoneLine(phone({}))).toBe("Notifications are on.");
    expect(phoneLine(phone({ quietChannelBlocked: true }))).toContain("switched off for Vela");
    expect(phoneLine(phone({ permission: "provisional" }))).toBe("Notifications are off.");
    expect(phoneLine(phone({ permission: "denied", canAskAgain: false }))).toBe(
      "Notifications are off in this phone's settings.",
    );
  });

  it("says when this phone could not be set up, rather than that it is on", () => {
    expect(phoneLine(phone({}, true))).toContain("could not be set up");
  });
});

describe("what One moment a day says (A3)", () => {
  it("tells an organiser the quiet notice comes whatever the switch says", () => {
    expect(momentLine(true, true, "Mom")).toContain("you are told whatever this says");
    expect(momentLine(false, true, "Mom")).toContain("you are still told");
  });

  it("promises the quiet notice only to an organiser something can reach", () => {
    const unreachable = {
      organiser: true,
      paused: false,
      toldIfQuiet: { telegram: false, app: false },
    };
    expect(toldOfQuiet(unreachable)).toBe(false);
    for (const on of [true, false]) {
      const line = momentLine(on, toldOfQuiet(unreachable), "Mom");
      expect(line).not.toContain("you are told");
      expect(line).not.toContain("still told");
    }
    expect(toldOfQuiet({ ...unreachable, toldIfQuiet: { telegram: true, app: false } })).toBe(true);
    expect(toldOfQuiet({ ...unreachable, toldIfQuiet: { telegram: false, app: true } })).toBe(true);
    // The example family says nothing of how; a paused organiser and anyone else are not told.
    expect(toldOfQuiet({ organiser: true, paused: false })).toBe(true);
    expect(toldOfQuiet({ organiser: true, paused: true })).toBe(false);
    expect(toldOfQuiet({ organiser: false, paused: false })).toBe(false);
  });

  it("promises nobody else a quiet notice, which only organisers get", () => {
    for (const on of [true, false]) {
      expect(momentLine(on, false, "Mom")).not.toContain("quiet");
    }
    expect(momentLine(true, false, "Mom")).toBe(
      "At most one of each a day: when Mom answers what you asked, and the evening before your turn.",
    );
  });
});

describe("an organiser nobody can tell (principle 7)", () => {
  it("says so plainly, and the one thing to do only when this phone can do it", () => {
    expect(nobodyTellsLine(true, true)).toMatch(/nobody can tell you yet.*Turn them on/);
    expect(nobodyTellsLine(false, true)).not.toContain("Turn them on");
  });

  it("says Vela sends phones nothing yet where the API sends no pushes, not that notifications are off", () => {
    for (const canTurnOnHere of [true, false]) {
      const line = nobodyTellsLine(canTurnOnHere, false);
      expect(line).toBe(
        "If a morning goes quiet, nobody can tell you yet: you have no Telegram link, and Vela does not send notifications to phones yet.",
      );
      expect(line).not.toContain("notifications on");
    }
  });
});
