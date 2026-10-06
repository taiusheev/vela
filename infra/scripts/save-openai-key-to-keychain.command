#!/bin/zsh
# Founder-facing launcher: saves the OpenAI key for AI test runs in this Mac's login Keychain
# (service "vela-openai-eval"), so test runs read it from there and nobody pastes it again.
# macOS's own `security` prompt reads the key hidden; it is never shown, written to a file or
# passed as a command argument. Delete it any time: Keychain Access → search "vela-openai-eval".
unsetopt XTRACE VERBOSE

print 'Save the OpenAI key for Vela’s AI test runs in your Mac’s Keychain'
print ''
print 'Paste your OpenAI API key (the vela-staging one) at each of the two hidden prompts.'
print 'Nothing appears while you paste; that is normal. Never paste it into chat.'
print ''
if security add-generic-password -U -s vela-openai-eval -a vela -l 'Vela OpenAI key (AI tests)' -w; then
  print ''
  print 'Saved. Tell Claude: "OpenAI key is in the Keychain".'
  rc=0
else
  print ''
  print 'Nothing was saved. Tell Claude: "keychain save failed".'
  rc=1
fi
read -r 'done_key?Press Return to close: '
exit $rc
