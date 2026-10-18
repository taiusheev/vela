/** Build-only isolation: every Drizzle table is explicitly qualified; never SET search_path at runtime. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = "vela_swarm_20261018a101";
const source = await readFile(`${root}packages/db/src/schema.ts`, "utf8");
if (!source.includes("  pgTable,") || !source.includes('from "./sealed.ts"'))
  throw new Error("Schema generator needs review");
const generated = source
  .replace("  pgTable,", "  pgSchema,")
  .replaceAll('from "./checks.ts"', 'from "../../../packages/db/src/checks.ts"')
  .replaceAll('from "./sealed.ts"', 'from "../../../packages/db/src/sealed.ts"')
  .replace(
    "// Sets that belong",
    `const pgTable = pgSchema("${schema}").table;\n\n// Sets that belong`,
  );
await writeFile(new URL("../schema.generated.ts", import.meta.url), generated);
const files = (await readdir(`${root}packages/db/migrations`))
  .filter((x) => /^\d+.*\.sql$/.test(x))
  .sort();
const migrations = [];
for (const file of files) {
  const text = (await readFile(`${root}packages/db/migrations/${file}`, "utf8")).replaceAll(
    '"public".',
    `"${schema}".`,
  );
  for (const statement of text.split("--> statement-breakpoint"))
    if (statement.trim()) migrations.push(statement);
}
await writeFile(
  new URL("../migrations.generated.ts", import.meta.url),
  `export const SCHEMA = ${JSON.stringify(schema)};\nexport const MIGRATIONS = ${JSON.stringify(migrations)};\n`,
);
console.log(`Generated ${files.length} migrations and explicitly qualified tables for ${schema}`);
