import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { appendFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { connectDatabase, type DatabaseConnection } from "@vela/db";
import { sql } from "drizzle-orm";

const IMAGE = "postgres:18";
const HOST = "127.0.0.1";
const LABEL = "dev.vela.harness";
const READY_MS = 90_000;
const STALE_MS = 30 * 60 * 1_000;
const INTERRUPT_GRACE_MS = 30_000;

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const dbDir = fileURLToPath(new URL("../../db", import.meta.url));
const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const vitestConfig = fileURLToPath(new URL("../vitest.postgres.config.ts", import.meta.url));

class HarnessBlocker extends Error {}

class HarnessInterrupted extends Error {}

interface Instance {
  readonly description: string;
  readonly port: number;
  logs(): Promise<string>;
  failure(): Promise<string | undefined>;
}

interface Captured {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly shielded?: boolean;
}

const run = randomBytes(6).toString("hex");
const credentials = {
  user: `vela_harness_${run}`,
  password: randomBytes(24).toString("base64url"),
  database: `vela_services_${run}`,
};
const cleanups: (() => Promise<void>)[] = [];
const children = new Set<ChildProcess>();
let aborted = false;
let disposing = false;
let forcedExit: ReturnType<typeof setTimeout> | undefined;
let disposal: Promise<boolean> = Promise.resolve(true);

function redact(text: string): string {
  return text.split(credentials.password).join("[redacted]");
}

function describeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

function log(message: string): void {
  console.log(`[postgres-tests] ${redact(message)}`);
}

function tail(file: string, lines = 40): string {
  try {
    return redact(readFileSync(file, "utf8").split(/\r?\n/).slice(-lines).join("\n"));
  } catch {
    return "(no output)";
  }
}

function ensureRunning(): void {
  if (aborted) throw new HarnessInterrupted("interrupted");
}

function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill());
  } else {
    child.kill();
  }
  return exited;
}

function watch(child: ChildProcess, options: RunOptions = {}): ChildProcess {
  if (options.shielded === true) return child;
  children.add(child);
  const forget = () => children.delete(child);
  child.once("exit", forget);
  child.once("error", forget);
  return child;
}

