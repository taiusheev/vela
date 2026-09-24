import { createOffAi } from "@vela/ai";
import type { LocalDate, OutboundKind, OutboundStatus } from "@vela/contracts";
import { t } from "@vela/copy";
import { addMinutes, outboundKey } from "@vela/core";
import {
  adminAccessLog,
  aiCalls,
  answers,
  awayPeriods,
  channelLinks,
  consents,
  deletions,
  events,
  families,
  invites,
  members,
  nearbyContacts,
  outbound,
  translations,
  weeklyReads,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_OVERVIEW_PATH,
  addContact,
  adminLink,
  createInvite,
  deleteFamily,
  endAway,
  familyPagePath,
  loadAdminOverview,
  loadFailedOutbound,
  loadFamilyPage,
  markDeceased,
  markLeft,
  recordAdminView,
  recordConsent,
  recordContactConsent,
  removeContact,
  sendWeeklyRead,
  setAway,
} from "./admin.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound, enqueueOutbound } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import { consentedNearbyContacts } from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";

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

const FOUNDER = { admin: "founder@vela.test" };
const TODAY: LocalDate = "2026-09-14";
const WEEK_START: LocalDate = "2026-09-07";
const WEEK_END: LocalDate = "2026-09-13";
const UNKNOWN_ID = "01990000-0000-7000-8000-000000000000";

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function family(): Promise<SeededFamily> {
  return seedFamily(h.db, { now: h.clock.now() });
}

async function logRows() {
  return h.db.select().from(adminAccessLog).orderBy(asc(adminAccessLog.at), asc(adminAccessLog.id));
}

async function eventRows() {
  return h.db
    .select({
      name: events.name,
      familyId: events.familyId,
      memberId: events.memberId,
      props: events.props,
    })
    .from(events)
    .orderBy(asc(events.id));
}

async function memberRow(memberId: string) {
  const [row] = await h.db.select().from(members).where(eq(members.id, memberId));
  if (row === undefined) {
    throw new Error("member is gone");
  }
  return row;
}

async function outboundRows() {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

const STATS = {
  counted_days: 7,
  answered_days: 5,
  hello_mornings: 2,
  family_asks: 5,
  usual_time: "08:40",
  drift_min: 0,
  topics: [],
  voice_len_drift: null,
};

async function seedWeeklyRead(
  seed: SeededFamily,
  options: { weekStart?: LocalDate; lines?: string[]; suggestion?: string } = {},
): Promise<string> {
  const [row] = await h.db
    .insert(weeklyReads)
    .values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      weekStart: options.weekStart ?? WEEK_START,
      lines: options.lines ?? ["Draft line one.", "Draft line two."],
      suggestion: options.suggestion ?? "Draft suggestion.",
      stats: STATS,
      promptVersion: "weekly_read.v4",
      createdAt: h.clock.now(),
    })
    .returning({ id: weeklyReads.id });
  if (row === undefined) {
    throw new Error("weekly read not inserted");
  }
  return row.id;
}

const CONSENT = {
  textVersion: "pilot-agreement@1",
  lang: "en" as const,
  channel: "paper",
  evidence: { form: "signed pilot agreement, scan 12" },
};

describe("adminLink", () => {
  it("points at the family's page on the public origin, whatever the origin's trailing slash", () => {
    expect(adminLink(h.config, UNKNOWN_ID)).toBe(`https://vela.test/admin/families/${UNKNOWN_ID}`);
    expect(adminLink({ ...h.config, publicBaseUrl: "https://vela.test/" }, UNKNOWN_ID)).toBe(
      `https://vela.test/admin/families/${UNKNOWN_ID}`,
    );
    expect(familyPagePath(UNKNOWN_ID)).toBe(`/admin/families/${UNKNOWN_ID}`);
  });
});

describe("recordAdminView", () => {
  it("writes one view row and one admin_page_opened event per family the page showed", async () => {
    const first = await family();
    const second = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });

    await recordAdminView(h.deps, FOUNDER, {
      familyIds: [first.family.id, second.family.id, first.family.id],
      memberId: null,
      what: ADMIN_OVERVIEW_PATH,
    });

    const rows = await logRows();
    expect(
      rows.map((row) => [row.admin, row.familyId, row.memberId, row.action, row.what]),
    ).toEqual([
      ["founder@vela.test", first.family.id, null, "view", "/admin"],
      ["founder@vela.test", second.family.id, null, "view", "/admin"],
    ]);
    expect(rows.every((row) => row.at.getTime() === h.clock.now().getTime())).toBe(true);
    expect(await eventRows()).toEqual([
      {
        name: "admin_page_opened",
        familyId: first.family.id,
        memberId: null,
        props: { what: "/admin" },
      },
      {
        name: "admin_page_opened",
        familyId: second.family.id,
        memberId: null,
        props: { what: "/admin" },
      },
    ]);
  });

  it("names the member a page is about, writes nothing for no families, and refuses a blank path", async () => {
    const seed = await family();
    await recordAdminView(h.deps, FOUNDER, {
      familyIds: [seed.family.id],
      memberId: seed.member.id,
      what: familyPagePath(seed.family.id),
    });
    expect((await logRows()).map((row) => row.memberId)).toEqual([seed.member.id]);

    await recordAdminView(h.deps, FOUNDER, { familyIds: [], memberId: null, what: "/admin" });
    expect(await logRows()).toHaveLength(1);

    await expect(
      recordAdminView(h.deps, FOUNDER, { familyIds: [seed.family.id], memberId: null, what: " " }),
    ).rejects.toThrow(VelaError);
    await expect(
      recordAdminView(
        h.deps,
        { admin: "" },
        { familyIds: [seed.family.id], memberId: null, what: "/admin" },
      ),
    ).rejects.toThrow(VelaError);
    expect(await logRows()).toHaveLength(1);
  });
});

