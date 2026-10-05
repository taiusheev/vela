/**
 * One queued row and its deliveries, on independent PostgreSQL connections (flows §3.7). Telegram
 * has no idempotency keys, and one row can have two deliveries at once: a duplicate of its job (the
 * queue delivers at least once), a job re-driven beside a late one, or a delivery that read her
 * paused beside one that read her active. So a delivery takes the row before it sends — one
 * conditional update sets `sent_at` on the row as it read it, `queued`, held by no one, with the
 * same `attempts` — and writes its outcome only on the row as it holds it. Each race here reads the
 * row free on every side and then meets on it, which PGlite, one connection running one query at a
 * time, cannot show:
 *
 * - Deliveries of one row that reach the take together: one takes it, the others find it taken,
 *   and the morning goes out once, with its effects once (the take's `sent_at is null`).
 * - `reconcile`'s re-drive of a row whose job ran late: it read the row free and past due, and its
 *   claim reaches the row after the late delivery took it. The claim needs the row held by no
 *   delivery, so it leaves the row to that delivery, with no attempt counted and no job sent.
 * - The pause drop against a delivery that has taken the row: the drop read the row free and her
 *   paused, and reaches the row while the delivery that took it is at Telegram, or once it has
 *   recorded the send. The take decided, so the drop writes nothing over a held or a sent row and
 *   the delivery's send stands.
 * - The retry of a morning whose voice note went out before its text failed, beside a second
 *   delivery of the retry: one sends the photos still to send, once, and none goes twice.
 *
 * The take, the send's record, and a retry's give-back each change no key of the row, so a
 * connection holding it `for key share` lets them through while it keeps a drop's `for update`
 * waiting: that is how the drop is made to decide only once the row is held, or sent.
 */
import type { ChannelAdapter, InboundEvent, LocalDate, MediaRef } from "@vela/contracts";
import { localDateOf, type ParentCommand } from "@vela/core";
import {
  type ChannelLink,
  events,
  exchanges,
  type Member,
  messageRefs,
  outbound,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverArrival } from "../src/arrivals.ts";
import type { Clock, Deps, OutboundJob } from "../src/deps.ts";
import {
  deliverOutbound,
  redriveStrandedOutbound,
  STRANDED_AFTER_MINUTES,
} from "../src/gateway.ts";
import { handleParentCommand } from "../src/parent-commands.ts";
import { memberById } from "../src/repo.ts";
import { createFakeTelegram, type FakeTelegram } from "../src/testing/fake-telegram.ts";
import {
  createFakeLogger,
  createFakeQueue,
  createFakeRandom,
  type FakeRandom,
} from "../src/testing/fakes.ts";
import { seedFamily, seedLinkedGroup } from "../src/testing/seed.ts";
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

const minute = 60_000;
const day = 24 * 60 * minute;
const clock: Clock = { now: () => new Date(NOW.getTime()) };

interface Scope {
  readonly herId: string;
  readonly herLink: ChannelLink;
  readonly today: LocalDate;
  /** Her 08:00 morning, queued by the tick and not sent yet. */
  readonly arrivalId: string;
  readonly exchangeId: string;
}

