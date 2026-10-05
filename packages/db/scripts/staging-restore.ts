/** Private, read-only database evidence for the staging restore rehearsal. */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { decodeContentKey } from "../src/sealed.ts";

const sourceHost = "ep-frosty-night-b31xz5dh.c-4.ap-southeast-1.aws.neon.tech";
const stagingProjectId = "autumn-brook-64741032";
const sourceBranchId = "br-odd-mud-b3lnl35f";
const attemptId = randomUUID();
const taipeiDateParts = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const datePart = (type: "year" | "month" | "day"): string =>
  taipeiDateParts.find((part) => part.type === type)?.value ?? "";
const proposedBranchName = `restore-drill-${datePart("year")}-${datePart("month")}-${datePart("day")}-${attemptId.slice(0, 8)}`;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const receiptPath = fileURLToPath(
  new URL("../../../infra/load-tests/adr-38-staging-restore.json", import.meta.url),
);
const targetPath = fileURLToPath(
  new URL("../../../infra/load-tests/adr-38-staging-restore-target.json", import.meta.url),
);
const branchReadyPath = fileURLToPath(
  new URL("../../../infra/load-tests/adr-38-staging-restore-branch.json", import.meta.url),
);
const sessionLockPath = fileURLToPath(
  new URL("../../../infra/load-tests/adr-38-staging-restore-session.lock", import.meta.url),
);
const lockToken = randomUUID();
let lockOwned = false;
const tables = [
  ["families", "created_at"],
  ["members", "created_at"],
  ["exchanges", "created_at"],
  ["answers", "received_at"],
  ["replies", "created_at"],
  ["media", "created_at"],
  ["consents", "given_at"],
  ["quiet_events", "opened_at"],
  ["outbound", "queued_at"],
  ["deletions", "deleted_at"],
] as const;
const indexNames = ["exchanges_one_per_day", "outbound_budget_idx"] as const;

interface MigrationEvidence {
  hash: string;
  createdAt: string;
}

interface IndexEvidence {
  name: string;
  table: string;
  definition: string;
  unique: boolean;
  valid: boolean;
  ready: boolean;
}

interface Snapshot {
  t0: string;
  snapshotCapturedAt: string;
  counts: Record<string, string>;
  migration: MigrationEvidence | null;
  indexes: IndexEvidence[];
  mediaEligibleCount: string;
  mediaKeys: string[];
  mediaExpectedBytes: (number | null)[];
}

interface MediaEvidence {
  bucket: "vela-media-staging";
  method: "cloudflare_r2_list_objects_metadata_only";
  status: "verified" | "needs_review" | "not_exercised";
  sampledCount: number;
  foundCount: number;
  missingCount: number;
  unverifiedCount: number;
  metadataValidatedCount: number;
  sizeComparedCount: number;
  sizeMismatchCount: number;
  checkedAt: string;
}

interface TargetManifest {
  attemptId: string;
  environment: "staging";
  projectId: string;
  branchId: string;
  parentBranchId: string;
  branchName?: string;
  restoreT0: string;
  host: string;
  creationStartedAt: string;
  checkedAt: string;
  verified: true;
  verificationSource: "neon-console" | "neon-api";
}

interface BranchReadyManifest {
  attemptId: string;
  environment: "staging";
  projectId: string;
  sourceBranchId: string;
  branchId: string;
  branchName: string;
  restoreT0: string;
  creationStartedAt: string;
  checkedAt: string;
  verified: true;
  verificationSource: "neon-console";
}

type KeyProof =
  | "opens"
  | "does not open"
  | "no sealed value available"
  | "read_failed"
  | "check_failed";

let sourceConnection: string | undefined;
let restoredConnection: string | undefined;
let savedKey: string | undefined;
let decodedKey: Uint8Array | undefined;
let sourceSnapshot: Snapshot | undefined;
let restoredSnapshot: Snapshot | undefined;
let keyCheckChild: ChildProcess | undefined;
let cloudflareAuth: { token: string; accountId: string } | undefined;
let cancelInput: (() => void) | undefined;
let shuttingDown = false;
let timeoutFailure: string | undefined;
let overallDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
const clients = new Set<Client>();
const metadataRequests = new Set<AbortController>();
let receipt: Record<string, unknown> = {
  source: "staging-restore-helper",
  schemaVersion: 1,
  attemptId,
  environment: "staging",
  status: "collecting_source",
  sourceHost,
  projectId: stagingProjectId,
  sourceBranchId,
  recoveryCutoffPrecision: "minute",
  proposedBranchName,
  mediaCheck: "pending",
  branchDeleted: false,
  drillComplete: false,
  privateSessionPid: process.pid,
};

function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

