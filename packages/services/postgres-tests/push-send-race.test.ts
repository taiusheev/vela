/**
 * Sending pushes and reading their receipts on independent PostgreSQL connections (ADR-34), each
 * against a phone that changes under it. What keeps each race right:
 *
 * - a receipt saying a phone is gone (DeviceNotRegistered) while the app registers a new token on
 *   that installation: the delete names the token the push went to in the same statement, which
 *   PostgreSQL checks again once the row it waited on is free. Without that, the delete takes the
 *   freshly registered phone, and its organiser silently hears nothing more;
 * - a send whose phone signs out before its tickets are recorded: the record reads the phones it
 *   keeps tickets for `for key share`, which waits for the sign-out and then finds the phone gone.
 *   Without that, the ticket's insert fails on its foreign key, the row that proves the send never
 *   commits, and the push goes out a second time on the retry;
 * - a phone's quiet notice dropped because every phone is gone, as the round's Telegram notice to
 *   the same reader fails for good (she blocked the bot): the drop decides whether that left the
 *   reader unheard under the quiet event's lock, after writing the drop, the lock the failure takes
 *   too, so the one that decides second sees the other's final status. Without it, each reads the
 *   other as still on its way, and the founder never hears that nothing reached her organiser.
 */

import { outboundKey } from "@vela/core";
import {
  members,
  outbound,
  pushDevices,
  pushTickets,
  quietEvents,
  users,
  type VelaTransaction,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { registerApiPushDevice, removeApiPushDevice } from "../src/api-push.ts";
import type { Deps } from "../src/deps.ts";
import { deliverOutbound, enqueueOutbound, insertOutbound } from "../src/gateway.ts";
import { sha256Hex } from "../src/hash.ts";
import { checkPushReceipts } from "../src/push.ts";
import { answerReceiptPush } from "../src/push-messages.ts";
import { openQuiet } from "../src/quiet.ts";
import { createFakePush, pushFailureFor } from "../src/testing/fake-push.ts";
import { createFakeTelegram } from "../src/testing/fake-telegram.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
} from "../src/testing/seed.ts";
import {
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const X1 = "0198f6aa-0000-7000-8000-0000000000d1";
const TICKET = "0198f6aa-7e57-7000-8000-00000000d001";

/** Made at run time: a literal shaped like a push token looks like a credential to scanning. */
function token(label: string): string {
  return `${["Exponent", "PushToken"].join("")}[pg-race-${label}]`;
}

interface Scope {
  readonly family: SeededFamily;
  readonly miaUser: string;
  readonly deviceId: string;
  /** "Mom answered you." for Mia, queued and not yet sent. */
  readonly rowId: string;
}

/** Where the founder is told, in the deps a race's flows run with. */
const ADMIN = "9001";

function withAdmin(deps: Deps): Deps {
  return { ...deps, config: { ...deps.config, adminConversationId: ADMIN } };
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedMiasPhone();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Mia organises the family, asked today's question, and has one phone that can be told. */
async function seedMiasPhone(): Promise<Scope> {
  const db = seeder.db;
  const family = await seedFamily(db, { now: NOW });
  const [account] = await db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (account === undefined) throw new Error("expected Mia's account");
  await db.update(members).set({ userId: account.id }).where(eq(members.id, family.organiser.id));
  const [device] = await db
    .insert(pushDevices)
    .values({
      userId: account.id,
      installationId: X1,
      token: token("old"),
      platform: "android",
      permission: "granted",
      registeredAt: NOW,
      createdAt: NOW,
    })
    .returning();
  if (device === undefined) throw new Error("expected Mia's phone");
  const exchange = await seedExchange(db, family, {
    date: "2026-09-14",
    state: "delivered",
    deliveredAt: NOW,
  });
  const row = await insertOutbound({ clock: { now: () => NOW } }, db, {
    ...answerReceiptPush({
      reader: { member: { ...family.organiser, userId: account.id }, userId: account.id },
      exchangeId: exchange.id,
      herName: "Mom",
    }),
  });
  if (!("outboundId" in row)) throw new Error("expected the push row");
  return { family, miaUser: account.id, deviceId: device.id, rowId: row.outboundId };
}

function onDevice(tx: VelaTransaction) {
  return tx.select().from(pushDevices).where(eq(pushDevices.installationId, X1)).for("update");
}

async function devices() {
  return seeder.db
    .select({ id: pushDevices.id, userId: pushDevices.userId, token: pushDevices.token })
    .from(pushDevices)
    .orderBy(asc(pushDevices.installationId));
}

describe("a receipt saying a phone is gone, as the app registers a new token on it", () => {
  it("keeps the phone with its new token", async () => {
    const [first, second, holder] = await pg.clientPool("receipt", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    // The push went out twenty minutes ago to the old token, and Apple has since said it is gone.
    await seeder.db
      .update(outbound)
      .set({ status: "sent", sentAt: new Date(NOW.getTime() - 20 * 60_000), attempts: 1 })
      .where(eq(outbound.id, scope.rowId));
    await seeder.db.insert(pushTickets).values({
      id: TICKET,
      deviceId: scope.deviceId,
      tokenSha256: await sha256Hex(token("old")),
      outboundId: scope.rowId,
      createdAt: new Date(NOW.getTime() - 20 * 60_000),
    });
    const push = createFakePush();
    push.receiptFor(TICKET, { status: "error", failure: pushFailureFor("DeviceNotRegistered") });
    const receiptsDeps = { ...pg.jobDeps(second), push };

    const queued = await pg.queueBehindRowLock<unknown>(holder, onDevice, [
      {
        client: first,
        start: () =>
          registerApiPushDevice(first.deps, mia, "mia-refreshes", {
            installation_id: X1,
            token: token("new"),
            platform: "android",
            permission: "granted",
            quiet_channel_blocked: false,
          }),
      },
      {
        client: second,
        start: () =>
          checkPushReceipts(receiptsDeps, (tx, request) =>
            enqueueOutbound(receiptsDeps, tx, request),
          ),
      },
    ]);
    const [registered, checked] = await pg.settle("the refresh and the receipt", queued);

    expect(registered === undefined ? undefined : settled(registered).status).toBe("fulfilled");
    expect(checked === undefined ? undefined : settled(checked)).toMatchObject({
      status: "fulfilled",
      value: { asked: 1, refused: 1 },
    });
    expect(await devices()).toEqual([
      { id: scope.deviceId, userId: scope.miaUser, token: token("new") },
    ]);
  });
});

describe("a send whose phone signs out before its tickets are recorded", () => {
  it("commits the send with no ticket, and never sends it again", async () => {
    const [first, second, holder] = await pg.clientPool("record", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const deliverDeps = pg.jobDeps(second);
    const push = createFakePush();
    deliverDeps.push = push;

    const queued = await pg.queueBehindRowLock<unknown>(holder, onDevice, [
      {
        client: first,
        start: () => removeApiPushDevice(first.deps, mia, "mia-signs-out", X1, {}),
      },
      { client: second, start: () => deliverOutbound(deliverDeps, scope.rowId) },
    ]);
    const [removed, delivered] = await pg.settle("the sign-out and the send", queued);

    expect(removed === undefined ? undefined : settled(removed)).toMatchObject({
      status: "fulfilled",
      value: { response: { status: 200, body: { installation_id: X1, removed: true } } },
    });
    expect(delivered === undefined ? undefined : settled(delivered)).toEqual({
      status: "fulfilled",
      value: "sent",
    });
    expect(push.sent.map((message) => message.to)).toEqual([token("old")]);
    const [row] = await seeder.db
      .select({ status: outbound.status })
      .from(outbound)
      .where(eq(outbound.id, scope.rowId));
    expect(row?.status).toBe("sent");
    expect(await devices()).toEqual([]);
    expect(await seeder.db.select().from(pushTickets)).toEqual([]);
  });
});

describe("a phone's quiet notice dropped with every phone gone, as the round's Telegram notice fails blocked", () => {
  it("tells the founder once that nothing of the round reached Mia", async () => {
    const [dropper, failer, holder] = await pg.clientPool("unheard", 3);
    if (dropper === undefined || failer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    // Anna organises too, on Telegram, so the round is not the family's last word, and nobody
    // stops being someone who can be told: the one alert due is that Mia heard nothing.
    const anna = await seedGroupMember(seeder.db, scope.family, {
      now: NOW,
      name: "Anna",
      externalId: "4001",
      role: "organiser",
    });
    await openQuiet(withAdmin(pg.jobDeps(seeder)), scope.family.member.id, "2026-09-14", true);
    const notices = await seeder.db
      .select()
      .from(outbound)
      .where(eq(outbound.kind, "quiet_notice"))
      .orderBy(asc(outbound.queuedAt), asc(outbound.id));
    const miaId = scope.family.organiser.id;
    const onPhone = notices.find((row) => row.channel === "app");
    const onTelegram = notices.find((row) => row.channel === "telegram" && row.memberId === miaId);
    if (onPhone === undefined || onTelegram === undefined) {
      throw new Error("expected Mia's notice on her phone and on Telegram");
    }
    expect(notices.map((row) => [row.memberId, row.channel]).sort()).toEqual(
      [
        [miaId, "app"],
        [miaId, "telegram"],
        [anna.member.id, "telegram"],
      ].sort(),
    );

    // Mia's phone was uninstalled: Expo says it is gone. And she blocked the bot.
    const dropDeps = withAdmin(pg.jobDeps(dropper));
    const push = createFakePush();
    push.unregister(token("old"));
    dropDeps.push = push;
    const failDeps = withAdmin(pg.jobDeps(failer));
    const telegram = createFakeTelegram(failDeps.clock);
    telegram.failSendsTo(scope.family.organiserLink.externalId, "blocked");
    failDeps.channels = { get: () => telegram };

    // The phone is held, so the drop stops at deleting it, after it has decided about the round,
    // holding the quiet event; the failure then reaches the round while the drop is uncommitted.
    const held = await pg.holdRows(holder, onDevice);
    const dropping = pg.track(deliverOutbound(dropDeps, onPhone.id));
    await pg.waitForRowLockWait(dropper, [holder], dropping);
    const failing = pg.track(deliverOutbound(failDeps, onTelegram.id));
    await pg.waitForRowLockWaitOrCompletion(failer, [dropper], failing);
    await held.release();
    const [dropped, failed] = await pg.settle("the drop and the failure", [dropping, failing]);

    expect(dropped === undefined ? undefined : settled(dropped)).toEqual({
      status: "fulfilled",
      value: "skipped",
    });
    expect(failed === undefined ? undefined : settled(failed)).toEqual({
      status: "fulfilled",
      value: "failed",
    });
    const rows = await seeder.db.select().from(outbound);
    expect(
      rows
        .filter((row) => row.kind === "quiet_notice" && row.memberId === miaId)
        .map((row) => [row.channel, row.status, row.error?.split(":")[0]])
        .sort(),
    ).toEqual(
      [
        ["app", "dropped", "no_push_device"],
        ["telegram", "failed", "blocked"],
      ].sort(),
    );
    expect(await devices()).toEqual([]);
    const [quiet] = await seeder.db.select().from(quietEvents);
    expect(
      rows.filter((row) => row.conversationId === ADMIN).map((row) => row.idempotencyKey),
    ).toEqual([
      outboundKey("system", {
        conversationId: ADMIN,
        suffix: `quiet_nobody_told:${quiet?.id}:0:${miaId}`,
      }),
    ]);
  });
});
