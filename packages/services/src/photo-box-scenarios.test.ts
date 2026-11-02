/**
 * The photo box's picture mornings (ADR-58) in the situations families meet, end to end through the
 * gateway and the fake channels: Telegram, LINE and her own phone; Chinese; two parents sharing a
 * box; the repeat and the check-in; her pick and her story; a pause; a photo taken out between the
 * morning being made and being sent; a long line; an organiser who has Vela write in their name.
 */
import { ApiUploadedMedia, type InboundEvent, type LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { addDays, decodeButton, zonedInstant } from "@vela/core";
import {
  answers,
  bookEntries,
  channelLinks,
  exchanges,
  familyChannels,
  media,
  members,
  outbound,
  users,
} from "@vela/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AnswerButtonAction, handleAnswerButton } from "./answers.ts";
import type { SessionIdentity } from "./api-access.ts";
import { uploadApiMedia } from "./api-media.ts";
import { deliverArrival, sendRepeat } from "./arrivals.ts";
import type { Deps, OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { applyRetention } from "./jobs.ts";
import { addToApiPhotoBox, loadApiPhotoBox, removeFromApiPhotoBox } from "./photo-box.ts";
import type { FakeTelegram } from "./testing/fake-telegram.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { testJpeg } from "./testing/jpeg.ts";
import { type SeededFamily, seedFamily, seedLinkedGroup } from "./testing/seed.ts";

const TZ = "Asia/Taipei";
const TODAY: LocalDate = "2026-09-14";
const MORNING = addDays(TODAY, 1);

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

async function family(options: { memberLanguage?: "en" | "zh-TW" } = {}) {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now(), ...options });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now(), conversationId: "-100group" });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("no account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
}

function on(extra: Partial<Deps["config"]> = {}): Deps {
  return { ...h.deps, config: { ...h.deps.config, photoBox: true, ...extra } };
}

let keys = 0;
async function boxed(scan: number, era: "new" | "old" = "new", caption?: string) {
  keys += 1;
  const upload = await uploadApiMedia(
    { db: h.db, clock: h.clock, random: h.random, store: h.media, logger: h.logger },
    mia,
    `upload-${keys}`,
    seed.family.id,
    testJpeg({ scan: [scan, 0x21, 0x43] }),
  );
  const mediaId = ApiUploadedMedia.parse(upload.response.body).id;
  const added = await addToApiPhotoBox(h.deps, mia, `box-${keys}`, seed.family.id, {
    media_id: mediaId,
    era,
    ...(caption === undefined ? {} : { caption }),
  });
  return { mediaId, boxId: (added.response.body as { id: string }).id };
}

function deliverAll(deps: Deps) {
  return h.run({ outbound: (job: OutboundJob) => deliverOutbound(deps, job.outboundId) });
}

/** Her morning of `date`, made and sent at 08:00 her time. */
async function morning(deps: Deps, date: LocalDate = MORNING, memberId = seed.member.id) {
  h.clock.set(zonedInstant(date, "08:00", TZ));
  await deliverArrival(deps, memberId, date, false);
  await deliverAll(deps);
  const [row] = await h.db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.recipientId, memberId), eq(exchanges.scheduledFor, date)));
  if (row === undefined) throw new Error(`no morning on ${date}`);
  return row;
}

function sentTo(adapter: FakeTelegram, id: string) {
  return adapter.sent.filter((entry) => entry.message.to.conversationId === id);
}