describe("recordConsent", () => {
  it("stores the consent with the founder as its recorder, one log row, and one event", async () => {
    const seed = await family();
    const givenAt = new Date("2026-09-13T10:00:00Z");

    await recordConsent(h.deps, FOUNDER, {
      memberId: seed.organiser.id,
      kind: "pilot",
      givenAt,
      ...CONSENT,
    });

    const rows = await h.db.select().from(consents).where(eq(consents.kind, "pilot"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: seed.organiser.id,
      contactId: null,
      subjectRef: `member:${seed.organiser.id}`,
      answer: "yes",
      textVersion: "pilot-agreement@1",
      lang: "en",
      channel: "paper",
      givenAt,
      withdrawnAt: null,
      evidence: { form: "signed pilot agreement, scan 12", recorded_by: "founder" },
    });
    const [log] = await logRows();
    expect(log).toMatchObject({
      admin: "founder@vela.test",
      familyId: seed.family.id,
      memberId: seed.organiser.id,
      action: "record_consent",
      what: "consent pilot pilot-agreement@1",
      at: h.clock.now(),
    });
    expect(await eventRows()).toEqual([
      {
        name: "consent_given",
        familyId: seed.family.id,
        memberId: seed.organiser.id,
        props: { kind: "pilot", recorded_by: "founder" },
      },
    ]);
  });

  it("changes nothing for the same kind and version again, and records a new version", async () => {
    const seed = await family();
    const input = {
      memberId: seed.member.id,
      kind: "privacy_notice" as const,
      givenAt: h.clock.now(),
      ...CONSENT,
    };

    await recordConsent(h.deps, FOUNDER, input);
    await recordConsent(h.deps, FOUNDER, input);
    await recordConsent(h.deps, FOUNDER, { ...input, textVersion: "privacy-notice@2" });

    const rows = await h.db.select().from(consents).where(eq(consents.kind, "privacy_notice"));
    expect(rows.map((row) => row.textVersion).sort()).toEqual([
      "pilot-agreement@1",
      "privacy-notice@2",
    ]);
    expect(await logRows()).toHaveLength(2);
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "consent_given",
      "consent_given",
    ]);
  });

  it("refuses a kind the founder cannot record, an unknown member, and a member of another family", async () => {
    const seed = await family();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const input = { kind: "pilot" as const, givenAt: h.clock.now(), ...CONSENT };

    await expect(
      recordConsent(h.deps, FOUNDER, {
        ...input,
        memberId: seed.member.id,
        kind: "light" as never,
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      recordConsent(h.deps, FOUNDER, { ...input, memberId: UNKNOWN_ID }),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    await expect(
      recordConsent(
        h.deps,
        { ...FOUNDER, familyId: seed.family.id },
        { ...input, memberId: other.member.id },
      ),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    expect(await h.db.select().from(consents).where(eq(consents.kind, "pilot"))).toHaveLength(0);
    expect(await logRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
  });
});

describe("recordContactConsent", () => {
  const ANNA_PHONE = "+886 912 000 001";
  const answer = (contactId: string, answer: "yes" | "no", phone: string | null = null) => ({
    contactId,
    answer,
    phone,
    at: h.clock.now(),
    textVersion: "nearby-notice@1",
    lang: "en" as const,
    channel: "phone",
    evidence: { call: "organiser reported the answer" },
  });

  it("lists the contact on a yes with their number, records the yes as a proof, and changes nothing on the same yes again", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: null,
    });
    expect(await consentedNearbyContacts(h.db, seed.member.id)).toHaveLength(0);

    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes", ANNA_PHONE));
    h.clock.advanceMinutes(5);
    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes", ANNA_PHONE));

    const listed = await consentedNearbyContacts(h.db, seed.member.id);
    expect(listed.map((row) => [row.id, row.phone, row.consentedAt, row.declinedAt])).toEqual([
      [contact.id, ANNA_PHONE, new Date("2026-09-14T00:00:00Z"), null],
    ]);
    const nearby = await h.db.select().from(consents).where(eq(consents.kind, "nearby"));
    expect(nearby).toHaveLength(1);
    expect(nearby[0]).toMatchObject({
      contactId: contact.id,
      memberId: null,
      subjectRef: `contact:${contact.id}`,
      answer: "yes",
      textVersion: "nearby-notice@1",
      evidence: { call: "organiser reported the answer", recorded_by: "founder" },
    });
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "record_contact_consent",
      familyId: seed.family.id,
      memberId: seed.member.id,
      what: `nearby yes contact=${contact.id}`,
    });
    expect(await eventRows()).toEqual([
      {
        name: "consent_given",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: { kind: "nearby", contact_id: contact.id, recorded_by: "founder" },
      },
    ]);
  });

  it("unlists the contact on a no, clears their number, withdraws their yes, records the no, and changes nothing on a second no", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: null,
    });
    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes", ANNA_PHONE));
    h.clock.advanceMinutes(60);

    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "no"));
    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "no"));

    expect(await consentedNearbyContacts(h.db, seed.member.id)).toHaveLength(0);
    const [row] = await h.db.select().from(nearbyContacts).where(eq(nearbyContacts.id, contact.id));
    expect(row).toMatchObject({ phone: null, declinedAt: h.clock.now() });
    const nearby = await h.db
      .select()
      .from(consents)
      .where(eq(consents.kind, "nearby"))
      .orderBy(asc(consents.givenAt));
    expect(nearby.map((consent) => [consent.answer, consent.withdrawnAt])).toEqual([
      ["yes", h.clock.now()],
      ["no", null],
    ]);
    expect((await logRows()).map((log) => log.what)).toEqual([
      `nearby yes contact=${contact.id}`,
      `nearby no contact=${contact.id}`,
    ]);
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "consent_given",
      "consent_declined",
    ]);
  });

  it("refuses a yes without a number and a no with one, storing nothing", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: null,
    });

    await expect(
      recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes")),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      recordContactConsent(h.deps, FOUNDER, answer(contact.id, "no", ANNA_PHONE)),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes", "call me")),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });

    const [row] = await h.db.select().from(nearbyContacts).where(eq(nearbyContacts.id, contact.id));
    expect(row).toMatchObject({ phone: null, consentedAt: null, declinedAt: null });
    expect(await h.db.select().from(consents).where(eq(consents.kind, "nearby"))).toEqual([]);
    expect(await logRows()).toHaveLength(0);
  });

  it("lists a contact again on a yes after a no, and refuses an unknown contact", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: "no",
    });

    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes", ANNA_PHONE));

    expect((await consentedNearbyContacts(h.db, seed.member.id)).map((row) => row.id)).toEqual([
      contact.id,
    ]);
    await expect(
      recordContactConsent(h.deps, FOUNDER, answer(UNKNOWN_ID, "yes", ANNA_PHONE)),
    ).rejects.toMatchObject({
      name: "VelaError",
      code: "not_found",
    });
    for (const log of await logRows()) {
      expect(log.what).not.toContain("Anna");
      expect(log.what).not.toContain("912");
    }
  });

  // The database holds a number exactly while a yes stands, whichever path writes it.
  it("cannot leave a number on a contact without a standing yes, even written directly", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: { yes: { phone: ANNA_PHONE } },
    });

    await expect(
      h.db
        .update(nearbyContacts)
        .set({ declinedAt: h.clock.now() })
        .where(eq(nearbyContacts.id, contact.id)),
    ).rejects.toMatchObject({ cause: { constraint: "nearby_contacts_phone_consented_check" } });
  });
});

