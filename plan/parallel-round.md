# Parallel round: five sessions at once

Five Claude sessions build five parts of sprint 3 at the same time. Each works alone, in its own worktree, and they come together through `build/sprint-0-1` one fast-forward at a time. Every session reads this page before it starts and follows it to the end.

| # | Task | Branch | `DEV_DB_PORT` | `API_PORT` | `APP_PORT` | Build plan |
|---|---|---|---|---|---|---|
| 1 | Push | `feat/push` | 54321 | 8791 | 8091 | 3.8 |
| 2 | Photo asks | `feat/photo-asks` | 54322 | 8792 | 8092 | 3.4 |
| 3 | Tomorrow's suggestion | `feat/suggestions` | 54323 | 8793 | 8093 | 3.3, 3.4 |
| 4 | The API on staging | `feat/api-staging` | 54324 | 8794 | 8094 | 3.3 |
| 5 | The app in Traditional Chinese | `feat/app-i18n` | 54325 | 8795 | 8095 | 3.1 |

## Before you start

1. Work only in your own worktree. If this session opened in `C:\Users\Пользователь\Desktop\Vela` itself, make one: `git worktree add .claude/worktrees/<branch-name> -b <branch> build/sprint-0-1`. A worktree the desktop app made is cut from `main`, which has no code: `git reset --hard build/sprint-0-1`, then `git switch -c <branch>`.
2. `pnpm install` in the worktree (worktrees get no `node_modules`).
3. Copy, never move, `apps/worker/.env.local` and `apps/app/.env.local` from the main checkout. In your copies set `DATABASE_URL` to your `DEV_DB_PORT`, add `API_PORT` and `APP_PORT`, and point `EXPO_PUBLIC_API_URL` at your `API_PORT`. Git ignores both files; never commit them, never print their values.
4. Bash needs `export PATH=/usr/bin:/mingw64/bin:"/c/Program Files/nodejs":"/c/Users/Пользователь/AppData/Roaming/npm":"/c/Program Files/Git/cmd":$PATH`.

## Running things locally

- Your ports are in the table. `DEV_DB_PORT` moves `dev-db`, `API_PORT` and `APP_PORT` move `api:dev`, and `expo start --web --port <APP_PORT>` moves the app. Each worktree keeps its own database in `packages/db/.pglite/dev`, so seed yours: `pnpm --filter @vela/worker seed:dev -- user_3Jky49ukX90cqD7TbXlZp8lcdSo`.
- **Stop only processes you started**, found by your own ports. Four other sessions are running servers on this machine.
- Do not sign in as the founder: the code goes to their email. Check screens in fixture mode (Clerk key and API URL empty, as `vela-app-demo` in `.claude/launch.json` does) and the API with tests. Put any check that needs a signed-in account in your founder list.
- No PostgreSQL binaries: the download needs the founder's yes. Prove a race by pushing your branch — CI's `contention-drill` job runs `postgres-tests/` on every push — and reading the run at `api.github.com/repos/taiusheev/vela/actions/runs?head_sha=<sha>`.

## Staying out of each other's way

Each task names the files it owns. Outside them:

- **Shared lists** — `packages/services/src/index.ts`, the services and routes in `apps/worker/src/api-app.ts` and `apps/worker/scripts/api-dev.ts`, `packages/contracts`, `packages/copy/src/en.ts` and `zh-TW.ts`: add your lines as one block; never reorder, rename or reformat what is there.
- **Docs** — `architecture/api-contract.md`: add your own section and change only sentences about your routes. `plan/build-plan.md`: only your rows. `architecture/decisions.md`: append at the end.
- **Migrations** — one Drizzle migration per task at most. If another task's migration lands first, delete yours (the SQL file, its snapshot and its journal entry), rebase, and generate it again with `pnpm --filter @vela/db generate` so the snapshot chain stays whole; then `pnpm --filter @vela/db export-sql`.
- **`pnpm-lock.yaml`** — on a conflict take `build/sprint-0-1`'s copy and run `pnpm install`.
- **App strings** — task 5 moves the app onto Lingui. If it has landed when you rebase, write your new strings through its macro with a zh-TW entry; if you land first, task 5 converts yours.
- **Memory** — write one memory file of your own (`vela-<branch-name>.md`) and one line in `MEMORY.md`. Leave `vela-app-status.md` alone.

## Every write, every route

- Every new write goes through `runApiMutation` with an idempotency key, and gets a race in `packages/services/postgres-tests/` that you have **seen fail** with the guard broken (the memory note `vela-postgres-race-harness` says how).
- Every new route gets a section in `architecture/api-contract.md`, contract types in `packages/contracts`, and its 404/403/409 answers tested.
- The product is `product/05-product-spec-v2.md`, the screens are `design/prototype/vela-app.html`, the look is `design/design-system.md`. No badge counts, ink never red, nothing that contacts a third party on its own.

## Landing

1. `git rebase build/sprint-0-1` and resolve conflicts by the rules above.
2. `pnpm check` green.
3. `git -C "C:\Users\Пользователь\Desktop\Vela" status --porcelain` must print nothing. If it prints anything, stop and tell the founder — someone is working in the main checkout.
4. `git -C "C:\Users\Пользователь\Desktop\Vela" merge --ff-only <branch>`. If it is refused, another task landed first: go back to 1.
5. `git -C "C:\Users\Пользователь\Desktop\Vela" push origin build/sprint-0-1`, then check CI for the pushed commit.
6. Scan the diff for secrets before every push.

## Never

Deploy to production. Buy, upgrade or start a paid plan. Type or paste a secret. Download anything without the founder's yes. Touch the founder's other projects (TakenTeach, takenteach.com).

## Finishing

End with two short lists: what you built and how you proved it; and what the founder must do, numbered, one line each — only what needs them.
