import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { TestWeekReport } from "@vela/services";
import { describe, expect, it } from "vitest";
import { createAdminWorker } from "./admin-app.ts";
import { adminTestEnv, createFakeAdminRuntime, namesOf } from "./testing/fakes.ts";

const FAMILY_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/admin/families/${FAMILY_ID}/test-week`;
const ORIGIN = "https://vela-admin.example.test";
const REPORT: TestWeekReport = {
  familyId: FAMILY_ID,
  generatedAt: new Date("2026-10-08T02:00:00Z"),
  steps: [
    {
      key: "consent",
      group: "setup",
      label: "The parent said Yes",
      how: "Send the parent's invite and tap Yes in her chat.",
      required: true,
      count: 1,
      firstAt: new Date("2026-10-06T09:05:00Z"),
    },
    {
      key: "stop",
      group: "control",
      label: "She said stop",
      how: "Send stop in her chat.",
      required: true,
      count: 0,
      firstAt: null,
    },
  ],
  deliveredMornings: 2,
  problems: { arrivalFailures: 1, droppedSends: 0, missedTicks: 0 },
};

async function send(fake: ReturnType<typeof createFakeAdminRuntime>) {
  const ctx = createExecutionContext();
  const response = await createAdminWorker(fake.runtime).fetch(
    new Request(`${ORIGIN}${PATH}`),
    adminTestEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("the test week checklist", () => {
  it("refuses access without Access authentication", async () => {
    const fake = createFakeAdminRuntime({ admin: null });
    expect((await send(fake)).status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("shows which gate-1 steps are seen, how to make the rest happen, and recorded problems", async () => {
    let called: unknown[] = [];
    const fake = createFakeAdminRuntime({
      services: {
        loadAdminTestWeek: async (_deps, ctx, familyId) => {
          called = [ctx, familyId];
          return REPORT;
        },
      },
    });
    const response = await send(fake);
    expect(response.status).toBe(200);
    expect(called).toEqual([{ admin: "founder@vela.test", familyId: FAMILY_ID }, FAMILY_ID]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("1 of 2 required steps seen");
    expect(body).toContain("Scheduled mornings delivered: 2 of 7");
    expect(body).toContain("2026-10-06T09:05:00.000Z");
    expect(body).toContain("Send stop in her chat.");
    expect(body).toContain("1 failed arrivals");
  });

  it("answers 404 for a family that is gone", async () => {
    const fake = createFakeAdminRuntime();
    expect((await send(fake)).status).toBe(404);
  });
});
