import { describe, expect, it } from "vitest";
import {
  type DeviceState,
  mayRegister,
  parseRegistered,
  phonePermission,
  REFRESH_AFTER_MS,
  type Registered,
  registrationNeeded,
  reportedPermission,
  reusableExpoToken,
} from "./registration.ts";

// Built at run time, never a literal, so nothing here looks like a real token.
const expoToken = (label: string) => `${["Exponent", "PushToken"].join("")}[app-test-${label}]`;

const NOW = Date.UTC(2026, 8, 27, 9, 0);
const DAY = 24 * 60 * 60 * 1_000;

const state: DeviceState = {
  accountId: "user_mia",
  installationId: "7f1c8a52-0d4e-4b8e-9f3a-2c6d5e4b3a21",
  token: expoToken("first"),
  platform: "android",
  permission: "granted",
  quietChannelBlocked: false,
};

function registered(patch: Partial<Registered> = {}): Registered {
  return { ...state, at: NOW - DAY, deviceToken: "fcm-first", ...patch };
}

describe("what the phone allows", () => {
  it("reads iOS's own status, which tells a provisional yes from a full one", () => {
    const ios = (status: number) =>
      phonePermission({ status: "granted", canAskAgain: true, ios: { status } });
    expect(ios(0)).toBe("undetermined");
    expect(ios(1)).toBe("denied");
    expect(ios(2)).toBe("granted");
    expect(ios(3)).toBe("provisional");
    expect(ios(99)).toBe("denied");
  });

  it("reads Android's status as it is", () => {
    for (const status of ["granted", "denied", "undetermined"] as const) {
      expect(phonePermission({ status, canAskAgain: true })).toBe(status);
    }
  });

  it("tells the API a phone never asked is not allowed", () => {
    expect(reportedPermission("undetermined")).toBe("denied");
    expect(reportedPermission("provisional")).toBe("provisional");
    expect(reportedPermission("granted")).toBe("granted");
  });
});

describe("whether the phone registers at all", () => {
  it("registers once notifications are allowed, for anyone", () => {
    expect(mayRegister("granted", null, "user_mia")).toBe(true);
    expect(mayRegister("granted", registered({ accountId: "user_sam" }), "user_mia")).toBe(true);
  });

  it("reports a phone that stopped allowing only to the account it was registered for", () => {
    for (const permission of ["denied", "provisional", "undetermined"] as const) {
      expect(mayRegister(permission, registered(), "user_mia")).toBe(true);
      expect(mayRegister(permission, registered({ accountId: "user_sam" }), "user_mia")).toBe(
        false,
      );
      expect(mayRegister(permission, null, "user_mia")).toBe(false);
    }
  });
});

describe("whether a registration is needed (R1)", () => {
  it("registers a phone never registered", () => {
    expect(registrationNeeded(state, null, NOW)).toBe(true);
  });

  it("leaves a registration alone while nothing changed and it is less than a week old", () => {
    expect(registrationNeeded(state, registered(), NOW)).toBe(false);
    expect(registrationNeeded(state, registered({ at: NOW - REFRESH_AFTER_MS + 1 }), NOW)).toBe(
      false,
    );
  });

  it("refreshes one a week old, and one from a clock that went back", () => {
    expect(registrationNeeded(state, registered({ at: NOW - REFRESH_AFTER_MS }), NOW)).toBe(true);
    expect(registrationNeeded(state, registered({ at: NOW + DAY }), NOW)).toBe(true);
  });

  it.each([
    ["the account", { accountId: "user_sam" }],
    ["the installation", { installationId: "0c3b2a19-8d7e-4f6a-b5c4-d3e2f1a0b9c8" }],
    ["the token", { token: expoToken("second") }],
    ["the platform", { platform: "ios" }],
    ["what the phone allows", { permission: "denied" }],
    ["the quiet channel", { quietChannelBlocked: true }],
  ] as const)("registers again when %s changed", (_, patch) => {
    expect(registrationNeeded({ ...state, ...patch }, registered(), NOW)).toBe(true);
  });
});

describe("asking Expo for a token only when the phone's own token changed", () => {
  it("reuses the Expo token minted from the same phone token within the week", () => {
    expect(reusableExpoToken(registered(), "fcm-first", NOW)).toBe(state.token);
  });

  it("asks again for a new phone token, a week-old registration, or none at all", () => {
    expect(reusableExpoToken(registered(), "fcm-second", NOW)).toBeNull();
    expect(
      reusableExpoToken(registered({ at: NOW - REFRESH_AFTER_MS }), "fcm-first", NOW),
    ).toBeNull();
    expect(reusableExpoToken(registered({ at: NOW + DAY }), "fcm-first", NOW)).toBeNull();
    expect(reusableExpoToken(null, "fcm-first", NOW)).toBeNull();
  });
});

describe("the remembered registration", () => {
  it("reads back what was written", () => {
    const written = registered();
    expect(parseRegistered(JSON.stringify(written))).toEqual(written);
  });

  it("reads anything else as never registered", () => {
    const whole = registered();
    for (const stored of [
      null,
      "",
      "not json",
      "null",
      "[]",
      JSON.stringify({ ...whole, at: "yesterday" }),
      JSON.stringify({ ...whole, permission: "undetermined" }),
      JSON.stringify({ ...whole, platform: "web" }),
      JSON.stringify({ ...whole, quietChannelBlocked: "no" }),
      JSON.stringify({ ...whole, deviceToken: undefined }),
      JSON.stringify({ ...whole, token: 7 }),
    ]) {
      expect(parseRegistered(stored), String(stored)).toBeNull();
    }
  });
});
