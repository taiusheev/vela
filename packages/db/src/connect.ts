import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { VelaDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { configureContentKey } from "./sealed.ts";

export interface DatabaseConnection {
  readonly db: VelaDatabase;
  close(): Promise<void>;
}

/**
 * One node-postgres client rather than a pool: in the Worker, Hyperdrive pools connections, and a
 * script needs only one.
 */
export async function connectDatabase(
  connectionString: string,
  contentKeyV1: string,
): Promise<DatabaseConnection> {
  configureContentKey(contentKeyV1);
  const client = new Client({ connectionString });
  // node-postgres emits `error` when the server drops a connected client, even an idle one, and an
  // unhandled `error` event crashes a Node process. Queries running at that moment already reject
  // with the same error and later ones reject as not queryable. Provider diagnostics can contain
  // connection details, so the idle listener records only a stable, content-free event.
  client.on("error", () => {
    console.error("database_connection_error");
  });
  await client.connect();
  const db = drizzle({ client, schema });
  return {
    db,
    close: async () => {
      await client.end();
    },
  };
}
