import { answers, media, outbound } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverOutbound, enqueueOutbound } from "./gateway.ts";
import { ingestExchangeMedia } from "./inbound-media-copy.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";
import { loadScheduleInput, tickMember } from "./tick.ts";

let h: Harness;
let seed: SeededFamily;
beforeAll(async () => {
  h = await createHarness();
}, 60000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  // The parent remains approved; removing the organiser pauses automatic family content.
  h.deps.config.pilotAdmission = { telegramUserIds: [seed.memberLink.externalId] };
});
afterAll(async () => {
  await h.close();
});

describe("automatic work after trial admission changes", () => {
  it("drops queued weekly content while keeping Stop/privacy confirmations deliverable", async () => {
    const request = {
      memberId: seed.member.id,
      channel: "telegram" as const,
      conversationId: seed.memberLink.externalId,
      lang: "en" as const,
      text: "Synthetic text",
    };
    const weekly = await enqueueOutbound(h.deps, h.db, {
      ...request,
      kind: "weekly_read",
      idempotencyKey: "weekly_read:trial-admission",
    });
    const stopped = await enqueueOutbound(h.deps, h.db, {
      ...request,
      kind: "system",
      idempotencyKey: "system:trial-stop-confirmation",
    });
    if (!("outboundId" in weekly) || !("outboundId" in stopped)) throw new Error("missing output");
    await deliverOutbound(h.deps, weekly.outboundId);
    await deliverOutbound(h.deps, stopped.outboundId);
    const rows = await h.db.select().from(outbound);
    expect(rows.find((row) => row.id === weekly.outboundId)?.status).toBe("dropped");
    expect(rows.find((row) => row.id === stopped.outboundId)?.status).toBe("sent");
    expect(h.telegram.sent).toHaveLength(1);
  });

  it("clears scheduling instead of preparing a new arrival", async () => {
    expect(await loadScheduleInput(h.deps, seed.member.id, h.clock.now())).toBeNull();
    expect(await tickMember(h.deps, seed.member.id)).toBeNull();
    expect(h.queues.outbound.pending).toHaveLength(0);
    expect(h.scheduler.wakes.get(seed.member.id)).toBeNull();
  });

  it("does not send a stored text answer to the model after a family member loses approval", async () => {
    const exchange = await seedExchange(h.db, seed, { date: "2026-09-14", state: "answered" });
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        payload: { text: "A synthetic garden answer." },
        receivedAt: h.clock.now(),
      })
      .returning();
    if (answer === undefined) throw new Error("missing answer");
    await understandAnswer(h.deps, answer.id);
    expect(h.ai.calls).toEqual([]);
    const [current] = await h.db.select().from(answers).where(eq(answers.id, answer.id));
    expect(current?.summary).toBeNull();
  });

  it("acknowledges media jobs without fetching or transcribing outside the approved family", async () => {
    const exchange = await seedExchange(h.db, seed, { date: "2026-09-14", state: "answered" });
    const [file] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.member.id,
        kind: "audio",
        channel: "telegram",
        providerFileId: "trial-voice",
        mime: "audio/ogg",
        createdAt: h.clock.now(),
      })
      .returning();
    if (file === undefined) throw new Error("missing file");
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "voice",
        channel: "telegram",
        mediaId: file.id,
        receivedAt: h.clock.now(),
      })
      .returning();
    if (answer === undefined) throw new Error("missing answer");
    let transcribed = 0;
    h.deps.stt = {
      transcribe: async () => {
        transcribed += 1;
        throw new Error("must not run");
      },
    };
    await ingestExchangeMedia(h.deps, file.id);
    await ingestAnswerMedia(h.deps, answer.id);
    expect(h.telegram.fetched).toEqual([]);
    expect(transcribed).toBe(0);
    expect(h.media.objects.size).toBe(0);
  });
});