describe("addContact", () => {
  const contact = (memberId: string, name = "Anna") => ({
    memberId,
    name,
    relation: "",
    channel: "line" as const,
    yes: null,
  });
  const withYes = (memberId: string, name = "Anna") => ({
    ...contact(memberId, name),
    yes: {
      phone: "+886912000001",
      at: new Date("2026-09-13T09:00:00Z"),
      textVersion: "nearby-contact-consent.en@1",
      lang: "en" as const,
      channel: "line",
      evidence: { note: "Anna replied yes on LINE" },
    },
  });

  it("stores a contact without their yes as a name alone, unlisted, and logs no name", async () => {
    const seed = await family();

    await addContact(h.deps, FOUNDER, contact(seed.member.id));

    const rows = await h.db.select().from(nearbyContacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      familyId: seed.family.id,
      memberId: seed.member.id,
      name: "Anna",
      phone: null,
      relation: null,
      channel: "line",
      consentedAt: null,
      declinedAt: null,
    });
    expect(await consentedNearbyContacts(h.db, seed.member.id)).toHaveLength(0);
    expect(await h.db.select().from(consents).where(eq(consents.kind, "nearby"))).toEqual([]);
    const [log] = await logRows();
    expect(log).toMatchObject({
      action: "add_contact",
      familyId: seed.family.id,
      memberId: seed.member.id,
      what: `contact=${rows[0]?.id}`,
    });
    expect(await eventRows()).toEqual([
      {
        name: "nearby_contact_added",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: { contact_id: rows[0]?.id, by: "founder", consented: false },
      },
    ]);
  });

  it("stores a contact with their yes, number, and nearby consent together, listed at once, with two events under one log row", async () => {
    const seed = await family();

    await addContact(h.deps, FOUNDER, withYes(seed.member.id));

    const [row] = await h.db.select().from(nearbyContacts);
    expect(row).toMatchObject({
      name: "Anna",
      phone: "+886912000001",
      consentedAt: new Date("2026-09-13T09:00:00Z"),
      declinedAt: null,
    });
    expect((await consentedNearbyContacts(h.db, seed.member.id)).map((c) => c.id)).toEqual([
      row?.id,
    ]);
    const nearby = await h.db.select().from(consents).where(eq(consents.kind, "nearby"));
    expect(nearby).toHaveLength(1);
    expect(nearby[0]).toMatchObject({
      contactId: row?.id,
      subjectRef: `contact:${row?.id}`,
      answer: "yes",
      textVersion: "nearby-contact-consent.en@1",
      givenAt: new Date("2026-09-13T09:00:00Z"),
      evidence: { note: "Anna replied yes on LINE", recorded_by: "founder" },
    });
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.what).not.toContain("912");
    expect(await eventRows()).toEqual([
      {
        name: "nearby_contact_added",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: { contact_id: row?.id, by: "founder", consented: true },
      },
      {
        name: "consent_given",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: { kind: "nearby", contact_id: row?.id, recorded_by: "founder" },
      },
    ]);
  });

  it("adds nobody for the same name again, in any letter case, and refuses a third contact", async () => {
    const seed = await family();
    await addContact(h.deps, FOUNDER, contact(seed.member.id));
    await addContact(h.deps, FOUNDER, contact(seed.member.id, " anna "));
    await addContact(h.deps, FOUNDER, withYes(seed.member.id, "Bob"));
    await addContact(h.deps, FOUNDER, withYes(seed.member.id, " BOB "));

    expect(await h.db.select().from(nearbyContacts)).toHaveLength(2);
    expect(await h.db.select().from(consents).where(eq(consents.kind, "nearby"))).toHaveLength(1);
    expect(await logRows()).toHaveLength(2);

    await expect(
      addContact(h.deps, FOUNDER, contact(seed.member.id, "Cara")),
    ).rejects.toMatchObject({ name: "VelaError", code: "illegal_state" });
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(2);
  });

  it("refuses a yes for a contact already stored by name, instead of dropping it, and points to their row", async () => {
    const seed = await family();
    await addContact(h.deps, FOUNDER, contact(seed.member.id));

    await expect(
      addContact(h.deps, FOUNDER, withYes(seed.member.id, " anna ")),
    ).rejects.toMatchObject({
      name: "VelaError",
      code: "illegal_state",
      message: expect.stringContaining("record their yes on that contact's row"),
    });
    await addContact(h.deps, FOUNDER, withYes(seed.member.id, "Bob"));
    await expect(
      addContact(h.deps, FOUNDER, {
        ...withYes(seed.member.id, "Bob"),
        yes: { ...withYes(seed.member.id).yes, phone: "+886912000002" },
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "illegal_state" });

    const rows = await h.db
      .select({ name: nearbyContacts.name, phone: nearbyContacts.phone })
      .from(nearbyContacts)
      .orderBy(asc(nearbyContacts.name));
    expect(rows).toEqual([
      { name: "Anna", phone: null },
      { name: "Bob", phone: "+886912000001" },
    ]);
    expect(await logRows()).toHaveLength(2);
  });

  it("refuses a channel Vela does not know, a blank name, and a yes whose number is not one", async () => {
    const seed = await family();
    await expect(
      addContact(h.deps, FOUNDER, { ...contact(seed.member.id), channel: "fax" as never }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      addContact(h.deps, FOUNDER, { ...contact(seed.member.id), name: "  " }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    const yes = withYes(seed.member.id);
    await expect(
      addContact(h.deps, FOUNDER, { ...yes, yes: { ...yes.yes, phone: "12345" } }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(0);
  });
});

describe("removeContact", () => {
  it("deletes the contact, keeps their consent rows forgotten, proves it with a hash of its type and id, and is a no-op again", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: { yes: { phone: "+886912000001" } },
    });
    await h.db.insert(consents).values({
      contactId: contact.id,
      subjectRef: `contact:${contact.id}`,
      kind: "nearby",
      answer: "yes",
      textVersion: "nearby-notice@1",
      lang: "en",
      channel: "phone",
      givenAt: h.clock.now(),
      evidence: { note: "Anna said yes on the phone", recorded_by: "founder" },
    });
    h.clock.advanceMinutes(10);

    await removeContact(h.deps, FOUNDER, contact.id);
    await removeContact(h.deps, FOUNDER, contact.id);

    expect(await h.db.select().from(nearbyContacts)).toHaveLength(0);
    const nearby = await h.db.select().from(consents).where(eq(consents.kind, "nearby"));
    expect(nearby).toHaveLength(1);
    expect(nearby[0]).toMatchObject({
      contactId: null,
      subjectRef: `contact:${contact.id}`,
      answer: "yes",
      subjectDeletedAt: h.clock.now(),
      evidence: { recorded_by: "founder" },
    });
    const proofs = await h.db.select().from(deletions);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      objectType: "nearby_contact",
      objectId: contact.id,
      contentHash: await sha256Hex(`nearby_contact:${contact.id}`),
      reason: "admin remove_contact",
      deletedAt: h.clock.now(),
    });
    expect(proofs[0]?.contentHash).not.toBe(await sha256Hex("+886912000001"));
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "remove_contact",
      familyId: seed.family.id,
      memberId: seed.member.id,
      what: `contact=${contact.id}`,
    });
    expect((await eventRows()).map((event) => event.name)).toEqual(["nearby_contact_removed"]);
  });

  it("refuses a contact that never existed", async () => {
    await family();
    await expect(removeContact(h.deps, FOUNDER, UNKNOWN_ID)).rejects.toMatchObject({
      name: "VelaError",
      code: "not_found",
    });
    await expect(removeContact(h.deps, FOUNDER, "not-a-uuid")).rejects.toMatchObject({
      name: "VelaError",
      code: "invalid_payload",
    });
    expect(await logRows()).toHaveLength(0);
  });
});