async function waitForManifest<T>(
  read: () => Promise<T | null>,
  deadline: number,
  failure: string,
): Promise<T> {
  while (!shuttingDown) {
    if (Date.now() >= deadline) {
      timeoutFailure = failure;
      throw new Error("private verification wait timed out");
    }
    const value = await read();
    if (value !== null) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("private session cancelled");
}

function processIsDead(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isRecord(error) && error.code === "ESRCH";
  }
}

async function releaseOwnedFile(path: string): Promise<void> {
  try {
    const owner: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isRecord(owner) && owner.pid === process.pid && owner.token === lockToken)
      await unlink(path);
  } catch {
    // Never remove an unknown or another session's lock.
  }
}

async function acquireSessionLock(): Promise<void> {
  await mkdir(dirname(sessionLockPath), { recursive: true });
  const owner = `${JSON.stringify({ pid: process.pid, token: lockToken, startedAt: new Date().toISOString() })}\n`;
  try {
    await writeFile(sessionLockPath, owner, { flag: "wx", mode: 0o644 });
    lockOwned = true;
    return;
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw error;
  }
  // Serialize stale-lock reclamation. A live or unknown recorded PID blocks takeover.
  const reclaimPath = `${sessionLockPath}.reclaim`;
  await writeFile(reclaimPath, owner, { flag: "wx", mode: 0o644 });
  try {
    const previous: unknown = JSON.parse(await readFile(sessionLockPath, "utf8"));
    if (!isRecord(previous) || !processIsDead(previous.pid))
      throw new Error("private session already active");
    await unlink(sessionLockPath);
    await writeFile(sessionLockPath, owner, { flag: "wx", mode: 0o644 });
    lockOwned = true;
  } finally {
    await releaseOwnedFile(reclaimPath);
  }
}

async function saveReceipt(): Promise<void> {
  const temporaryPath = `${receiptPath}.tmp-${process.pid}`;
  try {
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
    await rename(temporaryPath, receiptPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

/** Input stays in this terminal process; hidden input is never echoed. */
function terminalInput(prompt: string, hidden: boolean): Promise<string> {
  if (shuttingDown) return Promise.reject(new Error("cancelled"));
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error?: Error): void => {
      process.stdin.removeListener("data", onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // A closed Terminal window can remove the TTY before cleanup.
      }
      process.stdin.pause();
      cancelInput = undefined;
      say();
      if (error) {
        value = "";
        reject(error);
      } else {
        resolve(value);
        value = "";
      }
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          finish(new Error("cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) process.stdout.write("\b \b");
          }
        } else if (character >= " " && character !== "\u001b") {
          if (value.length >= 16_384) {
            finish(new Error("input too long"));
            return;
          }
          value += character;
          if (!hidden) process.stdout.write(character);
        }
      }
    };
    cancelInput = () => finish(new Error("cancelled"));
    process.stdin.on("data", onData);
  });
}

/** Canonical credentials and port keep pg's parser and inherited defaults on the checked target. */
function normalizedConnection(value: string, expectedHost: string): string | undefined {
  try {
    const url = new URL(value.trim());
    const keys = [...url.searchParams.keys()];
    const password = decodeURIComponent(url.password);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      url.hostname !== expectedHost ||
      url.hostname.includes("-pooler.") ||
      (url.port !== "" && url.port !== "5432") ||
      decodeURIComponent(url.username) !== "neondb_owner" ||
      password.length === 0 ||
      url.pathname !== "/neondb" ||
      value.includes("#") ||
      keys.some((key) => !["sslmode", "channel_binding"].includes(key)) ||
      keys.length !== new Set(keys).size ||
      !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") ||
      (url.searchParams.has("channel_binding") &&
        url.searchParams.get("channel_binding") !== "require") ||
      (process.env.PGOPTIONS !== undefined && process.env.PGOPTIONS.trim() !== "")
    ) {
      return undefined;
    }
    url.username = "neondb_owner";
    url.password = encodeURIComponent(password);
    url.port = "5432";
    // Preserve pg's current certificate/hostname verification across its next major release.
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    return undefined;
  }
}

class ChildPasswordRejected extends Error {
  constructor() {
    super("Recovery connection password was rejected");
    this.name = "ChildPasswordRejected";
  }
}

function childConnection(source: string, host: string): string {
  const url = new URL(source);
  url.hostname = host;
  return url.toString();
}