let scope: Scope;
let commands = 0;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  telegram = createFakeTelegram(clock);
  random = createFakeRandom();
  commands = 0;
  scope = await seedMorningQueued(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/**
 * A job's deps on its own connection; one Telegram and one random for the whole race, and the
 * adapter a delivery sends through, Telegram itself unless a test holds its sends at the platform.
 */
function depsOn(client: RaceClient, adapter: ChannelAdapter = telegram): Deps {
  return { ...pg.jobDeps(client), random, channels: { get: () => adapter } };
}

/** Her light on for ten days, and it is 08:00: her morning is prepared and queued, not sent yet. */
async function seedMorningQueued(db: VelaDatabase): Promise<Scope> {
  const seed = await seedFamily(db, { now: new Date(NOW.getTime() - 10 * day) });
  await seedLinkedGroup(db, seed, { now: NOW });
  const today = localDateOf(NOW, seed.member.tz);
  await deliverArrival(depsOn(seeder), seed.member.id, today, false);
  const [arrival] = await db
    .select({ id: outbound.id, exchangeId: outbound.exchangeId })
    .from(outbound)
    .where(and(eq(outbound.kind, "arrival"), eq(outbound.status, "queued")));
  if (arrival === undefined || arrival.exchangeId === null) {
    throw new Error("her morning was not queued");
  }
  return {
    herId: seed.member.id,
    herLink: seed.memberLink,
    today,
    arrivalId: arrival.id,
    exchangeId: arrival.exchangeId,
  };
}

/** Her command in her private chat, as the router hands it over, with her row as it is now. */
async function say(client: RaceClient, command: ParentCommand): Promise<void> {
  commands += 1;
  const her: Member | null = await memberById(client.db, scope.herId);
  if (her === null) throw new Error("she is not seeded");
  const event: InboundEvent = {
    channel: "telegram",
    eventId: `tg:${command}-${commands}`,
    at: NOW.toISOString(),
    sender: { externalUserId: scope.herLink.externalId },
    conversation: { externalId: scope.herLink.externalId, kind: "private" },
    messageId: String(500 + commands),
    kind: "text",
    text: command,
  };
  await handleParentCommand(depsOn(client), her, command, event);
}

function deliver(client: RaceClient, adapter?: ChannelAdapter) {
  return deliverOutbound(depsOn(client, adapter), scope.arrivalId);
}

function onTheArrival(tx: VelaTransaction, strength: "update" | "no key update" | "key share") {
  return tx.select().from(outbound).where(eq(outbound.id, scope.arrivalId)).for(strength);
}

interface HeldAtTelegram {
  /** Sends through Telegram, each once `open` lets it. */
  readonly adapter: ChannelAdapter;
  /** Released when a send reaches the platform. */
  readonly reached: Latch;
  readonly open: Latch;
}

/** Telegram as the network holds a send in flight: the send waits at the platform until `open`. */
function heldAtTelegram(): HeldAtTelegram {
  const reached = pg.latch("a send to reach Telegram");
  const open = pg.latch("Telegram to answer the send", HOLD_MS);
  return {
    reached,
    open,
    adapter: {
      ...telegram,
      async send(message, files) {
        reached.release();
        await open.wait();
        return telegram.send(message, files);
      },
    },
  };
}

function outcomes(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? shown.value : shown.reason;
  });
}

async function theArrival() {
  const [row] = await seeder.db.select().from(outbound).where(eq(outbound.id, scope.arrivalId));
  if (row === undefined) throw new Error("her morning's row is gone");
  return row;
}

async function drops(): Promise<unknown[]> {
  const rows = await seeder.db.select().from(events).where(eq(events.name, "gateway_dropped"));
  return rows.map((row) => row.props);
}

async function deliveredEvents(): Promise<number> {
  const rows = await seeder.db.select().from(events).where(eq(events.name, "arrival_delivered"));
  return rows.length;
}

/** Her morning as it reached her phone: each arrival Telegram was asked to send and sent. */
function morningsSent(): number {
  return telegram.sent.filter((sent) => sent.message.kind === "arrival").length;
}

/** The platform message ids her morning is known by, in the order they were recorded. */
async function arrivalRefs(): Promise<string[]> {
  const rows = await seeder.db
    .select({ messageId: messageRefs.messageId })
    .from(messageRefs)
    .where(and(eq(messageRefs.exchangeId, scope.exchangeId), eq(messageRefs.purpose, "arrival")))
    .orderBy(asc(messageRefs.messageId));
  return rows.map((row) => row.messageId);
}

/** Sent once, recorded once, and its effects applied once: her morning is delivered. */
async function expectDeliveredOnce(attempts: number): Promise<void> {
  expect(await theArrival()).toMatchObject({ status: "sent", attempts, error: null });
  expect(morningsSent()).toBe(1);
  expect(await deliveredEvents()).toBe(1);
  const [exchange] = await seeder.db
    .select({ state: exchanges.state, deliveredAt: exchanges.deliveredAt })
    .from(exchanges)
    .where(eq(exchanges.id, scope.exchangeId));
  expect(exchange).toEqual({ state: "delivered", deliveredAt: NOW });
  expect(await drops()).toEqual([]);
}

