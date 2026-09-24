import { ApiQuietNotice, ApiQuietState } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { events, members, outbound, quietEvents, users } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { type ApiNudges, runAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { loadApiQuiet, resolveApiQuiet } from "./api-quiet.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound, STRANDED_AFTER_MINUTES } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";
import { reconcile } from "./tick.ts";

let h: Harness;
let seed: SeededFamily;
let quietId: string;
let otherOrganiserId: string;
const organiser: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const sibling: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-2" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-3" };
const missingId = "00000000-0000-4000-8000-000000000001";

async function account(identity: SessionIdentity, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: identity.authSubject })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await account(organiser, seed.organiser.id);
  const other = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  otherOrganiserId = other.member.id;
  const plain = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "4002",
  });
  await account(sibling, plain.member.id);

  const exchange = await seedExchange(h.db, seed, {
    date: localDateOf(h.clock.now(), seed.member.tz),
    state: "delivered",
    deliveredAt: new Date(h.clock.now().getTime() - 3 * 60 * 60_000),
  });
  const [quiet] = await h.db
    .insert(quietEvents)
    .values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      openedAt: h.clock.now(),
      lastNotifiedAt: h.clock.now(),
      notifyCount: 1,
      notifiedMemberIds: [seed.organiser.id, otherOrganiserId],
    })
    .returning();
  if (quiet === undefined) throw new Error("expected a quiet event");
  quietId = quiet.id;
});
afterAll(async () => {
  await h.close();
});

let keys = 0;
async function act(action: "fine" | "wait", options: { who?: SessionIdentity; key?: string } = {}) {
  keys += 1;
  return resolveApiQuiet(
    h.deps,
    options.who ?? organiser,
    options.key ?? `key-${keys}`,
    quietId,
    action,
    {},
  );
}

async function quietRow() {
  const [row] = await h.db.select().from(quietEvents).where(eq(quietEvents.id, quietId));
  return row;
}

describe("loadApiQuiet", () => {
  it("gives the organiser the facts and the people nearby who said yes, with their numbers", async () => {
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Lena",
      relation: "neighbour",
      answer: { yes: { phone: "+886 2 1234 5678" } },
    });
    await seedNearbyContact(h.db, seed, { now: h.clock.now(), name: "Petro", answer: null });
    await seedNearbyContact(h.db, seed, { now: h.clock.now(), name: "Olga", answer: "no" });

    const notice = ApiQuietNotice.parse(await loadApiQuiet(h.db, organiser, quietId));
    expect(notice).toMatchObject({
      quiet_event_id: quietId,
      member_id: seed.member.id,
      member_name: "Mom",
      delivered_at: new Date(h.clock.now().getTime() - 3 * 60 * 60_000).toISOString(),
      usual_time: null,
      resolved: null,
      wait_until: null,
    });
    expect(notice.contacts).toEqual([
      { id: expect.any(String), name: "Lena", relation: "neighbour", phone: "+886 2 1234 5678" },
    ]);
  });

  it("is for the organisers only, whom the notice is for; nobody else learns it exists", async () => {
    expect(await loadApiQuiet(h.db, sibling, quietId)).toBeNull();
    expect(await loadApiQuiet(h.db, stranger, quietId)).toBeNull();
    expect(await loadApiQuiet(h.db, organiser, missingId)).toBeNull();
    expect(await loadApiQuiet(h.db, organiser, "not-a-uuid")).toBeNull();
  });
});

