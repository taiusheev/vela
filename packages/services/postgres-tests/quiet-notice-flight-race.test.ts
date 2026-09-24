/**
 * A quiet notice on its way when her answer closes the event, on independent PostgreSQL connections
 * (flows §3.12). The close tells everyone the event counts as told; the notice's own effect counts
 * its reader once it lands, and tells them how the event closed if it already has. Both lock the
 * event, so one waits for the other and sees what it wrote, and the reader hears it once either way:
 * counted before the close, they are told by the close; counted after, by the effect.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import {
  type ChannelLink,
  type Member,
  outbound,
  quietEvents,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleParentMessage } from "../src/answers.ts";
import { deliverOutbound } from "../src/gateway.ts";
import { openQuiet } from "../src/quiet.ts";
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

interface Scope {
  readonly quietId: string;
  readonly her: Member;
  readonly herLink: ChannelLink;
  readonly miaId: string;
  /** Mia's notice: out on Telegram, its effect — which counts her as told — not yet applied. */
  readonly noticeId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedNoticeInFlight(seeder);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Her morning unanswered three hours on, the notice opened, and Mia's notice mid-flight. */
async function seedNoticeInFlight(client: RaceClient): Promise<Scope> {
  const db: VelaDatabase = client.db;
  const family = await seedFamily(db, { now: NOW });
  await seedLinkedGroup(db, family, { now: NOW });
  const date: LocalDate = localDateOf(NOW, family.member.tz);
  await seedExchange(db, family, {
    date,
    state: "delivered",
    deliveredAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
  });
  await openQuiet(pg.jobDeps(client), family.member.id, date, true);
  const [notice] = await db
    .update(outbound)
    .set({ status: "sent", sentAt: NOW, externalId: "900" })
    .where(and(eq(outbound.kind, "quiet_notice"), eq(outbound.memberId, family.organiser.id)))
    .returning({ id: outbound.id });
  const [quiet] = await db.select({ id: quietEvents.id }).from(quietEvents);
  if (notice === undefined || quiet === undefined) {
    throw new Error("the notice in flight was not seeded");
  }
  return {
    quietId: quiet.id,
    her: family.member,
    herLink: family.memberLink,
    miaId: family.organiser.id,
    noticeId: notice.id,
  };
}

function herAnswer(): InboundEvent {
  return {
    channel: "telegram",
    eventId: "tg:her-answer",
    at: NOW.toISOString(),
    sender: { externalUserId: scope.herLink.externalId },
    conversation: { externalId: scope.herLink.externalId, kind: "private" },
    messageId: "501",
    kind: "text",
    text: "I'm here",
  };
}

function onTheNotice(tx: VelaTransaction) {
  return tx.select().from(quietEvents).where(eq(quietEvents.id, scope.quietId)).for("update");
}

async function closingsForMia() {
  return seeder.db
    .select()
    .from(outbound)
    .where(and(eq(outbound.kind, "quiet_resolved"), eq(outbound.memberId, scope.miaId)));
}

async function expectMiaHearsOnce(results: readonly PromiseSettledResult<unknown>[]) {
  expect(results.map((result) => settled(result).status)).toEqual(["fulfilled", "fulfilled"]);
  const [quiet] = await seeder.db.select().from(quietEvents);
  expect(quiet).toMatchObject({ outcome: "answered_late", notifiedMemberIds: [scope.miaId] });
  // She read that her mother is quiet; she reads that she answered, once.
  expect(await closingsForMia()).toHaveLength(1);
}

describe("a quiet notice on its way as her answer closes the event", () => {
  it("tells the reader through the notice's effect when her answer closes the event first", async () => {
    const [answerer, gateway, holder] = await pg.clientPool("flight", 3);
    if (answerer === undefined || gateway === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheNotice, [
      {
        client: answerer,
        start: () => handleParentMessage(pg.jobDeps(answerer), scope.her, herAnswer()),
      },
      { client: gateway, start: () => deliverOutbound(pg.jobDeps(gateway), scope.noticeId) },
    ]);
    await expectMiaHearsOnce(await pg.settle("her answer and the notice's effect", queued));
  });

  it("tells the reader through the close when the notice's effect counts them first", async () => {
    const [gateway, answerer, holder] = await pg.clientPool("flight", 3);
    if (gateway === undefined || answerer === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheNotice, [
      { client: gateway, start: () => deliverOutbound(pg.jobDeps(gateway), scope.noticeId) },
      {
        client: answerer,
        start: () => handleParentMessage(pg.jobDeps(answerer), scope.her, herAnswer()),
      },
    ]);
    await expectMiaHearsOnce(await pg.settle("the notice's effect and her answer", queued));
  });
});
