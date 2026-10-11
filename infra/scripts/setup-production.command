#!/bin/zsh
# Founder-facing launcher for production's one setup (infra/README.md section 11). Every key is
# typed at a hidden prompt in this window and never leaves it.

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/bin:$PATH"

print 'Set up Vela’s production system'
print ''
print 'Have these ready before you start (about 30 minutes):'
print '  1. Cloudflare, account "Vela": the setup prints which token to create, with a one-day expiry.'
print '  2. Neon, project "vela": Connect → default branch, database neondb, role neondb_owner,'
print '     connection pooling OFF, copy the connection string.'
print '  3. Telegram, @BotFather: the production bot "Vela Light" and its token.'
print '  4. OpenAI, project "vela-production": a new secret key.'
print '  5. Deepgram, project "vela": the key named vela-production.'
print '  6. Clerk, application Vela Light → Production → API keys: the secret key (starts sk_live_).'
print '  7. Ten minutes for Cloudflare Zero Trust (Access) when the setup asks.'
print ''
print 'At a hidden prompt, seeing no characters is normal. Paste, then press Return.'
print 'Keep this window private. Do not send its output or screenshots to chat.'
print 'A new content key is shown once: save it in your password manager before going on.'
print ''

if ! command -v pnpm >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Claude: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

# Production is set up from the exact code on main, never from a branch or unsaved changes.
git fetch --quiet origin main 2>/dev/null
if [[ -n "$(git status --porcelain)" || "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  print 'This folder is not a clean copy of the latest main, so setup did not start.'
  print 'Tell Claude: "production launcher needs a clean copy". Claude prepares one for you.'
  read -r 'finish?Press Return to close: '
  exit 1
fi

read -r 'ready?Type READY when you have the seven things above: '
if [[ "$ready" != READY ]]; then
  print 'Setup was not started. Open this launcher again when ready.'
  exit 0
fi
unset ready

pnpm install --frozen-lockfile >/dev/null || {
  print 'Installing Vela’s tools failed. Tell Claude: "install failed".'
  read -r 'finish?Press Return to close: '
  exit 1
}

pnpm --filter @vela/worker run setup -- --env production
setup_status=$?
print ''
if (( setup_status == 0 )); then
  print 'Production setup completed.'
  print 'Now: delete the setup token (Cloudflare → My Profile → API Tokens → its menu → Delete).'
  print 'Tell Claude: "production setup completed". Claude records the identifiers it wrote.'
else
  print 'Setup stopped. Save any key shown above before closing this window.'
  print 'Tell Claude only which step stopped, such as "database" or "telegram".'
  print 'The line above names the command that resumes from that step.'
fi
read -r 'finish?Press Return after saving the key and noting the result: '
exit "$setup_status"
