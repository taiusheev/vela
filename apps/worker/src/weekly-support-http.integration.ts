/** The actual HTTP -> service -> migrated database path, with synthetic identities only. */
import {
  SUPPORT_NOTICE_VERSION,
  SupportPrepared,
  SupportPresentation,
  SupportReport,
} from "@vela/contracts";
import { answers, members, users } from "@vela/db";
import {
  answerWeeklySupportPermission,
  loadWeeklySupportPresentation,
  loadWeeklySupportReport,
  prepareWeeklySupportPermission,
  removeWeeklySupportReview,
  reviewWeeklySupport,
  stopWeeklySupport,
} from "@vela/services";
import {
  createHarness,
  type Harness,
  type SeededFamily,
  seedExchange,
  seedFamily,
} from "@vela/services/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type ApiRuntime, createApiApp } from "./api-app.ts";

const WEEKLY_SUPPORT_SERVICES = {
  loadWeeklySupportReport,
  loadWeeklySupportPresentation,
  prepareWeeklySupportPermission,
  answerWeeklySupportPermission,
  stopWeeklySupport,
  reviewWeeklySupport,
  removeWeeklySupportReview,
};
const API_READ_SERVICES = {} as ApiRuntime["services"];
const API_WRITE_SERVICES = {} as NonNullable<ApiRuntime["writes"]>["services"];
let h: Harness;
let family: SeededFamily;
let runtime: ApiRuntime;
let seq = 0;
const parent = { authSubject: "synthetic|http-parent", sessionId: "p" };
const child = { authSubject: "synthetic|http-child", sessionId: "c" };
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  family = await seedFamily(h.db, { now: h.clock.now() });
  for (const [identity, id] of [
    [parent, family.member.id],
    [child, family.organiser.id],
  ] as const) {
    const [u] = await h.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
      .returning();
    if (!u) throw new Error();
    await h.db.update(members).set({ userId: u.id }).where(eq(members.id, id));
  }
  runtime = {
    verifySession: async (req) =>
      req.headers.get("authorization") === "Bearer parent"
        ? parent
        : req.headers.get("authorization") === "Bearer child"
          ? child
          : null,
    now: () => h.clock.now(),
    openDatabase: async () => ({ db: h.db, close: async () => {} }),
    services: API_READ_SERVICES,
    logger: h.logger,
    writes: { verifyActiveSession: async () => true, clock: h.clock, services: API_WRITE_SERVICES },
    weeklySupport: {
      config: {
        enabled: true,
        noticeVersion: SUPPORT_NOTICE_VERSION,
        familyIds: [family.family.id],
      },
      services: WEEKLY_SUPPORT_SERVICES,
    },
  };
});
function path() {
  return `/v1/families/${family.family.id}/weekly-support/${family.member.id}`;
}
async function request(actor: string, suffix = "", body?: unknown, key?: string) {
  const app = createApiApp(runtime);
  return app.request(path() + suffix, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${actor}`,
      ...(body === undefined
        ? {}
        : {
            "content-type": "application/json",
            "idempotency-key": key ?? `synthetic:http:${++seq}`,
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it("sends no-store report responses and requires authenticated parent-only permission", async () => {
  expect((await request("stranger")).status).toBe(401);
  expect((await request("child", "/presentations", {})).status).toBe(403);
  const response = await request("parent", "/presentations", {});
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const prepared = SupportPrepared.parse(await response.json());
  const preview = await request("parent", `/presentations/${prepared.id}`);
  expect(SupportPresentation.parse(await preview.json()).readers[0]?.name).toBe("Mia");
  expect((await request("child", `/presentations/${prepared.id}`)).status).toBe(403);
});
it("reads reviewed live source words and hides them after stopping through HTTP", async () => {
  const p = SupportPrepared.parse(await (await request("parent", "/presentations", {})).json());
  expect(
    (await request("parent", "/permission", { presentation_id: p.id, answer: "yes" })).status,
  ).toBe(200);
  h.clock.advance(1000);
  const exchange = await seedExchange(h.db, family, { date: "2026-09-14" });
  await h.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: family.member.id,
    kind: "text",
    channel: "telegram",
    payload: { text: "Could someone help sort my photos?" },
    transcriptLang: "en",
    receivedAt: h.clock.now(),
    understoodAt: h.clock.now(),
  });
  const before = SupportReport.parse(await (await request("child")).json());
  const source = before.sources[0];
  expect(source).toBeDefined();
  if (!source) throw new Error();
  expect(
    (
      await request("child", "/review", {
        source_id: source.id,
        source_digest: source.digest,
        kind: "practical_help",
        ordinary_confirmed: true,
        valid_until: new Date(h.clock.now().getTime() + 86400000).toISOString(),
      })
    ).status,
  ).toBe(200);
  expect(SupportReport.parse(await (await request("parent")).json()).suggestions).toHaveLength(1);
  expect((await request("parent", "/stop", {})).status).toBe(200);
  expect(SupportReport.parse(await (await request("child")).json()).suggestions).toEqual([]);
});
it("returns 404 when gated off, 409 for an expired permission and 400 without a write key", async () => {
  if (!runtime.weeklySupport) throw new Error();
  runtime.weeklySupport.config.enabled = false;
  expect((await request("child")).status).toBe(404);
  runtime.weeklySupport.config.enabled = true;
  const p = SupportPrepared.parse(await (await request("parent", "/presentations", {})).json());
  h.clock.advance(300001);
  expect(
    (await request("parent", "/permission", { presentation_id: p.id, answer: "yes" })).status,
  ).toBe(409);
  expect((await request("parent", "/stop", {}, "")).status).toBe(400);
});
it("keeps stop usable after processing and the private-test roster are disabled", async () => {
  if (!runtime.weeklySupport) throw new Error();
  runtime.weeklySupport.config = { enabled: false, noticeVersion: "", familyIds: [] };
  expect((await request("parent", "/stop", {})).status).toBe(200);
});
