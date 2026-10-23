import { SUPPORT_NOTICE_VERSION, SupportPrepared } from "@vela/contracts";
import {
  answers,
  exchanges,
  members,
  users,
  weeklySupportPermissions,
  weeklySupportPresentations,
  weeklySupportSelections,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyRetention } from "./jobs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";
import {
  answerWeeklySupportPermission,
  loadWeeklySupportPresentation,
  loadWeeklySupportReport,
  prepareWeeklySupportPermission,
  removeWeeklySupportReview,
  reviewWeeklySupport,
  stopWeeklySupport,
  type WeeklySupportDeps,
} from "./weekly-support-live.ts";

let h: Harness;
let family: SeededFamily;
let deps: WeeklySupportDeps;
const parent = { authSubject: "synthetic|report-parent", sessionId: "parent-session" };
const child = { authSubject: "synthetic|report-child", sessionId: "child-session" };
const stranger = { authSubject: "synthetic|stranger", sessionId: "stranger-session" };
let sequence = 0;
const key = () => `synthetic:report:${++sequence}`;
async function account(identity: typeof parent, memberId: string) {
  const [u] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
    .returning();
  if (!u) throw new Error("Missing account");
  await h.db.update(members).set({ userId: u.id }).where(eq(members.id, memberId));
}
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  family = await seedFamily(h.db, { now: h.clock.now() });
  await account(parent, family.member.id);
  await account(child, family.organiser.id);
  deps = {
    db: h.db,
    clock: h.clock,
    config: { enabled: true, noticeVersion: SUPPORT_NOTICE_VERSION, familyIds: [family.family.id] },
  };
});
const args = () => [family.family.id, family.member.id] as const;
async function prepare() {
  const r = await prepareWeeklySupportPermission(deps, parent, key(), ...args(), {});
  return SupportPrepared.parse(r.response.body).id;
}
async function permit(answer: "yes" | "no" = "yes") {
  const id = await prepare();
  return answerWeeklySupportPermission(deps, parent, key(), ...args(), {
    presentation_id: id,
    answer,
  });
}
async function source(text = "Could someone help me sort the old photos?") {
  h.clock.advance(1000);
  const exchange = await seedExchange(h.db, family, { date: "2026-09-14" });
  const [a] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: family.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text },
      transcriptLang: "en",
      receivedAt: h.clock.now(),
      understoodAt: h.clock.now(),
    })
    .returning();
  if (!a) throw new Error("Missing answer");
  return a;
}
const read = (identity = child) => loadWeeklySupportReport(deps, identity, ...args());
async function review() {
  const report = await read();
  const s = report.sources[0];
  if (!s) throw new Error("Missing eligible source");
  const input = {
    source_id: s.id,
    source_digest: s.digest,
    kind: "practical_help",
    ordinary_confirmed: true,
    valid_until: new Date(h.clock.now().getTime() + 86400000).toISOString(),
  };
  await reviewWeeklySupport(deps, child, key(), ...args(), input);
  return input;
}
describe("private-test weekly report live workflow", () => {
  it("shows exact named readers and proposed purpose before a parent agrees", async () => {
    const id = await prepare();
    const p = await loadWeeklySupportPresentation(deps, parent, ...args(), id);
    expect(p.readers).toEqual([{ id: family.organiser.id, name: "Mia" }]);
    expect(p.text).toContain("No messages are sent automatically");
    expect(p.text).toContain("after you agree");
  });
  it("loads, reviews and reads actual source words for the named child and author", async () => {
    await permit();
    await source();
    await review();
    expect((await read()).suggestions[0]?.source.quote).toContain("old photos");
    const own = await read(parent);
    expect(own.suggestions).toHaveLength(1);
    expect(own.sources).toEqual([]);
    expect(own.can_review).toBe(false);
    expect(h.ai.calls).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
  });
  it("requires fresh purpose permission; ordinary chat consent is insufficient", async () => {
    await source();
    expect((await read()).sources).toEqual([]);
    expect((await read()).permission).toBe("not_shared");
  });
  it("does not backfill messages from before permission", async () => {
    await source();
    h.clock.advance(1000);
    await permit();
    expect((await read()).sources).toEqual([]);
  });
  it("declining is available and never grants report access", async () => {
    await permit("no");
    await source();
    expect((await read(parent)).permission).toBe("no");
    expect((await read()).sources).toEqual([]);
  });
  it("forbids organiser consent on the parent's behalf", async () => {
    await expect(
      prepareWeeklySupportPermission(deps, child, key(), ...args(), {}),
    ).rejects.toHaveProperty("name", "WeeklySupportForbiddenError");
  });
  it("forbids stranger reads and cross-family writes", async () => {
    await expect(read(stranger)).rejects.toHaveProperty("code", "not_found");
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "9001",
      memberExternalId: "9002",
    });
    await expect(
      loadWeeklySupportReport(deps, child, family.family.id, other.member.id),
    ).rejects.toHaveProperty("code", "not_found");
  });
  it("does not grant reports to a newly added organiser", async () => {
    await permit();
    await source();
    await review();
    const other = await seedGroupMember(h.db, family, {
      now: h.clock.now(),
      name: "New organiser",
      externalId: "8888",
      role: "organiser",
    });
    const id = { authSubject: "synthetic|new-organiser", sessionId: "new-session" };
    await account(id, other.member.id);
    expect((await read(id)).permission).toBe("not_shared");
    expect((await read(id)).suggestions).toEqual([]);
  });
  it("invalidates a stale consent screen when named readers change", async () => {
    const id = await prepare();
    await seedGroupMember(h.db, family, {
      now: h.clock.now(),
      name: "Another organiser",
      externalId: "8888",
      role: "organiser",
    });
    await expect(
      answerWeeklySupportPermission(deps, parent, key(), ...args(), {
        presentation_id: id,
        answer: "yes",
      }),
    ).rejects.toHaveProperty("code", "conflict");
  });
  it("invalidates the consent screen when a shown name changes", async () => {
    const id = await prepare();
    await h.db
      .update(members)
      .set({ displayName: "Changed name" })
      .where(eq(members.id, family.organiser.id));
    await expect(
      answerWeeklySupportPermission(deps, parent, key(), ...args(), {
        presentation_id: id,
        answer: "yes",
      }),
    ).rejects.toHaveProperty("code", "conflict");
  });
  it("expires permission presentations after five minutes", async () => {
    const id = await prepare();
    h.clock.advance(300001);
    await expect(
      answerWeeklySupportPermission(deps, parent, key(), ...args(), {
        presentation_id: id,
        answer: "yes",
      }),
    ).rejects.toHaveProperty("code", "conflict");
  });
  it("a stop invalidates every old permission screen", async () => {
    const id = await prepare();
    await stopWeeklySupport(deps, parent, key(), ...args(), {});
    await expect(
      answerWeeklySupportPermission(deps, parent, key(), ...args(), {
        presentation_id: id,
        answer: "yes",
      }),
    ).rejects.toHaveProperty("code", "conflict");
  });
  it("stops while feature, notice or roster is off and clears review references", async () => {
    await permit();
    await source();
    await review();
    deps.config = { enabled: false, noticeVersion: "", familyIds: [] };
    await stopWeeklySupport(deps, parent, key(), ...args(), {});
    expect(await h.db.select().from(weeklySupportSelections)).toEqual([]);
    expect(await h.db.select().from(weeklySupportPresentations)).toEqual([]);
    expect((await h.db.select().from(weeklySupportPermissions))[0]?.state).toBe("withdrawn");
  });
  it.each(["enabled", "notice", "roster"])("fails closed when %s is missing", async (gate) => {
    if (gate === "enabled") deps.config.enabled = false;
    if (gate === "notice") deps.config.noticeVersion = "old";
    if (gate === "roster") deps.config.familyIds = [];
    await expect(read()).rejects.toHaveProperty("code", "not_found");
  });
  it("permission and review retries do not duplicate writes or persist quotations in receipts", async () => {
    const id = await prepare();
    const k = key();
    const body = { presentation_id: id, answer: "yes" };
    await answerWeeklySupportPermission(deps, parent, k, ...args(), body);
    expect((await answerWeeklySupportPermission(deps, parent, k, ...args(), body)).replayed).toBe(
      true,
    );
    await source();
    const input = await review();
    const k2 = key();
    await reviewWeeklySupport(deps, child, k2, ...args(), input);
    expect((await reviewWeeklySupport(deps, child, k2, ...args(), input)).replayed).toBe(true);
    expect(await h.db.select().from(weeklySupportSelections)).toHaveLength(1);
    expect(JSON.stringify(await h.db.select().from(weeklySupportSelections))).not.toContain(
      "old photos",
    );
  });
  it("does not permit a replay to reopen a stopped report", async () => {
    await permit();
    await source();
    const input = await review();
    await stopWeeklySupport(deps, parent, key(), ...args(), {});
    await expect(reviewWeeklySupport(deps, child, key(), ...args(), input)).rejects.toHaveProperty(
      "name",
      "WeeklySupportForbiddenError",
    );
    expect((await read(parent)).suggestions).toEqual([]);
  });
  it.each([
    "My medicine changed.",
    "The flowers opened. My knee hurts.",
    "最近很孤單。",
    "My debt is growing.",
  ])("excludes a sensitive whole source: %s", async (text) => {
    await permit();
    await source(text);
    expect((await read()).sources).toEqual([]);
  });
  it.each(["flag", "health", "unknown", "expired"])(
    "excludes sources with %s markers",
    async (marker) => {
      await permit();
      const a = await source();
      await h.db
        .update(answers)
        .set(
          marker === "flag"
            ? { flag: true }
            : marker === "health"
              ? { mentions: { health: ["pain"] } }
              : marker === "unknown"
                ? { understoodAt: null }
                : { wordsExpiredAt: h.clock.now() },
        )
        .where(eq(answers.id, a.id));
      expect((await read()).sources).toEqual([]);
    },
  );
  it("correction invalidates an approved quote and an old review submission", async () => {
    await permit();
    const a = await source();
    const input = await review();
    await h.db
      .update(answers)
      .set({ payload: { text: "I have already sorted those photos." } })
      .where(eq(answers.id, a.id));
    expect((await read()).suggestions).toEqual([]);
    await expect(reviewWeeklySupport(deps, child, key(), ...args(), input)).rejects.toHaveProperty(
      "code",
      "conflict",
    );
  });
  it("source removal, exchange withdrawal and membership revocation remove suggestions", async () => {
    await permit();
    const a = await source();
    await review();
    await h.db.update(exchanges).set({ state: "withdrawn" }).where(eq(exchanges.id, a.exchangeId));
    expect((await read()).suggestions).toEqual([]);
    await h.db.delete(answers).where(eq(answers.id, a.id));
    expect(await h.db.select().from(weeklySupportSelections)).toEqual([]);
  });
  it("leaving/rejoining does not resurrect a reader's prior access", async () => {
    await permit();
    await source();
    await review();
    await h.db
      .update(members)
      .set({ memoryMembershipRevision: crypto.randomUUID() })
      .where(eq(members.id, family.organiser.id));
    expect((await read()).suggestions).toEqual([]);
  });
  it("review requires a deliberate ordinary-content confirmation and a relevance deadline", async () => {
    await permit();
    await source();
    const input = await review();
    await expect(
      reviewWeeklySupport(deps, child, key(), ...args(), { ...input, ordinary_confirmed: false }),
    ).rejects.toHaveProperty("code", "invalid");
    await expect(
      reviewWeeklySupport(deps, child, key(), ...args(), {
        ...input,
        valid_until: new Date(h.clock.now().getTime() + 8 * 86400000).toISOString(),
      }),
    ).rejects.toHaveProperty("code", "conflict");
  });
  it("does not invent suggestions for sparse weeks and removes expired reviews", async () => {
    await permit();
    expect((await read()).suggestions).toEqual([]);
    await source();
    await review();
    h.clock.advance(86400001);
    expect((await read()).suggestions).toEqual([]);
    await applyRetention(h.deps);
    expect(await h.db.select().from(weeklySupportSelections)).toEqual([]);
    expect(await h.db.select().from(weeklySupportPresentations)).toEqual([]);
  });
  it("parent can remove a contribution without ending chat or the report permission", async () => {
    await permit();
    const a = await source();
    await review();
    await removeWeeklySupportReview(deps, parent, key(), ...args(), { source_id: a.id });
    expect((await read(parent)).suggestions).toEqual([]);
    expect((await read(parent)).permission).toBe("yes");
  });
});

