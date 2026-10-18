import { ApiCreatedFamily, ApiParentLink } from "@vela/contracts";
import { channelLinks, consents, families, invites, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiFamily } from "./api-families.ts";
import { shareApiParentLink } from "./api-parent-link.ts";
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

describe("re-sharing a parent link", () => {
  it("reuses the same valid invite without another family, parent, consent or outbound", async () => {
    const before = await h.db.select().from(members);
    const result = await share();
    expect(ApiParentLink.parse(result.response.body)).toEqual({
      kind: "invite",
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
