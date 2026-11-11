import { ApiCreatedFamily, ApiParentLink } from "@vela/contracts";
import { channelLinks, consents, events, families, invites, members, users } from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiFamily } from "./api-families.ts";
import { loadApiParentConnection, shareApiParentLink } from "./api-parent-link.ts";
import { sha256Hex } from "./hash.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
const actor = { authSubject: "auth|Mia", sessionId: "s1" };
let created: ApiCreatedFamily;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  await h.db.insert(users).values({
    authSubject: actor.authSubject,
    displayName: "Mia",
    language: "en",
    tz: "Asia/Taipei",
  });
  const result = await createApiFamily(h.deps, actor, "create", {
    country: "TW",
    kept_light_member: {
      display_name: "Mom",
      address_form: "Mom",
      language: "en",
      tz: "Asia/Taipei",
      wake_time: "07:30",
    },
  });
  created = ApiCreatedFamily.parse(result.response.body);
});
afterAll(async () => {
  await h.close();
});
const share = (
  key = "share",
  who = actor,
  family = created.family.id,
  member = created.kept_light_member.id,
) => shareApiParentLink(h.deps, who, key, family, member, {});

/** The token in an invite link, as Telegram's `?start=` carries it. */
const startTokenOf = (url: string): string => new URL(url).searchParams.get("start") ?? "";

describe("invite tokens at rest (ADR-38, migration 0038)", () => {
  it("keeps only the sealed token and its hash in the database", async () => {
    const token = startTokenOf(created.invite.url);
    expect(token.length).toBeGreaterThan(20);
    const { rows } = await h.db.execute<{ token: string; token_hash: string }>(
      sql`select token, token_hash from invites`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token.startsWith("v1.")).toBe(true);
    expect(rows[0]?.token).not.toContain(token);
    expect(rows[0]?.token_hash).toBe(await sha256Hex(token));
  });

  it("gives a fresh link for an open invite made before sealing, and keeps the old one findable", async () => {
    const oldToken = startTokenOf(created.invite.url);
    await h.db.execute(sql`update invites set token = ''`);
    const body = ApiParentLink.parse((await share()).response.body);
    expect(body.kind).toBe("invite");
    expect(body.url).not.toBe(created.invite.url);
    expect(startTokenOf(body.url).length).toBeGreaterThan(20);
    expect(await h.db.select().from(invites)).toHaveLength(2);
    const [old] = await h.db
      .select({ id: invites.id })
      .from(invites)
      .where(eq(invites.tokenHash, await sha256Hex(oldToken)));
    expect(old).toBeDefined();
  });
});

