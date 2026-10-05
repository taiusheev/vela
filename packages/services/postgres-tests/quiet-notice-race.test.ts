/**
 * The quiet notice closing on independent PostgreSQL connections (spec A11, flows §3.12). When she is
 * quiet, her organisers are told; the notice then closes once — by her answer, or by one of them
 * saying she's fine — and everyone else who was told hears how. However those arrive, it must close
 * once: a second close sends the family a second message that contradicts the first.
 *
 * Her answer and "she's fine" meet on two rows. Her answer locks the exchange, then the notice;
 * "she's fine" locks the notice, then tells the others through outbound rows whose foreign key
 * reaches the exchange. The first race here puts them in exactly that order.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import {
  answers,
  type ChannelLink,
  events,
  exchanges,
  type Member,
  members,
  outbound,
  quietEvents,
  users,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleParentMessage } from "../src/answers.ts";
import type { SessionIdentity } from "../src/api-access.ts";
import { resolveApiQuiet } from "../src/api-quiet.ts";
import { notifyQuiet } from "../src/quiet.ts";
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

/** Mia and Anna both organise, and both were told she is quiet. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const anna: SessionIdentity = { authSubject: "pg-race|anna", sessionId: "session-anna" };

interface Scope {
  readonly quietId: string;
  readonly exchangeId: string;
  readonly date: LocalDate;
  readonly her: Member;
  readonly herLink: ChannelLink;
  readonly miaId: string;
  readonly annaId: string;
  readonly annaConversation: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedQuietMorning(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** A morning delivered three hours ago with no answer, and the notice both organisers were sent. */
async function seedQuietMorning(db: VelaDatabase): Promise<Scope> {
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
  const date = localDateOf(NOW, family.member.tz);
  const exchange = await seedExchange(db, family, {
    date,
    state: "delivered",
    deliveredAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
  });
  const [quiet] = await db
    .insert(quietEvents)
    .values({
      exchangeId: exchange.id,
      memberId: family.member.id,
      openedAt: NOW,
      lastNotifiedAt: NOW,
      notifyCount: 1,
      notifiedMemberIds: [family.organiser.id, sister.member.id],
    })
    .returning();
  if (quiet === undefined) throw new Error("the quiet event was not seeded");
  return {
    quietId: quiet.id,
    exchangeId: exchange.id,
    date,
    her: family.member,
    herLink: family.memberLink,
    miaId: family.organiser.id,
    annaId: sister.member.id,
    annaConversation: sister.link.externalId,
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

/** Her words in her private chat, three hours after the morning reached her. */
function herAnswer(): InboundEvent {
  return {
    channel: "telegram",
    eventId: "tg:her-answer",
    at: NOW.toISOString(),
    sender: { externalUserId: scope.herLink.externalId },
    conversation: { externalId: scope.herLink.externalId, kind: "private" },
    messageId: "501",
    kind: "text",
    text: "I'm here, the phone was in my bag",
  };
}

function sheIsFine(client: RaceClient, who: SessionIdentity, key: string) {
  return resolveApiQuiet(client.deps, who, key, scope.quietId, "fine", {});
}

function onTheNotice(tx: VelaTransaction) {
  return tx.select().from(quietEvents).where(eq(quietEvents.id, scope.quietId)).for("update");
}

/** Each outcome as a word, or as the database's refusal, so a deadlock names itself. */
function outcomes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? "fulfilled" : shown.reason;
  });
}

async function theNotice() {
  const [quiet] = await seeder.db
    .select()
    .from(quietEvents)
    .where(eq(quietEvents.id, scope.quietId));
  return quiet;
}

async function closings() {
  return seeder.db.select().from(events).where(eq(events.name, "quiet_notice_resolved"));
}

async function toldResolved() {
  return seeder.db.select().from(outbound).where(eq(outbound.kind, "quiet_resolved"));
}

