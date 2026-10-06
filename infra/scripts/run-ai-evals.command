#!/bin/zsh
# Founder-facing launcher: runs Vela's AI golden set (88 made-up cases) through OpenAI and prints
# the safety gate. The key is read at a hidden prompt and given only to this run's environment;
# it is never written to a file, shown, or passed as a command argument.
unsetopt XTRACE VERBOSE

repo_root="${0:A:h:h:h}"
cd "$repo_root" || exit 1
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

finish() {
  read -r 'done_key?Press Return to close: '
  exit "$1"
}

if ! command -v pnpm >/dev/null 2>&1; then
  print 'This window cannot find Vela’s development tools. Tell Claude: "tools missing".'
  finish 1
fi

print 'Check Vela’s AI on OpenAI with made-up test cases'
print ''
print 'This sends 88 made-up family messages to OpenAI, and asks OpenAI to grade the answers.'
print 'It costs roughly US$2–8 of OpenAI credit and takes about 10–20 minutes.'
print 'The first run downloads the test tool Promptfoo (about 100 MB) into pnpm’s cache.'
print 'No real family message is used.'
print ''
print 'Paste your OpenAI API key (the vela-staging one is fine) at the hidden prompt.'
print 'Nothing appears while you paste; that is normal. Never paste it into chat.'
read -rs 'secret?OpenAI API key: '
print ''
secret="${secret//[[:space:]]/}"
if [[ ! "$secret" =~ '^sk-[A-Za-z0-9_-]{20,}$' || "$secret" == sk-ant-* ]]; then
  unset secret
  print 'That does not look like an OpenAI key (it starts with sk-), so nothing was run.'
  finish 1
fi

OPENAI_API_KEY="$secret" pnpm --filter @vela/ai eval:openai 2>&1 | grep -v -i 'api[_-]key'
run_status=${pipestatus[1]}
unset secret

print ''
if (( run_status == 0 )); then
  print 'The safety gate PASSED. Tell Claude: "AI evals passed".'
else
  print 'The run did not pass. Tell Claude: "AI evals finished, not passed". Claude reads the results itself.'
fi
finish "$run_status"
