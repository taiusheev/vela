import { clearSetting, readSetting, writeSetting } from "../storage/flags.ts";

/**
 * Her phone's token for the parent surface (ADR-35), kept in the phone's secure store and nowhere
 * else: not in a log, not in the API's receipts, never sent anywhere but in her own requests.
 */
const SETTING = "device-token";

export function readDeviceToken(): Promise<string | null> {
  return readSetting(SETTING);
}

export function writeDeviceToken(token: string): Promise<void> {
  return writeSetting(SETTING, token);
}

export function clearDeviceToken(): Promise<void> {
  return clearSetting(SETTING);
}
