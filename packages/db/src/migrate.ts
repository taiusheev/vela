/**
 * Applies the migrations in ../migrations to the database at DATABASE_URL.
 * The caller supplies DATABASE_URL through its private process environment.
 * Remote runs also require VELA_DATABASE_ENVIRONMENT=staging or production.
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { validatedMutationConnectionString } from "./mutation-target.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL is not set. Set it to the Postgres connection string to migrate.");
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const validatedConnectionString = validatedMutationConnectionString(
  connectionString,
  process.env.VELA_DATABASE_ENVIRONMENT,
  process.env.PGOPTIONS,
);
const client = new Client({ connectionString: validatedConnectionString });
await client.connect();
try {
  await migrate(drizzle({ client }), { migrationsFolder });
  console.log(`Migrations from ${migrationsFolder} applied.`);
} finally {
  await client.end();
}