describe("createInvite", () => {
  const PROFILE = {
    name: "Grandma",
    address: "Mrs Lin",
    language: "zh-TW" as const,
    country: "TW",
    timeZone: "Asia/Taipei",
    wakeTime: "06:30",
  };

  /** A family whose kept-light member said No: her member row is gone, the organiser remains. */
  async function afterNo(): Promise<SeededFamily> {
    const seed = await family();
    await h.db.delete(consents).where(eq(consents.memberId, seed.member.id));
    await h.db.delete(members).where(eq(members.id, seed.member.id));
    return seed;
  }

  /** A family whose kept-light member was invited and never answered, with a contact near her. */
  async function invitedOnly(): Promise<{ seed: SeededFamily; contactId: string }> {
    const seed = await family();
    await h.db.delete(consents).where(eq(consents.memberId, seed.member.id));
    await h.db
      .update(members)
      .set({ status: "invited", lightOn: false, lightConsentedAt: null, lightConsentText: null })
      .where(eq(members.id, seed.member.id));
    await h.db.insert(invites).values({
      familyId: seed.family.id,
      invitedBy: seed.organiser.id,
      forMemberId: seed.member.id,
      token: "old-token",
      createdAt: h.clock.now(),
      expiresAt: addMinutes(h.clock.now(), 7 * 24 * 60),
    });
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: { yes: { phone: "+886912000001" } },
    });
    return { seed, contactId: contact.id };
  }

  it("creates an invited member with the given profile and an invite, sends the organiser the link, and logs one row with its event", async () => {
    const seed = await afterNo();

    await createInvite(
      h.deps,
      { ...FOUNDER, familyId: seed.family.id },
      {
        invitedBy: seed.organiser.id,
        replacesMemberId: null,
        ...PROFILE,
      },
    );

    const invited = await h.db.select().from(members).where(eq(members.status, "invited"));
    expect(invited).toHaveLength(1);
    expect(invited[0]).toMatchObject({
      familyId: seed.family.id,
      role: "member",
      displayName: "Grandma",
      addressForm: "Mrs Lin",
      language: "zh-TW",
      tz: "Asia/Taipei",
      country: "TW",
      turnsIn: false,
      lightOn: false,
      primarySurface: "telegram",
      wakeTime: "06:30",
      arrivalTime: "07:00",
    });
    const her = invited[0];
    const [invite] = await h.db.select().from(invites);
    expect(invite).toMatchObject({
      familyId: seed.family.id,
      invitedBy: seed.organiser.id,
      forMemberId: her?.id,
      token: "token-1".padEnd(43, "x"),
      expiresAt: addMinutes(h.clock.now(), 7 * 24 * 60),
      acceptedAt: null,
    });
    const rows = await outboundRows();
    expect(
      rows.map((row) => [row.kind, row.memberId, row.conversationId, row.idempotencyKey]),
    ).toEqual([
      [
        "system",
        seed.organiser.id,
        seed.organiserLink.externalId,
        outboundKey("system", {
          conversationId: seed.organiserLink.externalId,
          suffix: `invite:${invite?.id}`,
        }),
      ],
    ]);
    await h.run(handlers());
    expect(
      h.telegram.sentTo(seed.organiserLink.externalId).map((sent) => sent.message.text),
    ).toEqual([
      t("en", "organiser.invite_again", {
        name: "Grandma",
        link: `https://t.me/VelaLightBot?start=${invite?.token}`,
      }),
    ]);
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "create_invite",
      familyId: seed.family.id,
      memberId: her?.id,
      what: `invite=${invite?.id} replaced=0`,
    });
    expect(await eventRows()).toEqual([
      {
        name: "invite_created",
        familyId: seed.family.id,
        memberId: her?.id,
        props: { invite_id: invite?.id, replaced: false },
      },
    ]);
  });

  it("replaces a never-consented invited member: her contacts move to the new member, and she is forgotten and deleted", async () => {
    const { seed, contactId } = await invitedOnly();
    await h.db.insert(consents).values({
      memberId: seed.member.id,
      subjectRef: `member:${seed.member.id}`,
      kind: "privacy_notice",
      answer: "yes",
      textVersion: "privacy-notice.v1",
      lang: "en",
      channel: "paper",
      givenAt: h.clock.now(),
      evidence: { note: "read aloud on the call", recorded_by: "founder" },
    });
    const input = { invitedBy: seed.organiser.id, replacesMemberId: seed.member.id, ...PROFILE };

    await createInvite(h.deps, FOUNDER, input);
    // The browser sends the form again: it names a member who is gone now.
    await expect(createInvite(h.deps, FOUNDER, input)).rejects.toMatchObject({
      name: "VelaError",
      code: "illegal_state",
    });

    expect(await h.db.select().from(members).where(eq(members.id, seed.member.id))).toEqual([]);
    const [her] = await h.db.select().from(members).where(eq(members.status, "invited"));
    const [contact] = await h.db
      .select()
      .from(nearbyContacts)
      .where(eq(nearbyContacts.id, contactId));
    expect(contact).toMatchObject({ memberId: her?.id, phone: "+886912000001" });
    const invitesNow = await h.db.select().from(invites);
    expect(invitesNow.map((invite) => [invite.forMemberId, invite.token === "old-token"])).toEqual([
      [her?.id, false],
    ]);
    const [proof] = await h.db.select().from(consents).where(eq(consents.kind, "privacy_notice"));
    expect(proof).toMatchObject({
      memberId: null,
      subjectRef: `member:${seed.member.id}`,
      subjectDeletedAt: h.clock.now(),
      evidence: { recorded_by: "founder" },
    });
    expect(await logRows()).toHaveLength(1);
    expect((await logRows())[0]?.what).toMatch(/ replaced=1$/);
    expect((await outboundRows()).filter((row) => row.kind === "system")).toHaveLength(1);
  });

  it("refuses a family whose light is on or was consented to, one that asked to be deleted, and a form that names no member when one waits", async () => {
    const lit = await family();
    await expect(
      createInvite(h.deps, FOUNDER, {
        invitedBy: lit.organiser.id,
        replacesMemberId: null,
        ...PROFILE,
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "illegal_state" });

    await h.reset();
    const { seed } = await invitedOnly();
    await expect(
      createInvite(h.deps, FOUNDER, {
        invitedBy: seed.organiser.id,
        replacesMemberId: null,
        ...PROFILE,
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "illegal_state" });

    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    await expect(
      createInvite(h.deps, FOUNDER, {
        invitedBy: seed.organiser.id,
        replacesMemberId: seed.member.id,
        ...PROFILE,
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "illegal_state" });

    expect(await h.db.select().from(members).where(eq(members.status, "invited"))).toHaveLength(1);
    expect(await logRows()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
  });

  it("refuses an organiser who is not one of the family's active organisers, or has no Telegram link, and a profile onboarding would refuse", async () => {
    const seed = await afterNo();
    const sibling = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "3001",
    });
    const base = { replacesMemberId: null, ...PROFILE };

    await expect(
      createInvite(h.deps, FOUNDER, { ...base, invitedBy: sibling.member.id }),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    await h.db.delete(channelLinks).where(eq(channelLinks.memberId, seed.organiser.id));
    await expect(
      createInvite(h.deps, FOUNDER, { ...base, invitedBy: seed.organiser.id }),
    ).rejects.toMatchObject({ name: "VelaError", code: "no_channel_link" });
    for (const bad of [
      { timeZone: "+08:00" },
      { wakeTime: "6:30" },
      { country: "Taiwan" },
      { language: "ja" as never },
      { name: "x".repeat(41) },
      { address: " " },
    ]) {
      await expect(
        createInvite(h.deps, FOUNDER, { ...base, invitedBy: seed.organiser.id, ...bad }),
      ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    }
    expect(await h.db.select().from(members).where(eq(members.status, "invited"))).toEqual([]);
    expect(await logRows()).toHaveLength(0);
  });
});

describe("setAway and endAway", () => {
  it("stores the organiser's away period, logs only its dates, and re-decides her schedule", async () => {
    const seed = await family();

    await setAway(h.deps, FOUNDER, {
      memberId: seed.member.id,
      setBy: seed.organiser.id,
      from: "2026-09-20",
      until: "2026-09-27",
    });

    const periods = await h.db.select().from(awayPeriods);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      memberId: seed.member.id,
      fromDate: "2026-09-20",
      toDate: "2026-09-27",
      source: "organiser",
      setBy: seed.organiser.id,
      endedAt: null,
    });
    const [log] = await logRows();
    expect(log).toMatchObject({
      action: "set_away",
      familyId: seed.family.id,
      memberId: seed.member.id,
      what: "away 2026-09-20..2026-09-27",
    });
    expect(await eventRows()).toEqual([
      {
        name: "away_set",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: {
          source: "organiser",
          from: "2026-09-20",
          until: "2026-09-27",
          set_by: seed.organiser.id,
        },
      },
    ]);
    expect((await memberRow(seed.member.id)).nextWakeAt).toEqual(h.clock.now());
    expect(h.scheduler.history).toEqual([{ memberId: seed.member.id, at: h.clock.now() }]);
  });

  it("stores the same open period once, and refuses a period that ends before it starts, an organiser of another family, or a family member as its source", async () => {
    const seed = await family();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });
    const input = {
      memberId: seed.member.id,
      setBy: seed.organiser.id,
      from: "2026-09-20",
      until: null,
    };

    await setAway(h.deps, FOUNDER, input);
    await setAway(h.deps, FOUNDER, input);

    expect(await h.db.select().from(awayPeriods)).toHaveLength(1);
    expect(await logRows()).toHaveLength(1);
    expect(h.scheduler.history).toHaveLength(1);

    await expect(setAway(h.deps, FOUNDER, { ...input, until: "2026-09-19" })).rejects.toMatchObject(
      { name: "VelaError", code: "invalid_payload" },
    );
    await expect(
      setAway(h.deps, FOUNDER, { ...input, setBy: other.organiser.id }),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    await expect(
      setAway(h.deps, FOUNDER, { ...input, setBy: sam.member.id, from: "2026-10-01" }),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    expect(await h.db.select().from(awayPeriods)).toHaveLength(1);
    expect(await logRows()).toHaveLength(1);
  });

  it("ends the period now, re-decides her schedule, and leaves an ended period as it is", async () => {
    const seed = await family();
    await setAway(h.deps, FOUNDER, {
      memberId: seed.member.id,
      setBy: seed.organiser.id,
      from: "2026-09-20",
      until: null,
    });
    const [period] = await h.db.select().from(awayPeriods);
    h.clock.advanceMinutes(30);
    h.scheduler.clear();

    await endAway(h.deps, FOUNDER, period?.id ?? "");
    await endAway(h.deps, FOUNDER, period?.id ?? "");

    const [ended] = await h.db.select().from(awayPeriods);
    expect(ended?.endedAt).toEqual(h.clock.now());
    const logs = await logRows();
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({
      action: "end_away",
      memberId: seed.member.id,
      what: "away 2026-09-20..open ended",
    });
    expect((await eventRows()).map((event) => event.name)).toEqual(["away_set", "away_ended"]);
    expect(h.scheduler.history).toEqual([{ memberId: seed.member.id, at: h.clock.now() }]);
    await expect(endAway(h.deps, FOUNDER, UNKNOWN_ID)).rejects.toMatchObject({
      name: "VelaError",
      code: "not_found",
    });
  });

  it("does not wake the scheduler of a member who said stop", async () => {
    const seed = await family();
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));

    await setAway(h.deps, FOUNDER, {
      memberId: seed.member.id,
      setBy: seed.organiser.id,
      from: "2026-09-20",
      until: null,
    });

    expect(await h.db.select().from(awayPeriods)).toHaveLength(1);
    expect(h.scheduler.history).toHaveLength(0);
    expect((await memberRow(seed.member.id)).nextWakeAt).toBeNull();
  });
});

