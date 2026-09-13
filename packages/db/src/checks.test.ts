import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { isOneOf, literalList, quoteLiteral } from "./checks.ts";
import { outbound } from "./schema.ts";

describe("quoteLiteral", () => {
  it("doubles single quotes so a value cannot end the literal", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
    expect(quoteLiteral("'); drop table members; --")).toBe("'''); drop table members; --'");
  });
});

describe("literalList", () => {
  it("renders a parenthesised list of quoted values in tuple order", () => {
    expect(literalList(["zh-TW", "en"])).toBe("('zh-TW', 'en')");
  });

  it("refuses an empty list, which would be invalid SQL", () => {
    expect(() => literalList([])).toThrow("at least one value");
  });
});

describe("isOneOf", () => {
  it("renders the column unqualified with no bound parameters", () => {
    const query = new PgDialect().sqlToQuery(sql`${isOneOf(outbound.kind, ["ack", "flag"])}`);
    expect(query).toEqual({ sql: `"kind" in ('ack', 'flag')`, params: [] });
  });
});
