#!/bin/zsh
# Founder-facing launcher (technical plan 4.2). Copies the OpenAI key saved in the login Keychain
# (service vela-openai-eval, from save-openai-key-to-keychain.command) into the GitHub repository
# secret OPENAI_EVAL_API_KEY, which only the ai-evals workflow reads. Nothing is shown, written to
# a file, or passed as a command argument.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

finish() {
  read -r 'done_key?Press Return to close: '
  exit "$1"
}

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  print 'GitHub is not signed in on this Mac. Tell Claude: "gh not signed in".'
  finish 1
fi
key="$(security find-generic-password -s vela-openai-eval -a vela -w 2>/dev/null)"
if [[ -z "$key" ]]; then
  print 'No OpenAI key in the Keychain yet. Run save-openai-key-to-keychain.command first.'
  finish 1
fi

print 'Let GitHub run Vela’s AI safety tests when prompts change, and weekly'
print 'Cost: about US$0.55 per run on a prompt change, US$1.10 per weekly run.'
print 'Tip: set a monthly spending limit for this key in the OpenAI dashboard.'
read -r 'go?Type YES to continue: '
if [[ "$go" != YES ]]; then
  unset key
  print 'Nothing was changed.'
  finish 0
fi
print -rn -- "$key" | gh secret set OPENAI_EVAL_API_KEY --repo taiusheev/vela >/dev/null
status=$?
unset key
if (( status == 0 )); then
  print 'Done. Tell Claude: "eval key set".'
else
  print 'GitHub refused the secret. Tell Claude: "eval key failed".'
fi
finish "$status"
