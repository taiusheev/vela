// biome-ignore lint/correctness/noNodejsModules: This opt-in runner executes only in Node Vitest.
import { writeFile } from "node:fs/promises";
import { SUPPORT_NOTICE_VERSION, SupportPrepared, SupportReport } from "@vela/contracts";
import { answers, exchanges, members, users, weeklySupportSelections } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createHarness, type Harness } from "../../src/testing/harness.ts";
import { seedExchange, seedFamily, seedGroupMember } from "../../src/testing/seed.ts";
import {
  answerWeeklySupportPermission,
  loadWeeklySupportPresentation,
  loadWeeklySupportReport,
  prepareWeeklySupportPermission,
  removeWeeklySupportReview,
  reviewWeeklySupport,
  stopWeeklySupport,
  type WeeklySupportDeps,
} from "../../src/weekly-support-live.ts";
import { personas } from "./personas.ts";

const DAY = 86400000;
let h: Harness;
let sequence = 0;
const rows: Record<string, unknown>[] = [];
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
  const path = process.env.WEEKLY_PERSONA_RESULTS;
  if (!path) throw new Error("Set WEEKLY_PERSONA_RESULTS to an explicit synthetic-results path");
  await writeFile(
    path,
    `${JSON.stringify(
      {
        synthetic_only: true,
        implementation: process.env.WEEKLY_PERSONA_HEAD,
        real_people: 0,
        real_family_access: false,
        ai_provider_calls: 0,
        interpretation:
          "Expected outcomes were fixed before execution. Failed expectations remain failed; these are automated service personas, not human usability sessions.",
        count: rows.length,
        passed: rows.filter((r) => r.passed).length,
        failed: rows.filter((r) => !r.passed).length,
        results: rows,
      },
      null,
      2,
    )}\n`,
  );
});