describe("the quiet notice closing on independent PostgreSQL connections", () => {
  it("closes once, and loses neither, when her answer arrives as an organiser says she's fine", async () => {
    const [tapper, answerer, holder] = await pg.clientPool("quiet", 3);
    if (tapper === undefined || answerer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // Mia's tap is first to the notice. Her answer locks the exchange on its way to the notice, and
    // queues behind the tap there; the tap then writes Anna's message, whose key is that exchange.
    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheNotice, [
      { client: tapper, start: () => sheIsFine(tapper, mia, "fine-mia") },
      {
        client: answerer,
        start: () => handleParentMessage(pg.jobDeps(answerer), scope.her, herAnswer()),
      },
    ]);
    const results = await pg.settle("the tap and her answer", queued);
    // A tap that fails is tapped again by a person. An answer that fails is her silence.
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    const [answer] = await seeder.db
      .select()
      .from(answers)
      .where(eq(answers.exchangeId, scope.exchangeId));
    expect(answer).toMatchObject({ memberId: scope.her.id, kind: "text" });
    const [exchange] = await seeder.db
      .select()
      .from(exchanges)
      .where(eq(exchanges.id, scope.exchangeId));
    expect(exchange?.state).toBe("answered");

    // Mia closed it; her answer found it closed and left it so.
    expect(await theNotice()).toMatchObject({ outcome: "fine_known", resolvedBy: scope.miaId });
    expect(await closings()).toHaveLength(1);
    expect((await toldResolved()).map((row) => row.conversationId)).toEqual([
      scope.annaConversation,
    ]);
  });

  it("shows the organiser she answered when her answer reaches the notice before the tap", async () => {
    const [answerer, tapper, holder] = await pg.clientPool("quiet", 3);
    if (answerer === undefined || tapper === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheNotice, [
      {
        client: answerer,
        start: () => handleParentMessage(pg.jobDeps(answerer), scope.her, herAnswer()),
      },
      { client: tapper, start: () => sheIsFine(tapper, mia, "fine-mia") },
    ]);
    const results = await pg.settle("her answer and the tap", queued);
    const tap = results[1];
    if (results[0]?.status !== "fulfilled" || tap?.status !== "fulfilled") {
      throw new Error(`expected both to finish, got ${outcomes(results).join(" and ")}`);
    }

    // The tap lost the race and has nothing left to do: it shows the notice closed by her answer,
    // and sends nothing of its own. Everyone who was told hears that she answered.
    const { response, after } = tap.value as Awaited<ReturnType<typeof sheIsFine>>;
    expect(response.body).toMatchObject({ resolved: { outcome: "answered_late", by_name: null } });
    expect(after.outboundIds).toEqual([]);
    expect(await theNotice()).toMatchObject({ outcome: "answered_late", resolvedBy: null });
    expect(await closings()).toHaveLength(1);
    expect((await toldResolved()).map((row) => row.memberId).sort()).toEqual(
      [scope.miaId, scope.annaId].sort(),
    );
  });

  it("closes once, and loses neither, when the detector comes back to the notice as an organiser says she's fine", async () => {
    const [tapper, detector, holder] = await pg.clientPool("quiet", 3);
    if (tapper === undefined || detector === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // The detector takes the exchange first, as her answer does, and so meets the tap the same way.
    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheNotice, [
      { client: tapper, start: () => sheIsFine(tapper, mia, "fine-mia") },
      {
        client: detector,
        start: () => notifyQuiet(pg.jobDeps(detector), scope.her.id, scope.date),
      },
    ]);
    const results = await pg.settle("the tap and the detector", queued);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // Mia closed it; the detector found it closed and raised nothing more.
    expect(await theNotice()).toMatchObject({ outcome: "fine_known", resolvedBy: scope.miaId });
    expect(
      await seeder.db.select().from(outbound).where(eq(outbound.kind, "quiet_notice")),
    ).toEqual([]);
    expect((await toldResolved()).map((row) => row.conversationId)).toEqual([
      scope.annaConversation,
    ]);
  });

  it("closes once when two organisers say she's fine at the same moment", async () => {
    const [first, second, holder] = await pg.clientPool("quiet", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock(holder, onTheNotice, [
      { client: first, start: () => sheIsFine(first, mia, "fine-mia") },
      { client: second, start: () => sheIsFine(second, anna, "fine-anna") },
    ]);
    const results = await pg.settle("both taps", queued);
    const [hers, theirs] = results;
    if (hers?.status !== "fulfilled" || theirs?.status !== "fulfilled") {
      throw new Error(`expected both taps answered, got ${outcomes(results).join(" and ")}`);
    }

    // Anna's tap lost the race: it is answered with the notice as Mia left it, and sends nothing.
    expect(theirs.value.response.status).toBe(200);
    expect(theirs.value.response.body).toMatchObject({
      resolved: { outcome: "fine_known", by_name: "Mia" },
    });
    expect(hers.value.after.outboundIds).toHaveLength(1);
    expect(theirs.value.after.outboundIds).toEqual([]);

    expect(await theNotice()).toMatchObject({ outcome: "fine_known", resolvedBy: scope.miaId });
    expect(await closings()).toHaveLength(1);
    expect((await toldResolved()).map((row) => row.conversationId)).toEqual([
      scope.annaConversation,
    ]);
  });
});
