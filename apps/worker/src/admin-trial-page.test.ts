import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { TrialReport } from "@vela/services";
import { describe, expect, it } from "vitest";
import { createAdminWorker } from "./admin-app.ts";
import { INVITE_COUNTRIES, renderFamilyPage } from "./admin-pages.ts";
import { renderTrialReport } from "./admin-trial-page.ts";
import {
  adminTestEnv,
  createFakeAdminRuntime,
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
});
