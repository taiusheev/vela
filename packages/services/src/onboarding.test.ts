import type { InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { decodeButton, encodeButton } from "@vela/core";
import {
  channelLinks,
  events,
  families,
  invites,
  members,
  nearbyContacts,
  onboardingSessions,
  outbound,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleOnboarding, regionForCountry } from "./onboarding.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

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

/** A Telegram user nobody has linked yet. */
const USER = "3001";

let sequence = 0;

function event(extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] }): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: USER, displayName: "Mia", languageCode: "en" },
    conversation: { externalId: USER, kind: "private" },
    messageId: String(sequence),
    ...extra,
  };
}

const start = (): InboundEvent => event({ kind: "start" });
const text = (body: string): InboundEvent => event({ kind: "text", text: body });
const tap = (step: string, value: string): InboundEvent =>
  event({
    kind: "button",
    buttonData: encodeButton({ type: "onboarding", step, value }),
    callbackId: `cb${sequence + 1}`,
  });

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

function lastPrompt() {
  const sent = h.telegram.sentTo(USER);
  return sent[sent.length - 1]?.message;
}

function lastButtons(): [unknown, string][] {
  return (lastPrompt()?.buttons?.flat() ?? []).map((button) => [
    decodeButton(button.id),
    button.label,
  ]);
}

async function session() {
  const [row] = await h.db.select().from(onboardingSessions);
  return row;
}

async function eventNames(): Promise<string[]> {
  const rows = await h.db.select({ name: events.name }).from(events).orderBy(asc(events.id));
  return rows.map((row) => row.name);
}

/** From /start through the wake time for Taiwan, leaving the session at the nearby step. */
async function reachNearby(): Promise<void> {
  await handleOnboarding(h.deps, start());
  await handleOnboarding(h.deps, text("Mom"));
  await handleOnboarding(h.deps, text("Mrs Chen"));
  await handleOnboarding(h.deps, tap("language", "zh-TW"));
  await handleOnboarding(h.deps, tap("country", "TW"));
  await handleOnboarding(h.deps, tap("wake", "07:30"));
}

describe("regionForCountry", () => {
  it("prefers the country's region when the environment has it, else apac", () => {
    expect(regionForCountry(["apac"], "TW")).toBe("apac");
    expect(regionForCountry(["apac"], "US")).toBe("apac");
    expect(regionForCountry(["apac"], "DE")).toBe("apac");
    expect(regionForCountry(["apac", "us", "eu"], "US")).toBe("us");
    expect(regionForCountry(["apac", "us", "eu"], "CA")).toBe("us");
    expect(regionForCountry(["apac", "us", "eu"], "GB")).toBe("eu");
    expect(regionForCountry(["apac", "us", "eu"], "ZZ")).toBe("apac");
  });
});

describe("handleOnboarding: starting", () => {
  it("welcomes on /start, asks for the name, and opens a session that lasts a day", async () => {
    const handled = await handleOnboarding(h.deps, start());

    expect(handled).toBe(true);
    expect(lastPrompt()?.text).toBe(
      `${t("en", "onboarding.welcome")}\n\n${t("en", "onboarding.ask_name")}`,
    );
    const row = await session();
    expect(row).toMatchObject({ conversationId: USER, externalUserId: USER, step: "name" });
    expect(row?.expiresAt).toEqual(new Date(h.clock.now().getTime() + 24 * 60 * 60_000));
  });

  it("speaks the organiser's language from Telegram's language code", async () => {
    await handleOnboarding(
      h.deps,
      event({ kind: "start", sender: { externalUserId: USER, languageCode: "zh-TW" } }),
    );

    expect(lastPrompt()?.text).toBe(
      `${t("zh-TW", "onboarding.welcome")}\n\n${t("zh-TW", "onboarding.ask_name")}`,
    );
    expect(lastPrompt()?.lang).toBe("zh-TW");
  });

  it("sends one welcome when the same /start is delivered twice", async () => {
    const first = start();

    await handleOnboarding(h.deps, first);
    await handleOnboarding(h.deps, first);

    expect(h.telegram.sentTo(USER)).toHaveLength(1);
    expect((await session())?.step).toBe("name");
  });

  it("starts over on a fresh /start in the middle of a session", async () => {
    await handleOnboarding(h.deps, start());
    await handleOnboarding(h.deps, text("Mom"));
    expect((await session())?.step).toBe("address");

    await handleOnboarding(h.deps, start());

    expect((await session())?.step).toBe("name");
    expect(lastPrompt()?.text).toContain(t("en", "onboarding.welcome"));
  });

  it("belongs to nobody without a session: a text or a group message is not onboarding", async () => {
    expect(await handleOnboarding(h.deps, text("hello"))).toBe(false);
    expect(
      await handleOnboarding(
        h.deps,
        event({ kind: "start", conversation: { externalId: "-100500", kind: "group" } }),
      ),
    ).toBe(false);
    expect(h.telegram.sent).toHaveLength(0);
    expect(await session()).toBeUndefined();
  });

  it("forgets a session after 24 hours, so a late answer is no longer onboarding", async () => {
    await handleOnboarding(h.deps, start());
    h.clock.advanceMinutes(24 * 60 + 1);

    const handled = await handleOnboarding(h.deps, text("Mom"));

    expect(handled).toBe(false);
    expect(await session()).toBeUndefined();
    expect(h.telegram.sentTo(USER)).toHaveLength(1);
  });
});

