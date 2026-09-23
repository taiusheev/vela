import { SUBSCRIPTION_STATUSES as CONTRACT_SUBSCRIPTION_STATUSES } from "@vela/contracts";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { isOneOf, literalList, quoteLiteral } from "./checks.ts";
import { outbound, SUBSCRIPTION_STATUSES, subscriptions } from "./schema.ts";

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
  it("keeps the subscription CHECK unchanged while sharing its values with the API", () => {
    expect(SUBSCRIPTION_STATUSES).toBe(CONTRACT_SUBSCRIPTION_STATUSES);
    const query = new PgDialect().sqlToQuery(
      sql`${isOneOf(subscriptions.status, SUBSCRIPTION_STATUSES)}`,
    );
    expect(query).toEqual({
      sql: `"status" in ('trial', 'active', 'grace', 'lapsed', 'cancelled')`,
      params: [],
    });
  });

  it("renders the column unqualified with no bound parameters", () => {
    const query = new PgDialect().sqlToQuery(sql`${isOneOf(outbound.kind, ["ack", "flag"])}`);
    expect(query).toEqual({ sql: `"kind" in ('ack', 'flag')`, params: [] });
  });
});
