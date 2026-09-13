/**
 * A persistent local Postgres 18 for `wrangler dev`: PGlite stored in packages/db/.pglite/dev,
 * migrated on start, and served over the Postgres wire protocol so Hyperdrive's local connection
 * string and ordinary Postgres tools can reach it.
 * Usage: pnpm --filter @vela/db dev-db   (Ctrl+C to stop)
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const host = "127.0.0.1";
const port = 54320;
const dataDir = fileURLToPath(new URL("../.pglite/dev", import.meta.url));
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

mkdirSync(dataDir, { recursive: true });
const client = await PGlite.create(dataDir);
await migrate(drizzle({ client }), { migrationsFolder });

// PGlite runs one query at a time; the server queues statements from several connections, which
// wrangler and a SQL client need at the same time.
const server = new PGLiteSocketServer({ db: client, host, port, maxConnections: 10 });
await server.start();

console.log(`Local database ready (data in ${dataDir}).`);
console.log(`DATABASE_URL=postgresql://postgres:postgres@${host}:${port}/postgres`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  await server.stop();
  // A clean close shuts Postgres down properly, so the next start needs no crash recovery.
  await client.close();
  console.log("Local database stopped.");
}

process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
