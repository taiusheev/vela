# Release runbook

20 September 2026 · architecture §16–17 · code design §9–10 · ADR-23, ADR-26 · the co-founder prepares, the founder approves production

## When to use it

Every change to either Worker in staging or production, and every database migration. JavaScript-only updates to the mobile app follow [`ota-policy.md`](ota-policy.md); store builds go out weekly during the pilot through EAS (from sprint 3).

Each environment has two Workers, deployed from `apps/worker` (`architecture/decisions.md`, ADR-26): the pilot Worker `vela` (`apps/worker/wrangler.jsonc`: the webhook, the privacy notice pages, the scheduler, the queues and cron) and the admin Worker `vela-admin` (`apps/worker/wrangler.admin.jsonc`: the admin pages, behind Cloudflare Access). Staging's are in the "Vela staging" account, at `https://vela.vela-light-staging.workers.dev` and `https://vela-admin.vela-light-staging.workers.dev`; production's are in the "Vela" account, at `https://vela.vela-light.workers.dev` and `https://vela-admin.vela-light.workers.dev`. `.github/workflows/deploy.yml` deploys both, the pilot Worker first, because the admin Worker binds the `MemberScheduler` class it exports.

## Before an environment's first deploy

An environment's first migration and deploy are not done with this runbook: the founder runs the setup script once for it, `pnpm --filter @vela/worker run setup -- --env staging`, then, once staging has passed, `--env production` ([`infra/README.md`](../README.md), sections 11 and 12). The script creates the queues and the dead-letter queue with the names in `wrangler.jsonc`, and the R2 media bucket only where that environment's `MEDIA_STORAGE` is `r2`, which is production alone today (staging keeps no copy of a voice note or photo; decision M of 20 September 2026, [`infra/README.md`](../README.md), section 1, step 3); migrates the database; replaces every `PLACEHOLDER_` value for that environment (the bot username in `wrangler.jsonc`, the Hyperdrive id in both wrangler files), which the co-founder then commits; puts each Worker's secrets (`ADMIN_CONVERSATION_ID` among `vela`'s; `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ANTHROPIC_API_KEY` on `vela-admin`); deploys `vela`, then `vela-admin`; waits while the founder has Cloudflare Access protect the whole `vela-admin` Worker and nothing else; registers the Telegram webhook; and checks the result. Before it, the GitHub environment holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`, which every later deploy needs. Both privacy notices in `plan/materials/pilot` were filled in on 17 September 2026; after any later edit, `apps/worker/src/notices.generated.ts` is regenerated in the same commit. The pilot Worker refuses to run while any value still holds `PLACEHOLDER_`, a URL var is not https, a secret is missing, or a notice holds a bracketed blank, so a pilot Worker deployed like that answers the notice pages once both notices are filled, but handles no webhook update, queue job, cron run, or alarm, and its `/healthz` never answers `ok`, because no reconcile finishes; a deploy whose queue or bucket does not exist fails. After an environment's first deploy passes its checks and `/healthz` there answers `ok`, the co-founder sets that environment's `enabled` to `true` in `.github/watchdog.json` and commits it, so the watchdog starts reading it (`infra/README.md`, section 6).

## Rules

- Trunk-based. `main` is always deployable; `pnpm check` passes before every merge.
- `main` deploys to staging. Production deploys only from a tag, through CI, after the founder approves the `production` environment in GitHub. Never `wrangler deploy --env production` from a laptop, with one exception: the founder's own run of `pnpm --filter @vela/worker run setup -- --env production`, once, before any family, with a setup token that expires the next day and is deleted after the run (`infra/README.md`, access rules and section 11).
- **Migrations expand, then contract.** A migration must work with the code already in production, because the migration runs first and the code follows. Adding tables, columns or indexes is one release; renaming or dropping takes two (stop using it, then remove it).
- **Never rename or remove the `MemberScheduler` Durable Object class** without a planned Wrangler migration: removing the class deletes every member's alarms and stored wake times. **Never rename the pilot Worker `vela`** either: the admin Worker reaches the class by that name (`script_name`).
- **Never turn on Cloudflare Access for `vela`**, or for all Workers in the account: Telegram's webhook and the privacy notice pages must answer without a sign-in. Access belongs on `vela-admin` only.
- **Timing.** Deploy when no family's arrival hour falls in the next 30 minutes (the admin page lists the next arrivals). If the change touches turn prompts or preparation, also avoid 19:00–22:00 in any family's zone.
- A change to consent, notice or agreement wording follows the versioning rules in `plan/materials/pilot/README.md`.

## Steps

1. **Pull request.** CI green (lint, typecheck, tests). New behaviour has a test that fails without it. A migration's SQL is read in the diff. Copy changes have both `en` and `zh-TW` keys.
2. **Merge.** CI (the GitHub `staging` environment) runs the checks, applies migrations to staging's own Neon project, `vela-staging`, once, then deploys `vela`, then `vela-admin`. Until the `staging` environment holds its secrets, these steps are done by hand, in this order. The co-founder never holds the staging connection string (`infra/README.md`, rule zero), so a migration is run by the founder, in their own terminal on the tested commit, pasting `vela-staging`'s direct string from the password manager at the hidden prompt:

   ```bash
   read -rsp "Staging connection string: " DATABASE_URL; echo; export DATABASE_URL
   pnpm --filter @vela/db migrate
   unset DATABASE_URL
   ```

   It prints "Migrations from … applied." Then the co-founder deploys both Workers with the "Vela staging" token in `apps/worker/.env`, which Wrangler reads when it runs in `apps/worker` (`infra/README.md`, section 1, step 8), the pilot Worker first:

   ```bash
   pnpm --filter @vela/worker exec wrangler deploy --env staging
   pnpm --filter @vela/worker exec wrangler deploy -c wrangler.admin.jsonc --env staging
   ```

3. **Staging smoke test (15 minutes).**
   - `https://vela.vela-light-staging.workers.dev/healthz` returns 200 with `"status":"ok"` (within 15 minutes of the deploy, once a reconcile has run); `/privacy` and `/privacy/zh-TW` on that host open with no sign-in; `/admin` on that host answers `not found`; and `https://vela-admin.vela-light-staging.workers.dev/admin` opens through Cloudflare Access. `/healthz` builds no deps and never touches the database: it answers `ok` only while a reconcile has finished in the last 35 minutes, which needs the pilot Worker's configuration, its database and its cron, so it proves the pilot Worker, and the admin page proves the admin Worker's configuration.
   - In the staging family group, reply to the turn prompt with an ask; the bot answers "Into [name]'s morning."
   - **Arrival**, only if the staging test member has had no arrival delivered today (the scheduler delivers one per local day; a second release the same day, or a release after the morning's arrival, skips this line and says so in the release notes). The founder sets the arrival at least 30 minutes ahead and clears the stored wake, in the Neon console in the project `vela-staging`, as in [`silence-drill.md`](silence-drill.md), "Setting the arrival hour H" (editing `arrival_time` alone leaves the old alarm in place). The arrival comes once at that time; tap an answer; the light line appears in the group.
   - Both Workers' logs in the "Vela staging" dashboard show, since the deploy, no line whose `level` is `error` (such as `request_failed`, `queue_job_failed`, `cron_failed`, `scheduler_tick_failed`, `reconcile_tick_failed`, `outbound_failed`, `outbound_redrive_failed`), no `ConfigError`, and no uncaught exception. Sentry is not connected to either Worker yet (`SENTRY_DSN` is not read) and stays empty whatever fails, so these logs are the error check.
   - If the scheduler, gateway, quiet ladder or an adapter changed: run the staging silence drill ([`silence-drill.md`](silence-drill.md)).
4. **Tag.** The founder opens **GitHub → Releases → Draft a new release**, creates the tag `vYYYY.MM.DD` on the tested commit (add `.2` for a second release the same day), writes two lines (what changed; migration yes or no) and publishes.
5. **Approve.** The production job waits for the founder's approval of the `production` environment. Approve it.
6. **CI** (the GitHub `production` environment, the only place the production connection string and Cloudflare token exist) runs the checks, applies migrations to the Neon project `vela` once, then deploys `vela`, then `vela-admin`.
7. **Watch for 30 minutes.** `https://vela.vela-light.workers.dev/healthz` 200 with `"status":"ok"` and its `/privacy` pages open; `https://vela-admin.vela-light.workers.dev/admin` opens through Cloudflare Access; both Workers' logs in the "Vela" dashboard show, since the deploy, no line whose `level` is `error`, no `ConfigError`, and no uncaught exception (as in step 3; Sentry is not connected yet); no watchdog failure email; the next due arrivals delivered on time in the admin page; no `scheduler_missed`; dead-letter queues empty.

## Rollback

- **Code:** in the "Vela" account's Cloudflare dashboard, go to the **Workers & Pages** page, select the Worker (`vela`, `vela-admin`, or each in turn when the release changed both) **→ Deployments**, select the three dot icon on the right of the previous version, and select **Rollback**. Nobody runs `wrangler rollback` against production from a laptop, which holds no production credential (the production setup token is deleted after its one run). This reverts code only; secrets, the queues and the database stay as they are, which is why migrations expand before they contract. Cloudflare refuses a rollback across a Durable Object migration (a change to the `MemberScheduler` class, or the migration that adds the heartbeat's `ReconcileHeartbeat` class, ADR-18 update of 18 September 2026), or to a version whose bucket or queue no longer exists.
- **A migration damaged data:** Sev 1 in [`incident.md`](incident.md), then "Doing it for real" in [`restore-drill.md`](restore-drill.md).
- After any rollback, add it to the incident note and fix forward through this runbook.

## How to know it worked

The CI production job is green; each Worker's version in the Cloudflare dashboard matches the tag; the smoke test passed; the 30-minute watch was clean; and at the first family's next arrival hour, the admin page shows the arrival delivered on time.
