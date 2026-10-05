/**
 * Her tap on yesterday's arrival and today's quiet, on independent PostgreSQL connections (flows
 * §3.9, §3.12). An answer counts for the local date it arrives on, whichever exchange it attaches
 * to: a tap on yesterday's buttons (answered by voice, the buttons stay) is today's answer too. So
 * her answer locks her delivered exchange for today after the one it answers
 * (`lockDeliveredExchangeForLocalDate`, the lock `openQuiet` and `notifyQuiet` take) and closes
 * today's open quiet; and the ladder, under that lock, refuses a date that has an answer of hers
 * (`firstAnswersByDate`). Whichever of the two gets there first, the other must see it: an event
 * opened or re-notified after her tap stays open for good, and tells the organisers she is quiet
 * after she answered, with nothing to follow.
 *
 * "She's fine" meets her answer on today's event: it holds the event and writes outbound rows whose
 * foreign key is today's exchange, while her answer holds that exchange and waits for the event.
 * Her answer's lock on it is `for no key update`, which those foreign-key checks pass; `for update`
 * would close the cycle that once aborted her answer (code design §8, "Lock order").
 *
 * Each race holds the rows one contender needs next, starts the contenders one at a time, and
 * confirms where each waits. A contender allowed to go on without waiting is one whose guard is the
 * lock itself: with the lock gone it finishes early, and the outcome the test asserts is what fails.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { addDays, encodeButton, localDateOf } from "@vela/core";
import {
  answers,
  type ChannelLink,
  events,
  type Member,
  members,
  outbound,
  quietEvents,
  users,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AnswerButtonAction, handleAnswerButton } from "../src/answers.ts";
import type { SessionIdentity } from "../src/api-access.ts";
import { resolveApiQuiet } from "../src/api-quiet.ts";
import type { Clock, Deps } from "../src/deps.ts";
import { deliverOutbound } from "../src/gateway.ts";
import { notifyQuiet, openQuiet } from "../src/quiet.ts";
import { createFakeTelegram, type FakeTelegram } from "../src/testing/fake-telegram.ts";
import { createFakeRandom, type FakeRandom } from "../src/testing/fakes.ts";
import { seedExchange, seedFamily, seedGroupMember, seedLinkedGroup } from "../src/testing/seed.ts";
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

/** Mia and Anna both organise; Mia can say she's fine from the app. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const anna: SessionIdentity = { authSubject: "pg-race|anna", sessionId: "session-anna" };

interface Scope {
  readonly her: Member;
  readonly herLink: ChannelLink;
  readonly miaId: string;
  readonly annaId: string;
  readonly today: LocalDate;
  readonly todayId: string;
  readonly yesterdayId: string;
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
  scope = await seedTwoMornings(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/**
 * Yesterday's morning, answered by voice (its buttons stay), and today's, delivered three hours ago
 * and unanswered. Mia and Anna organise, and each has an account.
 */
async function seedTwoMornings(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  await seedLinkedGroup(db, family, { now: NOW });
  const sister = await seedGroupMember(db, family, {
    now: NOW,
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, anna, "Anna", sister.member.id);
  const today = localDateOf(NOW, family.member.tz);
  const yesterday = await seedExchange(db, family, {
    date: addDays(today, -1),
    state: "answered",
    deliveredAt: new Date(NOW.getTime() - 27 * 60 * minute),
    answeredAt: new Date(NOW.getTime() - 26 * 60 * minute),
  });
  const morning = await seedExchange(db, family, {
    date: today,
    state: "delivered",
    deliveredAt: new Date(NOW.getTime() - 3 * 60 * minute),
  });
  return {
    her: family.member,
    herLink: family.memberLink,
    miaId: family.organiser.id,
    annaId: sister.member.id,
    today,
    todayId: morning.id,
    yesterdayId: yesterday.id,
  };
}

async function signIn(
  db: VelaDatabase,
  identity: SessionIdentity,
  displayName: string,
  memberId: string,
): Promise<void> {
  const [account] = await db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName })
    .returning();
  if (account === undefined) throw new Error(`expected an account for ${displayName}`);
  await db.update(members).set({ userId: account.id }).where(eq(members.id, memberId));
}

