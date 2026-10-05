#!/bin/zsh
# The Node helper reads private inputs directly from this terminal. No env files.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

if ! command -v pnpm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Codex: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

print 'Vela backup recovery check'
print ''
print 'Keep this window open while engineering creates a recovery copy of the test system.'
print 'The waiting steps update automatically. You do not need to press Return to continue them.'
print 'Wait for each hidden prompt before pasting a connection or key.'
print 'Normally, enter only the test connection and saved key. The recovery connection is requested only if needed.'
print 'Keep the Vela test app and bot unused throughout this check.'
print 'The connection and saved key prompts are private. Nothing appears while you paste.'
print 'Use your existing protection key from your password manager; do not create a new key.'
print 'Do not paste connections, the key, or the full terminal output into chat.'
print ''

node packages/db/scripts/staging-restore.ts
restore_check_status=$?

print ''
print 'Keep the test app and bot unused until engineering confirms the rehearsal has finished.'
read -r 'finish?Press Return after noting the short result: '
exit "$restore_check_status"
