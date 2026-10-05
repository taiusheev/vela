/** Founder-run private staging check. Provider credentials stay in this process only. */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PrivateLoadError, STAGING_ISSUER, STAGING_ORIGIN, UUID,
  askHidden, bridgeFor, checkOrganiser, makeTokenSource, refuse,
} from "./private-session-token.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const summaryPath = join(repoRoot, "infra/load-tests/adr-38-staging-summary.json");
const evidencePath = join(repoRoot, "infra/load-tests/adr-38-staging-session-check.json");
const fixturePath = join(repoRoot, "infra/load-tests/adr-38-staging-fixture.json");
const fixtureDatabaseHost = "ep-frosty-night-b31xz5dh.c-4.ap-southeast-1.aws.neon.tech";

async function requireVerifiedFixture() {
  let receipt;
  let info;
  try {
    const contents = await readFile(fixturePath, "utf8");
    if (contents.length > 16_384) refuse("The isolated test-family receipt could not be checked.");
    receipt = JSON.parse(contents);
    info = await stat(fixturePath);
  } catch {
    refuse("Engineering must prepare and verify the isolated synthetic family before this check can run.");
  }
  const checkedAt = typeof receipt?.checkedAt === "string" ? Date.parse(receipt.checkedAt) : NaN;
  const now = Date.now();
  if (receipt?.source !== "staging-load-fixture-helper" || receipt?.schemaVersion !== 1 ||
    receipt?.environment !== "staging" || receipt?.databaseHost !== fixtureDatabaseHost ||
    !Number.isFinite(checkedAt) || checkedAt > now || checkedAt < now - 24 * 60 * 60 * 1000 ||
    typeof receipt?.userId !== "string" || !/^user_[A-Za-z0-9]{1,120}$/.test(receipt.userId) ||
    typeof receipt?.familyId !== "string" || !UUID.test(receipt.familyId) ||
    typeof receipt?.created !== "boolean" ||
    !["sourceKeyVerified", "fixtureVerified", "ciphertextVerified", "apiDecoded", "noDeliveryRoutesVerified"]
      .every((name) => receipt[name] === true)) {
    refuse("The isolated test-family proof is incomplete. Engineering must verify it before this check can run.");
  }
  return {
    userId: receipt.userId, familyId: receipt.familyId,
    checkedAt: new Date(checkedAt).toISOString(), modifiedAt: info.mtime.toISOString(),
  };
}

function printSafeSummary(summary) {
  const metrics = summary?.metrics ?? {};
  const values = (name) => metrics[name]?.values ?? metrics[name] ?? {};
  for (const [label, value] of [
    ["Vela reads attempted", values("vela_requests").count],
    ["Vela p95 response time (milliseconds)", values("http_req_duration{service:vela-load}")["p(95)"]],
    ["Vela failed-request fraction", values("http_req_failed{service:vela-load}").rate ?? values("http_req_failed{service:vela-load}").value],
    ["Responses with decoded synthetic content (fraction)", values("content_decoded").rate ?? values("content_decoded").value],
    ["Missed scheduled iterations", values("dropped_iterations").count],
  ]) {
    if (typeof value === "number" && Number.isFinite(value)) console.log(`${label}: ${value}`);
  }
}

