/**
 * Someone nearby on Telegram (ADR-36), on independent PostgreSQL connections.
 *
 * - "Ask them to look in" from two organisers at once, for the same person on the same morning:
 *   different actors, so `runApiMutation` does not queue them; the quiet event's row lock does, and
 *   the second finds the first's ask and sends nothing new. Without it both read no ask, both
 *   answer 201 as the one who asked, and the event keeps whichever wrote last.
 * - Their Yes tapped twice at once (a double tap, or Telegram's redelivery of a slow one): the
 *   contact's row lock queues the two, and the second finds the link answered. Without it both see
 *   the link waiting and both record a yes.
 */

import type { InboundEvent } from "@vela/contracts";
import {
  consents,
  members,
  nearbyContacts,
  outbound,
  quietEvents,
  users,
  type VelaDatabase,
} from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { askApiToLookIn } from "../src/nearby-ask.ts";
import {
  handleNearbyConsentButton,
  handleNearbyStart,
  inviteApiNearby,
} from "../src/nearby-consent.ts";
import { seedExchange, seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const anna: SessionIdentity = { authSubject: "pg-race|anna", sessionId: "session-anna" };
const LENA = "777001";

interface Scope {
  readonly familyId: string;
  readonly herId: string;
  readonly listedId: string;
  readonly askedId: string;
  readonly quietId: string;
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

/** Two organisers, Lena listed on Telegram, someone else not yet asked, and a quiet morning. */
async function seedQuietMorning(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const sister = await seedGroupMember(db, family, {
    now: NOW,
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, anna, "Anna", sister.member.id);
  const [listed] = await db
    .insert(nearbyContacts)
    .values({
      familyId: family.family.id,
      memberId: family.member.id,
      name: "Lena",
      channel: "telegram",
      externalId: LENA,
      consentedAt: NOW,
      createdAt: NOW,
    })
    .returning();
  const [asked] = await db
    .insert(nearbyContacts)
    .values({
      familyId: family.family.id,
      memberId: family.member.id,
      name: "Petro",
      createdAt: NOW,
    })
    .returning();
  const exchange = await seedExchange(db, family, {
    date: "2026-09-14",
    state: "delivered",
    deliveredAt: NOW,
  });
  if (listed === undefined || asked === undefined || exchange === undefined) {
    throw new Error("expected the seeded rows");
  }
  const [quiet] = await db
    .insert(quietEvents)
    .values({
      exchangeId: exchange.id,
      memberId: family.member.id,
      openedAt: NOW,
      notifiedMemberIds: [family.organiser.id],
    })
    .returning();
  if (quiet === undefined) throw new Error("expected the quiet event");
  return {
    familyId: family.family.id,
    herId: family.member.id,
    listedId: listed.id,
    askedId: asked.id,
    quietId: quiet.id,
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

function ask(client: RaceClient, who: SessionIdentity, key: string) {
  return askApiToLookIn(client.deps, who, key, scope.quietId, { contact_id: scope.listedId });
}

let events = 0;
function fromPetro(fields: Partial<InboundEvent>): InboundEvent {
  events += 1;
  return {
    channel: "telegram",
    eventId: `tg:${events}`,
    at: NOW.toISOString(),
    sender: { externalUserId: "777002", languageCode: "en" },
    conversation: { externalId: "777002", kind: "private" },
    messageId: `m${events}`,
    kind: "text",
    ...fields,
  } as InboundEvent;
}

describe("someone nearby on Telegram, on independent PostgreSQL connections", () => {
  it("sends one ask to look in when two organisers ask the same person at once", async () => {
    const [first, second, holder] = await pg.clientPool("look-in", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(quietEvents).where(eq(quietEvents.id, scope.quietId)).for("update"),
    );
    const one = pg.track(ask(first, mia, "ask-mia"));
    await pg.waitForRowLockWaitOrCompletion(first, [holder], one);
    const two = pg.track(ask(second, anna, "ask-anna"));
    await pg.waitForRowLockWaitOrCompletion(second, [holder, first], two);
    await held.release();
    const [asked, again] = await pg.finish("both asks", Promise.all([one, two]));

    expect([asked.response.status, again.response.status].sort()).toEqual([200, 201]);
    const rows = await seeder.db.select().from(outbound).where(eq(outbound.kind, "nearby_ask"));
    expect(rows).toHaveLength(1);
    const [quiet] = await seeder.db
      .select()
      .from(quietEvents)
      .where(eq(quietEvents.id, scope.quietId));
    expect(quiet?.askToCheck).toHaveLength(1);
  });

  it("records one yes when their Yes arrives twice at once", async () => {
    const deps = pg.jobDeps(seeder);
    const invite = await inviteApiNearby(deps, mia, scope.askedId);
    await handleNearbyStart(
      deps,
      fromPetro({
        kind: "start",
        startParam: new URL(invite.link).searchParams.get("start") ?? "",
      }),
    );
    const [first, second, holder] = await pg.clientPool("nearby-yes", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const tap = (client: RaceClient) =>
      handleNearbyConsentButton(
        pg.jobDeps(client),
        fromPetro({ kind: "button", callbackId: "cb", buttonData: "yes" }),
        { contactId: scope.askedId, accept: true },
      );

    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(nearbyContacts).where(eq(nearbyContacts.id, scope.askedId)).for("update"),
    );
    const one = pg.track(tap(first));
    await pg.waitForRowLockWaitOrCompletion(first, [holder], one);
    const two = pg.track(tap(second));
    await pg.waitForRowLockWaitOrCompletion(second, [holder, first], two);
    await held.release();
    await pg.finish("both taps", Promise.all([one, two]));

    const yes = await seeder.db
      .select()
      .from(consents)
      .where(and(eq(consents.contactId, scope.askedId), eq(consents.answer, "yes")));
    expect(yes).toHaveLength(1);
  });
});
