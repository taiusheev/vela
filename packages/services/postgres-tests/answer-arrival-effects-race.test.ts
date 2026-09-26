/**
 * Her answer and her arrival's delivery effects, on independent PostgreSQL connections (flows §3.7,
 * §3.9). The send of a morning commits before its effects (D-B1): the effects, in their own
 * transaction, lock the morning `for update`, mark it delivered, and then lock the exchange its
 * read-back came from, which is yesterday's. Two answers of hers meet that transaction:
 *
 * - A tap on yesterday's arrival locks yesterday's exchange, and then her exchange for today — but
 *   only once today's is delivered (`lockDeliveredExchangeForLocalDate`), so it passes over a morning
 *   whose effects are still being written instead of waiting for them while it holds the exchange
 *   they need next. Waiting would be a lock cycle, and PostgreSQL would abort one of the two.
 * - Her message while the effects are late finishes them itself (`finishArrivalEffects`, flows
 *   §3.9), which the queue's retry of the same row may be doing at that moment. The claim on
 *   `effects_at` lets one of them apply the effects, once; the other finds them applied.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { addDays, encodeButton, localDateOf, outboundKey } from "@vela/core";
import {
  answers,
  type ChannelLink,
  events,
  exchanges,
  type Member,
  outbound,
  replies,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AnswerButtonAction,
  handleAnswerButton,
  handleParentMessage,
} from "../src/answers.ts";
import type { Clock, Deps } from "../src/deps.ts";
import { deliverOutbound, insertOutbound } from "../src/gateway.ts";
import { createFakeTelegram, type FakeTelegram } from "../src/testing/fake-telegram.ts";
import { createFakeRandom, type FakeRandom } from "../src/testing/fakes.ts";
import { seedExchange, seedFamily, seedLinkedGroup } from "../src/testing/seed.ts";
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

const minute = 60_000;
const clock: Clock = { now: () => new Date(NOW.getTime()) };
/** Today's arrival went out 30 seconds ago; its effects have not landed. */
const SENT_AT = new Date(NOW.getTime() - 30_000);

interface Scope {
  readonly her: Member;
  readonly herLink: ChannelLink;
  readonly today: LocalDate;
  readonly todayId: string;
  readonly yesterdayId: string;
  /** Mia's reply to yesterday's answer, read back in this morning's arrival. */
  readonly replyId: string;
  readonly arrivalId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  telegram = createFakeTelegram(clock);
  random = createFakeRandom();
  scope = await seedArrivalOnItsWay(seeder.db);
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

/**
 * Yesterday's morning, answered by voice and replied to by Mia; today's, whose arrival (reading
 * Mia's reply back) is on her phone, sent 30 seconds ago, while its effects have not landed.
 */
async function seedArrivalOnItsWay(db: VelaDatabase): Promise<Scope> {
  const seed = await seedFamily(db, { now: NOW });
  await seedLinkedGroup(db, seed, { now: NOW });
  const today = localDateOf(NOW, seed.member.tz);
  const yesterday = await seedExchange(db, seed, {
    date: addDays(today, -1),
    state: "replied",
    deliveredAt: new Date(NOW.getTime() - 27 * 60 * minute),
    answeredAt: new Date(NOW.getTime() - 26 * 60 * minute),
  });
  const [reply] = await db
    .insert(replies)
    .values({
      exchangeId: yesterday.id,
      memberId: seed.organiser.id,
      kind: "text",
      text: "Save me a dumpling",
      channel: "telegram",
      externalId: "-100500:88",
      createdAt: new Date(NOW.getTime() - 25 * 60 * minute),
    })
    .returning();
  const morning = await seedExchange(db, seed, { date: today, state: "scheduled" });
  if (reply === undefined) throw new Error("the reply was not seeded");
  const written = await insertOutbound(pg.jobDeps(seeder), db, {
    kind: "arrival",
    idempotencyKey: outboundKey("arrival", { memberId: seed.member.id, date: today }),
    memberId: seed.member.id,
    channel: "telegram",
    conversationId: seed.memberLink.externalId,
    localDay: today,
    exchangeId: morning.id,
    lang: "en",
    text: "Good morning, Mrs Chen.",
    ref: { purpose: "arrival", exchangeId: morning.id },
    effect: {
      exchangeId: morning.id,
      late: false,
      readBackReplyIds: [reply.id],
      previousExchangeId: yesterday.id,
    },
  });
  if (!("outboundId" in written)) throw new Error("the arrival was not seeded");
  await db
    .update(outbound)
    .set({ status: "sent", sentAt: SENT_AT, attempts: 1, externalId: "700" })
    .where(eq(outbound.id, written.outboundId));
  return {
    her: seed.member,
    herLink: seed.memberLink,
    today,
    todayId: morning.id,
    yesterdayId: yesterday.id,
    replyId: reply.id,
    arrivalId: written.outboundId,
  };
}

function fromHer(extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] }): InboundEvent {
  return {
    channel: "telegram",
    eventId: "tg:her-words",
    at: NOW.toISOString(),
    sender: { externalUserId: scope.herLink.externalId },
    conversation: { externalId: scope.herLink.externalId, kind: "private" },
    messageId: "701",
    ...extra,
  };
}

