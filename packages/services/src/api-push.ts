/**
 * The app's phones (ADR-34, API contract "Push"): `POST /v1/me/devices` registers or refreshes this
 * installation for the signed-in account, and `POST /v1/me/devices/:installationId/remove` takes it
 * away at sign-out. Both are the account's own: the caller's `users` row is locked, an unknown or
 * deleted account answers 404, and there is no 403, since nothing here is anyone else's to refuse.
 *
 * Registering moves an installation, or a token, that another account registered to this one (the
 * phone changed hands), and records what the phone allows now, so an organiser who turned
 * notifications off stops counting as someone who can be told. Removing takes only the caller's
 * own installation; another account's answers `removed: false` and stays.
 *
 * When either leaves a family with no organiser who can be told, the founder's alert is written as
 * an outbound row in the same transaction and handed to the queue after the commit, through the
 * returned `AfterCommit`, on the first attempt only. That needs `alerts`, and push on.
 */
import {
  type ApiMutationResponse,
  ApiPushDevice,
  type ApiPushDeviceRemoved,
  RegisterPushDevice,
  RemovePushDevice,
} from "@vela/contracts";
import { type PushDevice, pushDevices, type VelaTransaction } from "@vela/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { SessionIdentity } from "./api-access.ts";
import { lockAccount } from "./api-account-writes.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { insertOutbound } from "./gateway.ts";
import {
  alertsAfterDeviceLoss,
  type DeviceAlerts,
  lockPushDeviceKeys,
  pushDeviceCanBeTold,
} from "./push-devices.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApiPushDeps extends Pick<Deps, "db" | "clock"> {
  /** Where the founder is told, and whether push is on here; without it no alert is written. */
  alerts?: DeviceAlerts;
}

type Outcome = { response: ApiMutationResponse; replayed: boolean; after: AfterCommit };

/** The caller's live account under its row lock; an unknown or deleted one is `not_found`. */
async function lockCaller(tx: VelaTransaction, identity: SessionIdentity) {
  const account = await lockAccount(tx, identity.authSubject);
  if (account === undefined) throw new VelaError("not_found", "Account not found");
  return account;
}

function answerOf(device: PushDevice): ApiPushDevice {
  return ApiPushDevice.parse({
    installation_id: device.installationId,
    platform: device.platform,
    permission: device.permission,
    quiet_channel_blocked: device.quietChannelBlocked,
    registered_at: device.registeredAt.toISOString(),
  });
}

/** Writes each alert as a queued row and names it for the queue after the commit. */
async function writeAlerts(
  deps: ApiPushDeps,
  tx: VelaTransaction,
  after: AfterCommit,
  userId: string,
  occasion: string,
): Promise<void> {
  for (const request of await alertsAfterDeviceLoss(deps.alerts, tx, userId, occasion)) {
    const written = await insertOutbound(deps, tx, request);
    if ("outboundId" in written) after.outboundIds.push(written.outboundId);
  }
}

/**
 * Registers or refreshes this installation (`device.register:v1`). Every call writes: the app
 * sends a fresh key per attempt, and registers when its token, installation, account or what the
 * phone allows changed, or a week has passed.
 */
export async function registerApiPushDevice(
  deps: ApiPushDeps,
  identity: SessionIdentity,
  key: string,
  input: unknown,
): Promise<Outcome> {
  const parsed = RegisterPushDevice.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const device = { ...parsed.data, installation_id: parsed.data.installation_id.toLowerCase() };
  const after = nothingAfterCommit();

  const result = await runApiMutation(
    deps,
    identity,
    { key, operation: "device.register:v1", input: device },
    {
      authorize: async (tx) => {
        await lockCaller(tx, identity);
      },
      mutate: async (tx) => {
        const account = await lockCaller(tx, identity);
        const now = deps.clock.now();
        await lockPushDeviceKeys(tx, device.installation_id, device.token);
        const touched = await tx
          .select()
          .from(pushDevices)
          .where(
            or(
              eq(pushDevices.installationId, device.installation_id),
              eq(pushDevices.token, device.token),
            ),
          )
          .orderBy(asc(pushDevices.id))
          .for("update");
        // The token now belongs to this installation: the one it was registered under goes.
        const displaced = touched.filter((row) => row.installationId !== device.installation_id);
        if (displaced.length > 0) {
          await tx.delete(pushDevices).where(
            inArray(
              pushDevices.id,
              displaced.map((row) => row.id),
            ),
          );
        }
        const values = {
          userId: account.id,
          token: device.token,
          platform: device.platform,
          permission: device.permission,
          quietChannelBlocked: device.quiet_channel_blocked,
          registeredAt: now,
        };
        const [saved] = await tx
          .insert(pushDevices)
          .values({ ...values, installationId: device.installation_id, createdAt: now })
          .onConflictDoUpdate({ target: pushDevices.installationId, set: values })
          .returning();
        if (saved === undefined) throw new Error("the device was not saved");

        // Devices that could be told and now cannot, or now belong to someone else.
        const previous = touched.find((row) => row.installationId === device.installation_id);
        const lost = [...displaced, ...(previous === undefined ? [] : [previous])].filter(
          (row) =>
            pushDeviceCanBeTold(row) && (row.userId !== account.id || !pushDeviceCanBeTold(saved)),
        );
        const seen = new Set<string>();
        for (const row of lost) {
          if (seen.has(row.userId)) continue;
          seen.add(row.userId);
          await writeAlerts(
            deps,
            tx,
            after,
            row.userId,
            `push_device_changed:${row.id}:${now.getTime()}`,
          );
        }
        return { status: 200, body: answerOf(saved) };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}

/**
 * Removes this installation from the caller's account (`device.remove:v1`), at sign-out. Only the
 * caller's own: the delete names the account, so an installation another account has since taken
 * over is never removed with it. One that is not the caller's answers `removed: false`.
 */
export async function removeApiPushDevice(
  deps: ApiPushDeps,
  identity: SessionIdentity,
  key: string,
  installationId: string,
  input: unknown,
): Promise<Outcome> {
  if (!RemovePushDevice.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(installationId)) throw new VelaError("not_found", "Device not found");
  const installation = installationId.toLowerCase();
  const after = nothingAfterCommit();

  const result = await runApiMutation(
    deps,
    identity,
    { key, operation: "device.remove:v1", input: { installation_id: installation } },
    {
      authorize: async (tx) => {
        await lockCaller(tx, identity);
      },
      mutate: async (tx) => {
        const account = await lockCaller(tx, identity);
        const [removed] = await tx
          .delete(pushDevices)
          .where(
            and(eq(pushDevices.installationId, installation), eq(pushDevices.userId, account.id)),
          )
          .returning();
        if (removed !== undefined && pushDeviceCanBeTold(removed)) {
          await writeAlerts(deps, tx, after, account.id, `push_device_removed:${removed.id}`);
        }
        const body: ApiPushDeviceRemoved = {
          installation_id: installation,
          removed: removed !== undefined,
        };
        return { status: 200, body };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}
