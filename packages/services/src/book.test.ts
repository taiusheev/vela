/**
 * The family book (spec §10, ADR-39), end to end through the router her Telegram chat uses: a story
 * she tells is kept, with her words and her voice; "Don't keep this one" takes it out; retention
 * leaves a kept story's question and words past 30 days and clears everything else as before; an
 * organiser can remove one from the app, and the family reads the book.
 */
import { ApiBook, type InboundEvent } from "@vela/contracts";
import { decodeButton } from "@vela/core";
import { answers, bookEntries, exchanges, media, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { keepInBook, loadApiBook, removeApiBookEntry } from "./book.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { applyRetention } from "./jobs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-x" };
const TODAY = "2026-09-14";
let events = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
  await account(mia, "Mia", seed.organiser.id);
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  await account(sam, "Sam", brother.member.id);
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

function fromHer(fields: Partial<InboundEvent> & { kind: InboundEvent["kind"] }): InboundEvent {
  events += 1;
  return {
    channel: "telegram",
    eventId: `tg:${events}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: seed.memberLink.externalId },
    conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    messageId: String(500 + events),
    ...fields,
  } as InboundEvent;
}

async function send(event: InboundEvent) {
  await handleInbound(h.deps, [event]);
  await h.run(handlers);
}

/** Today's story ask, delivered at 08:00; it is now 08:12. */
async function storyMorning(type: "story" | "question" | "memory_photo" = "story") {
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    type,
    text: type === "story" ? "Tell me how you met Dad." : "What did you cook today?",
    state: "delivered",
    deliveredAt: h.clock.now(),
  });
  h.clock.advanceMinutes(12);
  return exchange;
}

async function entryOf(exchangeId: string) {
  const [row] = await h.db.select().from(bookEntries).where(eq(bookEntries.exchangeId, exchangeId));
  return row;
}

describe("a story she tells", () => {
  it("is kept in the family book, and her thanks says so with a way to say no", async () => {
    const story = await storyMorning();

    await send(fromHer({ kind: "text", text: "We met at the train station in Tainan." }));

    expect(await entryOf(story.id)).toMatchObject({ memberId: seed.member.id, removedAt: null });
    const thanks = h.telegram.sentTo(seed.memberLink.externalId).at(-1);
    expect(thanks?.message.text).toContain("Your story is kept in the family book.");
    expect(thanks?.message.buttons?.flat().map((button) => decodeButton(button.id))).toEqual([
      { type: "book_drop", exchangeId: story.id },
    ]);
    const book = ApiBook.parse(await loadApiBook(h.db, sam, seed.family.id));
    expect(book.entries).toEqual([
      expect.objectContaining({
        exchange_id: story.id,
        question: "Tell me how you met Dad.",
        answers: [
          expect.objectContaining({ kind: "text", text: "We met at the train station in Tainan." }),
        ],
      }),
    ]);
  });

  it("keeps her voice with it, and lets it go again when she says don't keep it", async () => {
    const story = await storyMorning();
    await send(
      fromHer({
        kind: "voice",
        media: {
          kind: "audio",
          providerFileId: "voice-1",
          providerUniqueId: "u-voice-1",
          durationMs: 40_000,
        },
      }),
    );
    const [answer] = await h.db.select().from(answers).where(eq(answers.exchangeId, story.id));
    const [file] = await h.db
      .select()
      .from(media)
      .where(eq(media.id, answer?.mediaId ?? ""));
    expect(file?.kept).toBe(true);

    const drop = h.telegram.sentTo(seed.memberLink.externalId).at(-1)?.message.buttons?.[0]?.[0];
    if (drop === undefined) throw new Error("expected Don't keep this one");
    await send(fromHer({ kind: "button", buttonData: drop.id, callbackId: "cb" }));

    expect((await entryOf(story.id))?.removedAt).toEqual(h.clock.now());
    const [after] = await h.db
      .select()
      .from(media)
      .where(eq(media.id, answer?.mediaId ?? ""));
    expect(after?.kept).toBe(false);
    expect(ApiBook.parse(await loadApiBook(h.db, mia, seed.family.id)).entries).toEqual([]);
    expect(h.telegram.sentTo(seed.memberLink.externalId).at(-1)?.message.text).toBe(
      "That's fine. This story is no longer in the family book.",
    );
  });

  it("moves a recording from her phone out of device/, which the bucket clears at 32 days, into book/", async () => {
    const story = await storyMorning();
    const from = `device/${seed.family.id}/${seed.member.id}/k.m4a`;
    const [file] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.member.id,
        kind: "audio",
        storageKey: from,
        mime: "audio/mp4",
      })
      .returning();
    await h.media.put(from, new ArrayBuffer(4), "audio/mp4");
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: story.id,
        memberId: seed.member.id,
        kind: "voice",
        channel: "device",
        mediaId: file?.id ?? null,
      })
      .returning();
    if (answer === undefined) throw new Error("expected her answer");

    await keepInBook(h.deps, story, answer);

    const [moved] = await h.db
      .select()
      .from(media)
      .where(eq(media.id, file?.id ?? ""));
    expect(moved?.storageKey).toBe(`book/${seed.family.id}/${file?.id}.m4a`);
    expect(moved?.kept).toBe(true);
    expect(h.media.objects.has(from)).toBe(false);
    expect(h.media.objects.has(moved?.storageKey ?? "")).toBe(true);
  });

  it("is not kept where the book is off, and her thanks offers nothing to undo", async () => {
    const story = await storyMorning();
    h.deps.config = { ...h.deps.config, book: false };
    try {
      await send(fromHer({ kind: "text", text: "We met at the train station in Tainan." }));
    } finally {
      h.deps.config = { ...h.deps.config, book: true };
    }

    expect(await entryOf(story.id)).toBeUndefined();
    const thanks = h.telegram.sentTo(seed.memberLink.externalId).at(-1);
    expect(thanks?.message.buttons).toBeUndefined();
    expect(thanks?.message.text).not.toContain("family book");
  });

  it("keeps what she says about an old photo, with the photo, out of the folder the bucket clears", async () => {
    const from = `asks/${seed.family.id}/old.jpg`;
    const [photo] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.organiser.id,
        kind: "image",
        storageKey: from,
        mime: "image/jpeg",
      })
      .returning();
    await h.media.put(from, new ArrayBuffer(4), "image/jpeg");
    const ask = await storyMorning("memory_photo");
    await h.db
      .update(exchanges)
      .set({ mediaIds: [photo?.id ?? ""] })
      .where(eq(exchanges.id, ask.id));

    await send(fromHer({ kind: "text", text: "That is our wedding day in Tainan." }));

    const [kept] = await h.db
      .select()
      .from(media)
      .where(eq(media.id, photo?.id ?? ""));
    expect(kept).toMatchObject({
      kept: true,
      storageKey: `book/${seed.family.id}/${photo?.id}.jpg`,
    });
    const book = ApiBook.parse(await loadApiBook(h.db, sam, seed.family.id));
    expect(book.entries).toEqual([
      expect.objectContaining({
        exchange_id: ask.id,
        photo_ids: [photo?.id],
        answers: [expect.objectContaining({ text: "That is our wedding day in Tainan." })],
      }),
    ]);
  });

  it("is not kept for an ordinary question, whose thanks has no button", async () => {
    const question = await storyMorning("question");
    await send(fromHer({ kind: "text", text: "Rice porridge." }));
    expect(await entryOf(question.id)).toBeUndefined();
    expect(h.telegram.sentTo(seed.memberLink.externalId).at(-1)?.message.buttons).toBeUndefined();
  });
});

describe("the book past 30 days", () => {
  it("keeps a kept story's question and words, and clears the rest as before", async () => {
    const story = await storyMorning();
    await send(fromHer({ kind: "text", text: "We met at the train station in Tainan." }));
    const ordinary = await seedExchange(h.db, seed, {
      date: "2026-09-13",
      type: "question",
      text: "What did you cook?",
      state: "answered",
      deliveredAt: new Date(h.clock.now().getTime() - 60_000),
    });

    h.clock.advanceMinutes(40 * 24 * 60);
    await applyRetention(h.deps);

    const [kept] = await h.db.select().from(exchanges).where(eq(exchanges.id, story.id));
    const [cleared] = await h.db.select().from(exchanges).where(eq(exchanges.id, ordinary.id));
    expect(kept?.text).toBe("Tell me how you met Dad.");
    expect(cleared?.text).toBeNull();
    const [answer] = await h.db.select().from(answers).where(eq(answers.exchangeId, story.id));
    expect((answer?.payload as { text?: string } | undefined)?.text).toBe(
      "We met at the train station in Tainan.",
    );
  });
});

describe("the book in the app", () => {
  it("is read by every member of the family and nobody else", async () => {
    await storyMorning();
    await send(fromHer({ kind: "text", text: "We met at the train station in Tainan." }));
    expect(ApiBook.parse(await loadApiBook(h.db, sam, seed.family.id)).entries).toHaveLength(1);
    expect(await loadApiBook(h.db, stranger, seed.family.id)).toBeNull();
  });

  it("shows the story asks still to come, with who chose them, and not the delivered ones", async () => {
    await storyMorning();
    const sunday = await seedExchange(h.db, seed, {
      date: "2026-09-20",
      type: "story",
      text: "Tell me about your first day at work.",
      state: "composed",
    });

    const book = ApiBook.parse(await loadApiBook(h.db, sam, seed.family.id));

    expect(book.coming).toEqual([
      {
        exchange_id: sunday.id,
        member_id: seed.member.id,
        member_name: seed.member.displayName,
        question: "Tell me about your first day at work.",
        asked_by: seed.organiser.displayName,
        date: "2026-09-20",
      },
    ]);
  });

  it("lets an organiser take a story out, and refuses anyone else", async () => {
    const story = await storyMorning();
    await send(fromHer({ kind: "text", text: "We met at the train station in Tainan." }));

    await expect(removeApiBookEntry(h.deps, sam, "remove-sam", story.id)).rejects.toBeInstanceOf(
      VelaError,
    );
    const removed = await removeApiBookEntry(h.deps, mia, "remove-mia", story.id);

    expect(removed.response.body).toEqual({ exchange_id: story.id, removed: true });
    expect((await entryOf(story.id))?.removedBy).toBe(seed.organiser.id);
    expect(ApiBook.parse(await loadApiBook(h.db, mia, seed.family.id)).entries).toEqual([]);
  });
});
