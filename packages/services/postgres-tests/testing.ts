import { createFakeAi, createFakeStt } from "@vela/ai";
import { type ApiMutationResponse, LANGS, type Lang } from "@vela/contracts";
import {
  type ApiRequestReceipt,
  apiRequestReceipts,
  connectDatabase,
  consents,
  type DatabaseConnection,
  type NewApiRequestReceipt,
  users,
  type VelaDatabase,
  type VelaTransaction,
} from "@vela/db";
import { asc, eq, sql } from "drizzle-orm";
import { type ApiMutationAction, lockApiActor } from "../src/api-idempotency.ts";
import type { Clock, Config, Deps } from "../src/deps.ts";
import { sha256Hex } from "../src/hash.ts";
import { createFakeTelegram } from "../src/testing/fake-telegram.ts";
import {
  createFakeHeartbeat,
  createFakeLogger,
  createFakeMediaStore,
  createFakeQueue,
  createFakeRandom,
  createFakeScheduler,
} from "../src/testing/fakes.ts";
import { seedFamily } from "../src/testing/seed.ts";

export const WAIT_MS = 10_000;
export const HOLD_MS = 40_000;
export const NOW = new Date("2026-09-14T00:00:00.000Z");

const POLL_MS = 10;
const RACE_PREFIX = "vela-pg-race:";
const hour = 60 * 60 * 1_000;

interface Settings {
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly run: string;
}

export interface Latch {
  release(): void;
  wait(): Promise<void>;
}

export interface RaceClient {
  readonly name: string;
  readonly pid: number;
  readonly db: VelaDatabase;
  readonly deps: Pick<Deps, "db" | "clock">;
}

export interface HeldActorLock {
  release(): void;
  readonly done: Promise<void>;
}

export interface HeldRows {
  /** Lets the rows go and waits for the holding transaction to end. */
  release(): Promise<void>;
}

export interface Account {
  readonly authSubject: string | null;
  readonly displayName: string;
  readonly deletedAt: Date | null;
}

export type AccountRow = { readonly displayName: string } | { readonly authSubject: string };

