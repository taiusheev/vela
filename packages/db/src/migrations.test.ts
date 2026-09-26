/**
 * Upgrades that start from a database already in use, rather than from an empty one. Until 0003,
 * nothing but the local dev seed (`apps/worker/scripts/seed-dev-family.ts`) wrote `suggestions`, and
 * a row it wrote has no day and no bank item for the columns 0003 adds as NOT NULL.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { families, members } from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

/** A copy of the migrations up to and including `lastTag`, as a database last migrated then has. */
function migrationsUpTo(lastTag: string): string {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (last === -1) {
    throw new Error(`no migration ${lastTag}`);
  }
  const entries = journal.entries.slice(0, last + 1);
  const folder = mkdtempSync(join(tmpdir(), "vela-migrations-"));
  mkdirSync(join(folder, "meta"));
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe("0003_suggestion_days", () => {
  it("upgrades a laptop database the old dev seed wrote a suggestion to, and clears that row", async () => {
    const earlier = migrationsUpTo("0002_account_linking");
    const client = new PGlite();
    cleanups.push(() => rmSync(earlier, { recursive: true, force: true }));
    cleanups.push(() => client.close());
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: earlier });

    const [family] = await db
      .insert(families)
      .values({ name: "Your family", region: "apac", country: "TW" })
      .returning();
    if (family === undefined) throw new Error("expected a family");
    const [organiser, mom] = await db
      .insert(members)
      .values([
        {
          familyId: family.id,
          role: "organiser",
          displayName: "You",
          tz: "Asia/Taipei",
          country: "TW",
          status: "active",
        },
        {
          familyId: family.id,
          displayName: "Mom",
          tz: "Asia/Taipei",
          country: "TW",
          status: "active",
          lightOn: true,
        },
      ])
      .returning();
    if (organiser === undefined || mom === undefined) throw new Error("expected two members");
    // The row the dev seed wrote before 0003 (`git show 2508aa1:apps/worker/scripts/seed-dev-family.ts`),
    // in the table's shape at 0002: a type no CHECK held to, and a turn holder.
    await db.execute(
      sql`insert into suggestions (family_id, for_member_id, about_member_id, type, text, prompt_version)
          values (${family.id}, ${organiser.id}, ${mom.id}, 'mention',
                  'Ask her about the seeds she saved from last year', 'dev-seed@1')`,
    );

    await migrate(db, { migrationsFolder });

    const suggestionRows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from suggestions`,
    );
    expect(suggestionRows.rows).toEqual([{ n: 0 }]);
    const memberRows = await db.execute<{ n: number }>(sql`select count(*)::int as n from members`);
    expect(memberRows.rows).toEqual([{ n: 2 }]);
    const applied = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: JournalEntry[] };
    expect(applied.rows).toEqual([{ n: journal.entries.length }]);
    await db.execute(
      sql`insert into suggestions (family_id, about_member_id, local_day, bank_id, type, text, prompt_version)
          values (${family.id}, ${mom.id}, '2026-09-27', 'life.childhood.home', 'question', '', 'bank.v1')`,
    );
  });
});
