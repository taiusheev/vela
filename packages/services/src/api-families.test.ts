import { ApiCreatedFamily, type InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { encodeButton } from "@vela/core";
import { consents, events, families, invites, members, users } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { composeApiAsk } from "./api-asks.ts";
import { AlreadyOrganiserError, createApiFamily } from "./api-families.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { handleConsentButton, handleInviteStart } from "./consent.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { acceptInvitationForDevelopment } from "./testing/seed.ts";

let h: Harness;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const nobody: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-2" };
const HER_TELEGRAM = "2001";

const REQUEST = {
  country: "TW",
  kept_light_member: {
    display_name: "Mom",
    address_form: "Mrs Chen",
    language: "en",
    tz: "Asia/Taipei",
    wake_time: "07:30",
  },
};

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  await h.db.insert(users).values({
    authSubject: identity.authSubject,
    displayName: "Mia",
    language: "en",
    tz: "Asia/Taipei",
  });
});
afterAll(async () => {
  await h.close();
});

let keys = 0;
async function create(
  body: unknown = REQUEST,
  options: { key?: string; who?: SessionIdentity } = {},
) {
  keys += 1;
  return createApiFamily(h.deps, options.who ?? identity, options.key ?? `key-${keys}`, body);
}

async function familyRows() {
  return h.db.select().from(families);
}

