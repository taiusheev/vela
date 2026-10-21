import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the kept-quote privacy guard definition", () => {
  it("is applied by a migration and included in the readable schema", () => {
    const guards = readFileSync(
      new URL("../sql/memory-keep-guards.sql", import.meta.url),
      "utf8",
    ).trim();
    const migrations = new URL("../migrations/", import.meta.url);
    expect(
      readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .some((name) => readFileSync(new URL(name, migrations), "utf8").trim().endsWith(guards)),
    ).toBe(true);
    expect(
      readFileSync(new URL("../../../architecture/schema.sql", import.meta.url), "utf8")
        .trim()
        .endsWith(guards),
    ).toBe(true);
  });
});
