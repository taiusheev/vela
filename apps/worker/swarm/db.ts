/** The synthetic connection uses the alternate schema for both selects and relational queries. */
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { VelaDatabase } from "../../../packages/db/src/database.ts";
import { configureContentKey } from "../../../packages/db/src/sealed.ts";
import * as schema from "./schema.generated.ts";

export type { DatabaseConnection } from "../../../packages/db/src/connect.ts";
export type * from "../../../packages/db/src/database.ts";
export * from "../../../packages/db/src/sealed.ts";
export * from "./schema.generated.ts";

export function createSwarmDatabase(client: Client): VelaDatabase {
  // Generated from the application's exact model; only the SQL namespace differs.
  return drizzle({ client, schema }) as unknown as VelaDatabase;
}
export async function connectDatabase(connectionString: string, contentKeyV1: string) {
  configureContentKey(contentKeyV1);
  const client = new Client({ connectionString });
  client.on("error", () => console.error("synthetic_database_connection_error"));
  await client.connect();
  return {
    db: createSwarmDatabase(client),
    close: async () => {
      await client.end();
    },
  };
}