function capture(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<Captured> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const child = watch(
      spawn(command, args, {
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: options.shielded === true,
      }),
      options,
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      void terminate(child);
      reject(new Error(`${basename(command)} ${args[0] ?? ""} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function succeed(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<string> {
  const result = await capture(command, args, options);
  if (result.code !== 0) {
    const output = redact(result.stderr.trim() || result.stdout.trim()).slice(-2_000);
    throw new Error(`${basename(command)} ${args[0] ?? ""} exited with ${result.code}: ${output}`);
  }
  return result.stdout;
}

async function runLogged(
  command: string,
  args: readonly string[],
  outputFile: string,
  options: RunOptions & { readonly timeoutMs: number },
): Promise<void> {
  const descriptor = openSync(outputFile, "a");
  let child: ChildProcess;
  try {
    child = watch(
      spawn(command, args, {
        env: options.env ?? process.env,
        stdio: ["ignore", descriptor, descriptor],
        windowsHide: true,
        detached: options.shielded === true,
      }),
      options,
    );
  } finally {
    closeSync(descriptor);
  }
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      void terminate(child);
      reject(
        new Error(`${basename(command)} ${args[0] ?? ""} timed out after ${options.timeoutMs} ms`),
      );
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  if (code !== 0) {
    throw new Error(
      `${basename(command)} ${args[0] ?? ""} exited with ${code}:\n${tail(outputFile)}`,
    );
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("No free local port"))));
    });
  });
}

async function startDocker(): Promise<Instance> {
  let server: string;
  try {
    server = (
      await succeed("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Version}}"], {
        timeoutMs: 30_000,
      })
    ).trim();
  } catch (error) {
    throw new HarnessBlocker(
      `Docker is not available (${describeError(error)}). Start Docker, or pass --pg-bin <PostgreSQL 18 bin directory>.`,
    );
  }
  if (!server.startsWith("linux/")) {
    throw new HarnessBlocker(`Docker must run Linux containers; the daemon reports ${server}`);
  }
  ensureRunning();
  const earlier = (
    await succeed(
      "docker",
      ["ps", "--all", "--quiet", "--filter", `label=${LABEL}=services-postgres-tests`],
      { shielded: true },
    )
  )
    .split(/\s+/)
    .filter((id) => id.length > 0);
  if (earlier.length > 0) {
    log(
      `${earlier.length} container(s) from earlier runs are still here; remove them with: docker rm --force --volumes $(docker ps --all --quiet --filter label=${LABEL}=services-postgres-tests)`,
    );
  }
  await succeed("docker", ["pull", "--quiet", IMAGE], { timeoutMs: 900_000 });
  ensureRunning();
  const name = `vela-services-pg-${run}`;
  cleanups.push(async () => {
    const filter = `label=${LABEL}.run=${run}`;
    try {
      const ids = (
        await succeed("docker", ["ps", "--all", "--quiet", "--filter", filter], { shielded: true })
      )
        .split(/\s+/)
        .filter((id) => id.length > 0);
      if (ids.length > 0) {
        await succeed("docker", ["rm", "--force", "--volumes", ...ids], { shielded: true });
      }
    } catch (error) {
      throw new Error(
        `${describeError(error)}; remove the container with: docker rm --force --volumes $(docker ps --all --quiet --filter ${filter})`,
      );
    }
  });
  const id = (
    await succeed(
      "docker",
      [
        "create",
        "--name",
        name,
        "--label",
        `${LABEL}=services-postgres-tests`,
        "--label",
        `${LABEL}.run=${run}`,
        "--publish",
        `${HOST}::5432`,
        "--tmpfs",
        "/var/lib/postgresql",
        "--env",
        "POSTGRES_USER",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_DB",
        IMAGE,
        "-c",
        "fsync=off",
        "-c",
        "synchronous_commit=off",
        "-c",
        "full_page_writes=off",
      ],
      {
        env: {
          ...process.env,
          POSTGRES_USER: credentials.user,
          POSTGRES_PASSWORD: credentials.password,
          POSTGRES_DB: "postgres",
        },
      },
    )
  ).trim();
  ensureRunning();
  await succeed("docker", ["start", id]);
  const digest = await capture("docker", [
    "image",
    "inspect",
    "--format",
    "{{index .RepoDigests 0}}",
    IMAGE,
  ]);
  const mapping = await succeed("docker", ["port", id, "5432/tcp"]);
  const binding = mapping
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${HOST}:`));
  const port = Number(binding?.slice(HOST.length + 1));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Docker did not publish PostgreSQL on ${HOST}: ${mapping.trim()}`);
  }
  return {
    description: `Docker container ${name} from ${digest.stdout.trim() || IMAGE}`,
    port,
    logs: async () => {
      const result = await capture("docker", ["logs", "--tail", "60", id]);
      return redact(`${result.stdout}${result.stderr}`);
    },
    failure: async () => {
      const state = await capture("docker", [
        "inspect",
        "--format",
        "{{.State.Status}} {{.State.ExitCode}}",
        id,
      ]);
      const status = state.stdout.trim();
      return state.code === 0 && status.startsWith("running ")
        ? undefined
        : `the container is ${status || "gone"}`;
    },
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

async function reapStaleClusters(): Promise<void> {
  const parent = tmpdir();
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch {
    return;
  }
  for (const entry of entries.filter((name) => /^vela-services-pg-[0-9a-f]{12}-/.test(name))) {
    const root = join(parent, entry);
    try {
      const info = await stat(root);
      if (!info.isDirectory() || Date.now() - info.mtimeMs < STALE_MS) continue;
      const pidFile = join(root, "data", "postmaster.pid");
      if (existsSync(pidFile)) {
        const pid = Number((await readFile(pidFile, "utf8")).split(/\r?\n/)[0]);
        if (Number.isInteger(pid) && alive(pid)) continue;
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      log(`removed ${entry}, a stopped data directory left by an earlier run`);
    } catch (error) {
      log(`left ${entry} in place: ${describeError(error)}`);
    }
  }
}

async function startBinaries(binDir: string): Promise<Instance> {
  const tool = (name: string): string =>
    join(binDir, process.platform === "win32" ? `${name}.exe` : name);
  const env = { ...process.env, LANGUAGE: "en", LC_MESSAGES: "C" };
  for (const name of ["initdb", "pg_ctl", "postgres"]) {
    if (!existsSync(tool(name))) {
      throw new HarnessBlocker(`${name} was not found in the --pg-bin directory`);
    }
  }
  const version = (await succeed(tool("postgres"), ["--version"], { env })).trim();
  if (!/\(PostgreSQL\) 18\.\d+/.test(version)) {
    throw new HarnessBlocker(`--pg-bin must hold PostgreSQL 18 binaries; found "${version}"`);
  }
  await reapStaleClusters();
  ensureRunning();
  const root = await mkdtemp(join(tmpdir(), `vela-services-pg-${run}-`));
  const data = join(root, "data");
  const toolLog = join(root, "tools.log");
  const serverLog = join(root, "server.log");
  const running = async (): Promise<boolean> => {
    const { code } = await capture(tool("pg_ctl"), ["status", "-D", data], {
      env,
      shielded: true,
    });
    if (code === 0) return true;
    if (code === 3 || code === 4) return false;
    throw new Error(`pg_ctl status gave no answer (exit ${code}) for ${data}`);
  };
  const stopped = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!(await running())) return true;
      await delay(250);
    }
    return false;
  };
  cleanups.push(async () => {
    if (await running()) {
      const stop = (mode: string) =>
        runLogged(tool("pg_ctl"), ["stop", "-D", data, "-m", mode, "-w", "-t", "30"], toolLog, {
          env,
          timeoutMs: 60_000,
          shielded: true,
        });
      await stop("fast")
        .catch(() => stop("immediate"))
        .catch(() => undefined);
      if (!(await stopped())) {
        throw new Error(`PostgreSQL is still running from ${data}; stop it and delete ${root}`);
      }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  });
  const passwordFile = join(root, "password");
  await writeFile(passwordFile, `${credentials.password}\n`, { mode: 0o600 });
  try {
    await runLogged(
      tool("initdb"),
      [
        "-D",
        data,
        "-U",
        credentials.user,
        `--pwfile=${passwordFile}`,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
        "--no-sync",
        "--no-instructions",
      ],
      toolLog,
      { env, timeoutMs: 120_000 },
    );
  } finally {
    await rm(passwordFile, { force: true });
  }
  const settings = join(data, "postgresql.conf");
  await appendFile(
    settings,
    [
      "",
      `listen_addresses = '${HOST}'`,
      "unix_socket_directories = ''",
      "fsync = off",
      "synchronous_commit = off",
      "full_page_writes = off",
      "",
    ].join("\n"),
  );
  for (let attempt = 1; ; attempt += 1) {
    const port = await freePort();
    await appendFile(settings, `port = ${port}\n`);
    ensureRunning();
    try {
      await runLogged(
        tool("pg_ctl"),
        ["start", "-D", data, "-l", serverLog, "-w", "-t", "60"],
        toolLog,
        { env, timeoutMs: 90_000 },
      );
      return {
        description: `${version} from --pg-bin in a temporary data directory`,
        port,
        logs: async () => tail(serverLog),
        failure: async () => ((await running()) ? undefined : "the server is not running"),
      };
    } catch (error) {
      const serverOutput = tail(serverLog);
      if (attempt < 3 && /could not bind/i.test(serverOutput) && !(await running())) continue;
      throw new Error(`${describeError(error)}\nserver log:\n${serverOutput}`);
    }
  }
}

function connectionString(port: number, database: string): string {
  const url = new URL(`postgresql://${HOST}`);
  url.port = String(port);
  url.username = credentials.user;
  url.password = credentials.password;
  url.pathname = `/${database}`;
  url.searchParams.set("application_name", "vela-pg-harness");
  url.searchParams.set("sslmode", "disable");
  return url.href;
}

async function connect(port: number, database: string): Promise<DatabaseConnection> {
  const connecting = connectDatabase(connectionString(port, database));
  const cancel = new AbortController();
  const timeout = delay(5_000, undefined, { signal: cancel.signal }).then(() => {
    throw new Error("connection attempt timed out");
  });
  try {
    return await Promise.race([connecting, timeout]);
  } catch (error) {
    connecting.then((connection) => connection.close()).catch(() => undefined);
    throw error;
  } finally {
    cancel.abort();
  }
}

async function waitUntilReady(instance: Instance): Promise<string> {
  const deadline = Date.now() + READY_MS;
  let last = "no connection attempt";
  while (Date.now() < deadline) {
    ensureRunning();
    try {
      const connection = await connect(instance.port, "postgres");
      try {
        const { rows } = await connection.db.execute<{ version: string; number: number }>(
          sql`select current_setting('server_version') as version, current_setting('server_version_num')::int as number`,
        );
        const row = rows[0];
        if (row === undefined || row.number < 180_000 || row.number >= 190_000) {
          throw new HarnessBlocker(`Expected PostgreSQL 18, found ${row?.version ?? "nothing"}`);
        }
        return row.version;
      } finally {
        await connection.close();
      }
    } catch (error) {
      if (error instanceof HarnessBlocker) throw error;
      last = describeError(error);
    }
    const failure = await instance.failure();
    if (failure !== undefined) {
      throw new Error(
        `PostgreSQL stopped before accepting connections: ${failure}\n${await instance.logs()}`,
      );
    }
    await delay(250);
  }
  throw new Error(
    `PostgreSQL did not accept connections within ${READY_MS / 1_000} s (last error: ${last})\n${await instance.logs()}`,
  );
}

async function prepareDatabase(port: number): Promise<string[]> {
  ensureRunning();
  const maintenance = await connect(port, "postgres");
  try {
    await maintenance.db.execute(sql`create database ${sql.identifier(credentials.database)}`);
  } finally {
    await maintenance.close();
  }

  ensureRunning();
  const migration = await capture(process.execPath, [join(dbDir, "src", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: connectionString(port, credentials.database) },
    timeoutMs: 120_000,
  });
  if (migration.code !== 0) {
    throw new Error(
      `Migrations failed (exit ${migration.code}):\n${redact(`${migration.stdout}${migration.stderr}`).slice(-4_000)}`,
    );
  }

  const journal: unknown = JSON.parse(
    readFileSync(join(dbDir, "migrations", "meta", "_journal.json"), "utf8"),
  );
  const entries =
    typeof journal === "object" && journal !== null && "entries" in journal
      ? journal.entries
      : undefined;
  const tags = Array.isArray(entries)
    ? entries.map((entry: unknown) =>
        typeof entry === "object" && entry !== null && "tag" in entry ? String(entry.tag) : "?",
      )
    : [];

  const connection = await connect(port, credentials.database);
  try {
    const database = sql.identifier(credentials.database);
    await connection.db.execute(
      sql`alter database ${database} set vela.harness_run = ${sql.raw(`'${run}'`)}`,
    );
    await connection.db.execute(sql`alter database ${database} set lock_timeout = '30s'`);
    await connection.db.execute(
      sql`alter database ${database} set idle_in_transaction_session_timeout = '2min'`,
    );
    const { rows } = await connection.db.execute<{ applied: number }>(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    );
    const applied = rows[0]?.applied ?? 0;
    if (tags.length === 0 || applied !== tags.length) {
      throw new Error(`Applied ${applied} migrations but the journal lists ${tags.length}`);
    }
    return tags;
  } finally {
    await connection.close();
  }
}

function runTests(port: number, args: readonly string[]): Promise<number> {
  ensureRunning();
  return new Promise((resolve, reject) => {
    const child = watch(
      spawn(process.execPath, [vitestCli, "run", "--config", vitestConfig, ...args], {
        cwd: packageDir,
        stdio: "inherit",
        windowsHide: true,
        env: {
          ...process.env,
          VELA_PG_TEST_PORT: String(port),
          VELA_PG_TEST_USER: credentials.user,
          VELA_PG_TEST_PASSWORD: credentials.password,
          VELA_PG_TEST_DATABASE: credentials.database,
          VELA_PG_TEST_RUN: run,
        },
      }),
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal === null ? 1 : 130)));
  });
}

