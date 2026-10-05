/**
 * Voice replies from the app (spec §14.1 A8): the recording kept first, the reply naming it, and
 * her next morning reading it back, uploaded to her Telegram chat as a voice message. The race on
 * the upload's key and limit is `postgres-tests/api-voice-upload-race.test.ts`'s.
 */
import { ApiReply, ApiUploadedVoice, type LocalDate, type OutboundKind } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { media, members, outbound, replies, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { AskVoiceMissingError, composeApiAsk } from "./api-asks.ts";
import { MediaRefusedError } from "./api-media.ts";
import { ReplyRefusedError, replyToApiExchange } from "./api-replies.ts";
import { MAX_VOICES_PER_ACCOUNT_DAY, uploadApiVoice } from "./api-voice.ts";
import { deliverArrival } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
let keys = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await signIn(mia, "Mia", seed.organiser.id);
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  await signIn(sam, "Sam", brother.member.id);
});
afterAll(async () => {
  await h.close();
});

async function signIn(identity: SessionIdentity, name: string, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  if (user === undefined) throw new Error(`expected an account for ${name}`);
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

/** A phone's `.m4a`: an `ftyp` box and a little more, different for each `n`. */
function m4a(n = 1): Uint8Array {
  return Uint8Array.of(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, n, n, n);
}

function uploadDeps() {
  return { db: h.db, clock: h.clock, random: h.random, store: h.media, logger: h.logger };
}

async function voice(who: SessionIdentity = mia, n = 1, key?: string) {
  keys += 1;
  const result = await uploadApiVoice(
    uploadDeps(),
    who,
    key ?? `voice-${keys}`,
    seed.family.id,
    m4a(n),
    4200,
  );
  return { ...result, body: ApiUploadedVoice.parse(result.response.body) };
}

function today(): LocalDate {
  return localDateOf(h.clock.now(), seed.member.tz);
}

async function answeredToday() {
  return seedExchange(h.db, seed, {
    date: today(),
    state: "answered",
    deliveredAt: h.clock.now(),
    answeredAt: h.clock.now(),
  });
}

describe("keeping a voice for a reply", () => {
  it("keeps the recording as it came, under a key of its own, for 30 days", async () => {
    const { body, replayed } = await voice();

    expect(replayed).toBe(false);
    expect(body).toMatchObject({ kind: "audio", duration_ms: 4200, bytes: 15 });
    const [row] = await h.db.select().from(media).where(eq(media.id, body.id));
    expect(row).toMatchObject({
      kind: "audio",
      mime: "audio/mp4",
      channel: null,
      uploadedBy: seed.organiser.id,
      durationMs: 4200,
    });
    expect(row?.storageKey).toMatch(new RegExp(`^replies/${seed.family.id}/.+\\.m4a$`));
    expect(h.media.objects.get(row?.storageKey ?? "")?.body).toEqual(m4a().buffer);
  });

  it("answers a retry from its receipt, keeping one row and one object", async () => {
    const first = await voice(mia, 1, "same-key");
    const again = await voice(mia, 1, "same-key");

    expect(again.replayed).toBe(true);
    expect(again.body.id).toBe(first.body.id);
    expect(await h.db.select().from(media)).toHaveLength(1);
    expect(h.media.objects.size).toBe(1);
  });

  it("refuses anything but an .m4a, and keeps nothing of it", async () => {
    const refused = await uploadApiVoice(
      uploadDeps(),
      mia,
      "not-audio",
      seed.family.id,
      Uint8Array.of(1, 2, 3),
      1,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(MediaRefusedError);
    expect((refused as MediaRefusedError).reason).toBe("m4a_only");
    expect(h.media.objects.size).toBe(0);
  });

  it(`refuses an account's voice past ${MAX_VOICES_PER_ACCOUNT_DAY} in a day, and deletes its object`, async () => {
    for (let n = 0; n < MAX_VOICES_PER_ACCOUNT_DAY; n += 1) await voice(mia, n);
    const refused = await voice(mia, 99).then(
      () => null,
      (error: unknown) => error,
    );
    expect((refused as MediaRefusedError).reason).toBe("voice_limit");
    expect(h.media.objects.size).toBe(MAX_VOICES_PER_ACCOUNT_DAY);
    // Another account's day is its own.
    expect((await voice(sam, 1)).replayed).toBe(false);
  });
});

describe("a voice reply", () => {
  it("is a reply of kind voice naming the recording, read back to her as a Telegram voice message", async () => {
    const exchange = await answeredToday();
    const recorded = await voice();

    keys += 1;
    const result = await replyToApiExchange(h.deps, mia, `reply-${keys}`, exchange.id, {
      voice: recorded.body.id,
    });

    expect(result.response.status).toBe(201);
    expect(ApiReply.parse(result.response.body)).toMatchObject({ kind: "voice", text: null });
    const [row] = await h.db.select().from(replies);
    expect(row).toMatchObject({ kind: "voice", mediaId: recorded.body.id, channel: "app" });

    const tomorrow = addDays(today(), 1);
    h.clock.set(new Date(`${tomorrow}T08:00:00.000+08:00`));
    await deliverArrival(h.deps, seed.member.id, tomorrow, false);
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });

    const [arrival] = await h.db
      .select()
      .from(outbound)
      .where(eq(outbound.kind, "arrival" satisfies OutboundKind));
    expect(arrival?.status).toBe("sent");
    const [sent] = h.telegram.sentTo(seed.memberLink.externalId);
    const [file] = await h.db.select().from(media).where(eq(media.id, recorded.body.id));
    expect(sent?.uploads.map((upload) => upload.storageKey)).toEqual([file?.storageKey]);
    expect(sent?.message.media?.[0]).toMatchObject({ kind: "audio", mime: "audio/mp4" });
  });

  it("refuses a voice that is not the replier's own recording", async () => {
    const exchange = await answeredToday();
    const hers = await voice(sam);

    keys += 1;
    const refused = await replyToApiExchange(h.deps, mia, `reply-${keys}`, exchange.id, {
      voice: hers.body.id,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(ReplyRefusedError);
    expect((refused as ReplyRefusedError).reason).toBe("voice_missing");
    expect(await h.db.select().from(replies)).toHaveLength(0);
  });
});

describe("a voice hello on an ask", () => {
  async function compose(
    voiceHelloId: string,
    who: SessionIdentity = mia,
    type: "question" | "voice_note" = "question",
    text = "What did you cook today?",
  ) {
    keys += 1;
    return composeApiAsk(h.deps, who, `compose-${keys}`, seed.family.id, {
      recipient_id: seed.member.id,
      type,
      text,
      when: "tomorrow",
      voice_hello_id: voiceHelloId,
    });
  }

  it("plays before the ask: uploaded to her Telegram chat as a voice message ahead of the words", async () => {
    const hello = await voice();
    const composed = await compose(hello.body.id);
    expect(composed.response.status).toBe(201);

    const tomorrow = addDays(today(), 1);
    h.clock.set(new Date(`${tomorrow}T08:00:00.000+08:00`));
    await deliverArrival(h.deps, seed.member.id, tomorrow, false);
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });

    const [sent] = h.telegram.sentTo(seed.memberLink.externalId);
    const [file] = await h.db.select().from(media).where(eq(media.id, hello.body.id));
    expect(sent?.message.media).toEqual([
      expect.objectContaining({ kind: "audio", storageKey: file?.storageKey, mime: "audio/mp4" }),
    ]);
    expect(sent?.message.text).toContain("What did you cook today?");
  });

  it("is the whole ask for a voice note: her morning plays it, with the words and a heart to answer", async () => {
    const note = await voice();
    const composed = await compose(note.body.id, mia, "voice_note", "Listen to my voice note.");
    expect(composed.response.status).toBe(201);

    const tomorrow = addDays(today(), 1);
    h.clock.set(new Date(`${tomorrow}T08:00:00.000+08:00`));
    await deliverArrival(h.deps, seed.member.id, tomorrow, false);
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });

    const [sent] = h.telegram.sentTo(seed.memberLink.externalId);
    expect(sent?.message.media).toEqual([expect.objectContaining({ kind: "audio" })]);
    expect(sent?.message.text).toContain("Listen to my voice note.");
    expect(sent?.message.buttons?.flat().length).toBeGreaterThan(0);
  });

  it("refuses a recording that is not the asker's own, or too long to be a hello", async () => {
    const hers = await voice(sam);
    await expect(compose(hers.body.id)).rejects.toBeInstanceOf(AskVoiceMissingError);

    keys += 1;
    const long = await uploadApiVoice(
      uploadDeps(),
      mia,
      `long-${keys}`,
      seed.family.id,
      m4a(9),
      60_000,
    );
    await expect(compose(ApiUploadedVoice.parse(long.response.body).id)).rejects.toBeInstanceOf(
      AskVoiceMissingError,
    );
  });
});
