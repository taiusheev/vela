import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("question profile privacy guards", () => {
  it("applies the reviewed guard SQL unchanged in the migration and schema export", () => {
    const guards = readFileSync(
      new URL("../sql/question-profile-guards.sql", import.meta.url),
      "utf8",
    ).trim();
    const migration = readFileSync(
      new URL("../migrations/0032_question_profiles.sql", import.meta.url),
      "utf8",
    ).trim();
    const schema = readFileSync(
      new URL("../../../architecture/schema.sql", import.meta.url),
      "utf8",
    ).trim();
    expect(migration.endsWith(guards)).toBe(true);
    expect(schema.endsWith(guards)).toBe(true);
  });
});
