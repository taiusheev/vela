#!/bin/zsh
# Read-only check of one saved staging message. Never print or persist credentials.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

# Verified from the staging Hyperdrive's nonsecret origin hostname.
# A missing value stops before credential entry; do not infer it from a pasted URL.
expected_staging_host='ep-frosty-night-b31xz5dh.c-4.ap-southeast-1.aws.neon.tech'
receipt_path="$repo_root/infra/load-tests/adr-38-staging-key-check.json"

trap 'unset keycheck_db_url keycheck_content_key check_output DATABASE_URL CONTENT_KEY_V1' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

print 'Check that Vela’s saved messages can be opened'
print ''
print 'This checks one protected message in Vela’s test system. It does not change messages.'
print 'Use the protection key you already saved. Do not generate a new key.'
print 'Keep connection details and the key private; do not paste them into chat.'
print ''

if ! command -v pnpm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Codex: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

if [[ -z "$expected_staging_host" || "$expected_staging_host" != ep-*.neon.tech || "$expected_staging_host" == *-pooler.* ]]; then
  print 'Engineering must finish identifying the test system before this check can start.'
  print 'Tell Codex: "saved-message checker needs the test system address".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

# Remove only a previous receipt produced by this check. A failed repeat cannot
# leave an older success behind. Do not overwrite an unrelated file.
VELA_KEY_CHECK_RECEIPT_PATH="$receipt_path" node --input-type=module <<'NODE' >/dev/null 2>&1
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
const path = process.env.VELA_KEY_CHECK_RECEIPT_PATH;
try {
  if (existsSync(path)) {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    if (receipt.source !== 'seal-check') process.exit(1);
    unlinkSync(path);
  }
} catch {
  process.exit(1);
}
NODE
if (( $? != 0 )); then
  print 'Engineering needs to clear the previous check record before continuing.'
  print 'Tell Codex: "saved-message check record needs attention".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

print '1. Open console.neon.tech and select the project named vela-staging.'
print '2. Click Connect. Keep the default branch, database neondb, and role neondb_owner.'
print '3. Turn Connection pooling OFF, then click Copy.'
print '4. Paste that copied connection into the private prompt below, then press Return.'
print '   No characters appear while you paste. This is normal.'
print ''

read -r -s 'keycheck_db_url?Test-system connection (hidden): '
input_status=$?
print ''
if (( input_status != 0 )); then
  print 'The check was cancelled.'
  exit 1
fi

# The copied connection is passed only through the child environment, never argv.
# Exact origin matching prevents accidentally checking the production project.
VELA_KEY_CHECK_DATABASE_URL="$keycheck_db_url" VELA_KEY_CHECK_EXPECTED_HOST="$expected_staging_host" node --input-type=module <<'NODE' >/dev/null 2>&1
try {
  const connection = new URL(process.env.VELA_KEY_CHECK_DATABASE_URL.trim());
  const expected = process.env.VELA_KEY_CHECK_EXPECTED_HOST;
  if (!['postgresql:', 'postgres:'].includes(connection.protocol)
    || connection.hostname !== expected
    || connection.hostname.includes('-pooler.')
    || (connection.port && connection.port !== '5432')
    || decodeURIComponent(connection.username) !== 'neondb_owner'
    || !connection.password
    || connection.pathname !== '/neondb'
    || connection.hash
    || !['require', 'verify-full'].includes(connection.searchParams.get('sslmode'))) {
    process.exit(1);
  }
} catch {
  process.exit(1);
}
NODE
if (( $? != 0 )); then
  unset keycheck_db_url
  print 'That connection does not match Vela’s test system. The check did not start.'
  print 'Copy it again from vela-staging using the four steps above.'
  print 'Tell Codex: "test-system connection was not accepted".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

print ''
print '5. Open your password manager entry:'
print '   Vela — test system — content encryption key (CONTENT_KEY_V1)'
print '6. Copy the saved key and paste it into the private prompt below, then press Return.'
print '   No characters appear. Use the existing saved key; do not create a replacement.'
print ''
read -r -s 'keycheck_content_key?Saved message-protection key (hidden): '
input_status=$?
print ''
if (( input_status != 0 )); then
  print 'The check was cancelled.'
  exit 1
fi

print 'Checking the saved message. Please keep this window open.'
check_output=$(DATABASE_URL="$keycheck_db_url" CONTENT_KEY_V1="$keycheck_content_key" pnpm --filter @vela/db run seal-check 2>&1)
check_status=$?
unset keycheck_db_url keycheck_content_key DATABASE_URL CONTENT_KEY_V1

# Only show recognised, content-free outcomes. Never forward raw tool diagnostics.
proof_opens=false
proof_does_not_open=false
proof_no_message=false
proof_read_failure=false
for check_line in "${(@f)check_output}"; do
  case "$check_line" in
    opens) proof_opens=true ;;
    'does not open') proof_does_not_open=true ;;
    'no sealed value available') proof_no_message=true ;;
    'restore check could not read the restored branch') proof_read_failure=true ;;
  esac
done
unset check_output check_line

print ''
if (( check_status == 0 )) && [[ "$proof_opens" == true ]]; then
  VELA_KEY_CHECK_RECEIPT_PATH="$receipt_path" VELA_KEY_CHECK_EXPECTED_HOST="$expected_staging_host" node --input-type=module <<'NODE' >/dev/null 2>&1
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
try {
  const path = process.env.VELA_KEY_CHECK_RECEIPT_PATH;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
  });
  const head = git.status === 0 && /^[0-9a-f]{40,64}$/.test(git.stdout.trim())
    ? git.stdout.trim() : null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    source: 'seal-check', proof: 'opens', environment: 'staging',
    scope: 'one stored content value', databaseHost: process.env.VELA_KEY_CHECK_EXPECTED_HOST,
    timestamp: new Date().toISOString(), localGitHead: head,
  }, null, 2)}\n`, { mode: 0o644 });
} catch {
  process.exit(1);
}
NODE
  if (( $? == 0 )); then
    print 'Your saved protection key opened a protected message. The check is complete.'
    print 'Tell Codex: "saved-message check completed".'
  else
    check_status=1
    print 'The key opened a message, but engineering could not save the check record.'
    print 'Tell Codex: "saved-message check record could not be saved".'
  fi
elif [[ "$proof_does_not_open" == true ]]; then
  print 'This saved protection key did not open the message.'
  print 'Tell Codex: "saved key did not open". Keep the key private.'
elif [[ "$proof_no_message" == true ]]; then
  print 'The test system has no saved message available to check.'
  print 'Tell Codex: "no saved message available".'
elif [[ "$proof_read_failure" == true ]]; then
  print 'The test system could not be reached for this check.'
  print 'Tell Codex: "saved-message check could not connect".'
else
  check_status=1
  print 'The saved-message check did not finish.'
  print 'Tell Codex: "saved-message check did not finish". Keep the key and connection private.'
fi

read -r 'finish?Press Return after noting the result: '
exit "$check_status"