describe("markLeft", () => {
  it("takes a family member out of the rotation without touching a scheduler, once", async () => {
    const seed = await family();
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });

    await markLeft(h.deps, FOUNDER, sam.member.id);
    await markLeft(h.deps, FOUNDER, sam.member.id);

    expect(await memberRow(sam.member.id)).toMatchObject({
      status: "left",
      leftAt: h.clock.now(),
      turnsIn: false,
    });
    expect(h.scheduler.history).toHaveLength(0);
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "mark_left",
      familyId: seed.family.id,
      memberId: sam.member.id,
      what: "left",
    });
    expect(await eventRows()).toEqual([
      {
        name: "member_left",
        familyId: seed.family.id,
        memberId: sam.member.id,
        props: { source: "admin", role: "member", kept_light: false },
      },
    ]);
  });

  it("clears the kept-light member's scheduler when she is marked left, and refuses a deceased member", async () => {
    const seed = await family();
    await h.db
      .update(members)
      .set({ nextWakeAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));

    await markLeft(h.deps, FOUNDER, seed.member.id);

    expect(await memberRow(seed.member.id)).toMatchObject({
      status: "left",
      nextWakeAt: null,
      lightOn: true,
    });
    expect(h.scheduler.history).toEqual([{ memberId: seed.member.id, at: null }]);

    await h.db.update(members).set({ status: "deceased" }).where(eq(members.id, seed.member.id));
    await expect(markLeft(h.deps, FOUNDER, seed.member.id)).rejects.toMatchObject({
      name: "VelaError",
      code: "illegal_state",
    });
    expect(await logRows()).toHaveLength(1);
  });

  it("tells the founder when the organiser marked left was the last one who could be told", async () => {
    const seed = await family();
    const anna = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      externalId: "1003",
      role: "organiser",
    });
    const toFounder = async () =>
      (
        await h.db
          .select()
          .from(outbound)
          .where(eq(outbound.conversationId, h.deps.config.adminConversationId ?? ""))
      ).map((row) => (row.payload as { message: { text: string } }).message.text);

    // One of two: Mia can still be told, so nothing is said.
    await markLeft(h.deps, FOUNDER, anna.member.id);
    expect(await toFounder()).toEqual([]);

    // The last one: from now on a quiet morning here reaches nobody.
    await markLeft(h.deps, FOUNDER, seed.organiser.id);
    expect(await toFounder()).toEqual([
      `Mia can no longer be told anything in The Chens, and no other organiser can: nobody will hear if a light there goes quiet. Open: https://vela.test/admin/families/${seed.family.id}`,
    ]);
  });
});

describe("markDeceased", () => {
  it("switches her light off, clears her scheduler once, sends nothing, and writes nothing the second time", async () => {
    const seed = await family();
    await h.db
      .update(members)
      .set({ nextWakeAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));

    await markDeceased(h.deps, FOUNDER, seed.member.id);
    await markDeceased(h.deps, FOUNDER, seed.member.id);
    await h.run(handlers());

    expect(await memberRow(seed.member.id)).toMatchObject({
      lightOn: false,
      status: "deceased",
      nextWakeAt: null,
      lightConsentedAt: seed.member.lightConsentedAt,
    });
    expect(h.scheduler.history).toEqual([{ memberId: seed.member.id, at: null }]);
    expect(await outboundRows()).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      admin: "founder@vela.test",
      action: "mark_deceased",
      familyId: seed.family.id,
      memberId: seed.member.id,
      what: "deceased",
    });
    expect(await eventRows()).toEqual([
      {
        name: "member_marked_deceased",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: {},
      },
    ]);
  });

  it("drops a message already queued for the family and refuses a member who is not kept light", async () => {
    const seed = await family();
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });
    await enqueueOutbound(h.deps, h.db, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: seed.organiserLink.externalId,
        suffix: "x",
      }),
      memberId: seed.organiser.id,
      channel: "telegram",
      conversationId: seed.organiserLink.externalId,
      lang: "en",
      text: "Queued before the news",
    });

    await expect(markDeceased(h.deps, FOUNDER, sam.member.id)).rejects.toMatchObject({
      name: "VelaError",
      code: "illegal_state",
    });
    await markDeceased(h.deps, FOUNDER, seed.member.id);
    await h.run(handlers());

    expect((await outboundRows()).map((row) => row.status)).toEqual(["dropped"]);
    expect(h.telegram.sent).toHaveLength(0);
    expect(await logRows()).toHaveLength(1);
  });
});

