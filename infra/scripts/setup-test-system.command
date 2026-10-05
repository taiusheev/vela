#!/bin/zsh
# Founder-facing launcher. Credentials stay in the founder's own Terminal window.

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

print 'Set up protection for Vela’s test system'
print ''
print 'Your part:'
print '  1. Stop using the Vela test app and bot. Ask other testers to pause too.'
print '  2. Follow the private copy-and-paste instructions below.'
print '  3. Save the new message-protection key in your password manager when it appears.'
print ''
print 'The setup checks unfinished background jobs itself.'
print 'At a hidden prompt, seeing no characters is normal. Paste, then press Return.'
print 'Keep this window private. Do not send its full output or screenshots to chat.'
print 'If an older setup window is waiting at READY, cancel it with Ctrl+C first.'
print 'If an older setup is already running, let it finish; do not start another.'
print ''

if ! command -v pnpm >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Codex: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

read -r 'test_system_idle?Type READY once the app and bot are unused and no other setup is running: '
if [[ "$test_system_idle" != READY ]]; then
  print 'Setup was not started. Open this launcher again when ready.'
  exit 0
fi
unset test_system_idle

pnpm --filter @vela/worker run setup -- --env staging
setup_status=$?
print ''
if (( setup_status == 0 )); then
  print 'Setup completed. Confirm the new key is saved in your password manager.'
  print 'Tell Codex: "setup completed". Engineering will check recovery and traffic next.'
else
  print 'Setup stopped. Save any key shown above before closing this window.'
  print 'Tell Codex only which step stopped, such as "database" or "seal".'
  print 'Do not send the full output. Engineering will explain the next action.'
fi
print 'Keep the test app and bot unused until engineering confirms the upgrade is complete.'
read -r 'finish?Press Return after saving the key and noting the result: '
exit "$setup_status"
