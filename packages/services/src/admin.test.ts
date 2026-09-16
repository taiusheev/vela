import type { LocalDate, OutboundKind, OutboundStatus } from "@vela/contracts";
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
  const answer = (contactId: string, answer: "yes" | "no") => ({
    contactId,
    answer,
    at: h.clock.now(),
    textVersion: "nearby-notice@1",
    lang: "en" as const,
    channel: "phone",
    evidence: { call: "organiser reported the answer" },
  });

  it("lists the contact on a yes, with a nearby consent, and changes nothing on the same yes again", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      phone: "+886912000001",
      answer: null,
    });
    expect(await consentedNearbyContacts(h.db, seed.member.id)).toHaveLength(0);

    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes"));
    h.clock.advanceMinutes(5);
    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes"));

    const listed = await consentedNearbyContacts(h.db, seed.member.id);
    expect(listed.map((row) => [row.id, row.consentedAt, row.declinedAt])).toEqual([
      [contact.id, new Date("2026-09-14T00:00:00Z"), null],
    ]);
    const nearby = await h.db.select().from(consents).where(eq(consents.kind, "nearby"));
    expect(nearby).toHaveLength(1);
    expect(nearby[0]).toMatchObject({
      contactId: contact.id,
      memberId: null,
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

  it("unlists the contact on a no, withdraws their nearby consents, and changes nothing on a second no", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      phone: "+886912000001",
      answer: null,
    });
    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes"));
    h.clock.advanceMinutes(60);

    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "no"));
    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "no"));

    expect(await consentedNearbyContacts(h.db, seed.member.id)).toHaveLength(0);
    const [row] = await h.db.select().from(nearbyContacts).where(eq(nearbyContacts.id, contact.id));
    expect(row?.declinedAt).toEqual(h.clock.now());
    const nearby = await h.db.select().from(consents).where(eq(consents.kind, "nearby"));
    expect(nearby.map((consent) => consent.withdrawnAt)).toEqual([h.clock.now()]);
    expect((await logRows()).map((log) => log.what)).toEqual([
      `nearby yes contact=${contact.id}`,
      `nearby no contact=${contact.id}`,
    ]);
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "consent_given",
      "consent_declined",
    ]);
  });

  it("lists a contact again on a yes after a no, and refuses an unknown contact", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      phone: "+886912000001",
      answer: "no",
    });

    await recordContactConsent(h.deps, FOUNDER, answer(contact.id, "yes"));

    expect((await consentedNearbyContacts(h.db, seed.member.id)).map((row) => row.id)).toEqual([
      contact.id,
    ]);
    await expect(
      recordContactConsent(h.deps, FOUNDER, answer(UNKNOWN_ID, "yes")),
    ).rejects.toMatchObject({
      name: "VelaError",
      code: "not_found",
    });
    for (const log of await logRows()) {
      expect(log.what).not.toContain("Anna");
      expect(log.what).not.toContain("+886");
    }
  });
});

describe("addContact", () => {
  const contact = (memberId: string, phone = "+886912000001") => ({
    memberId,
    name: "Anna",
    phone,
    relation: "",
    channel: "line" as const,
  });

  it("stores the contact unconsented, so a quiet notice does not list them yet, and logs no name or number", async () => {
    const seed = await family();

    await addContact(h.deps, FOUNDER, contact(seed.member.id));

    const rows = await h.db.select().from(nearbyContacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      familyId: seed.family.id,
      memberId: seed.member.id,
      name: "Anna",
      phone: "+886912000001",
      relation: null,
      channel: "line",
      consentedAt: null,
      declinedAt: null,
    });
    expect(await consentedNearbyContacts(h.db, seed.member.id)).toHaveLength(0);
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
        props: { contact_id: rows[0]?.id, by: "founder" },
      },
    ]);
  });

  it("adds nobody for the same number again, and refuses a third contact", async () => {
    const seed = await family();
    await addContact(h.deps, FOUNDER, contact(seed.member.id));
    await addContact(h.deps, FOUNDER, contact(seed.member.id));
    await addContact(h.deps, FOUNDER, contact(seed.member.id, "+886912000002"));

    expect(await h.db.select().from(nearbyContacts)).toHaveLength(2);
    expect(await logRows()).toHaveLength(2);

    await expect(
      addContact(h.deps, FOUNDER, contact(seed.member.id, "+886912000003")),
    ).rejects.toMatchObject({ name: "VelaError", code: "illegal_state" });
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(2);
  });

  it("refuses a channel Vela does not know and a blank name", async () => {
    const seed = await family();
    await expect(
      addContact(h.deps, FOUNDER, { ...contact(seed.member.id), channel: "fax" as never }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    await expect(
      addContact(h.deps, FOUNDER, { ...contact(seed.member.id), name: "  " }),
    ).rejects.toMatchObject({ name: "VelaError", code: "invalid_payload" });
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(0);
  });
});

describe("removeContact", () => {
  it("deletes the contact with their consents, proves it without the number, and is a no-op again", async () => {
    const seed = await family();
    const contact = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      phone: "+886912000001",
      answer: "yes",
    });
    await h.db.insert(consents).values({
      contactId: contact.id,
      kind: "nearby",
      textVersion: "nearby-notice@1",
      lang: "en",
      channel: "phone",
      givenAt: h.clock.now(),
    });

    await removeContact(h.deps, FOUNDER, contact.id);
    await removeContact(h.deps, FOUNDER, contact.id);

    expect(await h.db.select().from(nearbyContacts)).toHaveLength(0);
    expect(await h.db.select().from(consents).where(eq(consents.kind, "nearby"))).toHaveLength(0);
    const proofs = await h.db.select().from(deletions);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      objectType: "nearby_contact",
      objectId: contact.id,
      reason: "admin remove_contact",
      deletedAt: h.clock.now(),
    });
    expect(proofs[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
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
        promptVersion: "understand.v3",
        model: "fake",
        inputRef: {},
        ok: true,
        at: h.clock.now(),
      },
      {
        familyId: seed.family.id,
        call: "flag",
        promptVersion: "flag.v1",
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
      phone: "+886912000001",
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