it.each(personas)("$id $label", async (p) => {
  const start = performance.now();
  const result: Record<string, unknown> = {
    id: p.id,
    label: p.label,
    profile: p.profile.label,
    journey: p.journey,
    expected_eligible: p.journey === "content" ? p.eligible : undefined,
    synthetic_input: p.text,
    passed: false,
  };
  try {
    await h.reset();
    // Monday daytime in all three tested zones, independently of the server's timezone.
    h.clock.advance(12 * 60 * 60_000);
    const f = await seedFamily(h.db, {
      now: h.clock.now(),
      timeZone: p.profile.tz,
      familyName: `Synthetic family ${p.id}`,
      memberName: `Synthetic parent ${p.id}`,
      organiserName: `Synthetic organiser ${p.id}`,
    });
    const owner = { authSubject: `synthetic|${p.id}|parent`, sessionId: "p" };
    const child = { authSubject: `synthetic|${p.id}|child`, sessionId: "c" };
    async function account(identity: typeof owner, id: string) {
      const [u] = await h.db
        .insert(users)
        .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
        .returning();
      if (!u) throw new Error("No synthetic user");
      await h.db.update(members).set({ userId: u.id }).where(eq(members.id, id));
    }
    await account(owner, f.member.id);
    await account(child, f.organiser.id);
    const d: WeeklySupportDeps = {
      db: h.db,
      clock: h.clock,
      config: { enabled: true, noticeVersion: SUPPORT_NOTICE_VERSION, familyIds: [f.family.id] },
    };
    const key = () => `synthetic:personas:${p.id}:${++sequence}`;
    const args = [f.family.id, f.member.id] as const;
    const read = async (actor = child) =>
      SupportReport.parse(await loadWeeklySupportReport(d, actor, ...args));
    const prepare = async () =>
      SupportPrepared.parse(
        (await prepareWeeklySupportPermission(d, owner, key(), ...args, {})).response.body,
      ).id;
    const permit = async (answer: "yes" | "no" = "yes") =>
      answerWeeklySupportPermission(d, owner, key(), ...args, {
        presentation_id: await prepare(),
        answer,
      });
    let exchangeId: string | undefined;
    async function source(text: string = p.text) {
      h.clock.advance(1000);
      exchangeId ??= (await seedExchange(h.db, f, { date: "2026-09-14" })).id;
      const [a] = await h.db
        .insert(answers)
        .values({
          exchangeId,
          memberId: f.member.id,
          kind: p.profile.voice ? "voice" : "text",
          channel: "telegram",
          payload: p.profile.voice ? {} : { text },
          transcript: p.profile.voice ? text : null,
          transcriptLang: p.profile.explicitLang ? "en" : null,
          receivedAt: h.clock.now(),
          understoodAt: h.clock.now(),
        })
        .returning();
      if (!a) throw new Error("No synthetic answer");
      return a;
    }
    const choice = (s: { id: string; digest: string }, days = 1) => ({
      source_id: s.id,
      source_digest: s.digest,
      kind: "practical_help",
      ordinary_confirmed: true,
      valid_until: new Date(h.clock.now().getTime() + days * DAY).toISOString(),
    });
    async function review(days = 1) {
      const s = (await read()).sources[0];
      if (!s) throw new Error("Expected eligible fixture missing");
      const input = choice(s, days);
      await reviewWeeklySupport(d, child, key(), ...args, input);
      const own = await read(owner);
      expect(own.sources).toEqual([]);
      expect(own.can_review).toBe(false);
      expect(own.suggestions[0]?.source.quote).toBe(s.quote);
      return input;
    }
    if (p.journey === "content") {
      await permit();
      const a = await source();
      const report = await read();
      result.actual_eligible = report.sources.length === 1;
      result.actual_suggestions_before_review = report.suggestions.length;
      expect(report.suggestions).toEqual([]);
      if (report.sources[0]) {
        expect(report.sources[0].quote).toBe(p.text);
        await review();
        result.actual_reviewed_quote = (await read()).suggestions[0]?.source.quote;
        if (!p.eligible) {
          // The baseline intentionally supplies no upstream health flag. Verify separately
          // that a present marker suppresses the source AND any already reviewed selection.
          await h.db
            .update(answers)
            .set({ mentions: { health: ["synthetic-sensitive-marker"] } })
            .where(eq(answers.id, a.id));
          const flagged = await read();
          expect(flagged.sources).toEqual([]);
          expect(flagged.suggestions).toEqual([]);
          result.health_marker_control = "source and reviewed offer suppressed";
        }
      }
      expect(report.sources.length > 0, `${p.id}: desired source eligibility`).toBe(p.eligible);
    } else if (["no-permission", "declined", "before-permission"].includes(p.journey)) {
      if (p.journey === "declined") await permit("no");
      await source();
      if (p.journey === "before-permission") {
        h.clock.advance(1000);
        await permit();
      }
      expect((await read()).sources).toEqual([]);
      expect((await read()).suggestions).toEqual([]);
    } else if (p.journey === "organiser-cannot-agree") {
      await expect(
        prepareWeeklySupportPermission(d, child, key(), ...args, {}),
      ).rejects.toHaveProperty("name", "WeeklySupportForbiddenError");
      expect((await read(owner)).permission).toBe("none");
    } else if (p.journey === "stranger") {
      await permit();
      await source();
      await review();
      await expect(
        read({ authSubject: "synthetic|stranger", sessionId: "x" }),
      ).rejects.toHaveProperty("code", "not_found");
    } else if (p.journey === "new-reader") {
      await permit();
      await source();
      await review();
      const newcomer = await seedGroupMember(h.db, f, {
        now: h.clock.now(),
        name: "Synthetic newcomer",
        externalId: "8888",
        role: "organiser",
      });
      const actor = { authSubject: "synthetic|newcomer", sessionId: "n" };
      await account(actor, newcomer.member.id);
      expect((await read(actor)).suggestions).toEqual([]);
      expect((await read(actor)).sources).toEqual([]);
    } else if (p.journey === "renamed-screen" || p.journey === "expired-screen") {
      const id = await prepare();
      const presentation = await loadWeeklySupportPresentation(d, owner, ...args, id);
      expect(presentation.readers.map((r) => r.name)).toEqual([f.organiser.displayName]);
      if (p.journey === "renamed-screen")
        await h.db
          .update(members)
          .set({ displayName: "Changed synthetic name" })
          .where(eq(members.id, f.organiser.id));
      else h.clock.advance(300001);
      await expect(
        answerWeeklySupportPermission(d, owner, key(), ...args, {
          presentation_id: id,
          answer: "yes",
        }),
      ).rejects.toHaveProperty("code", "conflict");
    } else {
      if (p.journey === "week-rollover") h.clock.advance(6 * DAY);
      await permit();
      const a = await source();
      if (p.journey === "capacity") {
        for (let i = 0; i < 3; i++) await source(`Please sort photo box ${i}.`);
        const ss = (await read()).sources;
        expect(ss).toHaveLength(4);
        const first = ss[0];
        const fourth = ss[3];
        if (!first || !fourth) throw new Error("Missing capacity fixture");
        for (const s of ss.slice(0, 3))
          await reviewWeeklySupport(d, child, key(), ...args, choice(s));
        await expect(
          reviewWeeklySupport(d, child, key(), ...args, choice(fourth)),
        ).rejects.toHaveProperty("code", "conflict");
        expect((await read()).suggestions).toHaveLength(3);
        await removeWeeklySupportReview(d, owner, key(), ...args, { source_id: first.id });
        await reviewWeeklySupport(d, child, key(), ...args, choice(fourth));
        expect((await read()).suggestions).toHaveLength(3);
      } else {
        const input = await review(p.journey === "week-rollover" ? 3 : 1);
        switch (p.journey) {
          case "stop-while-off":
            d.config = { enabled: false, noticeVersion: "", familyIds: [] };
            await stopWeeklySupport(d, owner, key(), ...args, {});
            expect(await h.db.select().from(weeklySupportSelections)).toEqual([]);
            await expect(read()).rejects.toHaveProperty("code", "not_found");
            break;
          case "correction":
            await h.db
              .update(answers)
              .set(
                p.profile.voice
                  ? { transcript: "Those photos are now sorted." }
                  : { payload: { text: "Those photos are now sorted." } },
              )
              .where(eq(answers.id, a.id));
            expect((await read()).suggestions).toEqual([]);
            await expect(
              reviewWeeklySupport(d, child, key(), ...args, input),
            ).rejects.toHaveProperty("code", "conflict");
            break;
          case "withdraw-source":
            await h.db
              .update(exchanges)
              .set({ state: "withdrawn" })
              .where(eq(exchanges.id, a.exchangeId));
            expect((await read()).suggestions).toEqual([]);
            expect((await read()).sources).toEqual([]);
            break;
          case "parent-remove":
            await removeWeeklySupportReview(d, owner, key(), ...args, { source_id: a.id });
            expect((await read(owner)).suggestions).toEqual([]);
            expect((await read(owner)).permission).toBe("yes");
            break;
          case "renew-no-backfill":
            await stopWeeklySupport(d, owner, key(), ...args, {});
            h.clock.advance(1000);
            await permit();
            expect((await read()).sources).toEqual([]);
            expect((await read()).suggestions).toEqual([]);
            break;
          case "review-expiry":
            h.clock.advance(DAY + 1);
            expect((await read()).suggestions).toEqual([]);
            break;
          case "retries": {
            const k = key();
            await reviewWeeklySupport(d, child, k, ...args, input);
            expect((await reviewWeeklySupport(d, child, k, ...args, input)).replayed).toBe(true);
            expect(await h.db.select().from(weeklySupportSelections)).toHaveLength(1);
            await stopWeeklySupport(d, owner, key(), ...args, {});
            await expect(reviewWeeklySupport(d, child, k, ...args, input)).rejects.toHaveProperty(
              "name",
              "WeeklySupportForbiddenError",
            );
            break;
          }
          case "account-rebinding":
            await account({ authSubject: "synthetic|replacement", sessionId: "r" }, f.member.id);
            expect((await read()).sources).toEqual([]);
            expect((await read()).suggestions).toEqual([]);
            break;
          case "membership-revision":
            await h.db
              .update(members)
              .set({ memoryMembershipRevision: crypto.randomUUID() })
              .where(eq(members.id, f.organiser.id));
            expect((await read()).sources).toEqual([]);
            expect((await read()).suggestions).toEqual([]);
            break;
          case "week-rollover":
            h.clock.advance(DAY);
            expect((await read()).suggestions[0]?.source.id).toBe(a.id);
            break;
          case "discovery-pagination":
            for (let i = 0; i < 51; i++) await source(`The flowers in pot ${i} opened.`);
            expect((await read()).sources).toHaveLength(50);
            expect((await read()).sources.some((s) => s.id === a.id)).toBe(false);
            expect((await read()).suggestions[0]?.source.id).toBe(a.id);
            break;
        }
      }
    }
    result.passed = true;
  } catch (error) {
    result.failure =
      error instanceof Error ? error.message.slice(0, 800) : "Unknown evaluation failure";
    throw error;
  } finally {
    result.ai_calls = h.ai.calls.length;
    result.sent_messages = h.telegram.sent.length + h.line.sent.length + h.device.sent.length;
    result.duration_ms = Math.round(performance.now() - start);
    rows.push(result);
    expect(h.ai.calls).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
    expect(h.line.sent).toHaveLength(0);
    expect(h.device.sent).toHaveLength(0);
  }
});
