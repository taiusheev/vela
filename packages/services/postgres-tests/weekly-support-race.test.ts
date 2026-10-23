import { SUPPORT_NOTICE_VERSION, SupportPrepared } from "@vela/contracts";
import { answers, members, users, weeklySupportSelections } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import {
  answerWeeklySupportPermission,
  loadWeeklySupportReport,
  prepareWeeklySupportPermission,
  reviewWeeklySupport,
  stopWeeklySupport,
} from "../src/weekly-support-live.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seed: RaceClient;
const parent = { authSubject: "synthetic|race-parent", sessionId: "p" };
const child = { authSubject: "synthetic|race-child", sessionId: "c" };
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60000);
beforeEach(async () => {
  await pg.reset();
  seed = await pg.client("seed");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});
function deps(client: RaceClient, familyId: string) {
  return {
    db: client.db,
    clock: { now: () => NOW },
    config: { enabled: true, noticeVersion: SUPPORT_NOTICE_VERSION, familyIds: [familyId] },
  };
}
async function setup() {
  const family = await seedFamily(seed.db, { now: NOW });
  for (const [identity, id] of [
    [parent, family.member.id],
    [child, family.organiser.id],
  ] as const) {
    const [u] = await seed.db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
      .returning();
    if (!u) throw new Error();
    await seed.db.update(members).set({ userId: u.id }).where(eq(members.id, id));
  }
  const d = deps(seed, family.family.id);
  const p = await prepareWeeklySupportPermission(
    d,
    parent,
    "synthetic:race:prepare",
    family.family.id,
    family.member.id,
    {},
  );
  await answerWeeklySupportPermission(
    d,
    parent,
    "synthetic:race:yes",
    family.family.id,
    family.member.id,
    { presentation_id: SupportPrepared.parse(p.response.body).id, answer: "yes" },
  );
  const exchange = await seedExchange(seed.db, family, { date: "2026-09-14" });
  await seed.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: family.member.id,
    kind: "text",
    channel: "telegram",
    payload: { text: "Could someone help sort my photos?" },
    transcriptLang: "en",
    receivedAt: NOW,
    understoodAt: NOW,
  });
  const source = (await loadWeeklySupportReport(d, child, family.family.id, family.member.id))
    .sources[0];
  if (!source) throw new Error();
  return {
    family,
    input: {
      source_id: source.id,
      source_digest: source.digest,
      kind: "practical_help",
      ordinary_confirmed: true,
      valid_until: new Date(NOW.getTime() + 86400000).toISOString(),
    },
  };
}
it("withdrawal serialises with review; no approved references survive the stop", async () => {
  const row = await setup();
  const [reviewer, stopper, holder] = await pg.clientPool("weekly-stop-review", 3);
  if (!reviewer || !stopper || !holder) throw new Error();
  const held = await pg.holdRows(holder, (tx) =>
    tx.select().from(members).where(eq(members.id, row.family.member.id)).for("share"),
  );
  const review = pg.track(
    reviewWeeklySupport(
      deps(reviewer, row.family.family.id),
      child,
      "synthetic:race:review",
      row.family.family.id,
      row.family.member.id,
      row.input,
    ),
  );
  await pg.waitForRowLockWait(reviewer, [holder], review);
  const stop = pg.track(
    stopWeeklySupport(
      deps(stopper, row.family.family.id),
      parent,
      "synthetic:race:stop",
      row.family.family.id,
      row.family.member.id,
      {},
    ),
  );
  await pg.waitForRowLockWait(stopper, [reviewer], stop);
  await held.release();
  await review;
  await stop;
  expect(await seed.db.select().from(weeklySupportSelections)).toEqual([]);
  expect(
    (
      await loadWeeklySupportReport(
        deps(seed, row.family.family.id),
        child,
        row.family.family.id,
        row.family.member.id,
      )
    ).suggestions,
  ).toEqual([]);
});
it("a stopped permission prevents a review already waiting on the author", async () => {
  const row = await setup();
  const [stopper, reviewer, holder] = await pg.clientPool("weekly-review-after-stop", 3);
  if (!reviewer || !stopper || !holder) throw new Error();
  const held = await pg.holdRows(holder, (tx) =>
    tx.select().from(members).where(eq(members.id, row.family.member.id)).for("share"),
  );
  const stop = pg.track(
    stopWeeklySupport(
      deps(stopper, row.family.family.id),
      parent,
      "synthetic:race:stop-first",
      row.family.family.id,
      row.family.member.id,
      {},
    ),
  );
  await pg.waitForRowLockWait(stopper, [holder], stop);
  const review = pg.track(
    reviewWeeklySupport(
      deps(reviewer, row.family.family.id),
      child,
      "synthetic:race:review-second",
      row.family.family.id,
      row.family.member.id,
      row.input,
    ).then(
      () => "saved",
      () => "refused",
    ),
  );
  await pg.waitForRowLockWait(reviewer, [stopper], review);
  await held.release();
  await stop;
  expect(await review).toBe("refused");
  expect(await seed.db.select().from(weeklySupportSelections)).toEqual([]);
});

