import { answers, exchanges, media, members, outbound, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ANSWER_POST_LATE_MINUTES, postMissedAnswers } from "./answers.ts";
import type { SessionIdentity } from "./api-access.ts";
import { setUpApiDevice } from "./api-device.ts";
import { deliverArrival } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deviceInboundEvent, loadDeviceMessages } from "./device-messages.ts";
import { DeviceVoiceRefusedError, storeDeviceVoice } from "./device-voice.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedLinkedGroup } from "./testing/seed.ts";

/**
 * Her side of the parent surface (ADR-35, phase 3), end to end through the inbound router a Telegram
 * chat uses: her phone, set up before her yes, is asked for it; she taps Yes; her first morning
 * reaches the phone; and her words answer it and light her day.
 */
let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
let events = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
  await h.db
    .update(members)
    .set({
      status: "invited",
      lightOn: false,
      lightConsentedAt: null,
      lightConsentText: null,
      lightStartsOn: null,
    })
    .where(eq(members.id, seed.member.id));
});
afterAll(async () => {
  await h.close();
});

const handlers = { outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) };

async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (row === undefined) throw new Error("expected her");
  return row;
}

/** Her phone set up, and what the set-up wrote handed to the queue, as the Worker does. */
async function setUpHerPhone() {
  const set = await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);
  for (const id of set.after.outboundIds)
    await h.queues.outbound.send({ type: "deliver", outboundId: id });
  await h.run(handlers);
}

async function send(input: Parameters<typeof deviceInboundEvent>[2]) {
  events += 1;
  const event = await deviceInboundEvent(
    h.db,
    await her(),
    input,
    { eventId: `e${events}`, messageId: `m${events}` },
    h.clock.now(),
  );
  if (event === null) throw new Error("expected her phone's link");
  await handleInbound(h.deps, [event]);
  await h.run(handlers);
}

