/**
 * An in-memory Postgres 18 (PGlite) with the real migrations applied, so tests exercise the same
 * constraints production relies on rather than a hand-maintained imitation of them.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { VelaDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { configureContentKey } from "./sealed.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
/** Fixed key for ephemeral tests only; never use it for a local or deployed application database. */
export const TEST_CONTENT_KEY_V1 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export interface TestDatabase {
  readonly db: VelaDatabase;
  /** Empties every application table and restarts identity sequences. Migrations stay applied. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  configureContentKey(TEST_CONTENT_KEY_V1);
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });

  const tableNames = Object.values<unknown>(schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => `"${getTableName(table)}"`);
  const truncate = sql.raw(`truncate table ${tableNames.join(", ")} restart identity cascade`);

  return {
    db,
    reset: async () => {
      await db.execute(truncate);
    },
    close: async () => {
      await client.close();
    },
  };
}
