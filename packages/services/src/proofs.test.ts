/**
 * Consent and deletion proofs (flows §3.15, ADR-28): a proof outlives the person it is about
 * without holding their data, and a deletion proof never hashes a value a person could be found by.
 */
import { createHash } from "node:crypto";
import { t } from "@vela/copy";
import { consents, deletions, members, nearbyContacts } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  chatConsentEvidence,
  deletionHash,
  forgetConsentSubjects,
  forgetFamilySubjects,
  forgetMembersWithTheirContacts,
  recordDeletion,
  subjectRef,
} from "./proofs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedNearbyContact } from "./testing/seed.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Her family, with a nearby contact whose yes carries evidence in the founder's words. */
async function familyWithContact(): Promise<{ seed: SeededFamily; contactId: string }> {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  const contact = await seedNearbyContact(h.db, seed, {
    now: h.clock.now(),
    name: "Anna",
    answer: { yes: { phone: "+886912000001" } },
  });
  await h.db.insert(consents).values({
    contactId: contact.id,
    subjectRef: subjectRef({ contactId: contact.id }),
    kind: "nearby",
    answer: "yes",
    textVersion: "nearby-contact-consent.en@1",
    lang: "en",
    channel: "line",
    givenAt: h.clock.now(),
    evidence: { note: "Anna said yes", recorded_by: "founder" },
  });
  return { seed, contactId: contact.id };
}

describe("subjectRef and chatConsentEvidence", () => {
  it("name the subject by id and prove the text by its hash, leaving out a message id the event lacks", async () => {
    const params = { organiser: "Mia" };

    expect(subjectRef({ memberId: "a" })).toBe("member:a");
    expect(subjectRef({ contactId: "b" })).toBe("contact:b");
    expect(
      await chatConsentEvidence({
        chatId: "2001",
        messageId: "7",
        lang: "zh-TW",
        key: "consent.health_words",
        params,
      }),
    ).toEqual({
      chat_id: "2001",
      message_id: "7",
      params,
      text_sha256: sha256(t("zh-TW", "consent.health_words", params)),
    });
    expect(
      await chatConsentEvidence({
        chatId: "2001",
        messageId: undefined,
        lang: "en",
        key: "consent.health_words",
        params,
      }),
    ).not.toHaveProperty("message_id");
  });
});

describe("forgetConsentSubjects", () => {
  it("lets no member or contact be deleted while a consent row about them still holds its evidence", async () => {
    const { seed, contactId } = await familyWithContact();

    await expect(
      h.db.delete(nearbyContacts).where(eq(nearbyContacts.id, contactId)),
    ).rejects.toMatchObject({ cause: { constraint: "consents_subject_deleted_check" } });
    await expect(h.db.delete(members).where(eq(members.id, seed.member.id))).rejects.toMatchObject({
      cause: { constraint: "consents_subject_deleted_check" },
    });

    expect(await h.db.select().from(members).where(eq(members.id, seed.member.id))).toHaveLength(1);
  });

  it("cuts the evidence to the proof keys and stamps when the subject went, so the delete keeps the proof", async () => {
    const { seed, contactId } = await familyWithContact();
    const at = h.clock.now();

    const forgotten = await h.db.transaction(async (tx) => {
      const count = await forgetMembersWithTheirContacts(tx, [seed.member.id], at);
      await tx.delete(members).where(eq(members.id, seed.member.id));
      return count;
    });

    expect(forgotten).toBe(2);
    const rows = await h.db.select().from(consents).orderBy(asc(consents.kind));
    expect(
      rows.map((row) => [
        row.kind,
        row.memberId,
        row.contactId,
        row.subjectRef,
        row.subjectDeletedAt,
        row.evidence,
      ]),
    ).toEqual([
      ["light", null, null, `member:${seed.member.id}`, at, { chat_id: "2001", message_id: "1" }],
      ["nearby", null, null, `contact:${contactId}`, at, { recorded_by: "founder" }],
    ]);
  });

  it("leaves a row already forgotten as it was, and forgets nothing for no subjects", async () => {
    const { seed } = await familyWithContact();
    const first = h.clock.now();
    await forgetConsentSubjects(h.db, { memberIds: [seed.member.id] }, first);
    h.clock.advanceMinutes(10);

    expect(await forgetConsentSubjects(h.db, { memberIds: [seed.member.id] }, h.clock.now())).toBe(
      0,
    );
    expect(await forgetConsentSubjects(h.db, {}, h.clock.now())).toBe(0);
    const [light] = await h.db.select().from(consents).where(eq(consents.kind, "light"));
    expect(light?.subjectDeletedAt).toEqual(first);
  });

  it("forgets every member and contact of a family, so the family can be deleted", async () => {
    const { seed } = await familyWithContact();

    expect(await forgetFamilySubjects(h.db, seed.family.id, h.clock.now())).toBe(2);
    expect(await forgetFamilySubjects(h.db, seed.family.id, h.clock.now())).toBe(0);
  });
});

describe("deletion proofs", () => {
  it("hash the object's type and id, never a value it held, and the database refuses any other hash", async () => {
    const id = "01990000-0000-7000-8000-00000000000a";

    expect(await deletionHash("nearby_contact", id)).toBe(sha256(`nearby_contact:${id}`));
    await recordDeletion(h.db, {
      objectType: "nearby_contact",
      objectId: id,
      reason: "test",
      at: h.clock.now(),
    });
    expect((await h.db.select().from(deletions)).map((row) => row.contentHash)).toEqual([
      sha256(`nearby_contact:${id}`),
    ]);

    for (const contentHash of [
      sha256("+886912000001"),
      sha256(id),
      sha256(`nearby_contact:${id}`).toUpperCase(),
    ]) {
      await expect(
        h.db.insert(deletions).values({
          objectType: "nearby_contact",
          objectId: id,
          contentHash,
          reason: "test",
        }),
      ).rejects.toMatchObject({ cause: { constraint: "deletions_content_hash_check" } });
    }
  });
});
