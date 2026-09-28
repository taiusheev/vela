import { randomUUID } from "expo-crypto";
import { clearSetting, readSetting, writeSetting } from "../storage/flags.ts";
import { parseRegistered, type Registered } from "./registration.ts";

/**
 * What this phone remembers about its push registration (ADR-34), in the secure store: the
 * installation id it minted once, the last registration the API answered, and a removal that
 * sign-out could not finish. A value that cannot be kept costs a registration, never a push.
 */

const INSTALLATION = "push.installation";
const REGISTERED = "push.registered";
const PENDING_REMOVAL = "push.pending-removal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The installation id this phone registers under, minted from the phone's own secure random. */
export async function installationId(): Promise<string> {
  const known = await readSetting(INSTALLATION);
  if (known !== null && UUID.test(known)) return known;
  const minted = randomUUID();
  await writeSetting(INSTALLATION, minted);
  return minted;
}

/** The installation id if one was ever minted, without minting one. */
export async function knownInstallationId(): Promise<string | null> {
  const known = await readSetting(INSTALLATION);
  return known !== null && UUID.test(known) ? known : null;
}

export async function readRegistered(): Promise<Registered | null> {
  return parseRegistered(await readSetting(REGISTERED));
}

export async function writeRegistered(registered: Registered): Promise<void> {
  await writeSetting(REGISTERED, JSON.stringify(registered));
}

export async function forgetRegistered(): Promise<void> {
  await clearSetting(REGISTERED);
}

/** A sign-out's removal that did not reach the API, for the account it was made for. */
export interface PendingRemoval {
  accountId: string;
  installationId: string;
}

export async function readPendingRemoval(): Promise<PendingRemoval | null> {
  const stored = await readSetting(PENDING_REMOVAL);
  if (stored === null) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) return null;
    const { accountId, installationId: id } = value as Record<string, unknown>;
    return typeof accountId === "string" && typeof id === "string" && UUID.test(id)
      ? { accountId, installationId: id }
      : null;
  } catch {
    return null;
  }
}

export async function writePendingRemoval(pending: PendingRemoval): Promise<void> {
  await writeSetting(PENDING_REMOVAL, JSON.stringify(pending));
}

export async function forgetPendingRemoval(): Promise<void> {
  await clearSetting(PENDING_REMOVAL);
}
