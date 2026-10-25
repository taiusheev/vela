#!/bin/zsh
# Founder-facing launcher: makes the password RevenueCat sends with each purchase event, puts it on
# Vela's TEST system (staging), and copies it for RevenueCat's webhook page. It is never shown,
# written to a file or passed as a command argument. Production stays off: this never touches it.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root/apps/worker" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

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

print 'Connect RevenueCat to Vela’s TEST system (staging)'
print ''
print 'This makes a new random password, saves it on the test server, and copies it.'
print 'Then you paste it into RevenueCat. Running it again replaces the old password.'
print ''
read -r 'go?Press Return to start, or close this window to stop: '

value="Bearer $(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')"
if [[ ! "$value" =~ '^Bearer [A-Za-z0-9_-]{60,}$' ]]; then
  unset value
  print 'The password could not be made. Nothing was changed. Tell Claude: "password not made".'
  finish 1
fi

if ! print -rn -- "$value" | pnpm exec wrangler secret put REVENUECAT_WEBHOOK_AUTH --env staging >/dev/null 2>&1; then
  unset value
  print 'Could not save it on the test server. Tell Claude: "revenuecat secret put failed".'
  finish 1
fi
print -rn -- "$value" | pbcopy
unset value

print ''
print 'Saved on the test server, and copied. Now, in RevenueCat:'
print '  1. Open app.revenuecat.com → project “Vela Light” → Integrations → Webhooks → Add new webhook.'
print '  2. Name: Vela staging'
print '  3. Webhook URL: https://vela.vela-light-staging.workers.dev/webhooks/revenuecat'
print '  4. Authorization header value: press Cmd+V (it is on your clipboard).'
print '  5. Environment: Sandbox only. Events: All events. Then Save.'
print ''
print 'Then copy something else (any word) so the password leaves your clipboard.'
print 'Tell Claude: "RevenueCat webhook is on staging".'
finish 0
