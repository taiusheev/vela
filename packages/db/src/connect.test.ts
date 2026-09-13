import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "./connect.ts";

let postgres: PGlite;
let server: PGLiteSocketServer;

beforeAll(async () => {
  postgres = new PGlite();
  await postgres.waitReady;
}, 60_000);

beforeEach(async () => {
  // Port 0 lets the system pick a free port, so parallel test runs never collide.
  server = new PGLiteSocketServer({ db: postgres, host: "127.0.0.1", port: 0 });
  await server.start();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.stop();
});

afterAll(async () => {
  await postgres.close();
});

function connectionString(): string {
  return `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
}

describe("connectDatabase", () => {
  it("runs queries and can be closed more than once", async () => {
    const connection = await connectDatabase(connectionString());

    const result = await connection.db.execute<{ answer: number }>(sql`select 42 as answer`);
    expect(result.rows).toEqual([{ answer: 42 }]);

    await connection.close();
    await expect(connection.close()).resolves.toBeUndefined();
  });

  it("logs a connection the server drops instead of crashing, and rejects later queries", async () => {
    const logged = new Promise<unknown[]>((resolve) => {
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        resolve(args);
      });
    });
    const connection = await connectDatabase(connectionString());
    await connection.db.execute(sql`select 1`);

    await server.stop();

    expect(await logged).toEqual([
      "database_connection_error",
      { message: "Connection terminated unexpectedly" },
    ]);
    await expect(connection.db.execute(sql`select 1`)).rejects.toThrow();
    await expect(connection.close()).resolves.toBeUndefined();
  });
});