it("two named reviewers cannot both claim the last of three report slots", async () => {
  const row = await setup();
  const { seedGroupMember } = await import("../src/testing/seed.ts");
  const other = await seedGroupMember(seed.db, row.family, {
    now: NOW,
    name: "Synthetic second organiser",
    externalId: "3333",
    role: "organiser",
  });
  const identity = { authSubject: "synthetic|second-reviewer", sessionId: "second" };
  const [u] = await seed.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
    .returning();
  if (!u) throw new Error();
  await seed.db.update(members).set({ userId: u.id }).where(eq(members.id, other.member.id));
  const d = deps(seed, row.family.family.id);
  const args = [row.family.family.id, row.family.member.id] as const;
  const presentation = await prepareWeeklySupportPermission(
    d,
    parent,
    "synthetic:race:expand",
    ...args,
    {},
  );
  await answerWeeklySupportPermission(d, parent, "synthetic:race:expand-yes", ...args, {
    presentation_id: SupportPrepared.parse(presentation.response.body).id,
    answer: "yes",
  });
  const [original] = await seed.db
    .select()
    .from(answers)
    .where(eq(answers.id, row.input.source_id));
  if (!original) throw new Error();
  for (let i = 0; i < 3; i++)
    await seed.db.insert(answers).values({
      exchangeId: original.exchangeId,
      memberId: row.family.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: `Please help sort photo box ${i}.` },
      transcriptLang: "en",
      receivedAt: NOW,
      understoodAt: NOW,
    });
  const sources = (await loadWeeklySupportReport(d, child, ...args)).sources;
  const choice = (s: (typeof sources)[number]) => ({
    ...row.input,
    source_id: s.id,
    source_digest: s.digest,
  });
  for (const source of sources.slice(0, 2))
    await reviewWeeklySupport(
      d,
      child,
      `synthetic:race:first:${source.id}`,
      ...args,
      choice(source),
    );
  const third = sources[2];
  const fourth = sources[3];
  if (!third || !fourth) throw new Error();
  const [first, second, holder] = await pg.clientPool("weekly-third-slot", 3);
  if (!first || !second || !holder) throw new Error();
  const held = await pg.holdRows(holder, (tx) =>
    tx.select().from(members).where(eq(members.id, row.family.member.id)).for("share"),
  );
  const a = pg.track(
    reviewWeeklySupport(
      deps(first, row.family.family.id),
      child,
      "synthetic:race:third-a",
      ...args,
      choice(third),
    ),
  );
  await pg.waitForRowLockWait(first, [holder], a);
  const b = pg.track(
    reviewWeeklySupport(
      deps(second, row.family.family.id),
      identity,
      "synthetic:race:third-b",
      ...args,
      choice(fourth),
    ).then(
      () => "saved",
      () => "refused",
    ),
  );
  await pg.waitForRowLockWait(second, [first], b);
  await held.release();
  await a;
  expect(await b).toBe("refused");
  expect(await seed.db.select().from(weeklySupportSelections)).toHaveLength(3);
});