async function snapshot(connectionString: string, restoredT0?: string): Promise<Snapshot> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
    application_name: "vela-staging-restore-check",
  });
  // Pending queries reject on connection failure; idle connection diagnostics must
  // never reach the private terminal as raw provider errors.
  client.on("error", () => {});
  clients.add(client);
  try {
    try {
      await client.connect();
    } catch (error) {
      // Only a password rejection during initial authentication can ask for a new
      // child connection. Network, TLS, authorization and later SQL errors cannot.
      if (restoredT0 !== undefined && isRecord(error) && error.code === "28P01") {
        throw new ChildPasswordRejected();
      }
      throw error;
    }
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const time = await client.query<{ t0: string; snapshot_captured_at: string }>(
      `SELECT
        to_char(date_trunc('minute', transaction_timestamp()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t0,
        to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_captured_at`,
    );
    const t0 = restoredT0 ?? time.rows[0]?.t0;
    if (!t0) throw new Error("missing database time");
    const countQuery = tables
      .map(
        ([table, timestamp]) =>
          `SELECT '${table}' AS table_name, count(*)::text AS row_count FROM public."${table}" WHERE "${timestamp}" <= $1::timestamptz`,
      )
      .join(" UNION ALL ");
    const counts = await client.query<{ table_name: string; row_count: string }>(countQuery, [t0]);
    const migration = await client.query<{ hash: string; created_at: string }>(
      "SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1",
    );
    const indexes = await client.query<{
      name: string;
      table_name: string;
      definition: string;
      is_unique: boolean;
      is_valid: boolean;
      is_ready: boolean;
    }>(
      `SELECT c.relname AS name, t.relname AS table_name, pg_get_indexdef(c.oid) AS definition,
        i.indisunique AS is_unique, i.indisvalid AS is_valid, i.indisready AS is_ready
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_class t ON t.oid = i.indrelid
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [indexNames],
    );
    const mediaWhere =
      "kept = false AND storage_key IS NOT NULL AND created_at >= $1::timestamptz - interval '30 days' AND created_at <= $1::timestamptz";
    const mediaCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.media WHERE ${mediaWhere}`,
      [t0],
    );
    const media = await client.query<{ storage_key: string; bytes: number | null }>(
      `SELECT storage_key, bytes FROM public.media WHERE ${mediaWhere} ORDER BY created_at DESC, id DESC LIMIT 5`,
      [t0],
    );
    await client.query("COMMIT");
    return {
      t0,
      snapshotCapturedAt: time.rows[0]?.snapshot_captured_at ?? "",
      counts: Object.fromEntries(counts.rows.map((row) => [row.table_name, row.row_count])),
      migration: migration.rows[0]
        ? { hash: migration.rows[0].hash, createdAt: migration.rows[0].created_at }
        : null,
      indexes: indexes.rows.map((row) => ({
        name: row.name,
        table: row.table_name,
        definition: row.definition,
        unique: row.is_unique,
        valid: row.is_valid,
        ready: row.is_ready,
      })),
      mediaEligibleCount: mediaCount.rows[0]?.count ?? "0",
      mediaKeys: media.rows.map((row) => row.storage_key),
      mediaExpectedBytes: media.rows.map((row) => row.bytes),
    };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
    clients.delete(client);
  }
}

function hasRequiredIndexes(value: Snapshot): boolean {
  return indexNames.every((name) =>
    value.indexes.some(
      (index) =>
        index.name === name &&
        index.table === (name === "exchanges_one_per_day" ? "exchanges" : "outbound") &&
        index.unique &&
        index.valid &&
        index.ready,
    ),
  );
}

function publicSnapshot(value: Snapshot): Record<string, unknown> {
  return {
    snapshotCapturedAt: value.snapshotCapturedAt,
    counts: value.counts,
    migration: value.migration,
    indexes: value.indexes,
    mediaEligibleCount: value.mediaEligibleCount,
    mediaSampleCount: value.mediaKeys.length,
  };
}

async function readBranchReady(
  t0: string,
  earliestCreationTime: number,
): Promise<BranchReadyManifest | null> {
  try {
    const value: unknown = JSON.parse(await readFile(branchReadyPath, "utf8"));
    if (!isRecord(value)) return null;
    const creation =
      typeof value.creationStartedAt === "string" ? Date.parse(value.creationStartedAt) : NaN;
    const checked = typeof value.checkedAt === "string" ? Date.parse(value.checkedAt) : NaN;
    if (
      value.environment !== "staging" ||
      value.attemptId !== attemptId ||
      value.projectId !== stagingProjectId ||
      value.sourceBranchId !== sourceBranchId ||
      value.verified !== true ||
      value.verificationSource !== "neon-console" ||
      typeof value.branchId !== "string" ||
      !/^br-[a-z0-9-]+$/.test(value.branchId) ||
      value.branchId === sourceBranchId ||
      typeof value.branchName !== "string" ||
      !/^restore-drill-[a-z0-9-]+$/.test(value.branchName) ||
      value.restoreT0 !== t0 ||
      !Number.isFinite(creation) ||
      creation < earliestCreationTime ||
      !Number.isFinite(checked) ||
      checked < creation ||
      checked > Date.now() + 60_000
    )
      return null;
    return value as unknown as BranchReadyManifest;
  } catch {
    return null;
  }
}