function dispose(): Promise<boolean> {
  disposing = true;
  disposal = disposal.then(async (previous) => {
    let clean = previous;
    let removed = false;
    if (cleanups.length > 0) log(`run ${run}: removing the disposable PostgreSQL`);
    for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
      try {
        await cleanup();
        removed = true;
      } catch (error) {
        clean = false;
        console.error(`[postgres-tests] cleanup failed: ${describeError(error)}`);
      }
    }
    if (removed && clean) log(`run ${run}: removed the disposable PostgreSQL`);
    return clean;
  });
  return disposal;
}

async function finish(code: number): Promise<void> {
  const clean = await dispose();
  if (forcedExit !== undefined) clearTimeout(forcedExit);
  process.exit(!clean ? 1 : aborted ? 130 : code);
}

function interrupt(signal: string): void {
  const first = !aborted;
  aborted = true;
  if (!first || disposing) {
    log(`${signal} received; still removing the disposable PostgreSQL`);
    return;
  }
  log(`${signal} received; stopping and removing the disposable PostgreSQL`);
  for (const child of children) void terminate(child);
  forcedExit = setTimeout(() => {
    void dispose().finally(() => process.exit(130));
  }, INTERRUPT_GRACE_MS);
}

function parseOptions(argv: readonly string[]): {
  pgBin: string | undefined;
  vitestArgs: string[];
} {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const vitestArgs = separator === -1 ? [] : argv.slice(separator + 1);
  let pgBin: string | undefined;
  for (let index = 0; index < own.length; index += 1) {
    const option = own[index] ?? "";
    if (option === "--pg-bin" && own[index + 1] !== undefined) {
      pgBin = own[index + 1];
      index += 1;
    } else if (option.startsWith("--pg-bin=")) {
      pgBin = option.slice("--pg-bin=".length);
    } else {
      throw new HarnessBlocker(
        `Unknown option "${option}". Usage: node scripts/test-postgres.ts [--pg-bin <dir>] [-- <vitest args>]`,
      );
    }
  }
  return { pgBin, vitestArgs };
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("PG") || name === "DATABASE_URL") delete process.env[name];
  }
  log(
    `run ${run}: starting a disposable PostgreSQL 18 (${options.pgBin === undefined ? "docker" : "local binaries"})`,
  );
  const instance =
    options.pgBin === undefined ? await startDocker() : await startBinaries(options.pgBin);
  log(`${instance.description}, listening on ${HOST}:${instance.port}`);
  const version = await waitUntilReady(instance);
  ensureRunning();
  log(`PostgreSQL ${version} is ready`);
  const tags = await prepareDatabase(instance.port);
  log(`applied ${tags.length} migrations: ${tags.join(", ")}`);
  return runTests(instance.port, options.vitestArgs);
}

const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
if (process.platform === "win32") signals.push("SIGBREAK");
for (const signal of signals) process.on(signal, () => interrupt(signal));

main().then(
  (code) => finish(aborted ? 130 : code),
  (error: unknown) => {
    const blocked = error instanceof HarnessBlocker;
    if (!aborted) {
      console.error(`[postgres-tests] ${blocked ? "blocked" : "failed"}: ${describeError(error)}`);
    }
    return finish(aborted ? 130 : blocked ? 2 : 1);
  },
);
