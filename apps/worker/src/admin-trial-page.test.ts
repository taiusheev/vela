import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { TrialReport } from "@vela/services";
import { describe, expect, it } from "vitest";
import { createAdminWorker } from "./admin-app.ts";
import { INVITE_COUNTRIES, renderFamilyPage } from "./admin-pages.ts";
import { renderTrialOverview, renderTrialReport } from "./admin-trial-page.ts";
import {
  adminTestEnv,
  createFakeAdminRuntime,
  EMPTY_TRIAL_TOTALS,
  familyPageFixture,
  namesOf,
} from "./testing/fakes.ts";

const FAMILY_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/admin/families/${FAMILY_ID}/trial`;
const ORIGIN = "https://vela-admin.example.test";
const EMPTY: TrialReport = {
  familyId: FAMILY_ID,
  generatedAt: new Date("2026-10-06T02:00:00Z"),
  windowDays: 30,
  recipients: [],
};

/** The four-number counts of a parent with nothing recorded yet. */
const COUNTS = {
  eligibleDays: 0,
  eligibleAnsweredDays: 0,
  awayDays: 0,
  repliesHeardDays: 0,
  quietNoticeDays: 0,
  usefulYes: 0,
  usefulNo: 0,
  trueConcern: 0,
  stopsSaid: 0,
};

async function send(fake: ReturnType<typeof createFakeAdminRuntime>, query = "") {
  const ctx = createExecutionContext();
  const response = await createAdminWorker(fake.runtime).fetch(
    new Request(`${ORIGIN}${PATH}${query}`),
    adminTestEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("protected trial reports", () => {
  it("refuses report access without Access authentication and does not build database ports", async () => {
    const fake = createFakeAdminRuntime({ admin: null });
    expect((await send(fake)).status).toBe(401);
    expect(fake.built()).toBe(0);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it.each(["?days=31", "?days=0", "?days=", "?days=7&days=30"])(
    "refuses ambiguous or unsupported periods %s",
    async (query) => {
      const fake = createFakeAdminRuntime();
      expect((await send(fake, query)).status).toBe(400);
      expect(fake.built()).toBe(0);
    },
  );

  it.each([
    ["", 30],
    ["?days=7", 7],
    ["?days=30", 30],
  ] as const)(
    "loads %s with the verified founder identity and scoped family",
    async (query, days) => {
      let called: unknown[] = [];
      const fake = createFakeAdminRuntime({
        services: {
          loadAdminTrialReport: async (_deps, ctx, familyId, period) => {
            called = [ctx, familyId, period];
            return { ...EMPTY, windowDays: period };
          },
        },
      });
      const response = await send(fake, query);
      expect(response.status).toBe(200);
      expect(called).toEqual([
        { admin: "founder@vela.test", familyId: FAMILY_ID },
        FAMILY_ID,
        days,
      ]);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(fake.closed()).toBe(fake.built());
      const body = await response.text();
      expect(body).toContain("No prepared exchanges are recorded");
      expect(body).toContain("does not prove scheduled delivery or consent");
    },
  );

  it("shows unavailable when services refuse an absent or deleting family", async () => {
    expect((await send(createFakeAdminRuntime())).status).toBe(404);
  });

  it("links reports from the family page and offers Vietnam for founder-assisted invitations", async () => {
    const fixture = familyPageFixture();
    expect(await renderFamilyPage(fixture, null).text()).toContain(
      `/admin/families/${fixture.family.id}/trial`,
    );
    expect(INVITE_COUNTRIES).toContainEqual({ code: "VN", label: "Vietnam" });
  });

  it("shows exact denominators, latency samples and missing-metadata limits without inventing quality scores", async () => {
    const body = await renderTrialReport({
      ...EMPTY,
      recipients: [
        {
          recipientId: "recipient-code",
          lightOn: false,
          timezone: "Asia/Ho_Chi_Minh",
          from: "2026-09-06",
          through: "2026-10-05",
          unobservedDays: 26,
          expiredArrivalMetadata: 1,
          days: [],
          summary: {
            recordedDays: 4,
            deliveredDays: 3,
            failedDays: 1,
            answeredDays: 3,
            fallbackDays: 1,
            answerCount: 5,
            humanReplies: 7,
            repliesReadBack: 4,
            medianLatencyMin: 35,
            latencySamples: 2,
            preArrivalAnswers: 1,
            ...COUNTS,
          },
        },
      ],
    }).text();
    expect(body).toContain("3 / 4 (75.0%)");
    expect(body).toContain("7 / 5 = 1.40");
    expect(body).toContain("35.0 minutes");
    expect(body).toContain("2 nonnegative samples");
    expect(body).toContain("26 calendar days have no prepared exchange");
    expect(body).toContain("Read-back attempt and send-state counts below may be incomplete");
    expect(body).toContain("Contentful-answer assessment");
    expect(body).not.toContain("contentful answers: 100%");
  });

  it("shows a kept-light member's four numbers with their status and target", async () => {
    const body = await renderTrialReport({
      ...EMPTY,
      recipients: [
        {
          recipientId: "kept-light-code",
          lightOn: true,
          timezone: "Asia/Ho_Chi_Minh",
          from: "2026-09-06",
          through: "2026-10-05",
          unobservedDays: 20,
          expiredArrivalMetadata: 0,
          days: [],
          summary: {
            recordedDays: 10,
            deliveredDays: 10,
            failedDays: 0,
            answeredDays: 4,
            fallbackDays: 4,
            answerCount: 4,
            humanReplies: 0,
            repliesReadBack: 0,
            medianLatencyMin: 35,
            latencySamples: 4,
            preArrivalAnswers: 0,
            ...COUNTS,
            eligibleDays: 9,
            eligibleAnsweredDays: 4,
            awayDays: 1,
          },
        },
      ],
    }).text();
    expect(body).toContain("The four numbers");
    expect(body).toContain("Days she answers");
    expect(body).toContain("4 / 9 (44.4%)");
    expect(body).toContain('class="status-kill">Kill signal');
    expect(body).toContain("Mornings nobody asked");
    expect(body).toContain("Founder check");
  });
});

describe("the trial overview", () => {
  async function overview(query = "") {
    const fake = createFakeAdminRuntime();
    const ctx = createExecutionContext();
    const response = await createAdminWorker(fake.runtime).fetch(
      new Request(`${ORIGIN}/admin/trial${query}`),
      adminTestEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return { fake, response };
  }

  it("refuses a period other than seven or 30 days", async () => {
    const { response } = await overview("?days=14");
    expect(response.status).toBe(400);
  });

  it("loads every family with the founder identity and no family scope", async () => {
    let called: unknown[] = [];
    const fake = createFakeAdminRuntime({
      services: {
        loadAdminTrialOverview: async (_deps, ctx, period) => {
          called = [ctx, period];
          return {
            generatedAt: new Date("2026-10-10T00:00:00Z"),
            windowDays: period,
            parents: [],
            totals: EMPTY_TRIAL_TOTALS,
            parentsWhoStopped: 0,
          };
        },
      },
    });
    const ctx = createExecutionContext();
    const response = await createAdminWorker(fake.runtime).fetch(
      new Request(`${ORIGIN}/admin/trial?days=7`),
      adminTestEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(called).toEqual([{ admin: "founder@vela.test" }, 7]);
    expect(await response.text()).toContain("No kept-light member yet.");
    expect(fake.closed()).toBe(fake.built());
  });

  it("renders every kept-light member with links to their family's report", async () => {
    const body = await renderTrialOverview({
      generatedAt: new Date("2026-10-10T00:00:00Z"),
      windowDays: 30,
      parents: [
        {
          familyId: FAMILY_ID,
          report: {
            recipientId: "22222222-2222-4222-8222-222222222222",
            lightOn: true,
            timezone: "Asia/Taipei",
            from: "2026-09-10",
            through: "2026-10-09",
            unobservedDays: 0,
            expiredArrivalMetadata: 0,
            days: [],
            summary: {
              recordedDays: 30,
              deliveredDays: 30,
              failedDays: 0,
              answeredDays: 24,
              fallbackDays: 2,
              answerCount: 24,
              humanReplies: 30,
              repliesReadBack: 20,
              medianLatencyMin: 40,
              latencySamples: 24,
              preArrivalAnswers: 0,
              ...COUNTS,
              eligibleDays: 30,
              eligibleAnsweredDays: 24,
              repliesHeardDays: 15,
            },
          },
        },
      ],
      totals: {
        recordedDays: 30,
        deliveredDays: 30,
        failedDays: 0,
        answeredDays: 24,
        fallbackDays: 2,
        answerCount: 24,
        humanReplies: 30,
        repliesReadBack: 20,
        medianLatencyMin: null,
        latencySamples: 24,
        preArrivalAnswers: 0,
        ...COUNTS,
        eligibleDays: 30,
        eligibleAnsweredDays: 24,
        repliesHeardDays: 15,
      },
      parentsWhoStopped: 0,
    }).text();
    expect(body).toContain("1 kept-light member; 0 said stop");
    expect(body).toContain("24 / 30 (80.0%)");
    expect(body).toContain(`/admin/families/${FAMILY_ID}/trial?days=30`);
    expect(body).toContain("On track");
  });
});
