/**
 * Recipe cards (spec §10, ADR-41), end to end through the router her Telegram chat uses and the
 * understanding job: her answers to a recipe ask are written down as one card and offered to her;
 * "Keep it" puts it in the family book, "Not this one" deletes it; a card she never answers goes
 * with the 30 days of her words.
 */
import { ApiBook, type InboundEvent } from "@vela/contracts";
import { decodeButton } from "@vela/core";
import { members, recipes, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiBook } from "./book.ts";
import type { OutboundJob, UnderstandJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { applyRetention } from "./jobs.ts";
import { understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const TODAY = "2026-09-14";
const ASK = "How do you make your braised pork?";
let events = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: sam.authSubject, displayName: "Sam" })
    .returning();
  await h.db
    .update(members)
    .set({ userId: user?.id ?? null })
    .where(eq(members.id, brother.member.id));
});
afterAll(async () => {
  await h.close();
});

const handlers = {
  outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId),
  understand: (job: UnderstandJob) => understandAnswer(h.deps, job.answerId),
};

function fromHer(
  fields: Partial<InboundEvent> & { kind: InboundEvent["kind"] },
  externalUserId = seed.memberLink.externalId,
): InboundEvent {
  events += 1;
  return {
    channel: "telegram",
    eventId: `tg:${events}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId },
    conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    messageId: String(700 + events),
    ...fields,
  } as InboundEvent;
}

async function send(event: InboundEvent) {
  await handleInbound(h.deps, [event]);
  await h.run(handlers);
}

async function recipeMorning(type: "recipe" | "question" = "recipe") {
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    type,
    text: ASK,
    state: "delivered",
    deliveredAt: h.clock.now(),
  });
  h.clock.advanceMinutes(12);
  return exchange;
}

function lastToHer() {
  return h.telegram.sentTo(seed.memberLink.externalId).at(-1)?.message;
}

function offerButtons() {
  const offer = h.telegram
    .sentTo(seed.memberLink.externalId)
    .map((sent) => sent.message)
    .filter((message) => message.text?.includes("Shall we keep it in the family book?"))
    .at(-1);
  const [keep, not] = offer?.buttons?.[0] ?? [];
  if (keep === undefined || not === undefined) throw new Error("expected the recipe offer");
  return { offer, keep, not };
}

describe("her answers to a recipe ask", () => {
  it("are written down as one card and offered to her with Keep it and Not this one", async () => {
    await recipeMorning();
    await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));

    const { offer, keep, not } = offerButtons();
    expect(offer?.text).toContain(ASK);
    expect(offer?.text).toContain("Pork belly, brown it first.");
    const [row] = await h.db.select().from(recipes);
    expect(row).toMatchObject({ status: "draft", memberId: seed.member.id });
    expect(decodeButton(keep.id)).toEqual({ type: "recipe_keep", recipeId: row?.id, keep: true });
    expect(decodeButton(not.id)).toEqual({ type: "recipe_keep", recipeId: row?.id, keep: false });
  });

  it("keep one card as she adds to it, offered again with what she added", async () => {
    await recipeMorning();
    await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));
    await send(fromHer({ kind: "text", text: "Then soy sauce and rock sugar, one hour." }));

    expect(await h.db.select().from(recipes)).toHaveLength(1);
    expect(offerButtons().offer?.text).toContain("Then soy sauce and rock sugar, one hour.");
  });

  it("go into the family book when she keeps the card, and every member reads it", async () => {
    await recipeMorning();
    await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));

    await send(fromHer({ kind: "button", buttonData: offerButtons().keep.id, callbackId: "cb" }));

    expect(lastToHer()?.text).toBe(`Kept. Your ${ASK} is in the family book now.`);
    const book = ApiBook.parse(await loadApiBook(h.db, sam, seed.family.id));
    expect(book.recipes).toEqual([
      expect.objectContaining({ title: ASK, steps: ["Pork belly, brown it first."] }),
    ]);
  });

  it("are deleted when she says not this one, and a tap from anyone else does nothing", async () => {
    await recipeMorning();
    await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));
    const { not } = offerButtons();

    await send(fromHer({ kind: "button", buttonData: not.id, callbackId: "cb1" }, "3001"));
    expect(await h.db.select().from(recipes)).toHaveLength(1);

    await send(fromHer({ kind: "button", buttonData: not.id, callbackId: "cb2" }));
    expect(await h.db.select().from(recipes)).toEqual([]);
    expect(lastToHer()?.text).toBe("That's fine. This recipe is not kept.");
  });

  it("make no card for an ordinary question", async () => {
    await recipeMorning("question");
    await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));
    expect(await h.db.select().from(recipes)).toEqual([]);
  });

  it("make no card where the family book is off", async () => {
    await recipeMorning();
    h.deps.config = { ...h.deps.config, book: false };
    try {
      await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));
    } finally {
      h.deps.config = { ...h.deps.config, book: true };
    }
    expect(await h.db.select().from(recipes)).toEqual([]);
  });
});

describe("retention", () => {
  it("deletes a card she never answered after 30 days, and keeps one she kept", async () => {
    await recipeMorning();
    await send(fromHer({ kind: "text", text: "Pork belly, brown it first." }));
    const [draft] = await h.db.select().from(recipes);
    const [kept] = await h.db
      .insert(recipes)
      .values({
        familyId: seed.family.id,
        memberId: seed.member.id,
        title: "Soup",
        status: "confirmed",
        createdAt: h.clock.now(),
      })
      .returning();
    await h.db
      .update(recipes)
      .set({ createdAt: h.clock.now() })
      .where(eq(recipes.id, draft?.id ?? ""));

    h.clock.advanceMinutes(31 * 24 * 60);
    await applyRetention(h.deps);

    expect((await h.db.select().from(recipes)).map((row) => row.id)).toEqual([kept?.id]);
  });
});