async function run() {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log("Run node infra/load-tests/run-local-k6.mjs in your private Terminal.");
    console.log("It asks for the Development provider key and native test sign-in ID.");
    console.log("The verified fixture receipt supplies the test account and family IDs; no session token is copied or printed.");
    return;
  }
  let secretKey = "";
  let source;
  let bridge;
  let refreshTimer;
  let refreshInFlight = null;
  let temporaryConfig;
  let child;
  let failure = null;
  let interrupted = false;
  const cancellation = new AbortController();
  const evidence = {
    attempt_id: randomUUID(), outcome: "in_progress",
    environment: "staging", issuer: STAGING_ISSUER, staging_origin: STAGING_ORIGIN,
    started_at_utc: new Date().toISOString(), session_active: false,
    signed_native_token_verified: false, organiser_membership_verified: false,
    fixture_receipt_verified: false,
    requested_token_lifetime_seconds: 60, credential_or_content_included: false,
    load_completed: false,
  };
  const checkInterrupted = () => {
    if (interrupted) refuse("The load check was interrupted. No passing result was recorded.");
  };
  const onSignal = () => {
    interrupted = true;
    cancellation.abort();
    child?.kill("SIGTERM");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  try {
    // Reset evidence before even a cancelled prompt or refused input, so old success cannot
    // survive as the apparent result of this fresh attempt.
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await rm(summaryPath, { force: true });
    checkInterrupted();
    if (process.argv.length !== 2) refuse("This private check accepts no command-line credentials.");
    const expectedPeak = Number(process.env.EXPECTED_PEAK_REQUESTS_PER_MINUTE ?? "10");
    if (!Number.isFinite(expectedPeak) || expectedPeak <= 0 || Math.ceil(expectedPeak * 10) >= 120) {
      refuse("The planned load is outside staging's permitted rate. Ask engineering to check the baseline.");
    }
    evidence.planned_reads_per_minute = Math.ceil(expectedPeak * 10);
    const fixture = await requireVerifiedFixture();
    checkInterrupted();
    const { userId, familyId } = fixture;
    evidence.fixture_receipt_modified_at_utc = fixture.modifiedAt;
    evidence.fixture_receipt_checked_at_utc = fixture.checkedAt;
    evidence.fixture_receipt_verified = true;
    console.log("This runs a five-minute read check against Vela's test system, using only a dedicated synthetic family.");
    console.log("The verified synthetic family and test account are selected automatically.");
    console.log("Copy the Development secret key from Clerk → Vela Light → Development → API keys.");
    secretKey = await askHidden("Development secret key", (value) => /^sk_test_[A-Za-z0-9_-]+$/.test(value),
      "Use the Development key, beginning sk_test_. A production key is refused.", cancellation.signal);
    console.log("In the native test app, open the engineering test details. Copy the sign-in ID, not a session token.");
    const sessionId = await askHidden("Native test sign-in ID", (value) => /^sess_[A-Za-z0-9_-]{1,200}$/.test(value),
      "Copy the sign-in ID beginning sess_.", cancellation.signal);
    checkInterrupted();
    source = await makeTokenSource(secretKey, sessionId, userId);
    checkInterrupted();
    await source.refresh();
    checkInterrupted();
    evidence.session_active = true;
    evidence.signed_native_token_verified = true;
    evidence.actual_token_lifetime_seconds = source.current.lifetimeSeconds;
    await checkOrganiser(source.current.token, familyId);
    checkInterrupted();
    evidence.organiser_membership_verified = true;
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    checkInterrupted();
    console.log("Private preflight passed: active test sign-in, verified native token, and organiser access to the synthetic family.");
    const capability = randomBytes(32).toString("base64url");
    bridge = bridgeFor(source, capability);
    bridge.requestTimeout = 5_000;
    bridge.headersTimeout = 5_000;
    await new Promise((resolve, reject) => {
      bridge.once("error", reject);
      bridge.listen(0, "127.0.0.1", resolve);
    });
    checkInterrupted();
    const address = bridge.address();
    if (address === null || typeof address === "string") refuse("The private token bridge could not start.");
    temporaryConfig = await mkdtemp(join(tmpdir(), "vela-private-k6-"));
    checkInterrupted();
    const configPath = join(temporaryConfig, "config.json");
    await writeFile(configPath, "{}\n", { mode: 0o600 });
    checkInterrupted();
    refreshTimer = setInterval(() => {
      if (refreshInFlight !== null) return;
      refreshInFlight = source.refresh()
        .catch((error) => { failure = error; child?.kill("SIGTERM"); })
        .finally(() => { refreshInFlight = null; });
    }, 30_000);
    console.log(`Running ${Math.ceil(expectedPeak * 10)} Vela reads per minute for five minutes. Test sign-in refreshes automatically.`);
    const result = await new Promise((resolve) => {
      checkInterrupted();
      child = spawn(process.env.K6_BINARY ?? "k6", [
        "run", `--config=${configPath}`, "--http-debug=", "--include-system-env-vars",
        "--summary-export=infra/load-tests/adr-38-staging-summary.json",
        "infra/load-tests/adr-38-content-read.js",
      ], {
        cwd: repoRoot,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: process.env.TMPDIR ?? "/tmp",
          K6_HTTP_DEBUG: "", K6_NO_USAGE_REPORT: "true",
          LOAD_TEST_TOKEN_BRIDGE: `http://127.0.0.1:${address.port}/session-token`,
          LOAD_TEST_TOKEN_CAPABILITY: capability, LOAD_TEST_FAMILY_ID: familyId,
          EXPECTED_PEAK_REQUESTS_PER_MINUTE: String(expectedPeak),
        },
        // Only the curated numeric summary reaches the terminal. No child debug/error output
        // can accidentally print a request, JWT, capability or family message.
        stdio: "ignore", windowsHide: true,
      });
      child.once("error", () => resolve({ code: 127, signal: null }));
      child.once("close", (code, signal) => resolve({ code: code ?? 1, signal }));
    });
    clearInterval(refreshTimer);
    if (refreshInFlight !== null) await refreshInFlight;
    if (failure !== null) throw failure;
    if (interrupted || result.signal !== null) refuse("The load check was interrupted. No passing result was recorded.");
    if (result.code === 127) refuse("Local k6 could not start. Ask engineering to check its installation.");
    let summary;
    try { summary = JSON.parse(await readFile(summaryPath, "utf8")); }
    catch { refuse("The load check produced no readable summary. Ask engineering to check this step."); }
    checkInterrupted();
    printSafeSummary(summary);
    evidence.load_exit_code = result.code;
    evidence.load_completed = result.code === 0;
    process.exitCode = result.code;
    console.log(result.code === 0
      ? "Load thresholds passed. Engineering will review the saved numeric report."
      : "Load thresholds did not pass. Engineering will review the saved numeric report.");
  } finally {
    if (refreshTimer !== undefined) clearInterval(refreshTimer);
    if (refreshInFlight !== null) await refreshInFlight;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
    if (bridge !== undefined) await new Promise((resolve) => {
      bridge.close(resolve);
      bridge.closeAllConnections();
    });
    if (temporaryConfig !== undefined) await rm(temporaryConfig, { recursive: true, force: true });
    evidence.finished_at_utc = new Date().toISOString();
    if (interrupted) evidence.load_completed = false;
    evidence.outcome = interrupted ? "interrupted" : evidence.load_completed ? "passed" : "failed";
    evidence.verified_token_count = source?.refreshCount ?? 0;
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    source?.clear();
    secretKey = "";
  }
}

try { await run(); }
catch (error) {
  console.error(error instanceof PrivateLoadError ? error.message
    : "The private load check could not complete. Ask engineering to check this step; do not share keys or full terminal output.");
  process.exitCode = 1;
}
