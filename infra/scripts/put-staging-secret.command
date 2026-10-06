#!/bin/zsh
# Founder-facing launcher. The secret is read at a hidden prompt and piped straight to
# wrangler; it is never written to a file, shown, or passed as a command argument.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root/apps/worker" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

# The git-ignored apps/worker/.env lives in the main checkout, also when this runs from a worktree.
main_root="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
env_file="$repo_root/apps/worker/.env"
[[ -f "$env_file" ]] || env_file="${main_root:h}/apps/worker/.env"
env_value() {
  [[ -f "$env_file" ]] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -1 | tr -d '[:space:]"'
}

finish() {
  read -r 'done_key?Press Return to close: '
  exit "$1"
}

if ! command -v pnpm >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Claude: "tools missing".'
  finish 1
fi
export CLOUDFLARE_API_TOKEN="$(env_value CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_ACCOUNT_ID="$(env_value CLOUDFLARE_ACCOUNT_ID)"
if [[ -z "$CLOUDFLARE_API_TOKEN" || ! "$CLOUDFLARE_ACCOUNT_ID" =~ '^[0-9a-f]{32}$' ]]; then
  print 'The staging Cloudflare token is missing from apps/worker/.env. Tell Claude: "staging token missing".'
  finish 1
fi

print 'Put a private key on Vela’s TEST system (staging)'
print ''
print 'Which key?'
print '  1. Clerk webhook signing key   (starts whsec_)   → the vela Worker'
print '  2. Anthropic API key           (starts sk-ant-)  → both vela and vela-admin'
print ''
read -r 'choice?Type 1 or 2, then Return: '

case "$choice" in
  1) name=CLERK_WEBHOOK_SIGNING_SECRET; pattern='^whsec_[A-Za-z0-9+/]+={0,2}$'; workers=(pilot) ;;
  2) name=ANTHROPIC_API_KEY; pattern='^sk-ant-[A-Za-z0-9_-]{20,}$'; workers=(pilot admin) ;;
  *) print 'Nothing was changed.'; finish 0 ;;
esac

print ''
print 'Paste the key at the hidden prompt. Nothing appears while you paste; that is normal.'
print 'Never paste it into chat.'
read -rs 'secret?Key: '
print ''
secret="${secret//[[:space:]]/}"
if [[ ! "$secret" =~ $pattern ]]; then
  unset secret
  print 'That does not look like the right kind of key, so nothing was changed.'
  print 'Copy it again from the dashboard and reopen this launcher.'
  finish 1
fi

failed=0
for worker in $workers; do
  if [[ $worker == pilot ]]; then
    label=vela
    print -rn -- "$secret" | pnpm exec wrangler secret put "$name" --env staging >/dev/null 2>&1 || failed=1
  else
    label=vela-admin
    print -rn -- "$secret" | pnpm exec wrangler secret put "$name" --env staging -c wrangler.admin.jsonc >/dev/null 2>&1 || failed=1
  fi
  if (( failed )); then
    print "Could not put $name on $label. Tell Claude: \"secret put failed on $label\"."
    break
  fi
  print "Saved $name on staging $label."
done
unset secret

print ''
if (( failed )); then finish 1; fi
print "Done. Tell Claude: \"$name is on staging\"."
finish 0