describe("resolveApiQuiet", () => {
  it("closes the event as fine, and writes a message to the other organiser who was told", async () => {
    const result = await act("fine");
    const state = ApiQuietState.parse(result.response.body);
    expect(state.resolved).toEqual({
      outcome: "fine_known",
      at: h.clock.now().toISOString(),
      by_name: "Mia",
    });
    expect(result.response.body).not.toHaveProperty("contacts");
    expect(await quietRow()).toMatchObject({
      outcome: "fine_known",
      resolvedBy: seed.organiser.id,
    });

    const told = await h.db.select().from(outbound).where(eq(outbound.kind, "quiet_resolved"));
    expect(told.map((row) => row.memberId)).toEqual([otherOrganiserId]);
    expect(told[0]?.status).toBe("queued");
    // Written, not sent: the route hands it over after the commit.
    expect(h.queues.outbound.pending).toEqual([]);
    expect(result.after).toEqual({ outboundIds: [told[0]?.id], wakeMemberIds: [] });
    expect(
      await h.db.select().from(events).where(eq(events.name, "quiet_notice_resolved")),
    ).toHaveLength(1);
  });

  it("waits two hours and marks her wake due, leaving the wake itself for after the commit", async () => {
    const result = await act("wait");
    const until = new Date(h.clock.now().getTime() + 120 * 60_000);
    expect(ApiQuietState.parse(result.response.body).wait_until).toBe(until.toISOString());
    expect((await quietRow())?.waitUntil).toEqual(until);
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.nextWakeAt).toEqual(h.clock.now());
    expect(h.scheduler.wakes.get(seed.member.id)).toBeUndefined();
    expect(result.after).toEqual({ outboundIds: [], wakeMemberIds: [seed.member.id] });
  });

  it("answers an event already settled as it stands, doing nothing", async () => {
    await h.db
      .update(quietEvents)
      .set({ resolvedAt: h.clock.now(), outcome: "answered_late" })
      .where(eq(quietEvents.id, quietId));
    const result = await act("fine");
    expect(ApiQuietState.parse(result.response.body).resolved?.outcome).toBe("answered_late");
    expect(result.after).toEqual({ outboundIds: [], wakeMemberIds: [] });
    expect(await h.db.select().from(outbound)).toEqual([]);
  });

  it("replays the first answer, and leaves nothing to do after a replay", async () => {
    const first = await act("fine", { key: "same" });
    const again = await act("fine", { key: "same" });
    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(again.after).toEqual({ outboundIds: [], wakeMemberIds: [] });
    expect(
      await h.db.select().from(outbound).where(eq(outbound.kind, "quiet_resolved")),
    ).toHaveLength(1);
  });

  it("refuses anyone but the family's organisers, and a body with anything in it", async () => {
    for (const who of [sibling, stranger]) {
      const failure = await act("fine", { who }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(VelaError);
      expect((failure as VelaError).code).toBe("not_found");
    }
    await expect(
      resolveApiQuiet(h.deps, organiser, "k", quietId, "fine", { reason: "she called" }),
    ).rejects.toThrow(ApiIdempotencyError);
    expect((await quietRow())?.resolvedAt).toBeNull();
  });

  it("still delivers the message when nothing hands it over: reconcile finds the row", async () => {
    await act("fine");
    h.clock.set(new Date(h.clock.now().getTime() + (STRANDED_AFTER_MINUTES + 1) * 60_000));
    await reconcile(h.deps);
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
    const [told] = await h.db
      .select()
      .from(outbound)
      .where(and(eq(outbound.kind, "quiet_resolved"), eq(outbound.memberId, otherOrganiserId)));
    expect(told?.status).toBe("sent");
    expect(h.telegram.sentTo("4001")).toHaveLength(1);
  });
});

describe("runAfterCommit", () => {
  it("hands each row to the queue and wakes each member, reporting failures and never throwing", async () => {
    const delivered: string[] = [];
    const woken: string[] = [];
    const reports: [string, Record<string, string>][] = [];
    const nudges: ApiNudges = {
      deliver: async (id) => {
        if (id === "bad-row") throw new Error("queue down");
        delivered.push(id);
      },
      wake: async (id) => {
        woken.push(id);
      },
    };
    await runAfterCommit(
      nudges,
      { outboundIds: ["row-1", "bad-row", "row-2"], wakeMemberIds: ["her"] },
      h.clock.now(),
      (event, fields) => reports.push([event, fields]),
    );
    expect(delivered).toEqual(["row-1", "row-2"]);
    expect(woken).toEqual(["her"]);
    expect(reports).toEqual([["api_after_commit_deliver_failed", { outboundId: "bad-row" }]]);

    await expect(
      runAfterCommit(undefined, { outboundIds: ["x"], wakeMemberIds: ["y"] }, h.clock.now(), () => {
        throw new Error("nothing to report without nudges");
      }),
    ).resolves.toBeUndefined();
  });
});