describe("createApiFamily", () => {
  it("makes the family, its organiser and her invitation, the rows Telegram onboarding makes", async () => {
    const result = await create();
    expect(result.replayed).toBe(false);
    expect(result.response.status).toBe(201);
    const body = ApiCreatedFamily.parse(result.response.body);

    const [family] = await familyRows();
    expect(family).toMatchObject({ name: "Mia", region: "apac", country: "TW", language: "en" });

    const people = await h.db
      .select()
      .from(members)
      .where(eq(members.familyId, body.family.id))
      .orderBy(asc(members.createdAt), asc(members.role));
    const organiser = people.find((person) => person.role === "organiser");
    const her = people.find((person) => person.role === "member");
    const [account] = await h.db
      .select()
      .from(users)
      .where(eq(users.authSubject, identity.authSubject));
    expect(organiser).toMatchObject({
      userId: account?.id,
      displayName: "Mia",
      billing: true,
      status: "active",
      primarySurface: "app",
      tz: "Asia/Taipei",
    });
    // Invited, not enrolled: nothing about her is consented until she says so herself.
    expect(her).toMatchObject({
      displayName: "Mom",
      addressForm: "Mrs Chen",
      status: "invited",
      lightOn: false,
      lightConsentedAt: null,
      turnsIn: false,
      wakeTime: "07:30",
      arrivalTime: "08:00",
    });

    const [invite] = await h.db.select().from(invites);
    expect(invite).toMatchObject({
      familyId: family?.id,
      forMemberId: her?.id,
      invitedBy: organiser?.id,
    });
    expect(body).toEqual({
      family: { id: family?.id, name: "Mia", region: "apac", country: "TW" },
      organiser_member_id: organiser?.id,
      kept_light_member: {
        id: her?.id,
        display_name: "Mom",
        status: "invited",
        arrival_time: "08:00",
      },
      invite: {
        url: `https://t.me/${h.config.telegramBotUsername}?start=${invite?.token}`,
        expires_at: invite?.expiresAt.toISOString(),
        text: t("en", "invite.for_her", {
          name: "Mom",
          organiser: "Mia",
          link: `https://t.me/${h.config.telegramBotUsername}?start=${invite?.token}`,
        }),
      },
    });
  });

  it("writes the words she is sent in her own language", async () => {
    const body = ApiCreatedFamily.parse(
      (
        await create({
          ...REQUEST,
          kept_light_member: {
            ...REQUEST.kept_light_member,
            display_name: "媽媽",
            language: "zh-TW",
          },
        })
      ).response.body,
    );
    expect(body.invite.text).toContain("媽媽您好，我是Mia");
    expect(body.invite.text).toContain(body.invite.url);
  });

  it("works with the consent flow as it is: she opens the link, says yes, and can then be asked", async () => {
    const body = ApiCreatedFamily.parse((await create()).response.body);
    const herId = body.kept_light_member.id;
    const token = new URL(body.invite.url).searchParams.get("start") ?? "";

    // Before she answers, nobody may ask her anything.
    await expect(
      composeApiAsk(h.deps, identity, "ask-early", body.family.id, {
        recipient_id: herId,
        type: "question",
        text: "Are you there?",
        when: "whenever",
      }),
    ).rejects.toThrow(VelaError);

    let sequence = 0;
    const from = (extra: Partial<InboundEvent> & Pick<InboundEvent, "kind">): InboundEvent => {
      sequence += 1;
      return {
        channel: "telegram",
        eventId: `tg:${sequence}`,
        at: h.clock.now().toISOString(),
        sender: { externalUserId: HER_TELEGRAM, displayName: "Mom", languageCode: "en" },
        conversation: { externalId: HER_TELEGRAM, kind: "private" },
        messageId: String(sequence),
        ...extra,
      };
    };
    await handleInviteStart(h.deps, from({ kind: "start", startParam: token }));
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
    const action = { type: "consent" as const, memberId: herId, accept: true };
    await handleConsentButton(
      h.deps,
      from({ kind: "button", buttonData: encodeButton(action), callbackId: "cb1" }),
      action,
    );

    const [her] = await h.db.select().from(members).where(eq(members.id, herId));
    expect(her).toMatchObject({ status: "active", lightOn: true });
    expect(her?.lightConsentedAt).toBeInstanceOf(Date);

    const asked = await composeApiAsk(h.deps, identity, "ask-after", body.family.id, {
      recipient_id: herId,
      type: "question",
      text: "What did the garden look like?",
      when: "whenever",
    });
    expect(asked.response.status).toBe(201);
  });

  it("stands in for her yes on a developer's machine with the fields the real yes writes", async () => {
    // The real flow, on one family.
    const real = ApiCreatedFamily.parse((await create()).response.body);
    const token = new URL(real.invite.url).searchParams.get("start") ?? "";
    const base = {
      channel: "telegram" as const,
      at: h.clock.now().toISOString(),
      sender: { externalUserId: HER_TELEGRAM, displayName: "Mom", languageCode: "en" },
      conversation: { externalId: HER_TELEGRAM, kind: "private" as const },
    };
    await handleInviteStart(h.deps, {
      ...base,
      eventId: "tg:s",
      messageId: "1",
      kind: "start",
      startParam: token,
    });
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
    const action = { type: "consent" as const, memberId: real.kept_light_member.id, accept: true };
    await handleConsentButton(
      h.deps,
      {
        ...base,
        eventId: "tg:b",
        messageId: "2",
        kind: "button",
        buttonData: encodeButton(action),
        callbackId: "cb",
      },
      action,
    );

    // The stand-in, on a second family made by a second account.
    await h.db
      .insert(users)
      .values({ authSubject: "auth|Sam", displayName: "Sam", language: "en", tz: "Asia/Taipei" });
    const standIn = ApiCreatedFamily.parse(
      (await create(REQUEST, { who: { authSubject: "auth|Sam", sessionId: "s" } })).response.body,
    );
    await acceptInvitationForDevelopment(h.db, standIn.kept_light_member.id, h.clock.now());

    const fields = async (id: string) => {
      const [row] = await h.db.select().from(members).where(eq(members.id, id));
      return {
        status: row?.status,
        lightOn: row?.lightOn,
        lightConsentText: row?.lightConsentText,
        lightStartsOn: row?.lightStartsOn,
        learningUntil: row?.learningUntil,
        consented: row?.lightConsentedAt instanceof Date,
      };
    };
    expect(await fields(standIn.kept_light_member.id)).toEqual(
      await fields(real.kept_light_member.id),
    );

    // Its evidence says no tap was made, and the invite cannot be used again.
    const [proof] = await h.db
      .select()
      .from(consents)
      .where(eq(consents.memberId, standIn.kept_light_member.id));
    expect(JSON.stringify(proof?.evidence)).toContain("no tap was made");
    const [used] = await h.db
      .select()
      .from(invites)
      .where(eq(invites.forMemberId, standIn.kept_light_member.id));
    expect(used?.acceptedBy).toBe(standIn.kept_light_member.id);

    await expect(
      acceptInvitationForDevelopment(h.db, standIn.kept_light_member.id, h.clock.now()),
    ).rejects.toThrow("not waiting for her yes");
  });

  it("refuses a second family for an account that already runs one, and writes nothing", async () => {
    await create();
    const error = await create().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AlreadyOrganiserError);
    expect(await familyRows()).toHaveLength(1);
  });

  it("replays its own answer even though the caller is now an organiser", async () => {
    const first = await create(REQUEST, { key: "same" });
    const again = await create(REQUEST, { key: "same" });
    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(await familyRows()).toHaveLength(1);
    expect(await h.db.select().from(events).where(eq(events.name, "family_created"))).toHaveLength(
      1,
    );
  });

  it("refuses one key spent on a different family", async () => {
    await create(REQUEST, { key: "same" });
    await expect(
      create(
        { ...REQUEST, kept_light_member: { ...REQUEST.kept_light_member, display_name: "Dad" } },
        { key: "same" },
      ),
    ).rejects.toThrow(ApiIdempotencyError);
    expect(await familyRows()).toHaveLength(1);
  });

  it("needs an account first, which is where the organiser's name comes from", async () => {
    const error = await create(REQUEST, { who: nobody }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(VelaError);
    expect((error as VelaError).code).toBe("not_found");
    expect(await familyRows()).toEqual([]);
  });

  it("refuses a body the screen could not have sent", async () => {
    const person = REQUEST.kept_light_member;
    for (const body of [
      {},
      { ...REQUEST, country: "Taiwan" },
      { ...REQUEST, country: "tw" },
      { ...REQUEST, kept_light_member: { ...person, display_name: "" } },
      { ...REQUEST, kept_light_member: { ...person, display_name: "x".repeat(41) } },
      { ...REQUEST, kept_light_member: { ...person, tz: "Mars/Olympus" } },
      { ...REQUEST, kept_light_member: { ...person, wake_time: "7:30" } },
      { ...REQUEST, kept_light_member: { ...person, language: "xx" } },
      { ...REQUEST, kept_light_member: { ...person, age: 81 } },
      { ...REQUEST, extra: true },
    ]) {
      await expect(create(body), JSON.stringify(body)).rejects.toThrow(ApiIdempotencyError);
    }
    expect(await familyRows()).toEqual([]);
  });

  it("writes one content-free family_created event from the app", async () => {
    await create();
    const [event] = await h.db.select().from(events).where(eq(events.name, "family_created"));
    expect(event).toMatchObject({ surface: "app" });
    expect(event?.props).toEqual({
      country: "TW",
      region: "apac",
      language: "en",
      nearby_contacts: 0,
    });
    expect(JSON.stringify(event)).not.toContain("Mrs Chen");
  });
});
