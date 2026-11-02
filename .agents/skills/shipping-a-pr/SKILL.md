---
name: shipping-a-pr
description: How a change reaches Vela's main branch. Use when committing, pushing, opening, checking or merging a pull request in the Vela repo, or when a task is ready to "ship", "land" or "merge".
---

# Shipping a PR

Two agents (Claude and Codex) share this Mac and the main checkout. Every step below exists because skipping it once shipped someone else's half-done work or a red build.

## 1. Before editing

- Work in your own worktree from `origin/main`, never in the main checkout `../vela`:
  `git fetch origin && git worktree add -b <branch> ../vela-<topic> origin/main`.
  Uncommitted files in `../vela` may belong to the other agent: never commit, move, stash or delete them.
- Add a claim line for the paths you will touch to `../AGENT-CLAIMS.md` (outside the repo). Read the active claims first; if a path is claimed, coordinate before editing.
- On this Mac the shell needs `export PATH=~/.local/opt/node/bin:~/.local/bin:$PATH` before `pnpm`, `node` or `gh`. Run `pnpm install --frozen-lockfile` in a new worktree.

## 2. Before committing

- `pnpm check` (Biome, TypeScript, every test) passes in your worktree. If the app's typecheck fails on routes that exist, delete the stale `apps/app/.expo` folder and run it again.
- New writes go through `runApiMutation` with an idempotency key. A write two connections could race gets a test in `packages/services/postgres-tests`, seen failing with the guard removed. That suite runs in CI, not in `pnpm check`.
- A new route gets its section in `architecture/api-contract.md`, contract types, and 404/403/409 tests.
- Changes to family data, consent or the notice follow the `guarding-family-data` skill.

## 3. Committing

- Stage by explicit path only: `git add -- <file> <file>`. Never `git add -A`, `git add .` or `git commit -a`.
- Check `git diff --cached --stat` shows only your files.
- The message is a plain-English sentence about behaviour ("Sends no quiet notice when delivery failed"), not a list of files.

## 4. The pull request

- Push the branch and open a PR to `main` with `gh pr create --base main`.
- The body says, in plain words: what changes for families or the founder; how it was proven (commands run, tests added, what was seen); what was not proven; numbered founder to-dos, if any.
- Required checks: `lint · typecheck · test`, `silence drill`, `contention drill (PostgreSQL 18)`, `app flows (Maestro, demo on the web)`. Wait for all of them on the newest commit.
- When CI fails, read the log, fix the cause, push again. Handle review feedback with the `receiving-code-review` skill.

## 5. Merging

- The repo has no auto-merge. Merge with `gh pr merge <number> --merge` only after every check is green and the founder's go covers the change. A change families will notice needs the founder's go for that change.
- A merge to `main` deploys **staging** automatically (`.github/workflows/deploy.yml`): read the deploy run and its smoke step afterwards.
- **Production** deploys only from a `v*` tag, which the founder approves in GitHub. Never tag or deploy production without the founder's explicit yes for that release.
- After the merge, remove your claim line from `../AGENT-CLAIMS.md`.

## 6. Report

End with what was built, how it was proven, what is still unproven, and numbered founder to-dos in plain English.