export interface SeededReceipt {
  readonly requestHash: string;
  readonly result: NewApiRequestReceipt["result"];
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface SeededScope {
  readonly familyId: string;
  readonly memberId: string;
}

export interface Calls {
  readonly authorized: string[];
  readonly mutated: string[];
}

export interface WriterOptions {
  readonly entered?: Latch;
  readonly hold?: Latch;
  readonly failure?: Error;
}

export type Outcome = { response: ApiMutationResponse; replayed: boolean };

export function calls(): Calls {
  return { authorized: [], mutated: [] };
}

export function written(label: string): ApiMutationResponse {
  return { status: 201, body: { written: label } };
}

export function writer(
  label: string,
  record: Calls,
  options: WriterOptions = {},
): ApiMutationAction {
  return {
    authorize: async () => {
      record.authorized.push(label);
    },
    mutate: async (tx) => {
      record.mutated.push(label);
      await tx.insert(users).values({ displayName: label });
      options.entered?.release();
      await options.hold?.wait();
      if (options.failure !== undefined) throw options.failure;
      return written(label);
    },
  };
}

export interface PostgresHarness {
  readonly serverVersion: string;
  client(name: string): Promise<RaceClient>;
  clientPool(prefix: string, size: number): Promise<RaceClient[]>;
  latch(label: string, milliseconds?: number): Latch;
  track<T>(promise: Promise<T>): Promise<T>;
  reach(label: string, latch: Latch, operation: Promise<unknown>): Promise<void>;
  finish<T>(label: string, promise: Promise<T>): Promise<T>;
  settle<T>(label: string, promises: readonly Promise<T>[]): Promise<PromiseSettledResult<T>[]>;
  waitForActorLockWait(
    waiter: RaceClient,
    holders: readonly RaceClient[],
    operation: Promise<unknown>,
  ): Promise<void>;
  waitForRowLockWait(
    waiter: RaceClient,
    holders: readonly RaceClient[],
    operation: Promise<unknown>,
  ): Promise<void>;
  waitForRowLockWaitOrCompletion(
    waiter: RaceClient,
    holders: readonly RaceClient[],
    operation: Promise<unknown>,
  ): Promise<"waiting" | "completed">;
  /**
   * Contenders queued behind a row lock that `holder` takes with `lockRow` and keeps, in the order
   * given; the holder then lets go and they serialise on that row alone. Returns each contender's
   * operation, in that order.
   *
   * Each contender starts only once the one before it is confirmed waiting, because
   * `pg_blocking_pids` names a backend's *direct* blocker and nothing further up: the first waits
   * on the holder's transaction, the second on the first's tuple lock, and so on. Started together,
   * the queue order — and with it which contender wins — would be left to chance.
   */
  queueBehindRowLock<T>(
    holder: RaceClient,
    lockRow: (tx: VelaTransaction) => Promise<unknown>,
    contenders: readonly { readonly client: RaceClient; readonly start: () => Promise<T> }[],
  ): Promise<Promise<T>[]>;
  /**
   * Rows that `holder` takes with `lockRows` and keeps until `release`, for a race whose contenders
   * stop at different points: the test starts them one at a time and confirms where each one waits
   * (`waitForRowLockWait`), or that it went on without waiting (`waitForRowLockWaitOrCompletion`).
   * The second is how a race still judges the outcome when the lock a guard relies on is missing,
   * rather than failing on a wait that never comes.
   */
  holdRows(
    holder: RaceClient,
    lockRows: (tx: VelaTransaction) => Promise<unknown>,
  ): Promise<HeldRows>;
  jobDeps(client: RaceClient): Deps;
  holdsActorLock(client: RaceClient): Promise<boolean>;
  holdActorLock(client: RaceClient, authSubject: string): Promise<HeldActorLock>;
  writtenTogether(authSubject: string, key: string, account: AccountRow): Promise<boolean>;
  receipts(authSubject: string): Promise<ApiRequestReceipt[]>;
  accounts(): Promise<Account[]>;
  seedReceipts(authSubject: string, total: number): Promise<void>;
  seedReceipt(authSubject: string, key: string, receipt: SeededReceipt): Promise<ApiRequestReceipt>;
  seedScope(): Promise<SeededScope>;
  reset(): Promise<void>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
}

export class WaitTimeoutError extends Error {
  override readonly name = "WaitTimeoutError";
}

export function within<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new WaitTimeoutError(`Timed out after ${milliseconds} ms waiting for ${label}`)),
      milliseconds,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function databaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if (
      "code" in current &&
      typeof current.code === "string" &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

export function settled<T>(
  result: PromiseSettledResult<T>,
): { status: "fulfilled"; value: T } | { status: "rejected"; reason: string } {
  return result.status === "fulfilled"
    ? { status: "fulfilled", value: result.value }
    : { status: "rejected", reason: describeFailure(result.reason) };
}

function describeFailure(reason: unknown): string {
  if (!(reason instanceof Error)) return String(reason);
  const code = databaseErrorCode(reason);
  const summary = `${reason.name}: ${reason.message.split("\n")[0] ?? ""}`;
  return code === undefined ? summary : `${summary} (SQLSTATE ${code})`;
}

function readSettings(): Settings {
  const read = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
      throw new Error(
        `${name} is not set. Run this suite only through \`node scripts/test-postgres.ts\`, which creates the disposable database it needs.`,
      );
    }
    return value;
  };
  const port = Number(read("VELA_PG_TEST_PORT"));
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("VELA_PG_TEST_PORT is not a TCP port");
  }
  return {
    port,
    user: read("VELA_PG_TEST_USER"),
    password: read("VELA_PG_TEST_PASSWORD"),
    database: read("VELA_PG_TEST_DATABASE"),
    run: read("VELA_PG_TEST_RUN"),
  };
}

function connectionString(settings: Settings, applicationName: string): string {
  const url = new URL("postgresql://127.0.0.1");
  url.port = String(settings.port);
  url.username = settings.user;
  url.password = settings.password;
  url.pathname = `/${settings.database}`;
  url.searchParams.set("application_name", applicationName);
  url.searchParams.set("sslmode", "disable");
  return url.href;
}

interface Opened {
  readonly connection: DatabaseConnection;
  readonly pid: number;
  readonly serverVersion: string;
}

