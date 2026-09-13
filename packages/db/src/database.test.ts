import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { describe, expectTypeOf, it } from "vitest";
import type { VelaDatabase, VelaSchema } from "./database.ts";

// These assertions are checked by `tsc` (pnpm typecheck), not at runtime: they fail the build if a
// driver's database stops satisfying the type services are written against.
describe("VelaDatabase", () => {
  it("accepts the node-postgres database", () => {
    expectTypeOf<NodePgDatabase<VelaSchema>>().toExtend<VelaDatabase>();
  });

  it("accepts the PGlite database", () => {
    expectTypeOf<PgliteDatabase<VelaSchema>>().toExtend<VelaDatabase>();
  });
});
