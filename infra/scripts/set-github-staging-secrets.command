#!/bin/zsh
# Founder-facing launcher. Puts the three staging deploy secrets into GitHub's protected
# `staging` environment. The Cloudflare token and account id are read from the git-ignored
# apps/worker/.env; the database connection is read at a hidden prompt. Nothing is shown,
# written to a file, or passed as a command argument.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

finish() {
  read -r 'done_key?Press Return to close: '
  exit "$1"
}


# The git-ignored apps/worker/.env lives in the main checkout, also when this runs from a worktree.
main_root="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
env_file="$repo_root/apps/worker/.env"
[[ -f "$env_file" ]] || env_file="${main_root:h}/apps/worker/.env"
env_value() {
  [[ -f "$env_file" ]] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -1 | tr -d '[:space:]"'
}

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  print 'GitHub is not signed in on this Mac. Tell Claude: "gh not signed in".'
  finish 1
fi
token="$(env_value CLOUDFLARE_API_TOKEN)"
account="$(env_value CLOUDFLARE_ACCOUNT_ID)"
if [[ -z "$token" || ! "$account" =~ '^[0-9a-f]{32}$' ]]; then
  unset token account
  print 'The staging Cloudflare token or account id is missing from apps/worker/.env. Tell Claude: "staging token missing".'
  finish 1
fi

print 'Let GitHub deploy Vela’s TEST system (staging) automatically'
print ''
print 'After this, every change merged into main is checked and then deployed to staging,'
print 'including database updates. Production is not affected.'
print ''
print 'You need the DIRECT connection string of the Neon project vela-staging:'
print '  Neon console → vela-staging → Connect → turn "Connection pooling" OFF → copy the string.'
print 'Paste it at the hidden prompt. Nothing appears while you paste; that is normal.'
print 'Never paste it into chat.'
read -rs 'database_url?Staging connection string (direct): '
print ''
database_url="${database_url//[[:space:]]/}"
database_url="${database_url#psql}"
database_url="${database_url//\'/}"

if [[ ! "$database_url" =~ '^postgres(ql)?://[^/]+@ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech(:5432)?/[A-Za-z0-9_]+' ]]; then
  unset database_url token account
  print 'That does not look like a Neon connection string, so nothing was changed.'
  finish 1
fi
if [[ "$database_url" == *-pooler.* ]]; then
  unset database_url token account
  print 'That is the pooled string. Turn "Connection pooling" off in Neon, copy again, and reopen this launcher.'
  finish 1
fi
if [[ "$database_url" != *ep-frosty-night-b31xz5dh* ]]; then
  unset database_url token account
  print 'That connection is not the vela-staging production branch this launcher expects, so nothing was changed.'
  print 'Tell Claude: "staging host differs".'
  finish 1
fi

failed=0
print -rn -- "$database_url" | gh secret set DATABASE_URL --env staging >/dev/null 2>&1 || failed=1
(( failed )) || print -rn -- "$token" | gh secret set CLOUDFLARE_API_TOKEN --env staging >/dev/null 2>&1 || failed=1
(( failed )) || print -rn -- "$account" | gh secret set CLOUDFLARE_ACCOUNT_ID --env staging >/dev/null 2>&1 || failed=1
unset database_url token account

print ''
if (( failed )); then
  print 'GitHub refused one of the secrets. Tell Claude: "github secrets failed".'
  finish 1
fi
print 'Saved DATABASE_URL, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub’s staging environment.'
print 'Done. Tell Claude: "staging deploy secrets are in GitHub".'
finish 0