describe("her phone on the parent surface", () => {
  it("is asked for her yes when set up before it, in her language, with Yes and No", async () => {
    await setUpHerPhone();

    const [request] = await loadDeviceMessages(h.db, await her());
    expect(request?.kind).toBe("consent");
    // Who asks: the one who invited her, else the family, as on Telegram (no invite is seeded here).
    expect(request?.text).toContain("would like to keep a light on for you");
    expect(request?.buttons.flat()).toHaveLength(2);
  });

  it("turns her light on when she taps Yes on her phone, as a Telegram tap would", async () => {
    await setUpHerPhone();
    const [request] = await loadDeviceMessages(h.db, await her());
    const yes = request?.buttons[0]?.[0];
    if (request === undefined || yes === undefined) throw new Error("expected the request");

    await send({ button: yes.id, message_id: request.message_id });

    const after = await her();
    expect(after).toMatchObject({ status: "active", lightOn: true });
    expect(after.lightConsentedAt).toBeInstanceOf(Date);
  });

  it("brings her first morning to the phone after her yes, and her words answer it", async () => {
    await setUpHerPhone();
    const [request] = await loadDeviceMessages(h.db, await her());
    const yes = request?.buttons[0]?.[0];
    if (request === undefined || yes === undefined) throw new Error("expected the request");
    await send({ button: yes.id, message_id: request.message_id });

    const first = (await her()).lightStartsOn;
    if (first === null) throw new Error("expected her first morning");
    h.clock.set(new Date(`${first}T08:00:00.000+08:00`));
    await deliverArrival(h.deps, seed.member.id, first, false);
    await h.run(handlers);
    const [morning] = await loadDeviceMessages(h.db, await her());
    expect(morning?.kind).toBe("arrival");

    h.clock.advanceMinutes(20);
    await send({ text: "The tomatoes finally turned." });

    const [answer] = await h.db.select().from(answers).where(eq(answers.memberId, seed.member.id));
    expect(answer).toMatchObject({ channel: "device", kind: "text" });
    const [exchange] = await h.db.select().from(exchanges).where(eq(exchanges.scheduledFor, first));
    expect(exchange?.answeredAt).toEqual(h.clock.now());
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toEqual([]);
  });

  it("is not asked again for a yes she has given", async () => {
    await h.db
      .update(members)
      .set({ status: "active", lightOn: true, lightConsentedAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    await setUpHerPhone();
    expect(await loadDeviceMessages(h.db, await her())).toEqual([]);
  });
});

/** A phone's `.m4a` recording: an `ftyp` box and a little more, different for each `n`. */
function m4a(n = 1): Uint8Array {
  return Uint8Array.of(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, n, n, n);
}

/** Her phone set up, her yes given on it, and her first morning delivered there. */
async function herMorningOnThePhone(): Promise<void> {
  await setUpHerPhone();
  const [request] = await loadDeviceMessages(h.db, await her());
  const yes = request?.buttons[0]?.[0];
  if (request === undefined || yes === undefined) throw new Error("expected the request");
  await send({ button: yes.id, message_id: request.message_id });
  const first = (await her()).lightStartsOn;
  if (first === null) throw new Error("expected her first morning");
  h.clock.set(new Date(`${first}T08:00:00.000+08:00`));
  await deliverArrival(h.deps, seed.member.id, first, false);
  await h.run(handlers);
  h.clock.advanceMinutes(20);
}

describe("what she says on her phone, in the family group (ADR-35)", () => {
  it("posts her words to the family's Telegram group, which her phone has none of", async () => {
    const group = await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await herMorningOnThePhone();

    await send({ text: "The tomatoes finally turned." });

    const [post] = h.telegram.sentTo(group.conversationId);
    expect(post?.message.text).toContain("The tomatoes finally turned.");
    const [row] = await h.db.select().from(outbound).where(eq(outbound.kind, "answer_post"));
    expect(row).toMatchObject({ channel: "telegram", conversationId: group.conversationId });
  });
});

describe("her voice from her phone (ADR-35, P4)", () => {
  it("answers her morning with her recording, and the group is sent the stored copy", async () => {
    const group = await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await herMorningOnThePhone();

    const { mediaId } = await storeDeviceVoice(h.deps, await her(), "recording-0001", m4a(), 4200);
    await send({ voice: mediaId });

    const [answer] = await h.db.select().from(answers).where(eq(answers.memberId, seed.member.id));
    expect(answer).toMatchObject({ channel: "device", kind: "voice", mediaId });
    const [file] = await h.db.select().from(media).where(eq(media.id, mediaId));
    expect(file).toMatchObject({ kind: "audio", mime: "audio/mp4", durationMs: 4200 });
    const [post] = h.telegram.sentTo(group.conversationId);
    expect(post?.uploads.map((upload) => upload.storageKey)).toEqual([file?.storageKey]);
    expect(h.queues.media.pending.map((entry) => entry.job.type)).toContain("ingest_answer_media");
  });

  it("is posted by the late sweep with its stored copy when its group post was lost", async () => {
    const group = await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await herMorningOnThePhone();
    const { mediaId } = await storeDeviceVoice(h.deps, await her(), "recording-late", m4a(), 900);
    await send({ voice: mediaId });
    await h.db.delete(outbound).where(eq(outbound.kind, "answer_post"));
    h.clock.advanceMinutes(ANSWER_POST_LATE_MINUTES + 1);

    expect(await postMissedAnswers(h.deps)).toBe(1);

    const [row] = await h.db.select().from(outbound).where(eq(outbound.kind, "answer_post"));
    const [file] = await h.db.select().from(media).where(eq(media.id, mediaId));
    expect(row).toMatchObject({ channel: "telegram", conversationId: group.conversationId });
    const payload = row?.payload as { message: { media?: unknown[] } } | undefined;
    expect(payload?.message.media).toEqual([
      { kind: "audio", storageKey: file?.storageKey, mime: "audio/mp4", durationMs: 900 },
    ]);
  });

  it("is one answer however many times her phone sends the same recording", async () => {
    await herMorningOnThePhone();
    const { mediaId } = await storeDeviceVoice(h.deps, await her(), "recording-0002", m4a(), null);

    await send({ voice: mediaId });
    await send({ voice: mediaId });

    expect(
      await h.db.select().from(answers).where(eq(answers.memberId, seed.member.id)),
    ).toHaveLength(1);
  });

  it("refuses a voice that names no recording of hers", async () => {
    await herMorningOnThePhone();
    const [someoneElses] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.organiser.id,
        kind: "audio",
        channel: "device",
        storageKey: "families/x/device/other.m4a",
        providerFileId: "device:other",
        providerUniqueId: "other",
        createdAt: h.clock.now(),
      })
      .returning({ id: media.id });
    if (someoneElses === undefined) throw new Error("expected the row");

    await expect(
      deviceInboundEvent(
        h.db,
        await her(),
        { voice: someoneElses.id },
        { eventId: "x", messageId: "x" },
        h.clock.now(),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("keeping her recording", () => {
  it("keeps one row for one key, however often it is sent (the race: device-voice-race)", async () => {
    const mother = await her();
    const first = await storeDeviceVoice(h.deps, mother, "recording-again", m4a(), 1000);
    const again = await storeDeviceVoice(h.deps, mother, "recording-again", m4a(), 1000);

    expect(again.mediaId).toBe(first.mediaId);
    expect(await h.db.select().from(media).where(eq(media.uploadedBy, mother.id))).toHaveLength(1);
  });

  it("refuses what is not a recording, a bad key, too many in a day, and no store", async () => {
    const mother = await her();
    const refused = (promise: Promise<unknown>) =>
      promise.then(
        () => "kept",
        (error: unknown) => (error instanceof DeviceVoiceRefusedError ? error.reason : "threw"),
      );

    expect(
      await refused(storeDeviceVoice(h.deps, mother, "recording-1", Uint8Array.of(1, 2, 3), 1)),
    ).toBe("invalid");
    expect(await refused(storeDeviceVoice(h.deps, mother, "../x", m4a(), 1))).toBe("invalid");
    expect(
      await refused(storeDeviceVoice({ ...h.deps, media: null }, mother, "recording-1", m4a(), 1)),
    ).toBe("off");
    for (let n = 0; n < 30; n += 1) {
      await storeDeviceVoice(h.deps, mother, `recording-n${n}`, m4a(n), 1);
    }
    expect(await refused(storeDeviceVoice(h.deps, mother, "recording-31", m4a(), 1))).toBe("limit");
  });
});
