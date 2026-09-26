/**
 * Her morning, her stop and her start, on independent PostgreSQL connections (flows §3.7, §3.13).
 * The gateway drops her arrival unsent while she is paused (`member_paused`), and her start's tick,
 * asking for that morning again, queues the dropped row back (`requeueArrivalHeldByPause`). Both act
 * on the one row, from state each read a moment earlier, and a delivery reads her status before it
 * decides:
 *
 * - A delivery that read her paused just before her start must not drop the row after the start's
 *   tick found it still queued and left it to that delivery: the morning her start asked for would
 *   be lost until a later tick. So the drop checks again, under the row's lock and then hers, which
 *   her start takes before it makes her active.
 * - A drop and the requeue of her start's tick meet in either order, and the requeue comes last:
 *   her start waits for the drop's lock on her row, and the tick queues the dropped row again.
 * - A delivery that read her paused must not drop a row another delivery of it (a re-drive beside a
 *   late job) has just sent: `dropped` over `sent` hides the send from the effects' recovery, and her
 *   start would then queue the morning again and send it twice.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { localDateOf, type ParentCommand } from "@vela/core";
import {
  type ChannelLink,
  events,
  type Member,
  members,
  outbound,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverArrival } from "../src/arrivals.ts";
import type { Clock, Deps } from "../src/deps.ts";
import { deliverOutbound } from "../src/gateway.ts";
import { handleParentCommand } from "../src/parent-commands.ts";
import { memberById } from "../src/repo.ts";
import { createFakeTelegram, type FakeTelegram } from "../src/testing/fake-telegram.ts";
import { createFakeRandom, type FakeRandom } from "../src/testing/fakes.ts";
import { seedFamily, seedLinkedGroup } from "../src/testing/seed.ts";
import {
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

const day = 24 * 60 * 60_000;
const clock: Clock = { now: () => new Date(NOW.getTime()) };

interface Scope {
  readonly herId: string;
  readonly herLink: ChannelLink;
  readonly today: LocalDate;
  /** Her 08:00 morning, queued by the tick and not sent yet. */
  readonly arrivalId: string;
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

/** A job's deps on its own connection; one Telegram and one random for the whole race. */
function depsOn(client: RaceClient): Deps {
  return { ...pg.jobDeps(client), random, channels: { get: () => telegram } };
}

/** Her light on for ten days, and it is 08:00: her morning is prepared and queued, not sent yet. */
async function seedMorningQueued(db: VelaDatabase): Promise<Scope> {
  const seed = await seedFamily(db, { now: new Date(NOW.getTime() - 10 * day) });
  await seedLinkedGroup(db, seed, { now: NOW });
  const today = localDateOf(NOW, seed.member.tz);
  await deliverArrival(depsOn(seeder), seed.member.id, today, false);
  const [arrival] = await db
    .select({ id: outbound.id })
    .from(outbound)
    .where(and(eq(outbound.kind, "arrival"), eq(outbound.status, "queued")));
  if (arrival === undefined) throw new Error("her morning was not queued");
  return { herId: seed.member.id, herLink: seed.memberLink, today, arrivalId: arrival.id };
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

function deliver(client: RaceClient) {
  return deliverOutbound(depsOn(client), scope.arrivalId);
}

function onTheArrival(tx: VelaTransaction) {
  return tx.select().from(outbound).where(eq(outbound.id, scope.arrivalId)).for("update");
}

function onHerRow(tx: VelaTransaction) {
  return tx.select().from(members).where(eq(members.id, scope.herId)).for("no key update");
}

function outcomes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? "fulfilled" : shown.reason;
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

/** Her morning as it reached her phone: each arrival Telegram was asked to send. */
function morningsSent(): number {
  return telegram.sent.filter((sent) => sent.message.kind === "arrival").length;
}

/**
 * Her morning goes out, once: a row still queued is delivered by the job its queueing enqueued, and
 * then it is sent, with one arrival on her phone.
 */
async function expectHerMorningOnce(): Promise<void> {
  if ((await theArrival()).status === "queued") {
    expect(await deliver(seeder)).toBe("sent");
  }
  expect(await theArrival()).toMatchObject({ status: "sent" });
  expect(morningsSent()).toBe(1);
}

describe("her morning dropped for her pause, and her start", () => {
  it("sends the morning her start asks for when a delivery read her paused just before her start", async () => {
    await say(seeder, "stop");
    const [gateway, starter, holder] = await pg.clientPool("pause", 3);
    if (gateway === undefined || starter === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The delivery has read her paused and reaches for the row to drop it; her start then makes
    // her active, and its tick asks for this morning while the row is still queued.
    const held = await pg.holdRows(holder, onTheArrival);
    const delivering = pg.track(deliver(gateway));
    await pg.waitForRowLockWait(gateway, [holder], delivering);
    const starting = pg.track(say(starter, "start"));
    await pg.waitForRowLockWaitOrCompletion(starter, [gateway], starting);
    await held.release();
    const results = await pg.settle<unknown>("the delivery and her start", [delivering, starting]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    await expectHerMorningOnce();
    expect(await drops()).toEqual([]);
  });

  it("queues the morning again when her start comes while a delivery is dropping it", async () => {
    await say(seeder, "stop");
    const [gateway, starter, holder] = await pg.clientPool("pause", 3);
    if (gateway === undefined || starter === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The delivery drops the row while her row is held; her start, reaching for her row, comes in
    // behind it, and its tick asks for the morning once the drop is in.
    const held = await pg.holdRows(holder, onHerRow);
    const delivering = pg.track(deliver(gateway));
    const dropping = await pg.waitForRowLockWaitOrCompletion(gateway, [holder], delivering);
    const starting = pg.track(say(starter, "start"));
    await pg.waitForRowLockWait(starter, [dropping === "waiting" ? gateway : holder], starting);
    await held.release();
    const results = await pg.settle<unknown>("the drop and her start", [delivering, starting]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // Dropped for her pause, then queued again, fresh, by her start's tick.
    expect(await drops()).toEqual([{ kind: "arrival", reason: "member_paused" }]);
    expect(await theArrival()).toMatchObject({ status: "queued", attempts: 0, error: null });
    await expectHerMorningOnce();
  });

  it("keeps her morning sent when a delivery that read her paused reaches it as another delivery sends it", async () => {
    const [sender, dropper, holder] = await pg.clientPool("pause", 3);
    if (sender === undefined || dropper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // One delivery read her active and sent the morning, and is about to record the send; she then
    // says stop, and a second delivery of the same row, reading her paused, comes to drop it.
    const held = await pg.holdRows(holder, onTheArrival);
    const sending = pg.track(deliver(sender));
    await pg.waitForRowLockWait(sender, [holder], sending);
    await say(seeder, "stop");
    const dropping = pg.track(deliver(dropper));
    await pg.waitForRowLockWait(dropper, [sender], dropping);
    await held.release();
    const results = await pg.settle<unknown>("the send and the drop", [sending, dropping]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // It is on her phone, and the row says so: sent once, delivered once, never dropped.
    expect(await theArrival()).toMatchObject({ status: "sent", attempts: 1 });
    expect(morningsSent()).toBe(1);
    expect(
      await seeder.db.select().from(events).where(eq(events.name, "arrival_delivered")),
    ).toHaveLength(1);
    expect(await drops()).toEqual([]);
  });
});