describe("re-sharing a parent link", () => {
  it("reuses the same valid invite without another family, parent, consent or outbound", async () => {
    const before = await h.db.select().from(members);
    const result = await share();
    expect(ApiParentLink.parse(result.response.body)).toEqual({
      kind: "invite",
      messenger: "telegram",
      ...{
        url: created.invite.url,
        text: created.invite.text,
        expires_at: created.invite.expires_at,
      },
    });
    expect(await h.db.select().from(invites)).toHaveLength(1);
    expect(await h.db.select().from(members)).toEqual(before);
    expect(await h.db.select().from(families)).toHaveLength(1);
    expect(await h.db.select().from(consents)).toHaveLength(0);
    expect(h.queues.outbound.pending).toHaveLength(0);
  });
  it("renews an expired invitation for the existing parent and replays a retry", async () => {
    h.clock.advance(8 * 24 * 60 * 60_000);
    const result = await share();
    const body = ApiParentLink.parse(result.response.body);
    expect(body.url).not.toBe(created.invite.url);
    expect(body.kind).toBe("invite");
    expect(await h.db.select().from(members)).toHaveLength(2);
    const replay = await share();
    expect(replay.replayed).toBe(true);
    expect(replay.response).toEqual(result.response);
    expect(await h.db.select().from(invites)).toHaveLength(2);
    const next = await share("another-tap");
    expect(next.response.body).toEqual(result.response.body);
    expect(await h.db.select().from(invites)).toHaveLength(2);
  });
  it("returns the existing chat for an accepted invite, even while consent is pending", async () => {
    await h.db
      .update(invites)
      .set({ acceptedAt: h.clock.now(), acceptedBy: created.kept_light_member.id });
    const result = ApiParentLink.parse((await share()).response.body);
    expect(result).toEqual({
      kind: "chat",
      messenger: "telegram",
      url: `https://t.me/${h.config.telegramBotUsername}`,
      text: `https://t.me/${h.config.telegramBotUsername}`,
      expires_at: null,
    });
    expect(await h.db.select().from(invites)).toHaveLength(1);
    expect(
      (await h.db.select().from(members).where(eq(members.id, created.kept_light_member.id)))[0],
    ).toMatchObject({ status: "invited", lightOn: false });
  });
  it("preserves paused parents and uses their LINE chat when configured", async () => {
    await h.db
      .update(members)
      .set({ status: "paused", primarySurface: "line" })
      .where(eq(members.id, created.kept_light_member.id));
    const result = await shareApiParentLink(
      { ...h.deps, config: { ...h.config, lineBasicId: "@vela-test" } },
      actor,
      "line",
      created.family.id,
      created.kept_light_member.id,
      {},
    );
    expect(ApiParentLink.parse(result.response.body)).toMatchObject({
      kind: "chat",
      url: "https://line.me/R/oaMessage/%40vela-test/",
    });
    expect(await h.db.select().from(channelLinks)).toHaveLength(0);
  });
  describe("the messenger the family chose at setup", () => {
    // Field report, 11 Nov 2026: a family that talks on LINE was sent a t.me page from the
    // "share invitation" button, because every new parent was recorded as Telegram.
    const lineDeps = () => ({ ...h.deps, config: { ...h.config, lineBasicId: "@vela-test" } });
    const familyChoosing = async (messenger?: "telegram" | "line" | "phone") => {
      await h.reset();
      await h.db.insert(users).values({
        authSubject: actor.authSubject,
        displayName: "Mia",
        language: "en",
        tz: "Asia/Taipei",
      });
      return ApiCreatedFamily.parse(
        (
          await createApiFamily(lineDeps(), actor, `create:${messenger ?? "none"}`, {
            country: "TW",
            kept_light_member: {
              display_name: "Mom",
              address_form: "Mom",
              language: "en",
              tz: "Asia/Taipei",
              wake_time: "07:30",
            },
            ...(messenger === undefined ? {} : { messenger }),
          })
        ).response.body,
      );
    };
    const shareFor = async (made: ApiCreatedFamily, key: string, input: object = {}) =>
      ApiParentLink.parse(
        (
          await shareApiParentLink(
            lineDeps(),
            actor,
            key,
            made.family.id,
            made.kept_light_member.id,
            input,
          )
        ).response.body,
      );
    const lineLinkOf = (made: ApiCreatedFamily) =>
      `https://line.me/R/oaMessage/%40vela-test/?${encodeURIComponent(`/start ${startTokenOf(made.invite.url)}`)}`;

    it("sends LINE again to a family that chose LINE, for the same invite", async () => {
      const made = await familyChoosing("line");
      const body = await shareFor(made, "again");
      expect(body).toMatchObject({ kind: "invite", messenger: "line", url: lineLinkOf(made) });
      expect(body.url).toBe(made.invite.line_url);
      expect(body.text).not.toContain("t.me");
      expect(await h.db.select().from(invites)).toHaveLength(1);
    });

    it("sends Telegram again to a family that chose Telegram, wherever it lives", async () => {
      for (const messenger of ["telegram", "phone", undefined] as const) {
        const made = await familyChoosing(messenger);
        const body = await shareFor(made, `again:${messenger}`);
        expect(body).toMatchObject({ messenger: "telegram", url: made.invite.url });
      }
    });

    it("keeps Telegram for a LINE choice while LINE is off", async () => {
      await h.reset();
      await h.db.insert(users).values({
        authSubject: actor.authSubject,
        displayName: "Mia",
        language: "en",
        tz: "Asia/Taipei",
      });
      const made = ApiCreatedFamily.parse(
        (
          await createApiFamily(h.deps, actor, "create-off", {
            country: "TW",
            kept_light_member: {
              display_name: "Mom",
              address_form: "Mom",
              language: "en",
              tz: "Asia/Taipei",
              wake_time: "07:30",
            },
            messenger: "line",
          })
        ).response.body,
      );
      const [her] = await h.db
        .select()
        .from(members)
        .where(eq(members.id, made.kept_light_member.id));
      expect(her?.primarySurface).toBe("telegram");
    });

    it("lets the organiser switch her invitation, and remembers the switch", async () => {
      const made = await familyChoosing("telegram");
      const switched = await shareFor(made, "to-line", { messenger: "line" });
      expect(switched).toMatchObject({ messenger: "line", url: lineLinkOf(made) });
      expect(await shareFor(made, "later")).toMatchObject({ messenger: "line" });
      const back = await shareFor(made, "to-telegram", { messenger: "telegram" });
      expect(back).toMatchObject({ messenger: "telegram", url: made.invite.url });
      expect(await h.db.select().from(invites)).toHaveLength(1);
    });

    it("never switches a parent who already answered: her shortcut opens her own chat", async () => {
      const made = await familyChoosing("line");
      await h.db
        .update(members)
        .set({ status: "active", primarySurface: "telegram" })
        .where(eq(members.id, made.kept_light_member.id));
      const body = await shareFor(made, "answered", { messenger: "line" });
      expect(body).toMatchObject({ kind: "chat", messenger: "telegram" });
      const [her] = await h.db
        .select()
        .from(members)
        .where(eq(members.id, made.kept_light_member.id));
      expect(her?.primarySurface).toBe("telegram");
    });

    it("refuses an unknown messenger", async () => {
      const made = await familyChoosing("line");
      await expect(shareFor(made, "bad", { messenger: "whatsapp" })).rejects.toBeDefined();
    });
  });
  it("refuses strangers, relatives and parents from another family without exposing a token", async () => {
    await expect(
      share("stranger", { authSubject: "auth|stranger", sessionId: "s2" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      share("other-family", actor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      share("organiser-as-parent", actor, created.family.id, created.organiser_member_id),
    ).rejects.toMatchObject({ code: "not_found" });
    await h.db
      .update(members)
      .set({ role: "member" })
      .where(eq(members.id, created.organiser_member_id));
    await expect(share("relative")).rejects.toMatchObject({ code: "not_found" });
  });
  it("rechecks access and target existence before returning even a recorded response", async () => {
    await share();
    await h.db.delete(members).where(eq(members.id, created.kept_light_member.id));
    await expect(share()).rejects.toMatchObject({ code: "not_found" });
  });
  it("rejects left parents and malformed targets", async () => {
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, created.kept_light_member.id));
    await expect(share()).rejects.toMatchObject({ code: "not_found" });
    await expect(share("invalid", actor, created.family.id, "wrong")).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("parent invitation status", () => {
  const status = (who = actor, family = created.family.id, parent = created.kept_light_member.id) =>
    loadApiParentConnection(h.deps, who, family, parent);
  it("separates an unopened invite, opened chat, actual consent, pause and blocked delivery", async () => {
    expect(await status()).toEqual({ state: "waiting" });
    await h.db.insert(channelLinks).values({
      memberId: created.kept_light_member.id,
      channel: "telegram",
      externalId: "parent-test",
    });
    await h.db
      .update(members)
      .set({ primarySurface: "telegram" })
      .where(eq(members.id, created.kept_light_member.id));
    expect(await status()).toEqual({ state: "opened" });
    await h.db
      .update(members)
      .set({ status: "active", lightOn: true })
      .where(eq(members.id, created.kept_light_member.id));
    expect(await status()).toEqual({ state: "connected" });
    await h.db
      .update(members)
      .set({ status: "paused" })
      .where(eq(members.id, created.kept_light_member.id));
    expect(await status()).toEqual({ state: "paused" });
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.memberId, created.kept_light_member.id));
    expect(await status()).toEqual({ state: "unavailable" });
  });
  it("can report the recorded decline after the invitee was deleted, without retaining their profile", async () => {
    await h.db.insert(events).values({
      name: "consent_declined",
      familyId: created.family.id,
      memberId: created.kept_light_member.id,
      surface: "telegram",
    });
    await h.db.delete(members).where(eq(members.id, created.kept_light_member.id));
    expect(await status()).toEqual({ state: "declined" });
    expect(await status(actor, created.family.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toEqual({
      state: "unavailable",
    });
  });
  it("requires an organiser of this exact live family", async () => {
    await expect(status({ authSubject: "stranger", sessionId: "s2" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(status(actor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).rejects.toMatchObject({
      code: "not_found",
    });
    await h.db
      .update(members)
      .set({ role: "member" })
      .where(eq(members.id, created.organiser_member_id));
    await expect(status()).rejects.toMatchObject({ code: "not_found" });
  });
});