describe("picture mornings on each of her channels", () => {
  beforeEach(() => family());

  it("Telegram: uploads the photo, puts the family's line in Vela's question, and signs it Vela", async () => {
    const photo = await boxed(1, "new", "Lily at the beach");

    const row = await morning(on());

    const [sent] = sentTo(h.telegram, seed.memberLink.externalId);
    expect(row.type).toBe("question");
    expect(sent?.uploads.map((u) => u.storageKey)).toEqual([
      (await h.db.select().from(media).where(eq(media.id, photo.mediaId)))[0]?.storageKey,
    ]);
    expect(sent?.message.text).toContain("“Lily at the beach”");
    expect(sent?.message.text).toContain(t("en", "arrival.hello_signature"));
  });

  it("LINE: sends the same photo by its stored key", async () => {
    await h.db
      .update(channelLinks)
      .set({ channel: "line" })
      .where(inArray(channelLinks.memberId, [seed.member.id, seed.organiser.id]));
    await h.db
      .update(members)
      .set({ primarySurface: "line" })
      .where(inArray(members.id, [seed.member.id, seed.organiser.id]));
    await h.db
      .update(familyChannels)
      .set({ channel: "line" })
      .where(eq(familyChannels.familyId, seed.family.id));
    await boxed(1, "old", "Our first flat");

    const row = await morning(on());

    const [sent] = sentTo(h.line, seed.memberLink.externalId);
    expect(row.type).toBe("memory_photo");
    expect(sent?.message.media?.map((ref) => ref.kind)).toEqual(["image"]);
    expect(sent?.message.text).toContain("“Our first flat”");
  });

  it("her own phone: names the photo by its stored key for her app to load", async () => {
    await h.db
      .update(members)
      .set({ primarySurface: "parent-surface" })
      .where(eq(members.id, seed.member.id));
    await h.db.insert(channelLinks).values({
      memberId: seed.member.id,
      channel: "device",
      externalId: "device-token-hash",
    });
    await boxed(1);

    await morning(on());

    const sent = h.device.sent.at(-1);
    expect(sent?.media?.map((ref) => ref.kind)).toEqual(["image"]);
    expect(sent?.text).toContain(t("en", "photo_box.look"));
  });
});

describe("picture mornings in her language and her family", () => {
  it("asks in Chinese, signed by the family's helper, with the family's own line as written", async () => {
    await family({ memberLanguage: "zh-TW" });
    await boxed(1, "old", "我們的第一個家");

    await morning(on());

    const [sent] = sentTo(h.telegram, seed.memberLink.externalId);
    expect(sent?.message.text).toContain("家人找到一張老照片：「我們的第一個家」");
    expect(sent?.message.text).toContain(t("zh-TW", "arrival.hello_signature"));
  });

  it("two parents share the box: each gets picture mornings on their own rhythm", async () => {
    await family();
    const [hers] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    if (hers === undefined) throw new Error("no parent");
    const { id: _id, createdAt: _created, userId: _user, ...rest } = hers;
    const [dad] = await h.db
      .insert(members)
      .values({ ...rest, displayName: "Dad", addressForm: "Mr Chen" })
      .returning();
    if (dad === undefined) throw new Error("no second parent");
    await h.db
      .insert(channelLinks)
      .values({ memberId: dad.id, channel: "telegram", externalId: "2002" });
    await boxed(1);
    await boxed(2);

    const mom = await morning(on());
    const his = await morning(on(), MORNING, dad.id);
    const momNext = await morning(on(), addDays(MORNING, 1));

    expect([mom.type, his.type]).toEqual(["question", "question"]);
    // Her own rhythm: the day after her picture morning is the bank's, whatever Dad had.
    expect(momNext.type).toBe("hello");
    expect(sentTo(h.telegram, "2002")[0]?.uploads).toHaveLength(1);
  });

  it("a 140-character line with quotes and emoji still fits her morning", async () => {
    await family();
    const line = `Grandpa’s “famous” noodles 🍜 at the old flat — ${"x".repeat(80)}`.slice(0, 140);
    await boxed(1, "new", line);

    await morning(on());

    const [sent] = sentTo(h.telegram, seed.memberLink.externalId);
    expect(sent?.message.text).toContain(line);
  });
});

