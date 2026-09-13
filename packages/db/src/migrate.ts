/**
 * Applies the migrations in ../migrations to the database at DATABASE_URL.
 * Usage: DATABASE_URL=postgres://… node src/migrate.ts
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL is not set. Set it to the Postgres connection string to migrate.");
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const client = new Client({ connectionString });
await client.connect();
try {
  await migrate(drizzle({ client }), { migrationsFolder });
  console.log(`Migrations from ${migrationsFolder} applied.`);
} finally {
  await client.end();
}
