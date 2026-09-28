/**
 * Queueing her morning, on independent PostgreSQL connections (flows §3.6, §3.7). The tick that
 * queues a morning decides first and writes last: it prepares the day, reads the ask, loads its
 * photos and renders the message, and only then writes the arrival row. Two writers can reach her
 * in that gap, and PGlite, one connection running one query at a time, can show neither:
 *
 * - The 22:00 tick preparing tomorrow. An ask whose morning's window closed with no arrival row is
 *   carried to the next morning prepared, and a tick that decided just before 22:00 that this
 *   morning is due reaches its queueing after 22:00. So the row is written under her member row's
 *   lock, the one preparing takes, with the ask read again: whichever comes second sees what the
 *   first wrote, the arrival row, and the ask stays, or the ask moved, and this morning, whose
 *   window has closed, sends nothing. Either way the ask goes out once, on the morning it is dated
 *   to, and the next morning keeps its own.
 * - The effects of this morning's own send, while a second tick, which read the morning undelivered,
 *   queues it again. The effects have claimed the row, lock the exchange, and write her member row
 *   last. An insert under the row's key, made while holding her member row, would wait at the key
 *   for the effects that changed the row, while they wait for her member row: a cycle PostgreSQL
 *   breaks by aborting one of them. So the queueing reads the row first and, finding it, writes
 *   nothing.
 */
import type { ExchangeType, LocalDate, LocalTime } from "@vela/contracts";
import { addDays, localDateOf, outboundKey, zonedInstant } from "@vela/core";
import {
  events,
  exchanges,
  media,
  outbound,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverArrival, prepareDay } from "../src/arrivals.ts";
