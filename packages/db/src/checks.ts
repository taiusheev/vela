/**
 * SQL fragments for CHECK constraints and partial-index predicates built from const tuples. The
 * allowed values live in @vela/contracts, so a value added to a tuple reaches the database as a
 * generated migration instead of a hand-edited list that can drift from the code.
 */
import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** A Postgres string literal. Standard-conforming strings are the default, so only quotes need doubling. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** A parenthesised, quoted, escaped list for `IN`. An empty list would be a syntax error, so it throws. */
export function literalList(values: readonly string[]): string {
  if (values.length === 0) {
    throw new Error("an IN list needs at least one value");
  }
  return `(${values.map(quoteLiteral).join(", ")})`;
}

/**
 * `"column" in ('a', 'b')`. The column is rendered unqualified so the same fragment is valid in a
 * CREATE TABLE check and in a CREATE INDEX predicate, and reads cleanly in the exported schema.
 */
export function isOneOf(column: PgColumn, values: readonly string[]): SQL {
  return sql`${sql.identifier(column.name)} in ${sql.raw(literalList(values))}`;
}
