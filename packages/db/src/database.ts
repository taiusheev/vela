import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "./schema.ts";

export type VelaSchema = typeof schema;

/**
 * The result of `db.execute` that every supported driver satisfies: node-postgres's `QueryResult`
 * and PGlite's `Results` both carry `rows`. Declaring it keeps raw queries typed without tying
 * services to one driver.
 */
export interface VelaQueryResultHKT extends PgQueryResultHKT {
  type: QueryRows<this["row"]>;
}

export interface QueryRows<TRow> {
  rows: TRow[];
}

/**
 * A database over the Vela schema, independent of the driver: node-postgres in the Worker and in
 * scripts, PGlite in tests and local development. Services accept this type and nothing narrower.
 */
export type VelaDatabase = PgDatabase<VelaQueryResultHKT, VelaSchema>;

/** The handle passed to `db.transaction` callbacks. */
export type VelaTransaction = PgTransaction<
  VelaQueryResultHKT,
  VelaSchema,
  ExtractTablesWithRelations<VelaSchema>
>;
