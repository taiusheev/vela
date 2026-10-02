/**
 * Someone nearby, asked on Telegram in the organiser's name (ADR-36), end to end through the inbound
 * router a Telegram chat uses: the link an organiser shares, the request it opens, the yes or no,
 * stop, and then "Ask them to look in" on a quiet morning, their answer, and the stand-down when the
 * morning closes.
 */
import { ApiLookInAsk, type InboundEvent } from "@vela/contracts";
import { decodeButton, localDateOf } from "@vela/core";
import {
  consents,
  deletions,
  members,
  nearbyContacts,
  outbound,
  quietEvents,
  users,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiQuiet, resolveApiQuiet } from "./api-quiet.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { applyRetention } from "./jobs.ts";
import { askApiToLookIn, type LookInRefusedError } from "./nearby-ask.ts";
import {
  inviteApiNearby,
  NEARBY_TEXT_VERSION,
  NearbyInviteRefusedError,
} from "./nearby-consent.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let contactId: string;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const ANNA = "777001";
const STRANGER = "777009";
let events = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await account(mia, "Mia", seed.organiser.id);
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  await account(sam, "Sam", brother.member.id);
  const contact = await seedNearbyContact(h.db, seed, {
    now: h.clock.now(),
    name: "Anna",
    relation: "neighbour",
    answer: null,
  });
  contactId = contact.id;
});
afterAll(async () => {
  await h.close();
});

async function account(identity: SessionIdentity, name: string, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  if (user === undefined) throw new Error(`expected an account for ${name}`);
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

const handlers = { outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) };