import type { Deps, MediaStore, OutboundJob } from "../src/deps.ts";
import { deliverOutbound } from "../src/gateway.ts";
import { createFakeTelegram, type FakeTelegram } from "../src/testing/fake-telegram.ts";
import {
  createFakeLogger,
  createFakeMediaStore,
  createFakeQueue,
  createFakeRandom,
  type FakeMediaStore,
  type FakeRandom,
} from "../src/testing/fakes.ts";
import { seedExchange, seedFamily, seedLinkedGroup } from "../src/testing/seed.ts";
import {
  HOLD_MS,
  type Latch,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let telegram: FakeTelegram;
let random: FakeRandom;
let store: FakeMediaStore;

const TZ = "Asia/Taipei";
const day = 24 * 60 * 60_000;

interface Scope {
  readonly herId: string;
  readonly organiserId: string;
  readonly today: LocalDate;
  readonly tomorrow: LocalDate;
  /** Mia's question for this morning, with a photo she uploaded from the app; prepared last night. */
  readonly askId: string;
  readonly photoKey: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  telegram = createFakeTelegram({ now: () => new Date(NOW.getTime()) });
  random = createFakeRandom();
  store = createFakeMediaStore();
  scope = await seedAskPrepared(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function at(date: LocalDate, time: LocalTime): Date {
  return zonedInstant(date, time, TZ);
}

/**
 * A job's deps on its own connection at `now`, a tick's or a delivery's; one Telegram, one random
 * and one storage for the whole race.
 */
function depsOn(client: RaceClient, now: Date, overrides: Partial<Deps> = {}): Deps {
  return {
    ...pg.jobDeps(client),
    clock: { now: () => new Date(now.getTime()) },
    random,
    media: store,
    channels: { get: () => telegram },
    ...overrides,
  };
}

/** Her light on for ten days; her ask for this morning was prepared at 22:00 last night. */
async function seedAskPrepared(db: VelaDatabase): Promise<Scope> {
  const seed = await seedFamily(db, { now: new Date(NOW.getTime() - 10 * day) });
  await seedLinkedGroup(db, seed, { now: NOW });
  const today = localDateOf(NOW, seed.member.tz);
  const photoKey = `asks/${seed.family.id}/garden.jpg`;
  await store.put(photoKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, "image/jpeg");
  const [photo] = await db
    .insert(media)
    .values({
      familyId: seed.family.id,
      uploadedBy: seed.organiser.id,
      kind: "image",
      storageKey: photoKey,
      mime: "image/jpeg",
      bytes: 4,
      createdAt: new Date(NOW.getTime() - day),
      expiresAt: new Date(NOW.getTime() + 29 * day),
    })
    .returning({ id: media.id });
  if (photo === undefined) throw new Error("the photo was not seeded");
  const ask = await seedExchange(db, seed, {
    date: today,
    state: "scheduled",
    text: "Do you remember this garden?",
  });
  await db
    .update(exchanges)
    .set({ mediaIds: [photo.id] })
    .where(eq(exchanges.id, ask.id));
  return {
    herId: seed.member.id,
    organiserId: seed.organiser.id,
    today,
    tomorrow: addDays(today, 1),
    askId: ask.id,
    photoKey,
  };
}

function onTheAsk(tx: VelaTransaction, strength: "share" | "key share") {
  return tx.select().from(exchanges).where(eq(exchanges.id, scope.askId)).for(strength);
}

class KeyLetGo extends Error {}

/**
 * This morning's row key, held by an insert of another row under it that `holder` keeps uncommitted
 * and then rolls back: a queueing reaching its own insert waits at the key, inside its write, before
 * any of its row is written. The held row is the organiser's, so the holder takes nothing of hers.
 */
async function holdTheKey(holder: RaceClient): Promise<{ release(): Promise<void> }> {
  const entered = pg.latch(`${holder.name} to hold the key`);
  const release = pg.latch(`${holder.name} to let the key go`, HOLD_MS);
  const held = pg.track(
    holder.db
      .transaction(async (tx) => {
        await tx.insert(outbound).values({
          memberId: scope.organiserId,
          kind: "system",
          channel: "telegram",
          conversationId: "held",
          localDay: scope.today,
          idempotencyKey: outboundKey("arrival", { memberId: scope.herId, date: scope.today }),
          payload: {},
          queuedAt: NOW,
        });
        entered.release();
        await release.wait();
        throw new KeyLetGo();
      })
      .catch((error: unknown) => {
        if (!(error instanceof KeyLetGo)) throw error;
      }),
  );
  await pg.reach(`${holder.name} to hold the key`, entered, held);
  return {
    release: async () => {
      release.release();
      await pg.finish(`${holder.name} to let the key go`, held);
    },
  };
}

interface PausedAtStorage {
  /** Storage that answers whether the ask's photo is there, each time once `open` lets it. */
  readonly store: MediaStore;
  /** Released when the queueing asks. */
  readonly reached: Latch;
  readonly open: Latch;
}

/** Storage as the network holds the queueing's check of the ask's photo, until `open`. */
function pausedAtStorage(): PausedAtStorage {
  const reached = pg.latch("the queueing to check the ask's photo");
  const open = pg.latch("storage to answer the check", HOLD_MS);
  return {
    reached,
    open,
    store: {
      ...store,
      async head(key) {
        reached.release();
        await open.wait();
        return store.head(key);
      },
    },
  };
}

function outcomes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? "fulfilled" : shown.reason;
  });
}

/** Her arrival rows by morning: the date, the exchange, the status. */
async function arrivals(): Promise<[LocalDate, string | null, string][]> {
  const rows = await seeder.db
    .select({ day: outbound.localDay, exchangeId: outbound.exchangeId, status: outbound.status })
    .from(outbound)
    .where(eq(outbound.kind, "arrival"))
    .orderBy(asc(outbound.localDay));
  return rows.map((row) => [row.day, row.exchangeId, row.status]);
}

/** Her mornings as prepared: the date, the exchange, its type. */
async function mornings(): Promise<[LocalDate | null, string, ExchangeType][]> {
  const rows = await seeder.db
    .select({ date: exchanges.scheduledFor, id: exchanges.id, type: exchanges.type })
    .from(exchanges)
    .where(eq(exchanges.recipientId, scope.herId))
    .orderBy(asc(exchanges.scheduledFor));
  return rows.map((row) => [row.date, row.id, row.type]);
}

