import { readFileSync } from "node:fs";
import { awayPeriods, members } from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

/**
 * Until the admin page runs in production, the founder changes the pilot's data with the statements
 * in `infra/runbooks/data-requests.md`. These tests run a section's statements as the founder
 * would, with its placeholders filled in, against the real migrations: a statement that no longer
 * does what its section says, or what the admin action it stands in for does, fails here.
 */
const RUNBOOK = readFileSync(
  new URL("../../../infra/runbooks/data-requests.md", import.meta.url),
  "utf8",
);

/** The `sql` blocks of one lettered section ("E" for "## E. …"), in order. */
function sqlBlocksOf(section: string): string[] {
  const start = RUNBOOK.indexOf(`\n## ${section}. `);
  if (start === -1) {
    throw new Error(`no section ${section} in the runbook`);
  }
  const end = RUNBOOK.indexOf("\n## ", start + 1);
  const text = RUNBOOK.slice(start, end === -1 ? undefined : end);
  return [...text.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
}

function blockWith(section: string, words: string): string {
  const block = sqlBlocksOf(section).find((candidate) => candidate.includes(words));
  if (block === undefined) {
    throw new Error(`no statement with "${words}" in section ${section}`);
  }
  return block;
}

/** Runs a block's statements one by one, as pasted into a SQL console, and returns the last rows. */
async function run(
  h: Harness,
  block: string,
  values: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>[]> {
  let filled = block;
  for (const [placeholder, value] of Object.entries(values)) {
    filled = filled.replaceAll(`'<${placeholder}>'`, `'${value}'`);
  }
  const unfilled = filled.match(/'<[^>]+>'/);
  if (unfilled !== null) {
    throw new Error(`placeholder ${unfilled[0]} left unfilled`);
  }
  let rows: Record<string, unknown>[] = [];
  for (const statement of filled.split(/;\s*$/m)) {
    if (statement.trim().length > 0) {
      rows = (await h.db.execute(sql.raw(statement))).rows as Record<string, unknown>[];
    }
  }
  return rows;
}

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

describe("section E, ending an away early", () => {
  // Flows §3.9 step 4: her own "until I'm back", set by message (source `answer`), stays open on a
  // same-day "home now", and the founder ends it by hand with these statements, as `end_away` ends
  // any period. Until 26 September 2026 they ended only a period an organiser asked for, so hers
  // stayed open while the founder believed it ended, and a silent next morning told nobody.
  /** Her own "until I'm back" from today, set by message, and a trip her organiser set for October. */
  async function twoPeriods() {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const her = seed.member.id;
    const [own] = await h.db
      .insert(awayPeriods)
      .values({
        memberId: her,
        fromDate: "2026-09-14",
        toDate: null,
        source: "answer",
        createdAt: h.clock.now(),
      })
      .returning();
    const [ahead] = await h.db
      .insert(awayPeriods)
      .values({
        memberId: her,
        fromDate: "2026-10-10",
        toDate: "2026-10-15",
        source: "organiser",
        setBy: seed.organiser.id,
        createdAt: h.clock.now(),
      })
      .returning();
    if (own === undefined || ahead === undefined) {
      throw new Error("away periods not stored");
    }
    await h.db.update(members).set({ nextWakeAt: h.clock.now() }).where(eq(members.id, her));
    return { her, own, ahead };
  }

  it("lists her open periods with the id the ending takes, the one she set by message among them", async () => {
    const { her, own, ahead } = await twoPeriods();

    const open = await run(h, blockWith("E", "SELECT id"), { "kept-light member id": her });

    expect(open.map((row) => [row.id, row.source])).toEqual([
      [own.id, "answer"],
      [ahead.id, "organiser"],
    ]);
  });

  it("ends an away she set herself by message, by its id, and has her schedule planned again", async () => {
    const { her, own } = await twoPeriods();

    await run(h, blockWith("E", "SET ended_at"), {
      "kept-light member id": her,
      "away period id": own.id,
    });

    const periods = await h.db.select().from(awayPeriods).orderBy(awayPeriods.fromDate);
    expect(periods.map((period) => [period.source, period.endedAt === null])).toEqual([
      ["answer", false],
      // A trip still ahead is not the one she is back from.
      ["organiser", true],
    ]);
    const [member] = await h.db.select().from(members).where(eq(members.id, her));
    expect(member?.nextWakeAt).toBeNull();
  });

  it("ends nothing of another member's when the id is not hers", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const [theirs] = await h.db
      .insert(awayPeriods)
      .values({
        memberId: other.member.id,
        fromDate: "2026-09-14",
        toDate: null,
        source: "answer",
        createdAt: h.clock.now(),
      })
      .returning();

    await run(h, blockWith("E", "SET ended_at"), {
      "kept-light member id": seed.member.id,
      "away period id": theirs?.id ?? "",
    });

    const [period] = await h.db.select().from(awayPeriods);
    expect(period?.endedAt).toBeNull();
  });
});
