import {
  adminAccessLog,
  answers,
  channelLinks,
  consents,
  exchanges,
  families,
  familyChannels,
  invites,
  members,
  nearbyContacts,
  outbound,
  pilotFamilies,
  replies,
  users,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeApiAsk } from "./api-asks.ts";
import { loadApiExchanges } from "./api-exchanges.ts";
import { loadApiParentConnection, shareApiParentLink } from "./api-parent-link.ts";
import { loadApiToday } from "./api-today.ts";
import {
  APP_REVIEW_FAMILY,
  APP_REVIEW_SUBJECT,
  prepareAppReviewFamily,
  ReviewerFixtureRefused,
} from "./reviewer-demo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

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

describe("private reviewer family setup", () => {
  it("creates only the approved fictional family, seals its samples and provides no delivery or consent", async () => {
    const result = await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT);
    expect(result.response.status).toBe(201);
    expect(await h.db.select().from(families)).toEqual([
      expect.objectContaining({ id: APP_REVIEW_FAMILY, name: "Apple Review", turnsEnabled: false }),
    ]);
    expect(await h.db.select().from(members)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Demo Organiser",
          role: "organiser",
          turnsIn: false,
          nextWakeAt: null,
        }),
        expect.objectContaining({
          displayName: "Demo Parent",
          status: "invited",
          lightOn: false,
          turnsIn: false,
          nextWakeAt: null,
          lightConsentedAt: null,
          lightStartsOn: null,
        }),
      ]),
    );
    expect(await h.db.select().from(answers)).toEqual([
      expect.objectContaining({
        payload: { text: "Demo answer: I enjoyed a cup of tea by the window." },
      }),
    ]);
    const raw = await h.db.execute<{ payload: { text: string } }>(sql`select payload from answers`);
    expect(raw.rows[0]?.payload.text).toMatch(/^v1\./);
    expect(await h.db.select().from(exchanges)).toHaveLength(1);
    expect(await h.db.select().from(replies)).toHaveLength(1);
    for (const table of [
      channelLinks,
      familyChannels,
      invites,
      nearbyContacts,
      consents,
      outbound,
    ]) {
      expect(await h.db.select().from(table)).toEqual([]);
    }
    expect(await h.db.select().from(pilotFamilies)).toHaveLength(1);
    expect(await h.db.select().from(adminAccessLog)).toEqual([
      expect.objectContaining({
        action: "family_approve",
        what: "created isolated synthetic app-review fixture v1; no live delivery",
      }),
    ]);
    expect(h.queues.outbound.pending).toEqual([]);
    expect(h.scheduler.history).toEqual([]);
    const identity = { authSubject: APP_REVIEW_SUBJECT, sessionId: "synthetic-review-session" };
    const page = await loadApiExchanges(h.db, identity, APP_REVIEW_FAMILY, h.clock.now());
    expect(page?.exchanges).toHaveLength(1);
    expect(JSON.stringify(page)).toContain("Demo answer: I enjoyed a cup of tea by the window.");
    expect((await loadApiToday(h.db, identity, APP_REVIEW_FAMILY, h.clock.now()))?.lights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ display_name: "Demo Parent", state: "none" }),
      ]),
    );
    expect(
      await loadApiExchanges(
        h.db,
        { authSubject: "user_other_synthetic", sessionId: "other" },
        APP_REVIEW_FAMILY,
        h.clock.now(),
      ),
    ).toBeNull();
  });

  it("replays without replacing content or making another family", async () => {
    await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT);
    const before = await h.db.select().from(exchanges);
    const again = await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT);
    expect(again.replayed).toBe(true);
    expect(await h.db.select().from(exchanges)).toEqual(before);
    expect(await h.db.select().from(families)).toHaveLength(1);
    expect(await h.db.select().from(adminAccessLog)).toHaveLength(1);
  });

  it("uses the ordinary LINE invitation and first-question path without assuming consent or sending anything", async () => {
    await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT);
    const identity = { authSubject: APP_REVIEW_SUBJECT, sessionId: "synthetic-review-session" };
    const [parent] = await h.db
      .select()
      .from(members)
      .where(eq(members.displayName, "Demo Parent"));
    if (!parent) throw new Error("test setup failed");
    expect(await loadApiParentConnection(h.deps, identity, APP_REVIEW_FAMILY, parent.id)).toEqual({
      state: "waiting",
    });
    const link = await shareApiParentLink(
      { ...h.deps, config: { ...h.deps.config, lineBasicId: "@synthetic-review" } },
      identity,
      "review-invite",
      APP_REVIEW_FAMILY,
      parent.id,
      {},
    );
    expect(link.response.body).toMatchObject({
      kind: "invite",
      url: expect.stringContaining("https://line.me/"),
    });
    const ask = await composeApiAsk(h.deps, identity, "review-question", APP_REVIEW_FAMILY, {
      recipient_id: parent.id,
      type: "question",
      text: "Demo question: what did you enjoy today?",
      when: "whenever",
    });
    expect(ask.response.status).toBe(201);
    expect(ask.after.outboundIds).toEqual([]);
    expect(await h.db.select().from(outbound)).toEqual([]);
    expect(await h.db.select().from(consents)).toEqual([]);
    expect((await h.db.select().from(members).where(eq(members.id, parent.id)))[0]).toMatchObject({
      status: "invited",
      lightOn: false,
      nextWakeAt: null,
    });
  });

  it("preserves a normally provisioned empty account and its permission evidence", async () => {
    const evidence = {
      version: "synthetic.v1",
      text_sha256: "synthetic",
      accepted_at: h.clock.now().toISOString(),
    };
    const [account] = await h.db
      .insert(users)
      .values({
        authSubject: APP_REVIEW_SUBJECT,
        displayName: "Demo Organiser",
        privacyAcceptance: evidence,
      })
      .returning();
    await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT);
    expect(await h.db.select().from(users)).toEqual([account]);
  });

  it("refuses other subjects before writing anything", async () => {
    await expect(prepareAppReviewFamily(h.deps, "user_other_synthetic")).rejects.toBeInstanceOf(
      ReviewerFixtureRefused,
    );
    expect(await h.db.select().from(users)).toEqual([]);
    expect(await h.db.select().from(families)).toEqual([]);
  });

  it("works before the optional weekly-feedback migration on the live database", async () => {
    await h.db.execute(sql`alter table members drop column weekly_feedback`);
    try {
      expect((await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT)).response.status).toBe(201);
      const rows = await h.db.execute<{ status: string; light_on: boolean }>(
        sql`select status, light_on from members where role = 'member'`,
      );
      expect(rows.rows).toEqual([{ status: "invited", light_on: false }]);
      expect((await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT)).replayed).toBe(true);
    } finally {
      await h.db.execute(
        sql`alter table members add column weekly_feedback boolean default true not null`,
      );
    }
  });

  it("refuses to attach the reviewer identity to an existing family", async () => {
    const [account] = await h.db
      .insert(users)
      .values({ authSubject: APP_REVIEW_SUBJECT, displayName: "Unrelated synthetic organiser" })
      .returning();
    const [family] = await h.db
      .insert(families)
      .values({ name: "Unrelated synthetic family", region: "apac", country: "TW" })
      .returning();
    if (!account || !family) throw new Error("test setup failed");
    await h.db.insert(members).values({
      familyId: family.id,
      userId: account.id,
      displayName: "Unrelated synthetic organiser",
      tz: "Asia/Taipei",
      country: "TW",
    });
    const before = await h.db.select().from(members);
    await expect(prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT)).rejects.toBeInstanceOf(
      ReviewerFixtureRefused,
    );
    expect(await h.db.select().from(members)).toEqual(before);
    expect(await h.db.select().from(families)).toEqual([family]);
    expect(await h.db.select().from(answers)).toEqual([]);
  });

  it("refuses a replay after the sample parent is activated or acquires a messenger", async () => {
    await prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT);
    const [parent] = await h.db
      .select()
      .from(members)
      .where(eq(members.displayName, "Demo Parent"));
    if (!parent) throw new Error("test setup failed");
    await h.db.update(members).set({ status: "active" }).where(eq(members.id, parent.id));
    await expect(prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT)).rejects.toBeInstanceOf(
      ReviewerFixtureRefused,
    );
    await h.db.update(members).set({ status: "invited" }).where(eq(members.id, parent.id));
    await h.db
      .insert(channelLinks)
      .values({ memberId: parent.id, channel: "telegram", externalId: "synthetic-review-link" });
    await expect(prepareAppReviewFamily(h.deps, APP_REVIEW_SUBJECT)).rejects.toBeInstanceOf(
      ReviewerFixtureRefused,
    );
    expect(await h.db.select().from(answers)).toHaveLength(1);
  });
});