async function readTarget(
  t0: string,
  earliestCreationTime: number,
  expectedBranchId: string,
  expectedCreationTime: number,
): Promise<TargetManifest | null> {
  try {
    const value: unknown = JSON.parse(await readFile(targetPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const target = value as Partial<TargetManifest>;
    const creation = Date.parse(target.creationStartedAt ?? "");
    const checked = Date.parse(target.checkedAt ?? "");
    if (
      target.environment !== "staging" ||
      target.attemptId !== attemptId ||
      target.verified !== true ||
      !["neon-console", "neon-api"].includes(target.verificationSource ?? "") ||
      target.projectId !== stagingProjectId ||
      typeof target.branchId !== "string" ||
      !/^br-[a-z0-9-]+$/.test(target.branchId) ||
      target.branchId !== expectedBranchId ||
      target.parentBranchId !== sourceBranchId ||
      target.branchId === target.parentBranchId ||
      target.restoreT0 !== t0 ||
      typeof target.host !== "string" ||
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(target.host) ||
      target.host === sourceHost ||
      !target.host.endsWith(sourceHost.slice(sourceHost.indexOf("."))) ||
      target.host.includes("-pooler.") ||
      !Number.isFinite(creation) ||
      !Number.isFinite(checked) ||
      creation < earliestCreationTime - 1000 ||
      creation !== expectedCreationTime ||
      checked < creation ||
      checked < Date.now() - 5 * 60_000 ||
      checked > Date.now() + 60_000 ||
      (target.branchName !== undefined &&
        (typeof target.branchName !== "string" ||
          !/^restore-drill-[a-z0-9-]+$/.test(target.branchName)))
    ) {
      return null;
    }
    return target as TargetManifest;
  } catch {
    return null;
  }
}

function restoredKeyProof(connectionString: string, encodedKey: string): Promise<KeyProof> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(process.execPath, ["packages/db/scripts/seal-check.ts"], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        DATABASE_URL: connectionString,
        CONTENT_KEY_V1: encodedKey,
      },
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    keyCheckChild = child;
    const finish = (proof: KeyProof): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      output = "";
      keyCheckChild = undefined;
      resolve(proof);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish("check_failed");
    }, 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 16_384) {
        child.kill("SIGTERM");
        finish("check_failed");
      }
    });
    child.on("error", () => finish("check_failed"));
    child.on("close", (code) => {
      const lines = output.split(/\r?\n/).map((line) => line.trim());
      if (code === 0 && lines.includes("opens")) finish("opens");
      else if (code === 1 && lines.includes("does not open")) finish("does not open");
      else if (code === 1 && lines.includes("no sealed value available"))
        finish("no sealed value available");
      else if (code === 2 && lines.includes("restore check could not read the restored branch"))
        finish("read_failed");
      else finish("check_failed");
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read only the existing staging Cloudflare credentials, without loading any env file. */
async function stagingCloudflareCredentials(): Promise<void> {
  let text = await readFile(new URL("../../../apps/worker/.env", import.meta.url), "utf8");
  let token: string | undefined;
  let accountId: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match =
      /^\s*(?:export\s+)?(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (match[1] === "CLOUDFLARE_API_TOKEN") token = value;
    else accountId = value;
  }
  text = "";
  if (!token || /[^!-~]/.test(token) || !accountId || !/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("staging storage credentials unavailable");
  }
  cloudflareAuth = { token, accountId };
  token = undefined;
  accountId = undefined;
  const account = await cloudflareMetadata(`/accounts/${cloudflareAuth.accountId}`);
  const subdomain = await cloudflareMetadata(
    `/accounts/${cloudflareAuth.accountId}/workers/subdomain`,
  );
  if (
    !isRecord(account.result) ||
    account.result.name !== "Vela staging" ||
    !isRecord(subdomain.result) ||
    subdomain.result.subdomain !== "vela-light-staging"
  ) {
    throw new Error("staging storage account not verified");
  }
}

/** Cloudflare List Objects returns metadata, never the object's media body. */
async function cloudflareMetadata(
  path: string,
  query?: URLSearchParams,
): Promise<Record<string, unknown>> {
  if (!cloudflareAuth || shuttingDown) throw new Error("storage check unavailable");
  const url = new URL(`https://api.cloudflare.com/client/v4${path}`);
  if (query) url.search = query.toString();
  const controller = new AbortController();
  metadataRequests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${cloudflareAuth.token}` },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("storage metadata unavailable");
    const body: unknown = await response.json();
    if (!isRecord(body) || body.success !== true) throw new Error("storage metadata unavailable");
    return body;
  } finally {
    clearTimeout(timeout);
    metadataRequests.delete(controller);
  }
}

async function inspectMediaObject(
  key: string,
  expectedBytes: number | null,
): Promise<{
  found: boolean;
  missing: boolean;
  metadataValid: boolean;
  sizeCompared: boolean;
  sizeMismatch: boolean;
}> {
  const unresolved = {
    found: false,
    missing: false,
    metadataValid: false,
    sizeCompared: false,
    sizeMismatch: false,
  };
  if (!cloudflareAuth) return unresolved;
  let cursor: string | undefined;
  const visited = new Set<string>();
  // Prefix is the complete key. Pagination avoids treating a partial list as proof of absence.
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ prefix: key, per_page: "100" });
    if (cursor) query.set("cursor", cursor);
    const body = await cloudflareMetadata(
      `/accounts/${cloudflareAuth.accountId}/r2/buckets/vela-media-staging/objects`,
      query,
    );
    if (!Array.isArray(body.result)) return unresolved;
    const matches = body.result.filter((value) => isRecord(value) && value.key === key);
    if (matches.length > 1) return unresolved;
    if (matches.length === 1 && isRecord(matches[0])) {
      const object = matches[0];
      const validSize =
        typeof object.size === "number" && Number.isSafeInteger(object.size) && object.size >= 0;
      const metadataValid =
        validSize &&
        typeof object.etag === "string" &&
        object.etag.length > 0 &&
        typeof object.last_modified === "string" &&
        Number.isFinite(Date.parse(object.last_modified));
      const sizeCompared =
        validSize &&
        expectedBytes !== null &&
        Number.isSafeInteger(expectedBytes) &&
        expectedBytes >= 0;
      return {
        found: true,
        missing: false,
        metadataValid,
        sizeCompared,
        sizeMismatch: sizeCompared && object.size !== expectedBytes,
      };
    }
    if (!isRecord(body.result_info)) return unresolved;
    if (body.result_info.is_truncated === false) return { ...unresolved, missing: true };
    const next = body.result_info.cursor;
    if (typeof next !== "string" || next.length === 0 || visited.has(next)) return unresolved;
    visited.add(next);
    cursor = next;
  }
  return unresolved;
}

async function verifyMedia(value: Snapshot, sampleMatched: boolean): Promise<MediaEvidence> {
  const evidence: MediaEvidence = {
    bucket: "vela-media-staging",
    method: "cloudflare_r2_list_objects_metadata_only",
    status: value.mediaKeys.length === 0 ? "not_exercised" : "needs_review",
    sampledCount: value.mediaKeys.length,
    foundCount: 0,
    missingCount: 0,
    unverifiedCount: 0,
    metadataValidatedCount: 0,
    sizeComparedCount: 0,
    sizeMismatchCount: 0,
    checkedAt: new Date().toISOString(),
  };
  if (value.mediaKeys.length === 0) return evidence;
  if (!sampleMatched) {
    evidence.unverifiedCount = value.mediaKeys.length;
    return evidence;
  }
  try {
    await stagingCloudflareCredentials();
    for (let index = 0; index < value.mediaKeys.length; index += 1) {
      try {
        const result = await inspectMediaObject(
          value.mediaKeys[index] ?? "",
          value.mediaExpectedBytes[index] ?? null,
        );
        if (result.found) evidence.foundCount += 1;
        if (result.missing) evidence.missingCount += 1;
        if (!result.found && !result.missing) evidence.unverifiedCount += 1;
        if (result.metadataValid) evidence.metadataValidatedCount += 1;
        if (result.sizeCompared) evidence.sizeComparedCount += 1;
        if (result.sizeMismatch) evidence.sizeMismatchCount += 1;
      } catch {
        evidence.unverifiedCount += 1;
      }
    }
  } catch {
    evidence.unverifiedCount = value.mediaKeys.length;
  } finally {
    if (cloudflareAuth) cloudflareAuth.token = "";
    cloudflareAuth = undefined;
  }
  evidence.checkedAt = new Date().toISOString();
  if (
    evidence.foundCount === evidence.sampledCount &&
    evidence.metadataValidatedCount === evidence.sampledCount &&
    evidence.missingCount === 0 &&
    evidence.unverifiedCount === 0 &&
    evidence.sizeMismatchCount === 0
  ) {
    evidence.status = "verified";
  }
  return evidence;
}

async function clearPrivateState(): Promise<void> {
  if (overallDeadlineTimer) clearTimeout(overallDeadlineTimer);
  overallDeadlineTimer = undefined;
  cancelInput?.();
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // The terminal may already be gone after SIGHUP.
    }
  }
  process.stdin.pause();
  keyCheckChild?.kill("SIGTERM");
  keyCheckChild = undefined;
  for (const controller of metadataRequests) controller.abort();
  metadataRequests.clear();
  if (cloudflareAuth) cloudflareAuth.token = "";
  cloudflareAuth = undefined;
  sourceConnection = undefined;
  restoredConnection = undefined;
  savedKey = undefined;
  decodedKey?.fill(0);
  decodedKey = undefined;
  if (sourceSnapshot) {
    sourceSnapshot.mediaKeys.length = 0;
    sourceSnapshot.mediaExpectedBytes.length = 0;
  }
  if (restoredSnapshot) {
    restoredSnapshot.mediaKeys.length = 0;
    restoredSnapshot.mediaExpectedBytes.length = 0;
  }
  await Promise.allSettled([...clients].map((client) => client.end()));
  clients.clear();
}

async function signalExit(
  code: number,
  status: "interrupted" | "incomplete" = "interrupted",
  failure = "private_session_interrupted",
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  receipt = {
    ...receipt,
    status,
    failure,
    drillComplete: false,
  };
  if (lockOwned) await saveReceipt().catch(() => {});
  await Promise.race([
    clearPrivateState(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  await releaseOwnedFile(sessionLockPath);
  await releaseOwnedFile(`${sessionLockPath}.reclaim`);
  process.exit(code);
}

process.once("SIGINT", () => void signalExit(130));
process.once("SIGTERM", () => void signalExit(143));
process.once("SIGHUP", () => void signalExit(129));

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    say("Open the backup-recovery launcher in your own Terminal window.");
    process.exitCode = 1;
    return;
  }
  await acquireSessionLock();
  await saveReceipt();
  say("Check that Vela can recover its saved test messages");
  say();
  say("This reads the test system and a recovery copy. It does not change saved messages.");
  say("Keep this window open until engineering finishes creating the recovery copy.");
  say("Use your existing saved protection key. Do not generate a replacement.");
  say("Keep the connections, key, and full terminal output private.");
  say();
  say("1. Open console.neon.tech and select the project vela-staging.");
  say("2. Click Connect. Keep the default branch, database neondb, and role neondb_owner.");
  say(
    "   Its default branch is named production; inside vela-staging it is still the test system.",
  );
  say("3. Turn Connection pooling OFF, then click Copy.");
  say("4. Paste the copied connection below, then press Return.");
  say("   No characters appear while you paste. This is normal.");
  sourceConnection = normalizedConnection(
    await terminalInput("Test-system connection (hidden): ", true),
    sourceHost,
  );
  if (sourceConnection === undefined) {
    receipt = { ...receipt, status: "needs_review", failure: "source_connection_not_accepted" };
    await saveReceipt();
    say("That connection does not match Vela’s test system. No database check started.");
    say('Tell Codex: "backup check did not accept the test connection".');
    process.exitCode = 1;
    return;
  }
  say();
  say("5. Open your password manager entry:");
  say("   Vela — test system — content encryption key (CONTENT_KEY_V1)");
  say("6. Copy the existing key and paste it below, then press Return.");
  savedKey = (await terminalInput("Saved message-protection key (hidden): ", true)).trim();
  try {
    decodedKey = decodeContentKey(savedKey);
  } catch {
    receipt = { ...receipt, status: "needs_review", failure: "saved_key_format_not_accepted" };
    await saveReceipt();
    say("That saved key was not accepted. Do not create another key.");
    say('Tell Codex: "backup check did not accept the saved key".');
    process.exitCode = 1;
    return;
  }
  say("Recording the recovery point. Please keep this window open.");
  sourceSnapshot = await snapshot(sourceConnection);
  const capturedAt = new Date().toISOString();
  const earliestCreationTime = Date.now() + 5 * 60_000;
  const branchReadyDeadline = Date.now() + 30 * 60_000;
  const sourceChecksPass = sourceSnapshot.migration !== null && hasRequiredIndexes(sourceSnapshot);
  receipt = {
    ...receipt,
    status: sourceChecksPass ? "awaiting_restore" : "needs_review",
    ...(sourceChecksPass ? {} : { failure: "source_database_checks_not_satisfied" }),
    t0: sourceSnapshot.t0,
    capturedAt,
    restoreEarliestAt: new Date(earliestCreationTime).toISOString(),
    branchReadyDeadlineAt: new Date(branchReadyDeadline).toISOString(),
    ...publicSnapshot(sourceSnapshot),
    sourceSnapshot: publicSnapshot(sourceSnapshot),
    keyProof: "pending_on_restored_branch",
    localConfiguration: "not_changed_environment_only",
  };
  await saveReceipt();
  if (!sourceChecksPass) {
    say("Engineering needs to check the test database before creating the recovery copy.");
    say('Tell Codex: "backup check found a database setup issue".');
    process.exitCode = 1;
    return;
  }
  say();
  say(`Recovery point (T0): ${sourceSnapshot.t0}`);
  say("T0 is rounded down to the minute so it matches the recovery-time picker exactly.");
  say(`Suggested recovery-copy name: ${proposedBranchName}`);
  say("The recovery point is recorded. This is not yet a completed recovery check.");
  say("Engineering must wait five minutes, then create a copy in vela-staging:");
  say("Branches → New branch → parent: the default branch → from a specific date and time: T0.");
  say("The saved record contains no key, connection password, or message content.");
  say();
  say("Waiting automatically while engineering creates and verifies the recovery copy.");
  say("You do not need to press Return. This window normally continues without more input.");
  const sourceT0 = sourceSnapshot.t0;
  const readyBranch = await waitForManifest(
    () => readBranchReady(sourceT0, earliestCreationTime),
    branchReadyDeadline,
    "recovery_branch_wait_timed_out",
  );
  const overallDeadline = Date.parse(readyBranch.creationStartedAt) + 55 * 60_000;
  if (Date.now() >= overallDeadline) {
    timeoutFailure = "overall_verification_deadline_exceeded";
    throw new Error("private verification deadline exceeded");
  }
  overallDeadlineTimer = setTimeout(() => {
    timeoutFailure = "overall_verification_deadline_exceeded";
    say("The recovery check reached its time limit before completion.");
    say('Tell Codex: "backup check timed out". Engineering will arrange a fresh attempt.');
    void signalExit(1, "incomplete", timeoutFailure);
  }, overallDeadline - Date.now());
  receipt = {
    ...receipt,
    status: "awaiting_target_verification",
    recoveryBranch: readyBranch,
    overallVerificationDeadlineAt: new Date(overallDeadline).toISOString(),
  };
  await saveReceipt();
  say();
  say("Engineering is verifying the recovery copy’s address. No more input is needed yet.");
  say("After verification, this window will try the connection you already supplied privately.");
  const targetDeadline = Math.min(Date.now() + 30 * 60_000, overallDeadline);
  receipt = { ...receipt, targetVerificationDeadlineAt: new Date(targetDeadline).toISOString() };
  await saveReceipt();
  const target = await waitForManifest(
    () =>
      readTarget(
        sourceT0,
        earliestCreationTime,
        readyBranch.branchId,
        Date.parse(readyBranch.creationStartedAt),
      ),
    targetDeadline,
    "recovery_target_wait_timed_out",
  );
  if (sourceConnection === undefined) throw new Error("private source connection unavailable");
  restoredConnection = normalizedConnection(
    childConnection(sourceConnection, target.host),
    target.host,
  );
  sourceConnection = undefined;
  if (restoredConnection === undefined) throw new Error("unverified recovery connection");
  receipt = {
    ...receipt,
    status: "checking_restored_database",
    restoreTarget: target,
    credentialMode: "source_role_in_memory",
    connectionAttempts: 1,
  };
  await saveReceipt();
  say("Comparing the recovery copy and checking whether its protected message opens.");
  try {
    restoredSnapshot = await snapshot(restoredConnection, sourceSnapshot.t0);
  } catch (error) {
    if (!(error instanceof ChildPasswordRejected)) throw error;
    restoredConnection = undefined;
    receipt = {
      ...receipt,
      status: "awaiting_private_recovery_connection",
      inheritedPasswordRejected: true,
      credentialMode: "private_child_connection",
    };
    await saveReceipt();
    say(
      "The recovery copy needs its own private connection. Your saved protection key is still here; no new key is needed.",
    );
    say("In vela-staging, open this recovery copy and click Connect:");
    say(`Recovery-copy name: ${readyBranch.branchName}`);
    say("Choose neondb and neondb_owner, turn Connection pooling OFF, then Copy.");
    const candidate = normalizedConnection(
      await terminalInput("Recovery-copy connection (hidden): ", true),
      target.host,
    );
    if (candidate === undefined) throw new Error("private child connection not accepted");
    restoredConnection = candidate;
    receipt = { ...receipt, status: "awaiting_target_verification" };
    await saveReceipt();
    const refreshedTarget = await waitForManifest(
      () =>
        readTarget(
          sourceT0,
          earliestCreationTime,
          readyBranch.branchId,
          Date.parse(readyBranch.creationStartedAt),
        ),
      Math.min(Date.now() + 30 * 60_000, overallDeadline),
      "recovery_target_wait_timed_out",
    );
    restoredConnection = normalizedConnection(restoredConnection, refreshedTarget.host);
    if (restoredConnection === undefined) throw new Error("unverified private child connection");
    receipt = {
      ...receipt,
      status: "checking_restored_database",
      restoreTarget: refreshedTarget,
      connectionAttempts: 2,
    };
    await saveReceipt();
    // One private fallback only. Any second rejection, query or network error stops.
    restoredSnapshot = await snapshot(restoredConnection, sourceSnapshot.t0);
  }
  const keyProof = await restoredKeyProof(restoredConnection, savedKey);
  const differences = tables
    .filter(([table]) => sourceSnapshot?.counts[table] !== restoredSnapshot?.counts[table])
    .map(([table]) => ({
      table,
      sourceCount: sourceSnapshot?.counts[table],
      restoredCount: restoredSnapshot?.counts[table],
    }));
  const migrationMatched =
    sourceSnapshot.migration !== null &&
    JSON.stringify(sourceSnapshot.migration) === JSON.stringify(restoredSnapshot.migration);
  const indexesMatched =
    hasRequiredIndexes(restoredSnapshot) &&
    JSON.stringify(sourceSnapshot.indexes) === JSON.stringify(restoredSnapshot.indexes);
  const mediaSampleMatched =
    JSON.stringify(sourceSnapshot.mediaKeys) === JSON.stringify(restoredSnapshot.mediaKeys) &&
    JSON.stringify(sourceSnapshot.mediaExpectedBytes) ===
      JSON.stringify(restoredSnapshot.mediaExpectedBytes);
  const databaseVerified =
    differences.length === 0 &&
    migrationMatched &&
    indexesMatched &&
    mediaSampleMatched &&
    keyProof === "opens";
  say("Checking whether the sampled saved files exist in the test system’s storage.");
  const mediaEvidence = await verifyMedia(restoredSnapshot, mediaSampleMatched);
  if (shuttingDown) throw new Error("cancelled");
  if (overallDeadlineTimer) clearTimeout(overallDeadlineTimer);
  overallDeadlineTimer = undefined;
  const databaseCheckedAt = new Date().toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(target.creationStartedAt)) / 1000),
  );
  receipt = {
    ...receipt,
    status:
      databaseVerified && mediaEvidence.status !== "needs_review"
        ? "database_verified"
        : "needs_review",
    databaseVerified,
    databaseCheckedAt,
    databaseVerifiedAt: databaseVerified ? databaseCheckedAt : null,
    restoredSnapshot: publicSnapshot(restoredSnapshot),
    countsMatched: differences.length === 0,
    differences,
    differencesExplained: differences.length === 0 ? "not_needed" : "pending_engineering_review",
    migrationMatched,
    indexesMatched,
    mediaSampleMatched,
    keyProof,
    databaseVerificationElapsedSeconds: elapsedSeconds,
    recoveryTimerStartedAt: target.creationStartedAt,
    recoveryTimerStopped: false,
    mediaCheck:
      mediaEvidence.status === "not_exercised"
        ? "no_eligible_media_presence_check_not_exercised"
        : mediaEvidence.status,
    mediaEvidence,
    branchDeleted: false,
    localConfiguration: "not_changed_environment_only",
    drillComplete: false,
  };
  await saveReceipt();
  say();
  if (databaseVerified && mediaEvidence.status !== "needs_review") {
    say("The recovery copy matches the database checks, and its protected message opened.");
    if (mediaEvidence.status === "verified")
      say(`All ${mediaEvidence.sampledCount} sampled saved files were found in test storage.`);
    else say("There were no eligible saved files to sample; file recovery was not exercised.");
    say('Tell Codex: "backup database check completed".');
  } else {
    say("The recovery copy needs engineering review. This check is not complete.");
    if (keyProof === "does not open")
      say("The saved key did not open the recovery copy’s message.");
    if (keyProof === "no sealed value available")
      say("The recovery copy had no protected message available for the key check.");
    if (differences.length > 0) say("Some database counts differ. Engineering must explain them.");
    if (mediaEvidence.missingCount > 0)
      say(
        `${mediaEvidence.missingCount} sampled saved files were missing. Engineering must investigate.`,
      );
    if (mediaEvidence.status === "needs_review" && mediaEvidence.missingCount === 0)
      say("The saved-file metadata checks need engineering review.");
    say('Tell Codex: "backup database check needs review".');
    process.exitCode = 1;
  }
  say("Engineering must delete the recovery copy and resolve any remaining review items.");
  say("The full recovery rehearsal remains open until those actions are confirmed.");
}

try {
  await main();
} catch {
  if (!shuttingDown && lockOwned) {
    receipt = {
      ...receipt,
      status: timeoutFailure ? "incomplete" : "needs_review",
      failure: timeoutFailure ?? "private_database_check_did_not_finish",
      drillComplete: false,
    };
    await saveReceipt().catch(() => {});
    if (timeoutFailure) {
      say(
        "The recovery check timed out before completion. Engineering will arrange a fresh attempt.",
      );
      say('Tell Codex: "backup check timed out". Keep connections and the key private.');
    } else {
      say("The backup database check did not finish. No message content is shown.");
      say('Tell Codex: "backup database check stopped". Keep connections and the key private.');
    }
    process.exitCode = 1;
  } else if (!shuttingDown) {
    say(
      "Another backup-check window may already be open, or its session record needs engineering review.",
    );
    say("Keep the existing window open. This window did not change its check record.");
    process.exitCode = 1;
  }
} finally {
  await clearPrivateState();
  await releaseOwnedFile(sessionLockPath);
  await releaseOwnedFile(`${sessionLockPath}.reclaim`);
}