/** Her tap on "I'm fine" under yesterday's arrival, now. */
function tapYesterday(client: RaceClient): Promise<void> {
  const action: AnswerButtonAction = {
    type: "answer",
    exchangeId: scope.yesterdayId,
    answer: "fine",
  };
  return handleAnswerButton(
    depsOn(client),
    scope.her,
    fromHer({
      kind: "button",
      messageId: "400",
      buttonData: encodeButton(action),
      callbackId: "cb-yesterday",
    }),
    action,
  );
}

/** The queue's retry of the arrival: the send is recorded, so it finishes the effects only. */
function retryArrival(client: RaceClient) {
  return deliverOutbound(depsOn(client), scope.arrivalId);
}

function outcomes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? "fulfilled" : shown.reason;
  });
}

async function exchangeRow(id: string) {
  const [row] = await seeder.db.select().from(exchanges).where(eq(exchanges.id, id));
  return row;
}

async function deliveries() {
  return seeder.db.select().from(events).where(eq(events.name, "arrival_delivered"));
}

async function herAnswers() {
  return seeder.db.select().from(answers).where(eq(answers.memberId, scope.her.id));
}

describe("her answer as her arrival's delivery effects land", () => {
  it("passes over today's morning while its effects are written, so her tap on yesterday's arrival and the effects both commit", async () => {
    const [gateway, tapper, holder] = await pg.clientPool("effects", 3);
    if (gateway === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The effects hold today's morning, marked delivered but not committed, and wait on Mia's
    // reply before they lock yesterday's exchange. Her tap then locks yesterday's exchange and
    // reaches for today's.
    const held = await pg.holdRows(holder, (tx: VelaTransaction) =>
      tx.select().from(replies).where(eq(replies.id, scope.replyId)).for("update"),
    );
    const retrying = pg.track(retryArrival(gateway));
    await pg.waitForRowLockWait(gateway, [holder], retrying);
    const tapping = pg.track(tapYesterday(tapper));
    await pg.waitForRowLockWaitOrCompletion(tapper, [gateway], tapping);
    await held.release();
    const results = await pg.settle<unknown>("the effects and her tap", [retrying, tapping]);
    // An answer that fails is her silence; effects that fail leave her morning undelivered.
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    expect((await herAnswers()).map((row) => [row.exchangeId, row.kind])).toEqual([
      [scope.yesterdayId, "fine"],
    ]);
    expect(await exchangeRow(scope.todayId)).toMatchObject({
      state: "delivered",
      deliveredAt: SENT_AT,
    });
    expect(await exchangeRow(scope.yesterdayId)).toMatchObject({
      state: "read_back",
      readBackAt: SENT_AT,
    });
    expect(await deliveries()).toHaveLength(1);
  });

  it("applies the effects once when her message finishes them as the queue's retry does", async () => {
    const [gateway, writer, holder] = await pg.clientPool("effects", 3);
    if (gateway === undefined || writer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The retry has claimed the effects and waits for today's morning. Her message, finishing her
    // late arrivals first, reaches the same claim.
    const held = await pg.holdRows(holder, (tx: VelaTransaction) =>
      tx.select().from(exchanges).where(eq(exchanges.id, scope.todayId)).for("update"),
    );
    const retrying = pg.track(retryArrival(gateway));
    await pg.waitForRowLockWait(gateway, [holder], retrying);
    const writing = pg.track(
      handleParentMessage(
        depsOn(writer),
        scope.her,
        fromHer({ kind: "text", text: "Good morning! Rain here." }),
      ),
    );
    await pg.waitForRowLockWait(writer, [gateway], writing);
    await held.release();
    const results = await pg.settle<unknown>("the retry and her message", [retrying, writing]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // Delivered once, and her words answer the morning on her phone.
    expect(await deliveries()).toHaveLength(1);
    expect(await exchangeRow(scope.todayId)).toMatchObject({
      state: "answered",
      deliveredAt: SENT_AT,
      answeredAt: NOW,
    });
    expect((await herAnswers()).map((row) => [row.exchangeId, row.kind])).toEqual([
      [scope.todayId, "text"],
    ]);
    expect(telegram.sent).toEqual([]);
  });
});