describe("one queued row, several deliveries", () => {
  it("sends her morning once, with its effects once, when three deliveries of it reach the take together", async () => {
    const [holder, ...contenders] = await pg.clientPool("take", 4);
    if (holder === undefined || contenders.length !== 3) {
      throw new Error("expected four race connections");
    }

    // Each delivery has read the row queued and free, and reaches for it to take it; they queue on
    // the row in turn, and the first to come takes it.
    const operations = await pg.queueBehindRowLock<unknown>(
      holder,
      (tx) => onTheArrival(tx, "update"),
      contenders.map((client) => ({ client, start: () => deliver(client) })),
    );
    const results = await pg.settle("the three deliveries", operations);
    expect(outcomes(results)).toEqual(["sent", "skipped", "skipped"]);

    await expectDeliveredOnce(1);
    expect(await arrivalRefs()).toEqual(["1"]);
  });

  it("leaves a row a late delivery took to that delivery when reconcile's re-drive, which read it free, reaches it", async () => {
    const [gateway, reconciler, holder] = await pg.clientPool("redrive", 3);
    if (gateway === undefined || reconciler === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    // Her morning's job ran more than 10 minutes late, so reconcile counts it as lost.
    await seeder.db
      .update(outbound)
      .set({ queuedAt: new Date(NOW.getTime() - (STRANDED_AFTER_MINUTES + 1) * minute) })
      .where(eq(outbound.id, scope.arrivalId));
    const reconcileDeps = depsOn(reconciler);
    const redriveQueue = createFakeQueue<OutboundJob>(clock, () => 0);
    const redriveLog = createFakeLogger();
    const telegramHeld = heldAtTelegram();

    // The late job and the re-drive have both read the row queued, free, and past due; the job
    // takes it first, and the re-drive's claim comes to it after.
    const [delivering, redriving] = await pg.queueBehindRowLock<unknown>(
      holder,
      (tx) => onTheArrival(tx, "update"),
      [
        { client: gateway, start: () => deliver(gateway, telegramHeld.adapter) },
        {
          client: reconciler,
          start: () =>
            redriveStrandedOutbound({
              ...reconcileDeps,
              logger: redriveLog,
              queues: { ...reconcileDeps.queues, outbound: redriveQueue },
            }),
        },
      ],
    );
    if (delivering === undefined || redriving === undefined) {
      throw new Error("expected two contenders");
    }

    // The morning is at Telegram, and the re-drive has decided: it left the row to its delivery.
    await pg.reach("the late job to reach Telegram", telegramHeld.reached, delivering);
    await pg.finish("the re-drive", redriving);
    expect(await theArrival()).toMatchObject({
      status: "queued",
      sentAt: NOW,
      attempts: 0,
      error: null,
    });
    expect(redriveQueue.pending).toEqual([]);
    expect(redriveLog.entries.filter((entry) => entry.event === "outbound_stranded")).toEqual([]);

    telegramHeld.open.release();
    expect(await pg.finish("the late job", delivering)).toBe("sent");
    await expectDeliveredOnce(1);
  });

  /**
   * A delivery that read her active reaches the take while a connection holds the row
   * `for no key update`; she says stop, and a second delivery reads her paused and comes for the row
   * to drop it, queueing behind the first. Another connection holds the row `for key share`, which
   * the take and the send's record pass and the drop's `for update` does not. Once the take is let
   * go, the first delivery takes the row, and the drop waits on the key share until the test lets
   * it decide.
   */
  async function aDropBehindTheTake(adapter?: ChannelAdapter) {
    const [sender, dropper, keyHolder, holder] = await pg.clientPool("pause", 4);
    if (
      sender === undefined ||
      dropper === undefined ||
      keyHolder === undefined ||
      holder === undefined
    ) {
      throw new Error("expected four race connections");
    }
    const theDrop = await pg.holdRows(keyHolder, (tx) => onTheArrival(tx, "key share"));
    const theTake = await pg.holdRows(holder, (tx) => onTheArrival(tx, "no key update"));

    const sending = pg.track(deliver(sender, adapter));
    await pg.waitForRowLockWait(sender, [holder], sending);
    await say(seeder, "stop");
    const dropping = pg.track(deliver(dropper));
    await pg.waitForRowLockWait(dropper, [sender], dropping);

    await theTake.release();
    await pg.waitForRowLockWait(dropper, [keyHolder], dropping);
    return {
      sending,
      dropping,
      /** Lets the drop lock the row, as it stands by then, and decide. */
      letTheDropDecide: () => theDrop.release(),
    };
  }

  it("leaves her morning to the delivery at Telegram with it when a delivery that read her paused reaches it", async () => {
    const telegramHeld = heldAtTelegram();
    const race = await aDropBehindTheTake(telegramHeld.adapter);
    await pg.reach("the send to reach Telegram", telegramHeld.reached, race.sending);

    // The row is held while the send is out: the drop leaves it and writes nothing.
    await race.letTheDropDecide();
    expect(await pg.finish("the drop", race.dropping)).toBe("skipped");
    expect(await theArrival()).toMatchObject({ status: "queued", sentAt: NOW, attempts: 0 });
    expect(await drops()).toEqual([]);

    telegramHeld.open.release();
    expect(await pg.finish("the send", race.sending)).toBe("sent");
    await expectDeliveredOnce(1);
  });

  it("leaves her morning sent when a delivery that read her paused reaches it after the send was recorded", async () => {
    const race = await aDropBehindTheTake();

    // The send is out and recorded, its effects applied, while the drop still waits for the row.
    expect(await pg.finish("the send", race.sending)).toBe("sent");
    await race.letTheDropDecide();
    expect(await pg.finish("the drop", race.dropping)).toBe("skipped");

    await expectDeliveredOnce(1);
  });

  /** Her morning's files: a family voice note read back, then a photo choice's two photos. */
  const MORNING_MEDIA: MediaRef[] = [
    { kind: "audio", providerFileId: "voice-sam" },
    { kind: "image", providerFileId: "photo-a" },
    { kind: "image", providerFileId: "photo-b" },
  ];

  /** Every file that reached her chat, from the sends that failed part way and those that went out. */
  function filesToHer(): string[] {
    const her = scope.herLink.externalId;
    const partly = telegram.failed
      .filter((entry) => entry.message.to.conversationId === her)
      .flatMap((entry) => entry.sentMedia);
    const whole = telegram.sentTo(her).flatMap((entry) => entry.message.media ?? []);
    return [...partly, ...whole].map((ref) => ref.providerFileId ?? "");
  }

  it("sends each photo once when the retry of a morning whose voice note went out meets a second delivery of it", async () => {
    const payload = (await theArrival()).payload;
    if (typeof payload.message !== "object" || payload.message === null) {
      throw new Error("Expected the arrival's message");
    }
    await seeder.db
      .update(outbound)
      .set({
        // Use the mapped JSON column so provider identifiers receive the same sealing as writes.
        payload: { ...payload, message: { ...payload.message, media: MORNING_MEDIA } },
      })
      .where(eq(outbound.id, scope.arrivalId));
    // The first try: the voice note goes out, then the next call fails for a reason that can pass.
    telegram.failNextSends(1, "unavailable", { mediaDelivered: 1 });
    expect(await deliver(seeder)).toBe("retry");
    expect(await theArrival()).toMatchObject({
      status: "queued",
      attempts: 1,
      sentAt: null,
      payload: { sentMedia: { "voice-sam": "1" } },
    });

    // The retry's job and a second delivery of it (the job delivered twice, or a re-drive's beside
    // it) both read the row as the first try gave it back, and reach for it together.
    const [holder, retry, second] = await pg.clientPool("media", 3);
    if (holder === undefined || retry === undefined || second === undefined) {
      throw new Error("expected three race connections");
    }
    const operations = await pg.queueBehindRowLock<unknown>(
      holder,
      (tx) => onTheArrival(tx, "update"),
      [retry, second].map((client) => ({ client, start: () => deliver(client) })),
    );
    const results = await pg.settle("the retry and the second delivery", operations);
    expect(outcomes(results)).toEqual(["sent", "skipped"]);

    // The voice note from the first try, the two photos and the text from the retry: each once.
    expect(filesToHer()).toEqual(["voice-sam", "photo-a", "photo-b"]);
    expect(telegram.sentTo(scope.herLink.externalId).map((sent) => sent.message.media)).toEqual([
      MORNING_MEDIA.slice(1),
    ]);
    await expectDeliveredOnce(2);
    expect(await arrivalRefs()).toEqual(["1", "2", "3", "4"]);
  });
});
