#!/bin/zsh
# The runner owns hidden inputs; this launcher never reads a credential.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

if ! command -v node >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Codex: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

if command -v k6 >/dev/null 2>&1; then
  speed_binary="$(command -v k6)"
else
  # Official Grafana v2.3.0 portable archive, already downloaded and checksum-verified.
  speed_binary="/tmp/vela-k6-v2.3.0/k6-v2.3.0-macos-arm64/k6"
  speed_expected_hash="efb8282e24ffe18f54ce3679eaa71d72e0645bbb97b14e2a05cc8b192abf48e3"
  speed_actual_hash="$(shasum -a 256 "$speed_binary" 2>/dev/null)"
  speed_actual_hash="${speed_actual_hash%% *}"
  if [[ ! -x "$speed_binary" || "$speed_actual_hash" != "$speed_expected_hash" ]]; then
    print 'Engineering needs to prepare the speed-check tool again. No check started.'
    print 'Tell Codex: "speed-check tool missing".'
    read -r 'finish?Press Return to close: '
    exit 1
  fi
fi

print 'Vela test-system speed check'
print ''
print 'Engineering must prepare the separate synthetic test family first.'
print 'Use its dedicated phone sign-in; keep ordinary test accounts and the bot idle.'
print 'The private prompts need the existing Clerk Development key and the test sign-in ID.'
print 'No session token is copied from your phone. No messages or credentials go into the report.'
print 'Keep this window open for the full five-minute check.'
print ''

K6_BINARY="$speed_binary" node infra/load-tests/run-local-k6.mjs
speed_status=$?
print ''
read -r 'finish?Press Return after noting the short result: '
exit "$speed_status"