describe("deleteFamily", () => {
  it("marks the family, clears her scheduler, logs with no member, and is a no-op again", async () => {
    const seed = await family();
    await h.db
      .update(members)
      .set({ nextWakeAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));

    await deleteFamily(h.deps, { ...FOUNDER, familyId: seed.family.id }, seed.family.id);
    h.clock.advanceMinutes(1);
    await deleteFamily(h.deps, FOUNDER, seed.family.id);

    const [row] = await h.db.select().from(families).where(eq(families.id, seed.family.id));
    expect(row?.deletedAt).toEqual(new Date("2026-09-14T00:00:00Z"));
    expect((await memberRow(seed.member.id)).nextWakeAt).toBeNull();
    expect(h.scheduler.history).toEqual([{ memberId: seed.member.id, at: null }]);
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "delete_family",
      familyId: seed.family.id,
      memberId: null,
      what: "deletion requested",
    });
    expect(await eventRows()).toEqual([
      {
        name: "family_deletion_requested",
        familyId: seed.family.id,
        memberId: null,
        props: { kept_light_members: 1 },
      },
    ]);
  });

  it("refuses a family other than the page's, and an unknown one", async () => {
    const seed = await family();
    await expect(
      deleteFamily(h.deps, { ...FOUNDER, familyId: UNKNOWN_ID }, seed.family.id),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    await expect(deleteFamily(h.deps, FOUNDER, UNKNOWN_ID)).rejects.toMatchObject({
      name: "VelaError",
      code: "not_found",
    });
    const [row] = await h.db.select().from(families).where(eq(families.id, seed.family.id));
    expect(row?.deletedAt).toBeNull();
    expect(await logRows()).toHaveLength(0);
  });
});

