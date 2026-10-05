import type { PushPermission, PushPlatform } from "@vela/contracts";

/**
 * When this phone tells the API about itself (ADR-34, R1), as rules apart from the phone. Every
 * registration is a write, which costs one of the account's writes a minute and a check with
 * Clerk, so the phone registers only when something the API holds would change — the account, the
 * installation, the token, what the phone allows, whether its quiet channel is blocked — or the
 * last registration is a week old.
 */

/** A registration older than this is refreshed, though nothing changed. */
export const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * What the phone allows the app, as it reads it now. `undetermined` has never been asked: nothing
 * is registered for it. iOS's own status wins there, since `granted` alone hides a provisional yes.
 */
export type PhonePermission = "undetermined" | PushPermission;

/** The parts of expo-notifications' permission response these rules read. */
export interface PermissionReading {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
  ios?: { status: number } | undefined;
}

/**
 * `IosAuthorizationStatus` in expo-notifications, by value, so these rules load without it:
 * not determined 0, denied 1, authorized 2, provisional 3, ephemeral 4 (an App Clip's, never ours).
 */
const IOS_STATUS: Readonly<Record<number, PhonePermission>> = {
  0: "undetermined",
  1: "denied",
  2: "granted",
  3: "provisional",
  4: "granted",
};

export function phonePermission(reading: PermissionReading): PhonePermission {
  if (reading.ios !== undefined) return IOS_STATUS[reading.ios.status] ?? "denied";
  return reading.status;
}

/** What the API is told: a phone never asked, or one that stopped allowing, is `denied` there. */
export function reportedPermission(permission: PhonePermission): PushPermission {
  return permission === "undetermined" ? "denied" : permission;
}

/** Everything a registration tells the API, and the account it was made for. */
export interface DeviceState {
  /** The Clerk account the phone registered for; another account is another registration. */
  accountId: string;
  installationId: string;
  token: string;
  platform: PushPlatform;
  permission: PushPermission;
  quietChannelBlocked: boolean;
}

/** The last registration the API answered, remembered on the phone with when it was made. */
export interface Registered extends DeviceState {
  /** Milliseconds since the epoch. */
  at: number;
  /**
   * The phone's own token (APNs or FCM) the Expo token was minted from. It never leaves the phone:
   * while it is unchanged the Expo token is too, so Expo is not asked again (`reusableExpoToken`).
   */
  deviceToken: string;
}

/**
 * Whether the phone registers at all: always once notifications are allowed; while they are not,
 * only to tell the API that a phone it holds for this account can no longer be told — a phone never
 * registered, or registered for someone else, has nothing to report.
 */
export function mayRegister(
  permission: PhonePermission,
  last: Registered | null,
  accountId: string,
): boolean {
  if (permission === "granted") return true;
  return last !== null && last.accountId === accountId;
}

/** Whether what the API holds would change, or has not been refreshed for a week. */
export function registrationNeeded(
  current: DeviceState,
  last: Registered | null,
  now: number,
): boolean {
  if (last === null) return true;
  const changed =
    current.accountId !== last.accountId ||
    current.installationId !== last.installationId ||
    current.token !== last.token ||
    current.platform !== last.platform ||
    current.permission !== last.permission ||
    current.quietChannelBlocked !== last.quietChannelBlocked;
  // A clock that went back cannot say how old the registration is; it is made again.
  return changed || now < last.at || now - last.at >= REFRESH_AFTER_MS;
}

/**
 * The Expo token remembered with the last registration, while the phone's own token is the one it
 * was minted from and the registration is less than a week old; null when Expo must be asked, which
 * is a request to Expo's servers, so it is not made on every start.
 */
export function reusableExpoToken(
  last: Registered | null,
  deviceToken: string,
  now: number,
): string | null {
  if (last === null || last.deviceToken !== deviceToken) return null;
  return now < last.at || now - last.at >= REFRESH_AFTER_MS ? null : last.token;
}

const PERMISSIONS: ReadonlySet<string> = new Set(["granted", "denied", "provisional"]);
const PLATFORMS: ReadonlySet<string> = new Set(["ios", "android"]);

/** The remembered registration, or null for anything that is not one whole, as written. */
export function parseRegistered(stored: string | null): Registered | null {
  if (stored === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const {
    accountId,
    installationId,
    token,
    platform,
    permission,
    quietChannelBlocked,
    at,
    deviceToken,
  } = record;
  if (
    typeof accountId !== "string" ||
    typeof installationId !== "string" ||
    typeof token !== "string" ||
    typeof platform !== "string" ||
    !PLATFORMS.has(platform) ||
    typeof permission !== "string" ||
    !PERMISSIONS.has(permission) ||
    typeof quietChannelBlocked !== "boolean" ||
    typeof at !== "number" ||
    !Number.isFinite(at) ||
    typeof deviceToken !== "string"
  ) {
    return null;
  }
  return {
    accountId,
    installationId,
    token,
    platform: platform as PushPlatform,
    permission: permission as PushPermission,
    quietChannelBlocked,
    at,
    deviceToken,
  };
}