describe("picture mornings through her day", () => {
  beforeEach(() => family());

  it("the repeat sends the same photo again, not a new one", async () => {
    await boxed(1);
    await boxed(2);
    await morning(on());
    const first = sentTo(h.telegram, seed.memberLink.externalId)[0]?.uploads.map(
      (u) => u.storageKey,
    );

    h.clock.set(zonedInstant(MORNING, "11:00", TZ));
    await sendRepeat(on(), seed.member.id, MORNING);
    await deliverAll(on());

    const repeat = sentTo(h.telegram, seed.memberLink.externalId)[1];
    expect(repeat?.uploads.map((u) => u.storageKey)).toEqual(first);
  });

  it("with the check-in on, a new photo has no buttons and a choice keeps only its 1 and 2", async () => {
    await boxed(1);
    await boxed(2);
    const deps = on({ checkIn: true });

    await morning(deps);
    // The rotation's third kind needs a morning two days on and a week's room.
    const choice = await morning(deps, addDays(MORNING, 2));

    const [look, pick] = sentTo(h.telegram, seed.memberLink.externalId);
    expect(look?.message.buttons ?? []).toEqual([]);
    expect(choice.type).toBe("photo_choice");
    expect(pick?.message.buttons?.flat().map((b) => decodeButton(b.id))).toEqual([
      { type: "pick", exchangeId: choice.id, index: 0 },
      { type: "pick", exchangeId: choice.id, index: 1 },
    ]);
  });

  it("her pick on a choice is recorded against the photo she chose", async () => {
    await boxed(1);
    await boxed(2);
    await morning(on());
    const choice = await morning(on(), addDays(MORNING, 2));
    const sent = sentTo(h.telegram, seed.memberLink.externalId)[1];

    const action: AnswerButtonAction = { type: "pick", exchangeId: choice.id, index: 1 };
    await handleAnswerButton(
      on(),
      seed.member,
      {
        channel: "telegram",
        eventId: "tg:pick",
        at: h.clock.now().toISOString(),
        sender: { externalUserId: seed.memberLink.externalId },
        conversation: { externalId: seed.memberLink.externalId, kind: "private" },
        messageId: sent?.result.primaryMessageId ?? "1",
        kind: "button",
        buttonData: sent?.message.buttons?.[0]?.[1]?.id ?? "",
        callbackId: "cb-pick",
      },
      action,
    );

    const [answer] = await h.db.select().from(answers).where(eq(answers.exchangeId, choice.id));
    expect(answer?.kind).toBe("photo_pick");
    expect(answer?.payload).toMatchObject({ index: 1, media_id: choice.mediaIds[1] });
  });

  it("her story about an old photo goes into the family book, and keeps its photo when the box lets it go", async () => {
    const photo = await boxed(1, "old", "Our first flat");
    const story = await morning(on());
    expect(story.type).toBe("memory_photo");

    await handleInbound(on(), [
      {
        channel: "telegram",
        eventId: "tg:story",
        at: h.clock.now().toISOString(),
        messageId: "777",
        sender: { externalUserId: seed.memberLink.externalId },
        conversation: { externalId: seed.memberLink.externalId, kind: "private" },
        kind: "text",
        text: "That was on Jinhua Street, the year you were born.",
      } as InboundEvent,
    ]);
    await deliverAll(on());

    const [entry] = await h.db
      .select()
      .from(bookEntries)
      .where(eq(bookEntries.exchangeId, story.id));
    expect(entry?.removedAt ?? null).toBeNull();
    await removeFromApiPhotoBox(h.deps, mia, "remove-story", photo.boxId, {});
    h.clock.set(new Date(h.clock.now().getTime() + 2 * 24 * 60 * 60 * 1_000));
    await applyRetention(h.deps);
    // Out of the box, but her story keeps it (ADR-39): the book's photo is not the box's to delete.
    const [kept] = await h.db.select().from(media).where(eq(media.id, photo.mediaId));
    expect(kept?.kept).toBe(true);
  });

  it("a paused morning that is never sent does not count as shown", async () => {
    await boxed(1);
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));

    await morning(on());

    const [arrival] = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
    expect(arrival?.status).not.toBe("sent");
    const box = await loadApiPhotoBox(h.db, mia, seed.family.id);
    expect(box?.photos[0]?.last_used_on).toBeNull();
  });

  it("a photo taken out after her morning was made is not sent, and she is not asked about a photo she cannot see", async () => {
    const photo = await boxed(1, "new", "Lily at the beach");
    h.clock.set(zonedInstant(MORNING, "07:00", TZ));
    const { prepareDay } = await import("./arrivals.ts");
    await prepareDay(on(), seed.member.id, MORNING);
    await removeFromApiPhotoBox(h.deps, mia, "remove", photo.boxId, {});

    await morning(on());

    const [sent] = sentTo(h.telegram, seed.memberLink.externalId);
    expect(sent?.uploads ?? []).toEqual([]);
    expect(sent?.message.text).not.toContain("Lily at the beach");
    expect(sent?.message.text).not.toContain(t("en", "photo_box.look"));
  });

  it("an organiser who has Vela write in their name still gets picture mornings on picture days", async () => {
    await h.db
      .update(members)
      .set({ sendAsMe: true } as never)
      .where(eq(members.id, seed.organiser.id))
      .catch(() => undefined);
    await boxed(1);

    const row = await morning(on({ sendAsMe: true }));

    expect(row.askerId).toBeNull();
    expect(row.mediaIds).toHaveLength(1);
  });
});