it("requires fresh permission after the parent's account binding changes", async () => {
  await permit();
  await source();
  await review();
  const replacement = { authSubject: "synthetic|replacement-parent", sessionId: "replacement" };
  await account(replacement, family.member.id);
  expect((await read()).permission).toBe("not_shared");
  expect((await read(replacement)).permission).toBe("none");
});
it("hides reports when the author's account is deleted before membership cleanup", async () => {
  await permit();
  await source();
  await review();
  await h.db
    .update(users)
    .set({ deletedAt: h.clock.now() })
    .where(eq(users.authSubject, parent.authSubject));
  expect((await read()).sources).toEqual([]);
  expect((await read()).suggestions).toEqual([]);
});
it("caps reviewed offers at three and frees a slot after removing one", async () => {
  await permit();
  const a = await source();
  for (let i = 0; i < 3; i++)
    await h.db.insert(answers).values({
      exchangeId: a.exchangeId,
      memberId: family.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: `Please help sort photo box ${i}.` },
      transcriptLang: "en",
      receivedAt: h.clock.now(),
      understoodAt: h.clock.now(),
    });
  const rows = (await read()).sources;
  const choice = (s: (typeof rows)[number]) => ({
    source_id: s.id,
    source_digest: s.digest,
    kind: "practical_help",
    ordinary_confirmed: true,
    valid_until: new Date(h.clock.now().getTime() + 86400000).toISOString(),
  });
  for (const s of rows.slice(0, 3))
    await reviewWeeklySupport(deps, child, key(), ...args(), choice(s));
  const fourth = rows[3];
  const first = rows[0];
  if (!fourth || !first) throw new Error("Missing sources");
  await expect(
    reviewWeeklySupport(deps, child, key(), ...args(), choice(fourth)),
  ).rejects.toHaveProperty("code", "conflict");
  await removeWeeklySupportReview(deps, parent, key(), ...args(), { source_id: first.id });
  await reviewWeeklySupport(deps, child, key(), ...args(), choice(fourth));
  expect((await read()).suggestions).toHaveLength(3);
});
it("pins reviewer/template evidence and uses the parent's local source date", async () => {
  await permit();
  await source();
  await review();
  const item = (await read()).suggestions[0];
  expect(item?.reviewed_by).toBe("Mia");
  expect(item?.template_version).toBe("weekly.support.templates@1");
  expect(item?.source.occurred_on).toBe("2026-09-14");
});
it("a renewed yes never revives earlier report contributions", async () => {
  await permit();
  await source();
  await review();
  await stopWeeklySupport(deps, parent, key(), ...args(), {});
  h.clock.advance(1000);
  await permit();
  expect((await read()).sources).toEqual([]);
  expect((await read()).suggestions).toEqual([]);
});
it("lets the author withdraw after daily-light consent ends or they leave the family", async () => {
  await permit();
  await source();
  await review();
  await h.db
    .update(members)
    .set({ status: "left", lightOn: false, leftAt: h.clock.now(), lightConsentedAt: null })
    .where(eq(members.id, family.member.id));
  await stopWeeklySupport(deps, parent, key(), ...args(), {});
  expect(await h.db.select().from(weeklySupportSelections)).toEqual([]);
  expect((await h.db.select().from(weeklySupportPermissions))[0]?.state).toBe("withdrawn");
});
it("never lets an organiser stop the parent's report on their behalf", async () => {
  await permit();
  await expect(stopWeeklySupport(deps, child, key(), ...args(), {})).rejects.toHaveProperty(
    "code",
    "not_found",
  );
  expect((await read(parent)).permission).toBe("yes");
});