async function open(settings: Settings, applicationName: string): Promise<Opened> {
  const connecting = connectDatabase(connectionString(settings, applicationName));
  let connection: DatabaseConnection;
  try {
    connection = await within(connecting, WAIT_MS, `connection ${applicationName}`);
  } catch (error) {
    connecting.then((late) => late.close()).catch(() => undefined);
    throw error;
  }
  try {
    const { rows } = await connection.db.execute<{
      run: string | null;
      pid: number;
      version: number;
      server: string;
    }>(
      sql`select current_setting('vela.harness_run', true) as run, pg_backend_pid() as pid, current_setting('server_version_num')::int as version, current_setting('server_version') as server`,
    );
    const row = rows[0];
    if (row === undefined || row.run !== settings.run) {
      throw new Error("Refusing to use a database that this harness run did not create");
    }
    if (row.version < 180_000 || row.version >= 190_000) {
      throw new Error(`Expected PostgreSQL 18, found ${row.server}`);
    }
    return { connection, pid: row.pid, serverVersion: row.server };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

function createLatch(label: string, milliseconds: number): Latch {
  const { promise, resolve } = Promise.withResolvers<void>();
  return {
    release: () => resolve(),
    wait: () => within(promise, milliseconds, `latch "${label}"`),
  };
}

async function diagnostics(admin: VelaDatabase): Promise<string> {
  try {
    const activity = await admin.execute<Record<string, unknown>>(
      sql`select pid, application_name, backend_xid::text as xid, state, wait_event_type, wait_event, pg_blocking_pids(pid) as blocked_by, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 160) as query from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() order by pid`,
    );
    const locks = await admin.execute<Record<string, unknown>>(
      sql`select pid, locktype, relation::regclass::text as relation, transactionid::text as xid, mode, granted from pg_locks where locktype in ('advisory', 'tuple') or not granted order by granted desc, pid`,
    );
    return [
      "backends:",
      ...activity.rows.map((row) => `  ${JSON.stringify(row)}`),
      "advisory, tuple and waiting locks:",
      ...locks.rows.map((row) => `  ${JSON.stringify(row)}`),
    ].join("\n");
  } catch (error) {
    return `diagnostics unavailable: ${describeFailure(error)}`;
  }
}

export async function openPostgresHarness(): Promise<PostgresHarness> {
  const settings = readSettings();
  const adminConnection = await open(settings, "vela-pg-admin");
  const admin = adminConnection.connection.db;
  const clock: Clock = { now: () => new Date(NOW.getTime()) };
  const connections: DatabaseConnection[] = [];
  const latches: Latch[] = [];
  const pending: Promise<void>[] = [];

  const explain = async (error: unknown): Promise<never> => {
    if (error instanceof WaitTimeoutError) {
      throw new WaitTimeoutError(`${error.message}\n${await diagnostics(admin)}`);
    }
    throw error;
  };

  const waitFor = async (
    label: string,
    observe: () => Promise<{ done: boolean; state: string }>,
    operation: Promise<unknown>,
    completionEnds = false,
  ): Promise<"waiting" | "completed"> => {
    let outcome: string | undefined;
    let completed = false;
    void operation.then(
      () => {
        completed = true;
        outcome = "it completed";
      },
      (reason: unknown) => {
        outcome = `it failed with ${describeFailure(reason)}`;
      },
    );
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const observation = await observe();
      if (observation.done) return "waiting";
      if (completed && completionEnds) return "completed";
      if (outcome !== undefined) {
        throw new Error(
          `Stopped waiting for ${label} because ${outcome}; last seen ${observation.state}\n${await diagnostics(admin)}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new WaitTimeoutError(
          `Timed out after ${WAIT_MS} ms waiting for ${label}; last seen ${observation.state}\n${await diagnostics(admin)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };

  const waitForLock = async (
    waiter: RaceClient,
    holders: readonly RaceClient[],
    operation: Promise<unknown>,
    events: readonly string[],
    what: string,
    completionEnds = false,
  ): Promise<"waiting" | "completed"> => {
    return waitFor(
      `${waiter.name} to wait on ${what} held by ${holders.map((holder) => holder.name).join(", ")}`,
      async () => {
        const { rows } = await admin.execute<{
          state: string | null;
          waitEventType: string | null;
          waitEvent: string | null;
          blockers: number[];
        }>(
          sql`select state, wait_event_type as "waitEventType", wait_event as "waitEvent", pg_blocking_pids(pid) as blockers from pg_stat_activity where pid = ${waiter.pid}`,
        );
        const row = rows[0];
        return {
          done:
            row !== undefined &&
            row.waitEventType === "Lock" &&
            row.waitEvent !== null &&
            events.includes(row.waitEvent) &&
            holders.every((holder) => row.blockers.includes(holder.pid)),
          state: JSON.stringify(row ?? null),
        };
      },
      operation,
      completionEnds,
    );
  };

  const config: Config = {
    telegramBotUsername: "VelaRaceBot",
    adminConversationId: null,
    environment: "development",
    regions: ["apac"],
    publicBaseUrl: "https://vela.test",
    privacyNoticeUrls: Object.fromEntries(
      LANGS.map((lang: Lang) => [lang, "https://vela.test/privacy"]),
    ) as Record<Lang, string>,
    privacyNoticeVersion: "privacy-notice.v1",
  };

  const harness: PostgresHarness = {
    serverVersion: adminConnection.serverVersion,

    async client(name) {
      const opened = await open(settings, `${RACE_PREFIX}${name}`);
      connections.push(opened.connection);
      return {
        name,
        pid: opened.pid,
        db: opened.connection.db,
        deps: { db: opened.connection.db, clock },
      };
    },

    async clientPool(prefix, size) {
      return Promise.all(
        Array.from({ length: size }, (_, index) => harness.client(`${prefix}-${index}`)),
      );
    },

    latch(label, milliseconds = WAIT_MS) {
      const latch = createLatch(label, milliseconds);
      latches.push(latch);
      return latch;
    },

    track(promise) {
      pending.push(
        promise.then(
          () => undefined,
          () => undefined,
        ),
      );
      return promise;
    },

    async reach(label, latch, operation) {
      const early = operation.then(() => {
        throw new Error(`${label}: the operation completed before reaching this point`);
      });
      await Promise.race([latch.wait(), early]).catch(explain);
    },

    async finish(label, promise) {
      return within(promise, WAIT_MS, label).catch(explain);
    },

    async settle(label, promises) {
      return within(Promise.allSettled(promises), WAIT_MS, label).catch(explain);
    },

    async waitForActorLockWait(waiter, holders, operation) {
      await waitForLock(waiter, holders, operation, ["advisory"], "the actor lock");
    },

    async waitForRowLockWait(waiter, holders, operation) {
      await waitForLock(waiter, holders, operation, ["transactionid", "tuple"], "a row lock");
    },

    async waitForRowLockWaitOrCompletion(waiter, holders, operation) {
      return waitForLock(
        waiter,
        holders,
        operation,
        ["transactionid", "tuple"],
        "a row lock, or to complete without waiting,",
        true,
      );
    },

    async queueBehindRowLock<T>(
      holder: RaceClient,
      lockRow: (tx: VelaTransaction) => Promise<unknown>,
      contenders: readonly { readonly client: RaceClient; readonly start: () => Promise<T> }[],
    ): Promise<Promise<T>[]> {
      const entered = harness.latch(`${holder.name} to take the row`);
      const release = harness.latch(`${holder.name} to let the row go`, HOLD_MS);
      const held = harness.track(
        holder.db.transaction(async (tx) => {
          await lockRow(tx);
          entered.release();
          await release.wait();
        }),
      );
      await entered.wait();

      const operations: Promise<T>[] = [];
      let ahead = holder;
      for (const contender of contenders) {
        const operation = harness.track(contender.start());
        operations.push(operation);
        await harness.waitForRowLockWait(contender.client, [ahead], operation);
        ahead = contender.client;
      }

      release.release();
      await harness.finish(`${holder.name} to let the row go`, held);
      return operations;
    },

    async holdRows(holder, lockRows) {
      const entered = harness.latch(`${holder.name} to take the rows`);
      const release = harness.latch(`${holder.name} to let the rows go`, HOLD_MS);
      const held = harness.track(
        holder.db.transaction(async (tx) => {
          await lockRows(tx);
          entered.release();
          await release.wait();
        }),
      );
      await harness.reach(`${holder.name} to take the rows`, entered, held);
      return {
        release: async () => {
          release.release();
          await harness.finish(`${holder.name} to let the rows go`, held);
        },
      };
    },

    jobDeps(client) {
      let sequence = 0;
      const next = (): number => {
        sequence += 1;
        return sequence;
      };
      const telegram = createFakeTelegram(clock);
      return {
        db: client.db,
        clock,
        logger: createFakeLogger(),
        random: createFakeRandom(),
        queues: {
          outbound: createFakeQueue(clock, next),
          media: createFakeQueue(clock, next),
          understand: createFakeQueue(clock, next),
        },
        scheduler: createFakeScheduler(),
        media: createFakeMediaStore(),
        channels: { get: () => telegram },
        ai: createFakeAi(),
        stt: createFakeStt(),
        heartbeat: createFakeHeartbeat(),
        config,
      };
    },

    async holdsActorLock(client) {
      const { rows } = await admin.execute<{ held: boolean }>(
        sql`select exists (select 1 from pg_locks where locktype = 'advisory' and granted and pid = ${client.pid}) as held`,
      );
      return rows[0]?.held === true;
    },

    async holdActorLock(client, authSubject) {
      const actorHash = await sha256Hex(authSubject);
      const held = harness.latch(`${client.name} holds the actor lock`);
      const release = harness.latch(`${client.name} releases the actor lock`, HOLD_MS);
      const done = harness.track(
        client.db.transaction(async (tx) => {
          await lockApiActor(tx, actorHash);
          held.release();
          await release.wait();
        }),
      );
      await harness.reach(`${client.name} to take the actor lock`, held, done);
      if (!(await harness.holdsActorLock(client))) {
        throw new Error(
          `${client.name} did not acquire the actor lock\n${await diagnostics(admin)}`,
        );
      }
      return { release: () => release.release(), done };
    },

    async writtenTogether(authSubject, key, account) {
      const match =
        "displayName" in account
          ? sql`u.display_name = ${account.displayName}`
          : sql`u.auth_subject = ${account.authSubject}`;
      const { rows } = await admin.execute<{ receipt: string; account: string }>(
        sql`select r.xmin::text as receipt, u.xmin::text as account from api_request_receipts r cross join users u where r.actor_hash = ${await sha256Hex(authSubject)} and r.key_hash = ${await sha256Hex(key)} and ${match}`,
      );
      const [row] = rows;
      return rows.length === 1 && row !== undefined && row.receipt === row.account;
    },

    async receipts(authSubject) {
      return admin
        .select()
        .from(apiRequestReceipts)
        .where(eq(apiRequestReceipts.actorHash, await sha256Hex(authSubject)))
        .orderBy(asc(apiRequestReceipts.createdAt), asc(apiRequestReceipts.id));
    },

    async accounts() {
      return admin
        .select({
          authSubject: users.authSubject,
          displayName: users.displayName,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .orderBy(asc(users.authSubject), asc(users.displayName), asc(users.id));
    },

    async seedReceipts(authSubject, total) {
      const actorHash = await sha256Hex(authSubject);
      const requestHash = await sha256Hex("seeded request");
      const rows = await Promise.all(
        Array.from({ length: total }, async (_, index) => ({
          actorHash,
          keyHash: await sha256Hex(`seeded-key-${index}`),
          requestHash,
          result: { status: 200, body: null },
          createdAt: new Date(NOW.getTime() - hour),
          expiresAt: new Date(NOW.getTime() + 23 * hour),
        })),
      );
      for (let start = 0; start < rows.length; start += 250) {
        await admin.insert(apiRequestReceipts).values(rows.slice(start, start + 250));
      }
    },

    async seedReceipt(authSubject, key, receipt) {
      const [row] = await admin
        .insert(apiRequestReceipts)
        .values({
          actorHash: await sha256Hex(authSubject),
          keyHash: await sha256Hex(key),
          ...receipt,
        })
        .returning();
      if (row === undefined) throw new Error("The receipt was not seeded");
      return row;
    },

    async seedScope() {
      const seeded = await seedFamily(admin, { now: NOW });
      await admin.delete(consents);
      return { familyId: seeded.family.id, memberId: seeded.member.id };
    },

    async reset() {
      const { rows } = await admin.execute<{ name: string }>(
        sql`select tablename as name from pg_tables where schemaname = 'public' order by tablename`,
      );
      if (rows.length === 0) throw new Error("The disposable database has no migrated tables");
      await admin.execute(
        sql`truncate table ${sql.join(
          rows.map((row) => sql.identifier(row.name)),
          sql`, `,
        )} restart identity cascade`,
      );
    },

    async cleanup() {
      for (const latch of latches.splice(0)) latch.release();
      let stuck: string | undefined;
      try {
        await within(Promise.all(pending.splice(0)), WAIT_MS, "operations started by the test");
      } catch (error) {
        stuck = `${describeFailure(error)}\n${await diagnostics(admin)}`;
      }
      await admin.execute(
        sql`select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and starts_with(application_name, ${RACE_PREFIX}) and state <> 'idle'`,
      );
      await Promise.all(
        connections
          .splice(0)
          .map((connection) =>
            within(connection.close(), WAIT_MS, "a race connection to close").catch(
              () => undefined,
            ),
          ),
      );
      if (stuck !== undefined) {
        throw new Error(`Operations were still pending after the test: ${stuck}`);
      }
    },

    async close() {
      try {
        await harness.cleanup();
      } finally {
        await adminConnection.connection.close();
      }
    },
  };
  return harness;
}