describe("handleOnboarding: validation", () => {
  it("repeats the name prompt on an empty, over-long, tapped, or spoken answer", async () => {
    await handleOnboarding(h.deps, start());

    await handleOnboarding(h.deps, text("   "));
    await handleOnboarding(h.deps, text("M".repeat(41)));
    await handleOnboarding(h.deps, tap("language", "en"));
    await handleOnboarding(h.deps, event({ kind: "voice" }));

    const prompts = h.telegram.sentTo(USER).map((entry) => entry.message.text);
    expect(prompts.slice(1)).toEqual(Array(4).fill(t("en", "onboarding.ask_name")));
    expect((await session())?.step).toBe("name");
  });

  it("takes the language and the country from buttons only, and closes them with the choice", async () => {
    await handleOnboarding(h.deps, start());
    await handleOnboarding(h.deps, text("Mom"));
    await handleOnboarding(h.deps, text("Mrs Chen"));
    expect(lastButtons()).toEqual([
      [{ type: "onboarding", step: "language", value: "en" }, "English"],
      [{ type: "onboarding", step: "language", value: "zh-TW" }, "繁體中文"],
    ]);

    await handleOnboarding(h.deps, text("English"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_language"));
    expect((await session())?.step).toBe("language");

    const chosen = tap("language", "zh-TW");
    await handleOnboarding(h.deps, chosen);
    expect(h.telegram.closed).toEqual([
      { conversationId: USER, messageId: chosen.messageId, replacementText: "繁體中文" },
    ]);
    expect(h.telegram.acknowledged).toHaveLength(1);
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_country"));
    expect(lastButtons().map(([, label]) => label)).toEqual([
      "Taiwan",
      "United States",
      "United Kingdom",
      "Canada",
      "Australia",
      "Singapore",
      "Japan",
      "Germany",
      "India",
      "Other",
    ]);
    expect(lastPrompt()?.buttons?.map((row) => row.length)).toEqual([4, 4, 2]);

    await handleOnboarding(h.deps, tap("language", "en"));
    expect((await session())?.step).toBe("country");
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_country"));
  });

  it("offers the zones of the United States, Canada, and Australia as buttons", async () => {
    await handleOnboarding(h.deps, start());
    await handleOnboarding(h.deps, text("Dad"));
    await handleOnboarding(h.deps, text("Dad"));
    await handleOnboarding(h.deps, tap("language", "en"));

    await handleOnboarding(h.deps, tap("country", "US"));

    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_zone"));
    expect(lastButtons()).toEqual([
      [{ type: "onboarding", step: "zone", value: "America/New_York" }, "Eastern"],
      [{ type: "onboarding", step: "zone", value: "America/Chicago" }, "Central"],
      [{ type: "onboarding", step: "zone", value: "America/Denver" }, "Mountain"],
      [{ type: "onboarding", step: "zone", value: "America/Los_Angeles" }, "Pacific"],
      [{ type: "onboarding", step: "zone", value: "America/Anchorage" }, "Alaska"],
      [{ type: "onboarding", step: "zone", value: "Pacific/Honolulu" }, "Hawaii"],
    ]);

    await handleOnboarding(h.deps, tap("zone", "Europe/Paris"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.invalid_zone"));
    await handleOnboarding(h.deps, tap("zone", "America/Los_Angeles"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_wake"));
    expect((await session())?.data).toMatchObject({
      country: "US",
      timeZone: "America/Los_Angeles",
    });
  });

  it("takes a typed IANA zone for Other and refuses a fixed offset", async () => {
    await handleOnboarding(h.deps, start());
    await handleOnboarding(h.deps, text("Mom"));
    await handleOnboarding(h.deps, text("Mom"));
    await handleOnboarding(h.deps, tap("language", "en"));
    await handleOnboarding(h.deps, tap("country", "ZZ"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_zone_other"));
    expect(lastPrompt()?.buttons).toBeUndefined();

    await handleOnboarding(h.deps, text("+08:00"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.invalid_zone"));
    await handleOnboarding(h.deps, text("Etc/GMT-8"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.invalid_zone"));
    await handleOnboarding(h.deps, text("Asia/Seoul"));

    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_wake"));
    expect(lastButtons().map(([, label]) => label)).toEqual([
      "06:00",
      "06:30",
      "07:00",
      "07:30",
      "08:00",
      "08:30",
      "09:00",
    ]);
    expect((await session())?.data).toMatchObject({ country: "ZZ", timeZone: "Asia/Seoul" });
  });

  it("takes a typed wake time, refuses a malformed one, and sets the arrival 30 minutes later", async () => {
    await handleOnboarding(h.deps, start());
    await handleOnboarding(h.deps, text("Mom"));
    await handleOnboarding(h.deps, text("Mom"));
    await handleOnboarding(h.deps, tap("language", "en"));
    await handleOnboarding(h.deps, tap("country", "SG"));

    await handleOnboarding(h.deps, text("25:99"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.invalid_time"));
    await handleOnboarding(h.deps, text("7:15"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_nearby"));
    await handleOnboarding(h.deps, tap("nearby", "skip"));

    const [her] = await h.db.select().from(members).where(eq(members.role, "member"));
    expect(her).toMatchObject({
      wakeTime: "07:15",
      arrivalTime: "07:45",
      tz: "Asia/Singapore",
      country: "SG",
    });
    expect(await session()).toBeUndefined();
  });

  it("repeats the nearby prompt for a contact without a number", async () => {
    await reachNearby();

    await handleOnboarding(h.deps, text("Anna"));

    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_nearby"));
    expect((await session())?.step).toBe("nearby");
    expect((await session())?.data).toMatchObject({ nearby: [] });
  });
});

describe("handleOnboarding: completion", () => {
  it("creates the family, both members, the contacts, and the invite in one go, then sends the link", async () => {
    await reachNearby();
    await handleOnboarding(h.deps, text("Anna +886 912 000 001"));
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.ask_nearby"));
    expect(await session()).toBeDefined();

    await handleOnboarding(h.deps, text("Bob, +886912000002"));

    const [family] = await h.db.select().from(families);
    expect(family).toMatchObject({
      name: "Mia",
      region: "apac",
      country: "TW",
      language: "en",
      createdAt: h.clock.now(),
    });
    const rows = await h.db.select().from(members).orderBy(asc(members.createdAt), asc(members.id));
    const organiser = rows.find((row) => row.role === "organiser");
    const her = rows.find((row) => row.role === "member");
    expect(organiser).toMatchObject({
      familyId: family?.id,
      billing: true,
      displayName: "Mia",
      language: "en",
      tz: "Asia/Taipei",
      country: "TW",
      status: "active",
      primarySurface: "telegram",
    });
    expect(her).toMatchObject({
      familyId: family?.id,
      role: "member",
      displayName: "Mom",
      addressForm: "Mrs Chen",
      language: "zh-TW",
      tz: "Asia/Taipei",
      country: "TW",
      status: "invited",
      turnsIn: false,
      primarySurface: "telegram",
      lightOn: false,
      lightConsentedAt: null,
      lightStartsOn: null,
      wakeTime: "07:30",
      arrivalTime: "08:00",
    });
    const links = await h.db.select().from(channelLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      memberId: organiser?.id,
      channel: "telegram",
      externalId: USER,
      displayName: "Mia",
    });
    const contacts = await h.db
      .select()
      .from(nearbyContacts)
      .orderBy(asc(nearbyContacts.createdAt), asc(nearbyContacts.id));
    expect(contacts.map((contact) => [contact.name, contact.phone])).toEqual([
      ["Anna", "+886912000001"],
      ["Bob", "+886912000002"],
    ]);
    for (const contact of contacts) {
      expect(contact).toMatchObject({
        familyId: family?.id,
        memberId: her?.id,
        consentedAt: null,
        declinedAt: null,
      });
    }
    const [invite] = await h.db.select().from(invites);
    expect(invite).toMatchObject({
      familyId: family?.id,
      invitedBy: organiser?.id,
      forMemberId: her?.id,
      channel: "link",
      acceptedAt: null,
      expiresAt: new Date(h.clock.now().getTime() + 7 * 24 * 60 * 60_000),
    });
    expect(invite?.token.startsWith("token-1")).toBe(true);
    expect(await session()).toBeUndefined();

    const [done] = await h.db.select().from(outbound);
    expect(done).toMatchObject({
      kind: "onboarding",
      memberId: organiser?.id,
      conversationId: USER,
    });
    await h.run(handlers());
    const link = `https://t.me/VelaLightBot?start=${invite?.token ?? ""}`;
    expect(lastPrompt()?.text).toBe(t("en", "onboarding.done", { name: "Mom", link }));
    expect(await eventNames()).toEqual(["family_created"]);
    const [created] = await h.db.select().from(events);
    expect(created?.props).toEqual({
      country: "TW",
      region: "apac",
      language: "zh-TW",
      nearby_contacts: 2,
    });
  });

  it("stores no contact on Skip, and one contact then Skip stores one", async () => {
    await reachNearby();
    const skip = tap("nearby", "skip");
    await handleOnboarding(h.deps, skip);
    expect(await h.db.select().from(nearbyContacts)).toHaveLength(0);
    expect(await h.db.select().from(families)).toHaveLength(1);
    expect(h.telegram.closed.at(-1)).toEqual({
      conversationId: USER,
      messageId: skip.messageId,
      replacementText: "Skip",
    });

    await h.reset();
    await reachNearby();
    await handleOnboarding(h.deps, text("Anna +886 912 000 001"));
    await handleOnboarding(h.deps, text("skip"));

    expect(await h.db.select().from(nearbyContacts)).toHaveLength(1);
    expect(await h.db.select().from(families)).toHaveLength(1);
  });

  it("puts a family whose preferred region is not configured in apac", async () => {
    await handleOnboarding(h.deps, start());
    await handleOnboarding(h.deps, text("Dad"));
    await handleOnboarding(h.deps, text("Dad"));
    await handleOnboarding(h.deps, tap("language", "en"));
    await handleOnboarding(h.deps, tap("country", "US"));
    await handleOnboarding(h.deps, tap("zone", "America/Chicago"));
    await handleOnboarding(h.deps, tap("wake", "06:00"));
    await handleOnboarding(h.deps, tap("nearby", "skip"));

    const [family] = await h.db.select().from(families);
    expect(family).toMatchObject({ region: "apac", country: "US" });
    const [her] = await h.db.select().from(members).where(eq(members.role, "member"));
    expect(her).toMatchObject({ tz: "America/Chicago", arrivalTime: "06:30" });
  });

  it("changes nothing when a step's update is delivered twice", async () => {
    await handleOnboarding(h.deps, start());
    const name = text("Mom");

    await handleOnboarding(h.deps, name);
    await handleOnboarding(h.deps, name);

    expect(h.telegram.sentTo(USER)).toHaveLength(2);
    expect((await session())?.step).toBe("address");
  });
});

describe("handleOnboarding: people who are already linked", () => {
  it("refuses an organiser's /start with consent.already_linked through the gateway", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const organiserStart = event({
      kind: "start",
      sender: { externalUserId: seed.organiserLink.externalId },
      conversation: { externalId: seed.organiserLink.externalId, kind: "private" },
    });

    expect(await handleOnboarding(h.deps, organiserStart)).toBe(true);

    const rows = await h.db.select().from(outbound);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "system", memberId: seed.organiser.id });
    await h.run(handlers());
    expect(h.telegram.sentTo(seed.organiserLink.externalId)[0]?.message.text).toBe(
      t("en", "consent.already_linked"),
    );
    expect(await session()).toBeUndefined();
  });

  it("ignores the kept-light member's /start and leaves a linked person's text to the router", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const her = event({
      kind: "start",
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    });
    const organiserText = event({
      kind: "text",
      text: "hello",
      sender: { externalUserId: seed.organiserLink.externalId },
      conversation: { externalId: seed.organiserLink.externalId, kind: "private" },
    });

    expect(await handleOnboarding(h.deps, her)).toBe(true);
    expect(await handleOnboarding(h.deps, organiserText)).toBe(false);

    expect(await h.db.select().from(outbound)).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
    expect(await session()).toBeUndefined();
  });
});
