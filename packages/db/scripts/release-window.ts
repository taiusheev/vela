/** Protected CI only: read-only aggregate scheduling check before any production migration. */
import { Client } from "pg";
import { validatedMutationConnectionString } from "../src/mutation-target.ts";
import {
  RELEASE_WINDOW_MINUTES,
  RELEASE_WINDOW_QUERY,
  releaseWindowSafe,
} from "../src/release-window.ts";

async function main(): Promise<void> {
  let client: Client | undefined;
  try {
    if (process.env.VELA_DATABASE_ENVIRONMENT !== "production") throw new Error("environment");
    const connectionString = validatedMutationConnectionString(
      process.env.DATABASE_URL ?? "",
      "production",
      process.env.PGOPTIONS,
    );
    client = new Client({
      connectionString,
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
    });
    client.on("error", () => {
      /* Never echo provider diagnostics, which can contain credentials. */
    });
    await client.connect();
    await client.query("begin read only");
    await client.query("set local statement_timeout = '10s'");
    const result = await client.query(RELEASE_WINDOW_QUERY);
    await client.query("commit");
    const passed = result.rows.length === 1 && releaseWindowSafe(result.rows[0]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    const counts =
      row !== undefined &&
      [row.active, row.unknown, row.imminent].every(
        (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
      )
        ? { activeLights: row.active, unknownWakes: row.unknown, wakesWithinWindow: row.imminent }
        : null;
    console.log(
      JSON.stringify({
        check: "production_release_window",
        counts,
        windowMinutes: RELEASE_WINDOW_MINUTES,
        passed,
      }),
    );
    if (!passed) {
      console.error(
        "Deployment stopped: a consented light has an unknown, overdue, or imminent scheduler wake. No migration or Worker deployment started. Retry in a verified safe window.",
      );
      process.exitCode = 1;
    }
  } catch {
    console.error(
      "Production release-window check could not be verified. Deployment stopped; keep database credentials private.",
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {
      process.exitCode = 1;
    });
  }
}
await main();
