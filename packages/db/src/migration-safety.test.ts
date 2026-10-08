/**
 * Migration safety (technical plan 8.2). A release migrates the database first and deploys the
 * Workers after (deploy.yml), so for a few minutes the old Workers run against the new schema, and
 * a rollback runs old code against it for longer. Every migration must therefore be safe for the
 * code before it: expand first (add), switch the code, and contract (drop, rename, retype) only in
 * a later release, once nothing reads the old shape.
 *
 * So a migration after the baseline may not drop, rename or retype a table or column unless it says
 * why on a `-- contract: <reason>` line, and may not add a required column without a default, or
 * make one required, unless it says why on a `-- reviewed: <reason>` line (an empty table, say).
 * Migrations up to the baseline shipped before this rule and are not re-judged.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The last migration written before this rule (8 October 2026). */
const BASELINE = 12;

const CONTRACT = [
  { name: "drops a table", pattern: /\bdrop\s+table\b/i },
  { name: "drops a column", pattern: /\bdrop\s+column\b/i },
  { name: "renames a column", pattern: /\brename\s+column\b/i },
  { name: "renames a table", pattern: /\balter\s+table\s+\S+\s+rename\s+to\b/i },
  {
    name: "changes a column's type",
    pattern: /\balter\s+column\s+\S+\s+(?:set\s+data\s+)?type\b/i,
  },
] as const;

const REVIEWED = [
  {
    name: "adds a required column without a default",
    test: (statement: string) =>
      /\badd\s+column\b/i.test(statement) &&
      /\bnot\s+null\b/i.test(statement) &&
      !/\bdefault\b/i.test(statement),
  },
  {
    name: "makes a column required",
    test: (statement: string) => /\bset\s+not\s+null\b/i.test(statement),
  },
] as const;

/** What a migration's SQL does that needs a stated reason, or nothing. */
function migrationRisks(sql: string): string[] {
  const statements = sql
    .split(/-->\s*statement-breakpoint|;\s*\n/)
    .map((statement) => statement.replace(/--[^\n]*/g, "").trim())
    .filter((statement) => statement !== "");
  const contractReason = /^--\s*contract:\s*\S/im.test(sql);
  const reviewedReason = /^--\s*reviewed:\s*\S/im.test(sql);
  const risks: string[] = [];
  for (const statement of statements) {
    for (const rule of CONTRACT) {
      if (rule.pattern.test(statement) && !contractReason) risks.push(rule.name);
    }
    for (const rule of REVIEWED) {
      if (rule.test(statement) && !reviewedReason) risks.push(rule.name);
    }
  }
  return [...new Set(risks)];
}

const MIGRATIONS = new URL("../migrations/", import.meta.url);

function migrationsAfterBaseline(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) > BASELINE)
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

describe("migration safety", () => {
  it.each(migrationsAfterBaseline().map((m) => [m.file, m.sql] as const))(
    "%s is safe for the code released before it, or says why",
    (_file, sql) => {
      expect(migrationRisks(sql)).toEqual([]);
    },
  );

  it("finds every unsafe step in one release", () => {
    expect(migrationRisks('ALTER TABLE "a" DROP COLUMN "b";')).toEqual(["drops a column"]);
    expect(migrationRisks('DROP TABLE "a";')).toEqual(["drops a table"]);
    expect(migrationRisks('ALTER TABLE "a" RENAME COLUMN "b" TO "c";')).toEqual([
      "renames a column",
    ]);
    expect(migrationRisks('ALTER TABLE "a" RENAME TO "b";')).toEqual(["renames a table"]);
    expect(migrationRisks('ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;')).toEqual([
      "changes a column's type",
    ]);
    expect(migrationRisks('ALTER TABLE "a" ADD COLUMN "b" text NOT NULL;')).toEqual([
      "adds a required column without a default",
    ]);
    expect(migrationRisks('ALTER TABLE "a" ALTER COLUMN "b" SET NOT NULL;')).toEqual([
      "makes a column required",
    ]);
  });

  it("allows expanding, and contracting or tightening with a stated reason", () => {
    expect(migrationRisks('CREATE TABLE "a" ("b" text NOT NULL);')).toEqual([]);
    expect(migrationRisks('ALTER TABLE "a" ADD COLUMN "b" text;')).toEqual([]);
    expect(migrationRisks('ALTER TABLE "a" ADD COLUMN "b" text DEFAULT \'x\' NOT NULL;')).toEqual(
      [],
    );
    expect(
      migrationRisks('-- contract: v0.3 stopped reading "b"\nALTER TABLE "a" DROP COLUMN "b";'),
    ).toEqual([]);
    expect(
      migrationRisks(
        '-- reviewed: "a" is empty everywhere\nALTER TABLE "a" ADD COLUMN "b" text NOT NULL;',
      ),
    ).toEqual([]);
    // A reason of one kind does not cover the other.
    expect(migrationRisks('-- reviewed: empty\nALTER TABLE "a" DROP COLUMN "b";')).toEqual([
      "drops a column",
    ]);
  });

  it("judges the migrations shipped before the rule as they were", () => {
    const shipped = readdirSync(MIGRATIONS).filter((file) => /^\d{4}_.+\.sql$/.test(file));
    expect(shipped.filter((file) => Number(file.slice(0, 4)) <= BASELINE)).toHaveLength(
      BASELINE + 1,
    );
  });
});
