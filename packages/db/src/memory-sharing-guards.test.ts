import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("named-memory sharing guard definitions", () => {
  it("keeps migration and generated schema aligned with reviewed SQL", () => {
    const guards = readFileSync(
      new URL("../sql/memory-sharing-guards.sql", import.meta.url),
      "utf8",
    ).trim();
    expect(
      readFileSync(
        new URL("../migrations/0023_memory_sharing_permissions.sql", import.meta.url),
        "utf8",
      )
        .trim()
        .endsWith(guards),
    ).toBe(true);
    expect(
      readFileSync(new URL("../../../architecture/schema.sql", import.meta.url), "utf8")
        .trim()
        .endsWith(guards),
    ).toBe(true);
  });
});
