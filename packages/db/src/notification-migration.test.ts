import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";

it("preserves existing notification opt-outs when migrating from the combined control", async () => {
  const source = fileURLToPath(new URL("../migrations", import.meta.url));
  const before = await mkdtemp(join(tmpdir(), "vela-notification-migration-"));
  const client = new PGlite();
  try {
    await cp(source, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 29);
    await writeFile(journalPath, JSON.stringify(journal));
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });
    await client.exec(
      `INSERT INTO users (display_name, one_moment_a_day) VALUES ('Synthetic on', true), ('Synthetic off', false)`,
    );
    await client.exec(
      `INSERT INTO users (display_name, one_moment_a_day, deleted_at) VALUES ('Synthetic deleted', true, now())`,
    );
    await migrate(db, { migrationsFolder: source });
    const { rows } = await client.query<{
      display_name: string;
      reply_notifications: boolean;
      turn_reminders: boolean;
    }>(`SELECT display_name, reply_notifications, turn_reminders FROM users ORDER BY display_name`);
    expect(rows).toEqual([
      { display_name: "Synthetic deleted", reply_notifications: false, turn_reminders: false },
      { display_name: "Synthetic off", reply_notifications: false, turn_reminders: false },
      { display_name: "Synthetic on", reply_notifications: true, turn_reminders: true },
    ]);
  } finally {
    await client.close();
    await rm(before, { recursive: true, force: true });
  }
}, 60_000);
