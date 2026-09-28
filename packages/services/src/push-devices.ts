/**
 * An account's phones (ADR-34): which devices can be told anything, the lock every registration
 * takes, the deletes that take devices away, and the founder's alert when taking one away leaves a
 * family with no organiser who can be told. Shared by the API's device routes, Leave and account
 * deletion; the gateway and the receipts check read devices through the same rules.
 *
 * Devices belong to the account, not to a membership: one phone tells an organiser about every
 * family they organise. They are never deleted by age (an Expo push token does not expire), only on
 * DeviceNotRegistered for the token a push went to, sign-out, the account's last Leave, and account
 * deletion. Tokens never leave the table: a log line names a device by its id.
 */
import { families, members, type PushDevice, pushDevices, type VelaTransaction } from "@vela/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { organisersUnreachableAlert } from "./admin-alerts.ts";
import type { Config, Deps } from "./deps.ts";
import type { OutboundRequest } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import type { Queryable } from "./repo.ts";

/**
 * What a device write needs to tell the founder at once that a family has no organiser left who
 * can be told: the admin conversation and the admin origin, as the pilot Worker's `Config` has
 * them, and whether this environment sends push at all (`PUSH_SEND` "expo"), since only then does
 * a device count toward being told. Without it, or with push off, a device write raises nothing.
 */
export interface DeviceAlerts extends Pick<Config, "adminConversationId" | "publicBaseUrl"> {
  readonly pushSending: boolean;
}

/**
 * Whether a device can be told anything: the phone lets the app notify (`granted`; `provisional`
 * shows no banner and makes no sound), and on Android its quiet channel is not blocked.
 */
export function pushDeviceCanBeTold(
  device: Pick<PushDevice, "permission" | "quietChannelBlocked">,
): boolean {
  return device.permission === "granted" && !device.quietChannelBlocked;
}

const canBeTold = and(
  eq(pushDevices.permission, "granted"),
  eq(pushDevices.quietChannelBlocked, false),
);

/** Whether the account has a device that can be told anything. */
export async function accountCanBeToldByPush(db: Queryable, userId: string): Promise<boolean> {
  const [device] = await db
    .select({ id: pushDevices.id })
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, userId), canBeTold))
    .limit(1);
  return device !== undefined;
}

/**
 * Serialises every registration that names this installation or this token. The two are unique
 * each, and an upsert arbitrates only one of them: two phones registering one token at once (a
 * reinstall, a phone handed over) would otherwise both find no row with it, and the second would
 * fail on the token's key. Taken installation first, then token, by every registration, and
 * before any device row, so two registrations never wait on each other in a circle. No other
 * writer inserts a device, so only registrations take them.
 */
export async function lockPushDeviceKeys(
  tx: VelaTransaction,
  installationId: string,
  token: string,
): Promise<void> {
  for (const key of [`installation:${installationId.toLowerCase()}`, `token:${token}`]) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`vela:push_device:${key}`}, 0))`,
    );
  }
}

/**
 * Deletes the account's devices once it has no active or paused membership left in a family that
 * still exists: its last Leave. A Leave that keeps another family keeps the phones, which that
 * family's notices still need. One statement by account, so a device another account has just
 * taken over (a phone handed on) is never deleted with it. Returns how many were deleted.
 */
export async function forgetDevicesOfAccountWithoutFamily(
  tx: VelaTransaction,
  userId: string,
): Promise<number> {
  const [live] = await tx
    .select({ id: members.id })
    .from(members)
    .innerJoin(families, and(eq(families.id, members.familyId), isNull(families.deletedAt)))
    .where(
      and(
        eq(members.userId, userId),
        inArray(members.status, ["active", "paused"]),
        isNull(members.leftAt),
      ),
    )
    .limit(1);
  if (live !== undefined) {
    return 0;
  }
  const removed = await tx
    .delete(pushDevices)
    .where(eq(pushDevices.userId, userId))
    .returning({ id: pushDevices.id });
  return removed.length;
}

/**
 * Apple or Google said the phone a push went to is gone (DeviceNotRegistered, at the send or in its
 * receipt): the device is deleted while it still holds the token that push went to, whose SHA-256
 * is `tokenSha256`, and never once the app has registered a new token on the same installation.
 * The delete names the token it read, so a registration landing between the read and the delete
 * keeps its device. Returns the account whose device went, or null when none did.
 */
export async function forgetGoneDevice(
  db: Queryable,
  deviceId: string,
  tokenSha256: string,
): Promise<{ userId: string } | null> {
  const [device] = await db
    .select({ token: pushDevices.token })
    .from(pushDevices)
    .where(eq(pushDevices.id, deviceId))
    .limit(1);
  if (device === undefined || (await sha256Hex(device.token)) !== tokenSha256) {
    return null;
  }
  const [gone] = await db
    .delete(pushDevices)
    .where(and(eq(pushDevices.id, deviceId), eq(pushDevices.token, device.token)))
    .returning({ userId: pushDevices.userId });
  return gone ?? null;
}

/**
 * The founder's alerts after the account `userId` lost a device that could be told, already
 * written: removed at sign-out, moved to another account, registered again without permission, or
 * gone at Apple or Google (DeviceNotRegistered, at a send or in a receipt). For each family the
 * account organises, actively, `organisersUnreachableAlert` decides, counting every organiser's
 * Telegram link and phones: the alert goes when nobody at all is left. `occasion` names the loss,
 * once. Nothing while push is off, since a device then counts for nothing, nor while the account
 * still has another phone that can be told.
 */
export async function alertsAfterDeviceLoss(
  alerts: DeviceAlerts | undefined,
  db: Queryable,
  userId: string,
  occasion: string,
): Promise<OutboundRequest[]> {
  if (alerts === undefined || !alerts.pushSending || alerts.adminConversationId === null) {
    return [];
  }
  if (await accountCanBeToldByPush(db, userId)) {
    return [];
  }
  const organisers = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(families, and(eq(families.id, members.familyId), isNull(families.deletedAt)))
    .where(
      and(eq(members.userId, userId), eq(members.role, "organiser"), eq(members.status, "active")),
    )
    .orderBy(members.id);
  const requests: OutboundRequest[] = [];
  for (const organiser of organisers) {
    const alert = await organisersUnreachableAlert(
      { config: alerts, pushSending: true },
      db,
      organiser.id,
      occasion,
    );
    if (alert !== null) {
      requests.push(alert);
    }
  }
  return requests;
}

/** What `alertsAfterDeviceLoss` needs, from the pilot Worker's own deps. */
export function deviceAlertsOf(deps: Pick<Deps, "config" | "push">): DeviceAlerts {
  return {
    adminConversationId: deps.config.adminConversationId,
    publicBaseUrl: deps.config.publicBaseUrl,
    pushSending: deps.push !== null,
  };
}