it("encrypts audience names and source fingerprints instead of storing report words", async () => {
  await permit();
  await source();
  await review();
  const raw = await h.db.execute<{ audience: string }>(
    sql`select audience::text as audience from weekly_support_permissions`,
  );
  expect(raw.rows[0]?.audience).not.toContain("Mia");
  expect(raw.rows[0]?.audience).toContain("v1.");
  const selected = await h.db.execute<{ digest: string }>(
    sql`select source_digest as digest from weekly_support_selections`,
  );
  expect(selected.rows[0]?.digest).toMatch(/^v1\./);
  expect(JSON.stringify(await h.db.select().from(weeklySupportSelections))).not.toContain(
    "old photos",
  );
});

it("does not treat unsupported text scripts as English just because the profile uses English", async () => {
  await permit();
  const a = await source("У меня болит колено.");
  await h.db.update(answers).set({ transcriptLang: null }).where(eq(answers.id, a.id));
  expect((await read()).sources).toEqual([]);
});
it("still supports ordinary typed messages without a voice-language field", async () => {
  await permit();
  const a = await source();
  await h.db.update(answers).set({ transcriptLang: null }).where(eq(answers.id, a.id));
  expect((await read()).sources).toHaveLength(1);
});

it("screens compatibility-width health words without changing the original source", async () => {
  await permit();
  await source("Ｍｙ ｍｅｄｉｃｉｎｅ ｃｈａｎｇｅｄ.");
  expect((await read()).sources).toEqual([]);
});

