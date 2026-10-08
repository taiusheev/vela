#!/bin/zsh
# Runs the quick AI golden set on OpenAI with the key the founder saved in the login Keychain
# (save-openai-key-to-keychain.command). The key goes only into this run's environment.
# With --judge as the first argument, GPT-5 also judges every rubric criterion (about three times
# the cost of the plain run).
unsetopt XTRACE VERBOSE
repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"
key="$(security find-generic-password -s vela-openai-eval -a vela -w 2>/dev/null)"
if [[ -z "$key" ]]; then
  print 'No OpenAI key in the Keychain (service vela-openai-eval).' >&2
  exit 2
fi
script=eval:openai:quick
if [[ "$1" == "--judge" ]]; then
  script=eval:openai:judged
  shift
fi
OPENAI_API_KEY="$key" pnpm --filter @vela/ai "$script" "$@" 2>&1 | grep -v -i 'api[_-]key'
rc=${pipestatus[1]}
unset key
exit $rc
