import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { VelaDatabase } from "./database.ts";
import * as schema from "./schema.ts";

export interface DatabaseConnection {
  readonly db: VelaDatabase;
  close(): Promise<void>;
}

/**
 * One node-postgres client rather than a pool: in the Worker, Hyperdrive pools connections, and a
 * script needs only one.
 */
export async function connectDatabase(connectionString: string): Promise<DatabaseConnection> {
  const client = new Client({ connectionString });
  await client.connect();
  const db = drizzle({ client, schema });
  return {
    db,
    close: async () => {
      await client.end();
    },
  };
}
