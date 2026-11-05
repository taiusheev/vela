/** Regression tests for the privacy promises checked in the November audit. */
import { ApiUploadedMedia, InboundEvent } from "@vela/contracts";
import {
  channelLinks,
  deadLetters,
  families,
  media,
  members,
  photoBox,
  users,
  weeklyReads,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disableApiAccount } from "./api-account-writes.ts";
import { uploadApiMedia } from "./api-media.ts";
import { keepDeadLetter } from "./dead-letters.ts";
import { sha256Hex } from "./hash.ts";
import { applyRetention } from "./jobs.ts";
import { addToApiPhotoBox, keepBoxPhotoStored } from "./photo-box.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { testJpeg } from "./testing/jpeg.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
const identity = { authSubject: "audit|synthetic-organiser", sessionId: "synthetic-session" };
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

describe("full checkup: promised privacy behavior", () => {
  it("clears a deleted account's identifying profile after the retention period", async () => {
    const [account] = await h.db
      .insert(users)
      .values({
        authSubject: identity.authSubject,
        displayName: "Synthetic Account Name",
        email: "synthetic@example.test",
        phone: "+886900000099",
        language: "zh-TW",
        tz: "Asia/Taipei",
      })
      .returning();
    if (account === undefined) throw new Error("Missing synthetic account");
    await disableApiAccount(h.deps, identity.authSubject);
    h.clock.advance(31 * 86_400_000);
    await applyRetention(h.deps);
    const remaining = await h.db.select().from(users).where(eq(users.id, account.id));
    expect(
      remaining.map(({ displayName, email, phone }) => ({ displayName, email, phone })),
    ).not.toContainEqual({
      displayName: "Synthetic Account Name",
      email: "synthetic@example.test",
      phone: "+886900000099",
    });
  });

  it("minimises a legacy deleted profile and expires its denial fingerprint after five years", async () => {
    const [account] = await h.db
      .insert(users)
      .values({
        authSubject: identity.authSubject,
        displayName: "Synthetic legacy name",
        email: "legacy@example.test",
        deletedAt: h.clock.now(),
        language: "zh-TW",
        tz: "Asia/Taipei",
      })
      .returning();
    if (account === undefined) throw new Error("missing account");
    await applyRetention(h.deps);
    const [erased] = await h.db.select().from(users).where(eq(users.id, account.id));
    expect(erased).toMatchObject({
      authSubject: null,
      displayName: "",
      email: null,
      phone: null,
      language: "en",
      tz: "UTC",
      deletedAuthSubjectHash: await sha256Hex(identity.authSubject),
    });
    h.clock.set(new Date("2032-01-01T00:00:00Z"));
    await applyRetention(h.deps);
    const [expired] = await h.db.select().from(users).where(eq(users.id, account.id));
    expect(expired?.deletedAuthSubjectHash).toBeNull();
  });

  it("deletes photo-box photos within a day when their only organiser deletes the app account", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const [account] = await h.db
      .insert(users)
      .values({
        authSubject: identity.authSubject,
        displayName: "Synthetic Organiser",
      })
      .returning();
    if (account === undefined) throw new Error("Missing synthetic account");
    await h.db.update(members).set({ userId: account.id }).where(eq(members.id, seed.organiser.id));
    const upload = await uploadApiMedia(
      { db: h.db, clock: h.clock, random: h.random, store: h.media, logger: h.logger },
      identity,
      "audit-upload",
      seed.family.id,
      testJpeg({ scan: [1, 2, 3] }),
    );
    const mediaId = ApiUploadedMedia.parse(upload.response.body).id;
    await addToApiPhotoBox(h.deps, identity, "audit-box", seed.family.id, {
      media_id: mediaId,
      era: "old",
    });
    await keepBoxPhotoStored(h.deps, mediaId);
    await disableApiAccount(h.deps, identity.authSubject);
    h.clock.advance(86_400_000 + 1);
    await applyRetention(h.deps);
    expect(await h.db.select().from(photoBox)).toEqual([]);
    expect(await h.db.select().from(media).where(eq(media.id, mediaId))).toEqual([]);
  });

  it("clears expired private weekly text even if cleanup missed its four-week processing window", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const [read] = await h.db
      .insert(weeklyReads)
      .values({
        familyId: seed.family.id,
        memberId: seed.member.id,
        weekStart: "2026-09-07",
        lines: [],
        suggestion: "",
        promptVersion: "synthetic-audit",
        stats: {
          answered_days: 2,
          insight: [{ observation: "Synthetic private reading" }],
          feedback: { [seed.organiser.id]: "Synthetic private feedback" },
          sent_feedback: [{ member_id: seed.organiser.id, text: "Synthetic sent feedback" }],
        },
      })
      .returning();
    if (read === undefined) throw new Error("Missing synthetic weekly read");
    h.clock.set(new Date("2026-12-01T12:00:00Z"));
    await applyRetention(h.deps);
    const [after] = await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, read.id));
    expect(after?.stats).not.toHaveProperty("insight");
    expect(after?.stats).not.toHaveProperty("feedback");
    expect(after?.stats).not.toHaveProperty("sent_feedback");
  });

  it("erases failed inbound jobs containing a family's words when the family is deleted", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db
      .update(channelLinks)
      .set({ channel: "line" })
      .where(eq(channelLinks.id, seed.memberLink.id));
    const event = InboundEvent.parse({
      kind: "text",
      channel: "line",
      eventId: "synthetic-event",
      messageId: "synthetic-message",
      conversation: { kind: "private", externalId: seed.memberLink.externalId },
      sender: { externalUserId: seed.memberLink.externalId, displayName: "Synthetic Parent" },
      text: "Synthetic private answer",
      at: h.clock.now().toISOString(),
    });
    await keepDeadLetter(h.deps, {
      messageId: "synthetic-failed-inbound",
      jobType: "handle_inbound",
      job: { type: "handle_inbound", events: [event] },
    });
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    h.clock.advance(86_400_000 + 1);
    await applyRetention(h.deps);
    expect(await h.db.select().from(families)).toEqual([]);
    expect(await h.db.select().from(deadLetters)).toEqual([]);
  });
});
