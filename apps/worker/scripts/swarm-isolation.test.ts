import { members } from "@vela/db";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { MIGRATIONS, SCHEMA } from "../swarm/migrations.generated.ts";
import * as synthetic from "../swarm/schema.generated.ts";

it("qualifies every synthetic table without changing the application's tables", () => {
  const tables = Object.values(synthetic).filter((value) => is(value, PgTable));
  expect(tables.length).toBeGreaterThan(40);
  expect(tables.every((table) => getTableConfig(table).schema === SCHEMA)).toBe(true);
  expect(getTableConfig(members).schema).toBeUndefined();
  const query = new PgDialect().sqlToQuery(sql`select 1 from ${synthetic.members}`);
  expect(query.sql).toContain(`"${SCHEMA}"."members"`);
  expect(MIGRATIONS.length).toBeGreaterThan(100);
  expect(MIGRATIONS.every((statement) => !statement.includes('"public".'))).toBe(true);
});