async function theAsk() {
  const [row] = await seeder.db.select().from(exchanges).where(eq(exchanges.id, scope.askId));
  if (row === undefined) throw new Error("her ask is gone");
  return row;
}

/** Delivers every arrival row still queued, as their jobs would at `now`. */
async function deliverQueued(now: Date): Promise<void> {
  const rows = await seeder.db
    .select({ id: outbound.id })
    .from(outbound)
    .where(and(eq(outbound.kind, "arrival"), eq(outbound.status, "queued")))
    .orderBy(asc(outbound.queuedAt));
  for (const row of rows) {
    await deliverOutbound(depsOn(seeder, now), row.id);
  }
}

/** Whatever was queued tonight goes out, and then tomorrow's morning is queued at 08:00 and goes. */
async function runTheMornings(): Promise<void> {
  await deliverQueued(at(scope.today, "22:00"));
  const eight = at(scope.tomorrow, "08:00");
  await deliverArrival(depsOn(seeder, eight), scope.herId, scope.tomorrow, false);
  await deliverQueued(eight);
}

/** Her mornings as they reached her phone: each arrival Telegram was asked to send and sent. */
function morningsToHer(): number {
  return telegram.sent.filter((sent) => sent.message.kind === "arrival").length;
}

describe("her morning queued as the 22:00 preparation carries its ask", () => {
  it("keeps the ask on this morning, and gives the next its own, when this morning's queueing holds her row as the preparation reaches it", async () => {
    const [queuer, preparer, holder] = await pg.clientPool("carry", 3);
    if (queuer === undefined || preparer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The tick that decided at 21:59 that her morning is due has her member row, has read the ask
    // still dated for it, and reaches its row's key, which the holder keeps. The 22:00 tick then
    // prepares tomorrow, and reaches her member row.
    const held = await holdTheKey(holder);
    const queueing = pg.track(
      deliverArrival(depsOn(queuer, at(scope.today, "21:59")), scope.herId, scope.today, true),
    );
    await pg.waitForRowLockWait(queuer, [holder], queueing);
    const preparing = pg.track(
      prepareDay(depsOn(preparer, at(scope.today, "22:00")), scope.herId, scope.tomorrow),
    );
    await pg.waitForRowLockWaitOrCompletion(preparer, [queuer], preparing);
    await held.release();
    const results = await pg.settle<unknown>("the queueing and the preparation", [
      queueing,
      preparing,
    ]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // The ask stays on this morning, whose row the preparation found; tomorrow has the hello.
    expect(await arrivals()).toEqual([[scope.today, scope.askId, "queued"]]);
    const prepared = await mornings();
    expect(prepared).toEqual([
      [scope.today, scope.askId, "question"],
      [scope.tomorrow, expect.any(String), "hello"],
    ]);
    const helloId = prepared[1]?.[1];

    await runTheMornings();
    expect(await arrivals()).toEqual([
      [scope.today, scope.askId, "sent"],
      [scope.tomorrow, helloId, "sent"],
    ]);
    expect(morningsToHer()).toBe(2);
    expect(await theAsk()).toMatchObject({
      state: "delivered",
      scheduledFor: scope.today,
      deliveredAt: at(scope.today, "22:00"),
    });
  });

  it("sends the ask once, on the next morning, when the preparation carrying it holds her row as this morning's queueing reaches it", async () => {
    const [queuer, preparer, holder] = await pg.clientPool("carry", 3);
    if (queuer === undefined || preparer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const storage = pausedAtStorage();
    const queuerLog = createFakeLogger();

    // The tick that decided at 21:59 that her morning is due has read the ask, dated for it, and
    // checks its photo in storage.
    const queueing = pg.track(
      deliverArrival(
        depsOn(queuer, at(scope.today, "21:59"), { media: storage.store, logger: queuerLog }),
        scope.herId,
        scope.today,
        true,
      ),
    );
    await pg.reach("the queueing to check the ask's photo", storage.reached, queueing);
    // The 22:00 tick prepares tomorrow: it takes her member row, carries the ask, whose morning's
    // window has closed with no arrival row, and reaches the ask, which the holder keeps.
    const held = await pg.holdRows(holder, (tx) => onTheAsk(tx, "share"));
    const preparing = pg.track(
      prepareDay(depsOn(preparer, at(scope.today, "22:00")), scope.herId, scope.tomorrow),
    );
    await pg.waitForRowLockWait(preparer, [holder], preparing);
    // Storage answers, and the queueing comes to write this morning's row.
    storage.open.release();
    await pg.waitForRowLockWaitOrCompletion(queuer, [preparer], queueing);
    await held.release();
    const results = await pg.settle<unknown>("the queueing and the preparation", [
      queueing,
      preparing,
    ]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // This morning, whose window has closed, queued nothing; the ask is tomorrow's.
    expect(await arrivals()).toEqual([]);
    expect(await mornings()).toEqual([[scope.tomorrow, scope.askId, "question"]]);
    expect(queuerLog.entries).toContainEqual({
      level: "info",
      event: "arrival_carried",
      fields: { memberId: scope.herId, date: scope.today, exchangeId: scope.askId },
    });

    await runTheMornings();
    expect(await arrivals()).toEqual([[scope.tomorrow, scope.askId, "sent"]]);
    expect(morningsToHer()).toBe(1);
    expect(telegram.sent[0]?.uploads.map((upload) => upload.storageKey)).toEqual([scope.photoKey]);
    expect(await theAsk()).toMatchObject({
      state: "delivered",
      scheduledFor: scope.tomorrow,
      deliveredAt: at(scope.tomorrow, "08:00"),
    });
  });
});

describe("her morning queued again as the effects of its send are written", () => {
  it("queues nothing more, and both commit, when a second tick queues the morning while the effects hold its row", async () => {
    // Her morning was queued at 08:00 and sent at 08:00:30; the send is recorded, its effects are
    // not yet.
    const eight = at(scope.today, "08:00");
    const sentAt = new Date(eight.getTime() + 30_000);
    await deliverArrival(depsOn(seeder, eight), scope.herId, scope.today, false);
    await seeder.db
      .update(outbound)
      .set({ status: "sent", sentAt, attempts: 1, externalId: "700" })
      .where(eq(outbound.kind, "arrival"));
    const [row] = await seeder.db.select({ id: outbound.id }).from(outbound);
    if (row === undefined) throw new Error("her morning was not queued");

    const [gateway, queuer, holder] = await pg.clientPool("effects", 3);
    if (gateway === undefined || queuer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const minuteLater = new Date(eight.getTime() + 60_000);
    const queuerDeps = depsOn(queuer, minuteLater);
    const handedOver = createFakeQueue<OutboundJob>(queuerDeps.clock, () => 0);

    // The queue's retry finishes the effects: it has claimed the row and reaches for the ask,
    // which the holder keeps. A second tick, which read the morning undelivered, then queues it.
    const held = await pg.holdRows(holder, (tx) => onTheAsk(tx, "key share"));
    const finishing = pg.track(deliverOutbound(depsOn(gateway, minuteLater), row.id));
    await pg.waitForRowLockWait(gateway, [holder], finishing);
    const queueing = pg.track(
      deliverArrival(
        { ...queuerDeps, queues: { ...queuerDeps.queues, outbound: handedOver } },
        scope.herId,
        scope.today,
        false,
      ),
    );
    await pg.waitForRowLockWaitOrCompletion(queuer, [gateway], queueing);
    await held.release();
    const results = await pg.settle<unknown>("the effects and the second queueing", [
      finishing,
      queueing,
    ]);
    // Neither may be aborted: the effects would leave her morning undelivered until reconcile,
    // and the tick would fail.
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // One row, sent once and delivered once; the second queueing handed nothing to the queue.
    expect(await arrivals()).toEqual([[scope.today, scope.askId, "sent"]]);
    expect(handedOver.pending).toEqual([]);
    expect(await theAsk()).toMatchObject({ state: "delivered", deliveredAt: sentAt });
    expect(
      await seeder.db.select().from(events).where(eq(events.name, "arrival_delivered")),
    ).toHaveLength(1);
    expect(telegram.sent).toEqual([]);
  });
});