function from(user: string, fields: Partial<InboundEvent>): InboundEvent {
  events += 1;
  return {
    channel: "telegram",
    eventId: `tg:${events}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: user, languageCode: "en" },
    conversation: { externalId: user, kind: "private" },
    messageId: `m${events}`,
    kind: "text",
    ...fields,
  } as InboundEvent;
}

async function send(event: InboundEvent) {
  await handleInbound(h.deps, [event]);
  await h.run(handlers);
}

function startOf(link: string): string {
  return new URL(link).searchParams.get("start") ?? "";
}

/** Mia shares the link, Anna opens it; the request Anna is shown. */
async function annaOpensTheLink(user = ANNA) {
  const invite = await inviteApiNearby(h.deps, mia, contactId);
  await send(from(user, { kind: "start", startParam: startOf(invite.link) }));
  const request = h.telegram.sentTo(user).at(-1);
  if (request === undefined) throw new Error("expected the request");
  return { invite, request };
}

async function tap(user: string, buttonId: string, messageId = "request") {
  await send(from(user, { kind: "button", buttonData: buttonId, messageId, callbackId: "cb" }));
}

async function annaSaysYes() {
  const { request } = await annaOpensTheLink();
  const yes = request.message.buttons?.[0]?.[0];
  if (yes === undefined) throw new Error("expected Yes");
  await tap(ANNA, yes.id);
}

async function contactRow() {
  const [row] = await h.db.select().from(nearbyContacts).where(eq(nearbyContacts.id, contactId));
  return row;
}

describe("asking someone nearby on Telegram", () => {
  it("gives an organiser a link, and refuses anyone else", async () => {
    const invite = await inviteApiNearby(h.deps, mia, contactId);

    expect(invite.link).toMatch(/^https:\/\/t\.me\/VelaLightBot\?start=n[A-Za-z0-9_-]{32}$/);
    expect(await contactRow()).toMatchObject({
      invitedBy: seed.organiser.id,
      consentRequestedAt: h.clock.now(),
    });
    await expect(inviteApiNearby(h.deps, sam, contactId)).rejects.toBeInstanceOf(VelaError);
  });

  it("asks them in the organiser's name, with Yes and No, only once they open the link", async () => {
    expect(h.telegram.sentTo(ANNA)).toEqual([]);
    const { request } = await annaOpensTheLink();

    expect(request.message.text).toContain("Mia asks: you live near Mrs Chen.");
    expect(request.message.text).toContain("Timur Aiusheev");
    expect(request.message.buttons?.flat().map((button) => decodeButton(button.id))).toEqual([
      { type: "nearby_consent", contactId, accept: true },
      { type: "nearby_consent", contactId, accept: false },
    ]);
  });

  it("keeps their account with their yes, and tells them and the organiser", async () => {
    await annaSaysYes();

    expect(await contactRow()).toMatchObject({
      externalId: ANNA,
      channel: "telegram",
      consentedAt: h.clock.now(),
      inviteTokenHash: null,
    });
    const [yes] = await h.db.select().from(consents).where(eq(consents.contactId, contactId));
    expect(yes).toMatchObject({ kind: "nearby", answer: "yes", textVersion: NEARBY_TEXT_VERSION });
    expect(h.telegram.sentTo(ANNA).at(-1)?.message.text).toContain(
      "Vela will write to you only if Mia asks",
    );
    expect(h.telegram.sentTo(seed.organiserLink.externalId).at(-1)?.message.text).toBe(
      "Anna said yes. On a quiet morning you can now ask Anna to look in on Mrs Chen.",
    );
    await expect(inviteApiNearby(h.deps, mia, contactId)).rejects.toBeInstanceOf(
      NearbyInviteRefusedError,
    );
  });

  it("deletes them at once on a no, keeping only the proof that they were asked", async () => {
    const { request } = await annaOpensTheLink();
    const no = request.message.buttons?.[0]?.[1];
    if (no === undefined) throw new Error("expected No");

    await tap(ANNA, no.id);

    expect(await contactRow()).toBeUndefined();
    const [proof] = await h.db
      .select()
      .from(consents)
      .where(eq(consents.subjectRef, `contact:${contactId}`));
    expect(proof).toMatchObject({ answer: "no", contactId: null });
    expect(proof?.subjectDeletedAt).toEqual(h.clock.now());
    expect(await h.db.select().from(deletions)).toHaveLength(1);
    expect(h.telegram.sentTo(ANNA).at(-1)?.message.text).toContain(
      "Your details have been deleted",
    );
  });

  it("refuses an old link once a newer one replaced it, and ignores a tap from its request", async () => {
    const { request: old } = await annaOpensTheLink();
    const { invite } = await annaOpensTheLink(STRANGER);
    void invite;

    await send(from("777010", { kind: "start", startParam: "n" + "A".repeat(32) }));
    expect(h.telegram.sentTo("777010").at(-1)?.message.text).toContain("no longer valid");
    const yes = old.message.buttons?.[0]?.[0];
    if (yes === undefined) throw new Error("expected Yes");
    await tap(ANNA, yes.id);
    expect((await contactRow())?.consentedAt).toBeNull();
  });

  it("removes them from every list when they send stop", async () => {
    await annaSaysYes();

    await send(from(ANNA, { kind: "text", text: "stop" }));

    expect(await contactRow()).toBeUndefined();
    const [yes] = await h.db
      .select()
      .from(consents)
      .where(eq(consents.subjectRef, `contact:${contactId}`));
    expect(yes?.withdrawnAt).toEqual(h.clock.now());
    expect(h.telegram.sentTo(ANNA).at(-1)?.message.text).toBe(
      "You have been removed. Vela will not write to you again.",
    );
  });
});

describe("someone nearby who never answers", () => {
  it("is deleted 14 days after the latest link, and not a day before", async () => {
    await inviteApiNearby(h.deps, mia, contactId);
    h.clock.advanceMinutes(13 * 24 * 60);
    await applyRetention(h.deps);
    expect(await contactRow()).toBeDefined();

    h.clock.advanceMinutes(2 * 24 * 60);
    const counts = await applyRetention(h.deps);

    expect(counts.nearby_unanswered_deleted).toBe(1);
    expect(await contactRow()).toBeUndefined();
    expect(await h.db.select().from(deletions)).toHaveLength(1);
  });

  it("is kept when they said yes, however long ago", async () => {
    await annaSaysYes();
    h.clock.advanceMinutes(60 * 24 * 60);
    await applyRetention(h.deps);
    expect((await contactRow())?.externalId).toBe(ANNA);
  });
});

describe("asking them to look in on a quiet morning", () => {
  let quietId: string;

  beforeEach(async () => {
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
        notifiedMemberIds: [seed.organiser.id],
      })
      .returning();
    if (quiet === undefined) throw new Error("expected a quiet event");
    quietId = quiet.id;
  });

  let keys = 0;
  async function ask(who = mia) {
    keys += 1;
    const result = await askApiToLookIn(h.deps, who, `ask-${keys}`, quietId, {
      contact_id: contactId,
    });
    for (const id of result.after.outboundIds) {
      await h.queues.outbound.send({ type: "deliver", outboundId: id });
    }
    await h.run(handlers);
    return { ...result, body: ApiLookInAsk.parse(result.response.body) };
  }

  it("writes to them in the organiser's name, once a morning, naming who tapped", async () => {
    await annaSaysYes();

    const first = await ask();
    const again = await ask();

    expect(first.response.status).toBe(201);
    expect(again.response.status).toBe(200);
    expect(again.body.asked_at).toBe(first.body.asked_at);
    const rows = await h.db.select().from(outbound).where(eq(outbound.kind, "nearby_ask"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: seed.organiser.id, conversationId: ANNA });
    const asked = h.telegram.sentTo(ANNA).at(-1);
    expect(asked?.message.text).toBe(
      "Mia asks: could you look in on Mrs Chen today? Mrs Chen hasn't answered this morning.",
    );
    const notice = await loadApiQuiet(h.db, mia, quietId);
    expect(notice?.contacts).toEqual([
      expect.objectContaining({
        id: contactId,
        phone: null,
        can_ask: true,
        asked: { at: first.body.asked_at, by_name: "Mia", reply: null },
      }),
    ]);
  });

  it("tells the organiser their answer and thanks them", async () => {
    await annaSaysYes();
    await ask();
    const lookIn = h.telegram.sentTo(ANNA).at(-1)?.message.buttons?.[0]?.[0];
    if (lookIn === undefined) throw new Error("expected I'll look in");

    await tap(ANNA, lookIn.id, "ask");

    expect(h.telegram.sentTo(seed.organiserLink.externalId).at(-1)?.message.text).toBe(
      "Anna will look in on Mrs Chen.",
    );
    expect(h.telegram.sentTo(ANNA).at(-1)?.message.text).toBe(
      "Thank you. Mia knows you'll look in.",
    );
    const notice = await loadApiQuiet(h.db, mia, quietId);
    expect(notice?.contacts[0]?.asked?.reply).toBe("yes");
  });

  it("tells them there is no need once the morning is settled", async () => {
    await annaSaysYes();
    await ask();

    keys += 1;
    await resolveApiQuiet(h.deps, mia, `fine-${keys}`, quietId, "fine", {}).then(async (done) => {
      for (const id of done.after.outboundIds) {
        await h.queues.outbound.send({ type: "deliver", outboundId: id });
      }
      await h.run(handlers);
    });

    expect(h.telegram.sentTo(ANNA).at(-1)?.message.text).toBe(
      "Mrs Chen has answered now, so there is no need to look in. Thank you.",
    );
  });

  it("refuses someone without a Telegram yes, and a morning already settled", async () => {
    const refusedFirst = await ask().then(
      () => null,
      (error: unknown) => error,
    );
    expect((refusedFirst as LookInRefusedError).reason).toBe("cannot_be_asked");

    await annaSaysYes();
    await h.db.update(quietEvents).set({ resolvedAt: h.clock.now(), outcome: "fine_known" });
    const refused = await ask().then(
      () => null,
      (error: unknown) => error,
    );
    expect((refused as LookInRefusedError).reason).toBe("settled");
    expect(await h.db.select().from(outbound).where(eq(outbound.kind, "nearby_ask"))).toEqual([]);
  });
});
