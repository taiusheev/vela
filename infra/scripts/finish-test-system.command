#!/bin/zsh
# Resume only the final Telegram and service checks. No content key is generated or requested.

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1

print 'Finish connecting Vela’s test bot'
print ''
print 'The previous setup stopped at the Telegram connection step.'
print 'This resumes there; it does not repeat the saved-message update.'
print ''
print '1. In the old setup window, press Return at its final prompt to finish that launcher.'
print '2. Keep the Vela test app and bot unused while reconnecting.'
print '3. In Telegram, open @BotFather, send /mybots, select @VelaLightstagingbot,'
print '   choose API Token, and copy the current token.'
print '4. Paste it ONLY into the hidden Telegram bot token prompt in this window.'
print '   No characters will appear. Press Return after pasting.'
print ''
print 'Do not revoke or regenerate the token just to retry. Do not paste it in chat.'
print 'This repair copies the verified token to the running service as well.'
print ''

if ! command -v pnpm >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Codex: "tools missing".'
  read -r 'finish?Press Return to close: '
  exit 1
fi

read -r 'repair_ready?Type READY when the old launcher has finished and the test app and bot are unused: '
repair_ready="${repair_ready//[[:space:]]/}"
if [[ "${repair_ready:u}" != READY ]]; then
  print 'Repair was not started. Open this launcher again when ready.'
  exit 0
fi
unset repair_ready

pnpm --filter @vela/worker run setup -- --env staging --from webhook
setup_status=$?
print ''
if (( setup_status == 0 )); then
  print 'Telegram setup and service checks completed.'
  print 'Tell Codex: "Telegram setup completed".'
else
  print 'The repair stopped. Tell Codex which step stopped and its short error message.'
  print 'Keep credentials and the full output private.'
fi
print 'Engineering will verify the result and tell you when testing can resume.'
read -r 'finish?Press Return after noting the result: '
exit "$setup_status"
