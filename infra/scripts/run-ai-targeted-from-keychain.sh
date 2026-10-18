#!/bin/zsh
unsetopt XTRACE VERBOSE
repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"
key="$(security find-generic-password -s vela-openai-eval -a vela -w 2>/dev/null)"
if [[ -z "$key" ]]; then
  print 'No saved evaluation credential is available.' >&2
  exit 2
fi
OPENAI_API_KEY="$key" EVAL_PROVIDER=openai pnpm --filter @vela/ai exec node evals/targeted.ts "$@"
rc=$?
unset key
exit $rc
