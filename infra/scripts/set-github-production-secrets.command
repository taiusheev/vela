#!/bin/zsh
# Founder-facing launcher. Puts the three production deploy secrets into GitHub's protected
# `production` environment, so a reviewed `v*` tag deploys production through CI instead of a
# laptop. Both the Cloudflare CI token and the database connection are read at hidden prompts;
# nothing is shown, written to a file, or passed as a command argument.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

# The "Vela" production account (an identifier, not a secret; infra/README.md resource register).
PRODUCTION_ACCOUNT=012bda634ba44b6c13c6bba300a65eac
PRODUCTION_HOST=ep-late-mode-b3bfn7bh

finish() {
  read -r 'done_key?Press Return to close: '
  exit "$1"
}

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  print 'GitHub is not signed in on this Mac. Tell Claude: "gh not signed in".'
  finish 1
fi

print 'Let GitHub deploy Vela’s PRODUCTION system from a release you approve'
print ''
print 'After this, a release tag (v0.1.1, …) that you approve in GitHub is checked and deployed'
print 'to production by GitHub, including database updates. Nothing deploys without your approval.'
print ''
print 'You need two things, each pasted at a hidden prompt (nothing appears while you paste):'
print '  1. The Cloudflare token "vela-ci-production" (Claude prepared the form in the browser).'
print '  2. The DIRECT connection string of the Neon project vela:'
print '     Neon console → vela → Connect → turn "Connection pooling" OFF → copy the string.'
print 'Never paste either into chat.'
print ''
read -rs 'token?Cloudflare token vela-ci-production: '
print ''
token="${token//[[:space:]]/}"
if (( ${#token} < 30 )); then
  unset token
  print 'That is too short to be a whole Cloudflare token, so nothing was changed.'
  print 'Use the copy icon next to the token rather than selecting it by hand, and reopen this launcher.'
  finish 1
fi
# The header goes to curl on standard input, never as an argument other processes could see.
verify="$(print -r -- "Authorization: Bearer $token" | curl -s -H @- https://api.cloudflare.com/client/v4/user/tokens/verify 2>/dev/null)"
if [[ "$verify" != *'"status":"active"'* ]]; then
  unset token verify
  print 'Cloudflare does not accept that token, so nothing was changed.'
  print 'Check it is vela-ci-production (not an R2 key), copy it with the copy icon, and reopen this launcher.'
  finish 1
fi
unset verify

read -rs 'database_url?Production connection string (direct): '
print ''
database_url="${database_url//[[:space:]]/}"
database_url="${database_url#psql}"
database_url="${database_url//\'/}"
if [[ ! "$database_url" =~ '^postgres(ql)?://[^/]+@ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech(:5432)?/[A-Za-z0-9_]+' ]]; then
  unset database_url token
  print 'That does not look like a Neon connection string, so nothing was changed.'
  finish 1
fi
if [[ "$database_url" == *-pooler.* ]]; then
  unset database_url token
  print 'That is the pooled string. Turn "Connection pooling" off in Neon, copy again, and reopen this launcher.'
  finish 1
fi
if [[ "$database_url" != *"$PRODUCTION_HOST"* ]]; then
  unset database_url token
  print 'That connection is not the production project vela, so nothing was changed.'
  print 'Tell Claude: "production host differs".'
  finish 1
fi

failed=0
print -rn -- "$database_url" | gh secret set DATABASE_URL --env production >/dev/null 2>&1 || failed=1
(( failed )) || print -rn -- "$token" | gh secret set CLOUDFLARE_API_TOKEN --env production >/dev/null 2>&1 || failed=1
(( failed )) || print -rn -- "$PRODUCTION_ACCOUNT" | gh secret set CLOUDFLARE_ACCOUNT_ID --env production >/dev/null 2>&1 || failed=1
unset database_url token

print ''
if (( failed )); then
  print 'GitHub refused one of the secrets. Tell Claude: "github secrets failed".'
  finish 1
fi
print 'Saved DATABASE_URL, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub’s production environment.'
print 'Done. Tell Claude: "production deploy secrets are in GitHub".'
finish 0
