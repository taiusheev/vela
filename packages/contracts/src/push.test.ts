import { describe, expect, it } from "vitest";
import {
  ApiPushDevice,
  ApiPushDeviceRemoved,
  BUDGETED_OUTBOUND_KINDS,
  ExpoPushToken,
  ORDINARY_PUSH_KINDS,
  OUTBOUND_KINDS,
  PUSH_EXCEPTION_KINDS,
  PUSH_KINDS,
  PUSH_PERMISSIONS,
  PUSH_PLATFORMS,
  PushData,
  RegisterPushDevice,
  RemovePushDevice,
} from "./index.ts";

/**
 * Tokens are made here at run time, never written whole: a literal shaped like a real credential
 * trips secret scanning, and an Expo push token is one while Enhanced Push Security is off.
 */
function pushToken(inner: string, prefix: "Expo" | "Exponent" = "Exponent"): string {
  return `${prefix}PushToken[${inner}]`;
}

const INSTALLATION = "0198f6aa-0000-7000-8000-00000000000a";
const FAMILY = "0198f6aa-0000-7000-8000-00000000000b";
const MEMBER = "0198f6aa-0000-7000-8000-00000000000c";
const EVENT = "0198f6aa-0000-7000-8000-00000000000d";

describe("push kinds", () => {
  it("pushes the two ordinary kinds, each already held to one a day by the budget index", () => {
    expect(ORDINARY_PUSH_KINDS).toEqual(["answer_receipt", "turn_prompt"]);
    const budgeted: readonly string[] = BUDGETED_OUTBOUND_KINDS;
    for (const kind of ORDINARY_PUSH_KINDS) {
      expect(budgeted, kind).toContain(kind);
    }
  });

  it("never budgets the quiet notice or its close, and pushes no flag", () => {
    expect(PUSH_EXCEPTION_KINDS).toEqual(["quiet_notice", "quiet_resolved"]);
    const budgeted: readonly string[] = BUDGETED_OUTBOUND_KINDS;
    for (const kind of PUSH_EXCEPTION_KINDS) {
      expect(budgeted, kind).not.toContain(kind);
    }
    expect(PUSH_KINDS).toEqual([...ORDINARY_PUSH_KINDS, ...PUSH_EXCEPTION_KINDS]);
    expect(PUSH_KINDS).not.toContain("flag");
    const outbound: readonly string[] = OUTBOUND_KINDS;
    for (const kind of PUSH_KINDS) {
      expect(outbound, kind).toContain(kind);
    }
  });

  it("knows two platforms and three permissions", () => {
    expect(PUSH_PLATFORMS).toEqual(["ios", "android"]);
    expect(PUSH_PERMISSIONS).toEqual(["granted", "denied", "provisional"]);
  });
});

describe("ExpoPushToken", () => {
  it("accepts both prefixes Expo has issued", () => {
    expect(ExpoPushToken.safeParse(pushToken("aBc-123_xyz")).success).toBe(true);
    expect(ExpoPushToken.safeParse(pushToken("aBc-123_xyz", "Expo")).success).toBe(true);
  });

  it("refuses anything else", () => {
    for (const value of [
      "",
      pushToken(""),
      pushToken("has space"),
      pushToken("x".repeat(201)),
      `${pushToken("abc")} `,
      `x${pushToken("abc")}`,
      "PushToken[abc]",
      "ExponentPushToken(abc)",
      "fcm:abc",
    ]) {
      expect(ExpoPushToken.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("RegisterPushDevice", () => {
  const device = {
    installation_id: INSTALLATION,
    token: pushToken("device-1"),
    platform: "android",
    permission: "granted",
    quiet_channel_blocked: false,
  };

  it("takes the installation, its token, the platform, and what the phone allows", () => {
    expect(RegisterPushDevice.parse(device)).toEqual(device);
    expect(RegisterPushDevice.parse({ ...device, platform: "ios", permission: "denied" })).toEqual({
      ...device,
      platform: "ios",
      permission: "denied",
    });
  });

  it("refuses a missing field, a stranger's field, or a value outside its set", () => {
    const { permission: _permission, ...withoutPermission } = device;
    const { quiet_channel_blocked: _blocked, ...withoutBlocked } = device;
    for (const invalid of [
      withoutPermission,
      withoutBlocked,
      { ...device, installation_id: "not-a-uuid" },
      { ...device, token: "not-a-token" },
      { ...device, platform: "web" },
      { ...device, permission: "ephemeral" },
      { ...device, quiet_channel_blocked: "no" },
      { ...device, user_id: MEMBER },
      { ...device, badge: 1 },
    ]) {
      expect(RegisterPushDevice.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
  });

  it("answers the installation without its token", () => {
    const answered = ApiPushDevice.parse({
      installation_id: INSTALLATION,
      token: device.token,
      platform: "android",
      permission: "granted",
      quiet_channel_blocked: false,
      registered_at: "2026-09-27T01:00:00.000Z",
    });
    expect(answered).toEqual({
      installation_id: INSTALLATION,
      platform: "android",
      permission: "granted",
      quiet_channel_blocked: false,
      registered_at: "2026-09-27T01:00:00.000Z",
    });
    expect(JSON.stringify(answered)).not.toContain("PushToken");
  });
});

describe("removing a device", () => {
  it("carries nothing in its body and answers whether the account had it", () => {
    expect(RemovePushDevice.parse({})).toEqual({});
    expect(RemovePushDevice.safeParse({ installation_id: INSTALLATION }).success).toBe(false);
    expect(ApiPushDeviceRemoved.parse({ installation_id: INSTALLATION, removed: false })).toEqual({
      installation_id: INSTALLATION,
      removed: false,
    });
    expect(ApiPushDeviceRemoved.safeParse({ installation_id: INSTALLATION }).success).toBe(false);
  });
});

describe("PushData", () => {
  it("carries ids and the kind", () => {
    const data = {
      kind: "quiet_notice",
      family_id: FAMILY,
      member_id: MEMBER,
      quiet_event_id: EVENT,
    };
    expect(PushData.parse(data)).toEqual(data);
  });

  it("refuses words, a kind that is never pushed, and anything that is not an id", () => {
    const base = { kind: "answer_receipt", family_id: FAMILY, member_id: MEMBER };
    for (const invalid of [
      { ...base, text: "The tomatoes finally turned." },
      { ...base, name: "Mom" },
      { ...base, kind: "flag" },
      { ...base, kind: "arrival" },
      { ...base, exchange_id: "yesterday" },
      { kind: "answer_receipt", family_id: FAMILY },
    ]) {
      expect(PushData.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
  });
});