it("keeps a Sunday-reviewed offer visible on Monday until its relevance deadline", async () => {
  h.clock.advance(6 * 86400000);
  await permit();
  await source();
  await review();
  h.clock.advance(20 * 60 * 60_000);
  const report = await read();
  expect(report.week_start).toBe("2026-09-21");
  expect(report.suggestions).toHaveLength(1);
});
it("does not lose an approved source when newer messages move it off the review list", async () => {
  await permit();
  const original = await source();
  await review();
  h.clock.advance(1000);
  await h.db.insert(answers).values(
    Array.from({ length: 55 }, (_, i) => ({
      exchangeId: original.exchangeId,
      memberId: family.member.id,
      kind: "text" as const,
      channel: "telegram" as const,
      payload: { text: `The flowers in pot ${i} opened.` },
      receivedAt: h.clock.now(),
      understoodAt: h.clock.now(),
    })),
  );
  const report = await read();
  expect(report.sources).toHaveLength(50);
  expect(report.sources.some((s) => s.id === original.id)).toBe(false);
  expect(report.suggestions[0]?.source.id).toBe(original.id);
});

it("cannot turn an invalidated old review into a fourth active offer", async () => {
  await permit();
  const original = await source();
  await review();
  await h.db
    .update(answers)
    .set({ payload: { text: "I have another box of photos to sort." } })
    .where(eq(answers.id, original.id));
  h.clock.advance(1000);
  await h.db.insert(answers).values(
    Array.from({ length: 3 }, (_, i) => ({
      exchangeId: original.exchangeId,
      memberId: family.member.id,
      kind: "text" as const,
      channel: "telegram" as const,
      payload: { text: `The flowers in pot ${i} opened.` },
      receivedAt: h.clock.now(),
      understoodAt: h.clock.now(),
    })),
  );
  const rows = (await read()).sources;
  const choice = (s: (typeof rows)[number]) => ({
    source_id: s.id,
    source_digest: s.digest,
    kind: "shared_interest",
    ordinary_confirmed: true,
    valid_until: new Date(h.clock.now().getTime() + 86400000).toISOString(),
  });
  for (const row of rows.filter((s) => s.id !== original.id))
    await reviewWeeklySupport(deps, child, key(), ...args(), choice(row));
  const corrected = rows.find((s) => s.id === original.id);
  if (!corrected) throw new Error("Missing corrected source");
  await expect(
    reviewWeeklySupport(deps, child, key(), ...args(), choice(corrected)),
  ).rejects.toHaveProperty("code", "conflict");
  expect((await read()).suggestions).toHaveLength(3);
});
