/**
 * Regenerates architecture/schema.sql from the Drizzle schema with `drizzle-kit export`, so the
 * readable schema can never drift from the one migrations are generated from.
 * Usage: pnpm --filter @vela/db export-sql
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
// drizzle-kit's package exports do not expose its bin, and on Windows the .bin shim is a .cmd that
// cannot be spawned without a shell, so the entry point is run with this Node directly. It sits
// beside the package's main module, which is resolved rather than looked for in this package's own
// node_modules: the workspace hoists its dependencies to the root (pnpm-workspace.yaml).
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");
const target = fileURLToPath(new URL("../../../architecture/schema.sql", import.meta.url));

const result = spawnSync(
  process.execPath,
  [drizzleKit, "export", "--sql", "--config", "drizzle.config.ts"],
  {
    cwd: packageDir,
    encoding: "utf8",
  },
);

if (result.error !== undefined) {
  throw result.error;
}
if (result.status !== 0) {
  console.error(result.stderr);
  console.error(`drizzle-kit export exited with status ${result.status}`);
  process.exit(result.status ?? 1);
}

const statements = result.stdout.replaceAll("\r\n", "\n").trim();
if (!statements.startsWith("CREATE")) {
  console.error(result.stdout);
  console.error("drizzle-kit export printed something other than SQL; schema.sql was not written.");
  process.exit(1);
}

const header = [
  "-- Vela · Postgres schema",
  "-- GENERATED FILE: DO NOT EDIT. The source of truth is packages/db/src/schema.ts.",
  "-- Regenerate with: pnpm --filter @vela/db export-sql",
  "-- Applied through the migrations in packages/db/migrations (pnpm --filter @vela/db generate).",
  "-- Column meanings, retention rules, and the invariants behind each index are documented in",
  "-- schema.ts and in architecture/03-code-design.md §3.",
].join("\n");

writeFileSync(target, `${header}\n\n${statements}\n`);
console.log(`Wrote ${target}`);