/**
 * Today's quiet, opened and told to both organisers. With `waitRanOut`, one of them tapped "wait 2
 * hours" after that notice and the wait has run out, so the notice is due again.
 */
async function seedTodaysQuiet(options: { waitRanOut: boolean }): Promise<void> {
  await seeder.db.insert(quietEvents).values({
    exchangeId: scope.todayId,
    memberId: scope.her.id,
    openedAt: new Date(NOW.getTime() - 150 * minute),
    lastNotifiedAt: new Date(NOW.getTime() - 150 * minute),
    notifyCount: 1,
    notifiedMemberIds: [scope.miaId, scope.annaId],
    waitUntil: options.waitRanOut ? new Date(NOW.getTime() - 30 * minute) : null,
  });
}

/** A job's deps on its own connection; one Telegram and one random for the whole race. */
function depsOn(client: RaceClient): Deps {
  return { ...pg.jobDeps(client), random, channels: { get: () => telegram } };
}

const onYesterday = (): AnswerButtonAction => ({
  type: "answer",
  exchangeId: scope.yesterdayId,
  answer: "fine",
});

/** Her tap on "I'm fine" under yesterday's arrival, now. */
function tapYesterday(client: RaceClient): Promise<void> {
  const action = onYesterday();
  const event: InboundEvent = {
    channel: "telegram",
    eventId: "tg:her-tap",
    at: NOW.toISOString(),
    sender: { externalUserId: scope.herLink.externalId },
    conversation: { externalId: scope.herLink.externalId, kind: "private" },
    messageId: "400",
    kind: "button",
    buttonData: encodeButton(action),
    callbackId: "cb-yesterday",
  };
  return handleAnswerButton(depsOn(client), scope.her, event, action);
}

function sheIsFine(client: RaceClient, quietId: string) {
  return resolveApiQuiet(client.deps, mia, "fine-mia", quietId, "fine", {});
}

/** The organisers' rows, which the foreign key of every notice to them reads `for key share`. */
function onTheOrganisers(tx: VelaTransaction) {
  return tx
    .select()
    .from(members)
    .where(inArray(members.id, [scope.miaId, scope.annaId]))
    .for("update");
}

/** Her own row, which her answer writes last (`markWakeDue`), after both exchanges are locked. */
function onHerRow(tx: VelaTransaction) {
  return tx.select().from(members).where(eq(members.id, scope.her.id)).for("no key update");
}

async function todaysQuiet() {
  const [quiet] = await seeder.db
    .select()
    .from(quietEvents)
    .where(eq(quietEvents.exchangeId, scope.todayId));
  return quiet;
}

async function closings() {
  return seeder.db.select().from(events).where(eq(events.name, "quiet_notice_resolved"));
}

async function rowsOf(kind: "quiet_notice" | "quiet_resolved") {
  return seeder.db.select().from(outbound).where(eq(outbound.kind, kind));
}

/** Who among the organisers each row is to, sorted, so the count per organiser shows. */
function readers(rows: readonly { memberId: string }[]): string[] {
  return rows.map((row) => row.memberId).sort();
}

function bothOrganisers(): string[] {
  return [scope.miaId, scope.annaId].sort();
}

/** Each outcome as a word, or as the database's refusal, so a deadlock names itself. */
function outcomes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? "fulfilled" : shown.reason;
  });
}

/** Her tap was recorded as yesterday's answer, received now: today's answer too. */
async function expectHerTapRecorded(): Promise<void> {
  const rows = await seeder.db.select().from(answers).where(eq(answers.memberId, scope.her.id));
  expect(rows.map((row) => [row.exchangeId, row.kind, row.receivedAt])).toEqual([
    [scope.yesterdayId, "fine", NOW],
  ]);
}

/**
 * The quiet notices still on their way reach nobody: the gateway drops each one whose event has
 * closed (flows §3.12), so no organiser reads that she is quiet after she answered.
 */
async function expectNoticesDropped(notices: readonly { id: string }[]): Promise<void> {
  const delivery = depsOn(seeder);
  for (const notice of notices) {
    expect(await deliverOutbound(delivery, notice.id)).toBe("skipped");
  }
  expect((await rowsOf("quiet_notice")).map((row) => [row.status, row.error])).toEqual(
    notices.map(() => ["dropped", "quiet_resolved"]),
  );
  expect(telegram.sent).toEqual([]);
}

