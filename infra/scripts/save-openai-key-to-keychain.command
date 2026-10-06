#!/bin/zsh
# Founder-facing launcher: saves the OpenAI key for AI test runs in this Mac's login Keychain
# (service "vela-openai-eval"), so test runs read it from there and nobody pastes it again.
# The key is read at a hidden prompt and handed to `security` on its standard input (its own
# command line, `security -i`), so it is never shown, written to a file or passed as an argument.
# macOS's own password prompt stops at 128 characters, shorter than an OpenAI project key, so it
# is not used. Delete the item any time: Keychain Access → search "vela-openai-eval".
unsetopt XTRACE VERBOSE

finish() {
  read -r 'done_key?Press Return to close: '
  exit "$1"
}

print 'Save the OpenAI key for Vela’s AI test runs in your Mac’s Keychain'
print ''
print 'Paste your OpenAI API key (the vela-staging one) at the hidden prompt, then press Return.'
print 'Nothing appears while you paste; that is normal. Never paste it into chat.'
read -rs 'secret?OpenAI API key: '
print ''
secret="${secret//[[:space:]]/}"
if [[ ! "$secret" =~ '^sk-[A-Za-z0-9_-]{20,}$' || "$secret" == sk-ant-* ]]; then
  unset secret
  print 'That does not look like an OpenAI key (it starts with sk-), so nothing was saved.'
  finish 1
fi
if print -r -- "add-generic-password -U -s vela-openai-eval -a vela -l \"Vela OpenAI key (AI tests)\" -w $secret" | security -i >/dev/null 2>&1; then
  saved="$(security find-generic-password -s vela-openai-eval -a vela -w 2>/dev/null)"
  if [[ "$saved" == "$secret" ]]; then
    unset secret saved
    print 'Saved, and read back whole. Tell Claude: "OpenAI key is in the Keychain".'
    finish 0
  fi
fi
unset secret saved
print 'The Keychain did not keep the whole key. Tell Claude: "keychain save failed".'
finish 1