describe("form input", () => {
  it("refuses an id that is not a UUID before reading anything, for every id-taking action", async () => {
    const seed = await family();
    await h.db
      .update(members)
      .set({ nextWakeAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    const refused = { name: "VelaError", code: "invalid_payload" };

    await expect(markLeft(h.deps, FOUNDER, "sam")).rejects.toMatchObject(refused);
    await expect(markDeceased(h.deps, FOUNDER, `${seed.member.id}x`)).rejects.toMatchObject(
      refused,
    );
    await expect(deleteFamily(h.deps, FOUNDER, "")).rejects.toMatchObject(refused);
    await expect(endAway(h.deps, FOUNDER, "1")).rejects.toMatchObject(refused);
    await expect(
      recordAdminView(h.deps, FOUNDER, {
        familyIds: ["not-a-uuid"],
        memberId: null,
        what: "/admin",
      }),
    ).rejects.toMatchObject(refused);

    expect(await memberRow(seed.member.id)).toMatchObject({
      status: "active",
      nextWakeAt: h.clock.now(),
    });
    expect(h.scheduler.history).toHaveLength(0);
    expect(await logRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
  });
});

describe("sendWeeklyRead", () => {
  const EDITED = {
    lines: ["She cooked dumplings on Tuesday.", " ", "Her sister visited on Friday."],
    suggestion: "Ask about the dumpling recipe.",
  };

  it("reaches each active organiser once with the counts, the edited lines, and the suggestion", async () => {
    const seed = await family();
    const second = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
      role: "organiser",
    });
    const readId = await seedWeeklyRead(seed);

    expect(await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, ...EDITED })).toBe("sent");
    await h.run(handlers());
    expect(await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, ...EDITED })).toBe(
      "already_sent",
    );
    await h.run(handlers());

    const [read] = await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, readId));
    expect(read).toMatchObject({
      lines: ["Draft line one.", "Draft line two."],
      suggestion: "Draft suggestion.",
      sentLines: ["She cooked dumplings on Tuesday.", "Her sister visited on Friday."],
      sentSuggestion: "Ask about the dumpling recipe.",
      sentAt: h.clock.now(),
    });
    const rows = await outboundRows();
    expect(
      rows.map((row) => [
        row.kind,
        row.memberId,
        row.conversationId,
        row.idempotencyKey,
        row.status,
      ]),
    ).toEqual([
      [
        "weekly_read",
        seed.organiser.id,
        "1001",
        outboundKey("weekly_read", {
          memberId: seed.member.id,
          date: WEEK_END,
          conversationId: "1001",
        }),
        "sent",
      ],
      [
        "weekly_read",
        second.member.id,
        "1002",
        outboundKey("weekly_read", {
          memberId: seed.member.id,
          date: WEEK_END,
          conversationId: "1002",
        }),
        "sent",
      ],
    ]);
    expect(h.telegram.sentTo("1001")).toHaveLength(1);
    expect(h.telegram.sentTo("1002")).toHaveLength(1);
    expect(h.telegram.sentTo("2001")).toHaveLength(0);
    expect(h.telegram.sentTo("1001")[0]?.message.text).toBe(
      [
        "Mom answered 5 of 7 days.",
        "On 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
        "",
        "She cooked dumplings on Tuesday.",
        "Her sister visited on Friday.",
        "",
        "Something to ask next week: Ask about the dumpling recipe.",
      ].join("\n"),
    );
    const logs = await logRows();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "send_weekly_read",
      familyId: seed.family.id,
      memberId: seed.member.id,
      what: `weekly_read=${readId} week=${WEEK_START} organisers=2`,
    });
    expect(logs[0]?.what).not.toContain("dumpling");
    expect(await eventRows()).toEqual([
      {
        name: "weekly_read_sent",
        familyId: seed.family.id,
        memberId: seed.member.id,
        props: {
          weekly_read_id: readId,
          week_start: WEEK_START,
          organisers: 2,
          lines: 2,
          suggestion: true,
        },
      },
    ]);
    expect(h.ai.calls).toHaveLength(0);
  });

  it("stores a removed suggestion as '' and leaves it out of the message", async () => {
    const seed = await family();
    const readId = await seedWeeklyRead(seed);

    await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, lines: [], suggestion: "  " });
    await h.run(handlers());

    const [read] = await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, readId));
    expect(read).toMatchObject({ sentLines: [], sentSuggestion: "", sentAt: h.clock.now() });
    expect(h.telegram.sentTo("1001")[0]?.message.text).toBe(
      "Mom answered 5 of 7 days.\nOn 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
    );
  });

  it("refuses another week's read that would reach the same organisers the same local day, storing nothing", async () => {
    const seed = await family();
    const first = await seedWeeklyRead(seed, { weekStart: "2026-08-31" });
    const second = await seedWeeklyRead(seed, { weekStart: WEEK_START });
    await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: first, ...EDITED });

    expect(await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: second, ...EDITED })).toBe(
      "budget",
    );

    const [read] = await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, second));
    expect(read).toMatchObject({ sentLines: null, sentSuggestion: null, sentAt: null });
    expect(await outboundRows()).toHaveLength(1);
    expect(await logRows()).toHaveLength(1);
    expect((await eventRows()).map((event) => event.name)).toEqual(["weekly_read_sent"]);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("weekly_read_send_refused");
  });

  it("refuses a read no organiser can receive, storing nothing", async () => {
    const seed = await family();
    await h.db.delete(channelLinks).where(eq(channelLinks.memberId, seed.organiser.id));
    const readId = await seedWeeklyRead(seed);

    expect(await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, ...EDITED })).toBe(
      "no_organiser",
    );

    const [read] = await h.db.select().from(weeklyReads).where(eq(weeklyReads.id, readId));
    expect(read?.sentAt).toBeNull();
    expect(await outboundRows()).toHaveLength(0);
    expect(await logRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
  });

  it("translates the sent lines into her language, never the suggestion, and logs the call", async () => {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      language: "en",
      memberLanguage: "zh-TW",
    });
    const readId = await seedWeeklyRead(seed);

    await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, ...EDITED });

    expect(h.ai.calls.map((call) => call.call)).toEqual(["translate"]);
    expect(h.ai.calls[0]?.input).toMatchObject({
      text: "She cooked dumplings on Tuesday.\nHer sister visited on Friday.",
      from: "en",
      to: "zh-TW",
    });
    const rows = await h.db.select().from(translations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      objectType: "weekly_read",
      objectId: readId,
      lang: "zh-TW",
      text: "[zh-TW] She cooked dumplings on Tuesday.\nHer sister visited on Friday.",
    });
    const calls = await h.db.select().from(aiCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      familyId: seed.family.id,
      memberId: seed.member.id,
      call: "translate",
      ok: true,
      inputRef: { weekly_read_id: readId, lang: "zh-TW" },
    });
  });

  // Decision X (2026-09-18): she reads the lines as sent, as after a failed call, and no call is
  // logged or warned about, because none was made.
  it("sends the read and translates nothing for her while AI is off, logging no call", async () => {
    h.deps.ai = createOffAi();
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      language: "en",
      memberLanguage: "zh-TW",
    });
    const readId = await seedWeeklyRead(seed);

    expect(await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, ...EDITED })).toBe("sent");

    expect(await h.db.select().from(translations)).toHaveLength(0);
    expect(await h.db.select().from(aiCalls)).toHaveLength(0);
    expect(h.logger.entries.map((entry) => entry.event)).not.toContain(
      "weekly_read_translation_failed",
    );
  });

  it("stores no translation when the call fails, and calls nothing when the languages match", async () => {
    const failing = await createHarness({
      ai: {
        translate: async () => ({
          ok: false,
          value: { text: "" },
          error: "http_529",
          record: {
            call: "translate",
            promptVersion: "translate.v1",
            model: "fake",
            ok: false,
            tokensIn: 0,
            tokensOut: 0,
            tokensCached: 0,
            latencyMs: 0,
            costUsd: 0,
            error: "http_529",
          },
        }),
      },
    });
    try {
      const seed = await seedFamily(failing.db, {
        now: failing.clock.now(),
        language: "en",
        memberLanguage: "zh-TW",
      });
      const [row] = await failing.db
        .insert(weeklyReads)
        .values({
          familyId: seed.family.id,
          memberId: seed.member.id,
          weekStart: WEEK_START,
          lines: [],
          suggestion: null,
          stats: STATS,
          promptVersion: "weekly_read.v4",
        })
        .returning({ id: weeklyReads.id });

      expect(
        await sendWeeklyRead(failing.deps, FOUNDER, { weeklyReadId: row?.id ?? "", ...EDITED }),
      ).toBe("sent");

      expect(await failing.db.select().from(translations)).toHaveLength(0);
      expect((await failing.db.select().from(aiCalls)).map((call) => call.ok)).toEqual([false]);
      expect(failing.logger.entries.map((entry) => entry.event)).toContain(
        "weekly_read_translation_failed",
      );
    } finally {
      await failing.close();
    }

    const seed = await family();
    const readId = await seedWeeklyRead(seed);
    await sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: readId, ...EDITED });
    expect(h.ai.calls).toHaveLength(0);
    expect(await h.db.select().from(translations)).toHaveLength(0);
  }, 60_000);

  it("refuses five lines, an over-long line, and an unknown read", async () => {
    const seed = await family();
    const readId = await seedWeeklyRead(seed);

    await expect(
      sendWeeklyRead(h.deps, FOUNDER, {
        weeklyReadId: readId,
        lines: ["1", "2", "3", "4", "5"],
        suggestion: "",
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      sendWeeklyRead(h.deps, FOUNDER, {
        weeklyReadId: readId,
        lines: ["x".repeat(301)],
        suggestion: "",
      }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      sendWeeklyRead(h.deps, FOUNDER, { weeklyReadId: UNKNOWN_ID, ...EDITED }),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
    expect(await outboundRows()).toHaveLength(0);
    expect(await logRows()).toHaveLength(0);
  });
});

describe("the admin pages", () => {
  async function seedAnswer(
    seed: SeededFamily,
    exchangeId: string,
    options: { summary: string; flag?: boolean; understood?: boolean; attempts?: number },
  ): Promise<string> {
    const [row] = await h.db
      .insert(answers)
      .values({
        exchangeId,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        payload: { text: "the words she wrote" },
        summary: options.summary,
        flag: options.flag ?? false,
        flagReason: options.flag === true ? "health" : null,
        understoodAt: options.understood === false ? null : h.clock.now(),
        processingAttempts: options.attempts ?? 1,
        receivedAt: h.clock.now(),
      })
      .returning({ id: answers.id });
    return row?.id ?? "";
  }

  it("lists every family's states and counts on the overview, logging one view per family, with no words", async () => {
    const seed = await family();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "answered",
      deliveredAt: h.clock.now(),
      answeredAt: h.clock.now(),
    });
    await seedAnswer(seed, exchange.id, { summary: "She is well.", flag: true });
    await h.db.insert(aiCalls).values([
      {
        familyId: seed.family.id,
        call: "understand",
        promptVersion: "understand.v4",
        model: "fake",
        inputRef: {},
        ok: true,
        at: h.clock.now(),
      },
      {
        familyId: seed.family.id,
        call: "flag",
        promptVersion: "flag.v2",
        model: "fake",
        inputRef: {},
        ok: false,
        at: h.clock.now(),
      },
    ]);

    const rows = await loadAdminOverview(h.deps, FOUNDER);

    expect(rows.map((row) => row.family.id)).toEqual([seed.family.id, other.family.id]);
    expect(rows[0]).toMatchObject({
      family: { name: "The Chens", language: "en", region: "apac", deletedAt: null },
      keptLight: { id: seed.member.id, status: "active", lightOn: true, localToday: TODAY },
      today: { id: exchange.id, state: "answered", scheduledFor: TODAY },
      quiet: null,
      ai: { calls: 2, failures: 1 },
    });
    expect(rows[0]?.answers).toEqual([
      expect.objectContaining({ kind: "text", flag: true, processingAttempts: 1 }),
    ]);
    expect(rows[1]).toMatchObject({ today: null, answers: [], ai: { calls: 0, failures: 0 } });
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain("She is well");
    expect(serialised).not.toContain("the words she wrote");
    expect(serialised).not.toContain("What are you cooking");
    expect((await logRows()).map((log) => [log.familyId, log.action, log.what])).toEqual([
      [seed.family.id, "view", "/admin"],
      [other.family.id, "view", "/admin"],
    ]);
  });

  it("shows the member the invite was for, as invited, while nobody in the family has consented", async () => {
    const seed = await family();
    await h.db
      .update(members)
      .set({ status: "invited", lightOn: false, lightConsentedAt: null, lightStartsOn: null })
      .where(eq(members.id, seed.member.id));
    await h.db.insert(invites).values({
      familyId: seed.family.id,
      invitedBy: seed.organiser.id,
      forMemberId: seed.member.id,
      token: "token-1",
      expiresAt: new Date("2026-09-21T00:00:00Z"),
      createdAt: h.clock.now(),
    });

    const rows = await loadAdminOverview(h.deps, FOUNDER);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      keptLight: { id: seed.member.id, status: "invited", lightOn: false, lightStartsOn: null },
      today: null,
      answers: [],
    });
    expect((await logRows()).map((log) => log.action)).toEqual(["view"]);
  });

  it("shows one family with its flagged and unread answers and the read's count lines, logging the page path", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: null,
    });
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const flagged = await seedAnswer(seed, exchange.id, {
      summary: "Mentioned chest pain.",
      flag: true,
    });
    const unread = await seedAnswer(seed, exchange.id, {
      summary: "",
      understood: false,
      attempts: 3,
    });
    const retrying = await seedAnswer(seed, exchange.id, {
      summary: "",
      understood: false,
      attempts: 1,
    });
    const readId = await seedWeeklyRead(seed);
    await setAway(h.deps, FOUNDER, {
      memberId: seed.member.id,
      setBy: seed.organiser.id,
      from: "2026-09-20",
      until: null,
    });

    const page = await loadFamilyPage(h.deps, FOUNDER, seed.family.id);

    expect(page?.family.id).toBe(seed.family.id);
    expect(page?.members.map((row) => [row.member.id, row.link?.externalId])).toEqual([
      [seed.organiser.id, "1001"],
      [seed.member.id, "2001"],
    ]);
    expect(page?.consents.map((consent) => consent.kind)).toEqual(["light"]);
    expect(page?.nearbyContacts.map((row) => row.id)).toEqual([contact.id]);
    expect(page?.awayPeriods).toHaveLength(1);
    expect(page?.answers.map((answer) => answer.id).sort()).toEqual(
      [flagged, unread, retrying].sort(),
    );
    expect(page?.answers[0]).not.toHaveProperty("payload");
    expect(page?.flagged.map((answer) => answer.id)).toEqual([flagged]);
    expect(page?.notUnderstood.map((answer) => answer.id)).toEqual([unread]);
    expect(page?.weeklyReads).toEqual([
      expect.objectContaining({
        weekEnd: WEEK_END,
        countLines:
          "Mom answered 5 of 7 days.\nOn 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
      }),
    ]);
    expect(page?.weeklyReads[0]?.read.id).toBe(readId);
    const logs = await logRows();
    expect(logs.map((log) => [log.familyId, log.action, log.what])).toEqual([
      [seed.family.id, "set_away", "away 2026-09-20..open"],
      [seed.family.id, "view", familyPagePath(seed.family.id)],
    ]);
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "away_set",
      "admin_page_opened",
    ]);
  });

  it("shows nothing and logs nothing for a family that does not exist", async () => {
    await family();
    expect(await loadFamilyPage(h.deps, FOUNDER, UNKNOWN_ID)).toBeNull();
    expect(await logRows()).toHaveLength(0);
  });
});

