#!/bin/zsh
# Open this file in macOS Terminal. Credentials and the generated key stay in that terminal.
# No setup output is captured by Codex or written to a log by this launcher.

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

print 'Vela staging setup — ADR-38 / build plan 5.7'
print ''
print 'Before continuing:'
print '  • Keep the staging app and bot idle until both Workers have deployed.'
print '  • Drain vela-outbound-staging, vela-media-staging, and vela-understand-staging.'
print '  • Have the direct staging Neon connection string and password manager ready.'
print '  • Save the generated CONTENT_KEY_V1 when setup shows it.'
print 'Keep this terminal private: do not share its output, screenshots, keys or tokens.'
print ''

if ! command -v pnpm >/dev/null 2>&1; then
  print 'pnpm is unavailable in this terminal. Run this launcher from your development shell.'
  read -r 'finish?Press Return to close: '
  exit 1
fi

read -r 'cutover_ready?Type READY when staging is idle and all three queues are drained: '
if [[ "$cutover_ready" != READY ]]; then
  print 'Setup was not started. Open this launcher again when ready.'
  exit 0
fi
unset cutover_ready

pnpm --filter @vela/worker run setup -- --env staging
setup_status=$?
print ''
if (( setup_status == 0 )); then
  print 'Staging setup completed. Confirm the content key is saved in your password manager.'
  print 'Next: staging restore rehearsal, production pre-family drill, and the 10× load report.'
else
  print 'Setup stopped. Its output above contains the resume command for the failed step.'
  print 'Save any generated content key before closing this window; reuse it when resuming.'
fi
print 'Tell Codex only whether setup completed, or the failed step and a redacted error.'
read -r 'finish?Press Return after saving the key and reviewing the result: '
exit "$setup_status"