describe("her tap on yesterday's arrival and today's quiet ladder", () => {
  it("closes today's quiet once when her tap comes while the ladder is opening it", async () => {
    const [opener, tapper, holder] = await pg.clientPool("ladder", 3);
    if (opener === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The ladder has today's exchange and its new event, and waits to write the notices, whose
    // foreign key reads the organisers' rows. Her tap then reaches today's exchange.
    const held = await pg.holdRows(holder, onTheOrganisers);
    const opening = pg.track(openQuiet(depsOn(opener), scope.her.id, scope.today, true));
    await pg.waitForRowLockWait(opener, [holder], opening);
    const tapping = pg.track(tapYesterday(tapper));
    await pg.waitForRowLockWaitOrCompletion(tapper, [opener], tapping);
    await held.release();
    const results = await pg.settle<unknown>("the ladder and her tap", [opening, tapping]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // The event opened, and her tap, waiting for it, closed it: once, telling nobody, since no
    // notice had gone out yet.
    await expectHerTapRecorded();
    expect(await todaysQuiet()).toMatchObject({ outcome: "answered_late", resolvedBy: null });
    expect(await closings()).toHaveLength(1);
    expect(await rowsOf("quiet_resolved")).toEqual([]);
    const notices = await rowsOf("quiet_notice");
    expect(readers(notices)).toEqual(bothOrganisers());
    await expectNoticesDropped(notices);
  });

  it("opens no quiet for today when her tap is first to today's exchange", async () => {
    const [tapper, opener, holder] = await pg.clientPool("ladder", 3);
    if (opener === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // Her tap holds yesterday's exchange and today's, and waits to write her row last. The ladder
    // then reaches today's exchange, decided on state read before her tap.
    const held = await pg.holdRows(holder, onHerRow);
    const tapping = pg.track(tapYesterday(tapper));
    await pg.waitForRowLockWait(tapper, [holder], tapping);
    const opening = pg.track(openQuiet(depsOn(opener), scope.her.id, scope.today, true));
    await pg.waitForRowLockWaitOrCompletion(opener, [tapper], opening);
    await held.release();
    const results = await pg.settle<unknown>("her tap and the ladder", [tapping, opening]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // Under the lock the ladder found today's answer, although it is yesterday's exchange that
    // took it, and opened nothing.
    await expectHerTapRecorded();
    expect(await todaysQuiet()).toBeUndefined();
    expect(await rowsOf("quiet_notice")).toEqual([]);
    expect(await closings()).toEqual([]);
  });

  it("tells each organiser once, that she answered, when her tap comes while the notice is due again", async () => {
    await seedTodaysQuiet({ waitRanOut: true });
    const [notifier, tapper, holder] = await pg.clientPool("ladder", 3);
    if (notifier === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The wait has run out: the ladder has today's exchange and its event, and waits to write the
    // second round of notices. Her tap then reaches today's exchange.
    const held = await pg.holdRows(holder, onTheOrganisers);
    const notifying = pg.track(notifyQuiet(depsOn(notifier), scope.her.id, scope.today));
    await pg.waitForRowLockWait(notifier, [holder], notifying);
    const tapping = pg.track(tapYesterday(tapper));
    await pg.waitForRowLockWaitOrCompletion(tapper, [notifier], tapping);
    await held.release();
    const results = await pg.settle<unknown>("the ladder and her tap", [notifying, tapping]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    await expectHerTapRecorded();
    expect(await todaysQuiet()).toMatchObject({ outcome: "answered_late", resolvedBy: null });
    expect(await closings()).toHaveLength(1);
    // Both were told she is quiet this morning; each hears once that she answered.
    expect(readers(await rowsOf("quiet_resolved"))).toEqual(bothOrganisers());
    // The second round, written before her tap, never goes out.
    const notices = await rowsOf("quiet_notice");
    expect(readers(notices)).toEqual(bothOrganisers());
    await expectNoticesDropped(notices);
  });

  it("sends no second notice, and tells each organiser once, when her tap is first to today's exchange", async () => {
    await seedTodaysQuiet({ waitRanOut: true });
    const [tapper, notifier, holder] = await pg.clientPool("ladder", 3);
    if (notifier === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const held = await pg.holdRows(holder, onHerRow);
    const tapping = pg.track(tapYesterday(tapper));
    await pg.waitForRowLockWait(tapper, [holder], tapping);
    const notifying = pg.track(notifyQuiet(depsOn(notifier), scope.her.id, scope.today));
    await pg.waitForRowLockWaitOrCompletion(notifier, [tapper], notifying);
    await held.release();
    const results = await pg.settle<unknown>("her tap and the ladder", [tapping, notifying]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    await expectHerTapRecorded();
    expect(await todaysQuiet()).toMatchObject({ outcome: "answered_late", notifyCount: 1 });
    expect(await closings()).toHaveLength(1);
    expect(readers(await rowsOf("quiet_resolved"))).toEqual(bothOrganisers());
    expect(await rowsOf("quiet_notice")).toEqual([]);
  });
});

describe("her tap on yesterday's arrival and \"she's fine\" on today's quiet", () => {
  function onTodaysQuiet(tx: VelaTransaction) {
    return tx
      .select()
      .from(quietEvents)
      .where(eq(quietEvents.exchangeId, scope.todayId))
      .for("update");
  }

  async function todaysQuietId(): Promise<string> {
    const quiet = await todaysQuiet();
    if (quiet === undefined) throw new Error("today's quiet was not seeded");
    return quiet.id;
  }

  it("closes once, without a deadlock, when Mia says she's fine as her tap comes", async () => {
    await seedTodaysQuiet({ waitRanOut: false });
    const quietId = await todaysQuietId();
    const [finer, tapper, holder] = await pg.clientPool("fine", 3);
    if (finer === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // Mia is first to the event. Her tap locks today's exchange on its way there and queues behind
    // Mia, who then writes Anna's message, whose foreign key is that exchange.
    const queued = await pg.queueBehindRowLock<unknown>(holder, onTodaysQuiet, [
      { client: finer, start: () => sheIsFine(finer, quietId) },
      { client: tapper, start: () => tapYesterday(tapper) },
    ]);
    const results = await pg.settle<unknown>("she's fine and her tap", queued);
    // A tap that fails is tapped again by a person. An answer that fails is her silence.
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    await expectHerTapRecorded();
    expect(await todaysQuiet()).toMatchObject({ outcome: "fine_known", resolvedBy: scope.miaId });
    expect(await closings()).toHaveLength(1);
    // Anna hears it from Mia; her tap found the event closed and tells nobody again.
    expect(readers(await rowsOf("quiet_resolved"))).toEqual([scope.annaId]);
  });

  it("closes once, as answered, when her tap is first to today's quiet and Mia says she's fine", async () => {
    await seedTodaysQuiet({ waitRanOut: false });
    const quietId = await todaysQuietId();
    const [tapper, finer, holder] = await pg.clientPool("fine", 3);
    if (finer === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const held = await pg.holdRows(holder, onTodaysQuiet);
    const tapping = pg.track(tapYesterday(tapper));
    const tapState = await pg.waitForRowLockWaitOrCompletion(tapper, [holder], tapping);
    const fining = pg.track(sheIsFine(finer, quietId));
    await pg.waitForRowLockWait(finer, [tapState === "waiting" ? tapper : holder], fining);
    await held.release();
    const results = await pg.settle<unknown>("her tap and she's fine", [tapping, fining]);
    const fine = results[1];
    if (results[0]?.status !== "fulfilled" || fine?.status !== "fulfilled") {
      throw new Error(`expected both to finish, got ${outcomes(results).join(" and ")}`);
    }

    // Her tap closed today's event; Mia's tap shows it closed by her answer and sends nothing.
    await expectHerTapRecorded();
    const { response, after } = fine.value as Awaited<ReturnType<typeof sheIsFine>>;
    expect(response.body).toMatchObject({
      resolved: { outcome: "answered_late", by_name: null },
    });
    expect(after.outboundIds).toEqual([]);
    expect(await todaysQuiet()).toMatchObject({ outcome: "answered_late", resolvedBy: null });
    expect(await closings()).toHaveLength(1);
    expect(readers(await rowsOf("quiet_resolved"))).toEqual(bothOrganisers());
  });
});