describe("loadFailedOutbound", () => {
  let sequence = 0;

  async function seedSend(
    memberId: string,
    options: {
      kind: OutboundKind;
      status: OutboundStatus;
      minutesAgo: number;
      attempts?: number;
      error?: string | null;
    },
  ): Promise<string> {
    sequence += 1;
    const [row] = await h.db
      .insert(outbound)
      .values({
        memberId,
        kind: options.kind,
        channel: "telegram",
        conversationId: "2001",
        localDay: TODAY,
        idempotencyKey: `test:${sequence}`,
        payload: { message: { lang: "en", text: "What are you cooking today, Mrs Chen?" } },
        status: options.status,
        attempts: options.attempts ?? 1,
        error: options.error ?? null,
        queuedAt: addMinutes(h.clock.now(), -options.minutesAgo),
      })
      .returning({ id: outbound.id });
    if (row === undefined) {
      throw new Error("outbound row not inserted");
    }
    return row.id;
  }

  it("lists failed and dropped sends across families, newest first, with a code and no words", async () => {
    const chens = await family();
    const lins = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const failed = await seedSend(chens.member.id, {
      kind: "arrival",
      status: "failed",
      minutesAgo: 30,
      attempts: 4,
      error: "not_found: Bad Request: chat not found",
    });
    const dropped = await seedSend(lins.organiser.id, {
      kind: "quiet_notice",
      status: "dropped",
      minutesAgo: 10,
      attempts: 0,
      error: "family_ended",
    });
    const uncoded = await seedSend(chens.organiser.id, {
      kind: "system",
      status: "failed",
      minutesAgo: 20,
      error: "the platform said Mrs Chen blocked the bot",
    });
    await seedSend(chens.member.id, { kind: "repeat", status: "sent", minutesAgo: 5 });
    await seedSend(chens.organiser.id, {
      kind: "turn_prompt",
      status: "queued",
      minutesAgo: 1,
      error: "unavailable: Too Many Requests: retry after 30",
    });

    const rows = await loadFailedOutbound(h.deps, FOUNDER);

    expect(rows).toEqual([
      {
        id: dropped,
        family: { id: lins.family.id, name: "The Lins" },
        memberId: lins.organiser.id,
        kind: "quiet_notice",
        status: "dropped",
        attempts: 0,
        errorCode: "family_ended",
        queuedAt: addMinutes(h.clock.now(), -10),
      },
      {
        id: uncoded,
        family: { id: chens.family.id, name: "The Chens" },
        memberId: chens.organiser.id,
        kind: "system",
        status: "failed",
        attempts: 1,
        errorCode: "unknown",
        queuedAt: addMinutes(h.clock.now(), -20),
      },
      {
        id: failed,
        family: { id: chens.family.id, name: "The Chens" },
        memberId: chens.member.id,
        kind: "arrival",
        status: "failed",
        attempts: 4,
        errorCode: "not_found",
        queuedAt: addMinutes(h.clock.now(), -30),
      },
    ]);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain("What are you cooking");
    expect(serialised).not.toContain("Mrs Chen");
    expect(serialised).not.toContain("chat not found");
  });

  it("logs one view per family whose sends it lists, and nothing when none failed", async () => {
    const chens = await family();
    const lins = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    await seedSend(chens.member.id, { kind: "repeat", status: "sent", minutesAgo: 5 });

    expect(await loadFailedOutbound(h.deps, FOUNDER)).toEqual([]);
    expect(await logRows()).toHaveLength(0);
    await expect(loadFailedOutbound(h.deps, { admin: "" })).rejects.toThrow(VelaError);

    await seedSend(chens.member.id, { kind: "arrival", status: "failed", minutesAgo: 3 });
    await seedSend(chens.organiser.id, { kind: "system", status: "dropped", minutesAgo: 2 });
    await seedSend(lins.member.id, { kind: "arrival", status: "failed", minutesAgo: 1 });

    await loadFailedOutbound(h.deps, FOUNDER);

    // One row per family, in the order the list first shows it, however many of its sends it lists.
    expect(
      (await logRows()).map((row) => [row.admin, row.familyId, row.memberId, row.action, row.what]),
    ).toEqual([
      ["founder@vela.test", lins.family.id, null, "view", "/admin#failed-outbound"],
      ["founder@vela.test", chens.family.id, null, "view", "/admin#failed-outbound"],
    ]);
    expect((await eventRows()).map((event) => [event.name, event.familyId, event.props])).toEqual([
      ["admin_page_opened", lins.family.id, { what: "/admin#failed-outbound" }],
      ["admin_page_opened", chens.family.id, { what: "/admin#failed-outbound" }],
    ]);
  });

  it("lists the 20 most recent by default, as many as asked, and refuses a limit out of bounds", async () => {
    const seed = await family();
    const ids: string[] = [];
    for (let minutesAgo = 0; minutesAgo < 22; minutesAgo += 1) {
      ids.push(await seedSend(seed.member.id, { kind: "system", status: "failed", minutesAgo }));
    }

    const byDefault = await loadFailedOutbound(h.deps, FOUNDER);
    expect(byDefault.map((row) => row.id)).toEqual(ids.slice(0, 20));

    const three = await loadFailedOutbound(h.deps, FOUNDER, { limit: 3 });
    expect(three.map((row) => row.id)).toEqual(ids.slice(0, 3));

    await expect(loadFailedOutbound(h.deps, FOUNDER, { limit: 0 })).rejects.toThrow(VelaError);
    await expect(loadFailedOutbound(h.deps, FOUNDER, { limit: 2.5 })).rejects.toThrow(VelaError);
    expect(await logRows()).toHaveLength(2);
  });
});
