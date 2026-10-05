#!/bin/zsh
# Private prompts live only in this Terminal process; the safe receipt has no credentials.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

if ! command -v node >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Codex: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

node apps/worker/scripts/seed-staging-load-fixture.ts
fixture_status=$?
print ''
read -r 'finish?Press Return after noting the short result: '
exit "$fixture_status"
