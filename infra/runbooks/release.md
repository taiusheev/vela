# Release runbook

Architecture §16–17 · code design §10 · the co-founder prepares, the founder approves production

## When to use it

Every change to the Worker in staging or production, and every database migration. JavaScript-only updates to the mobile app follow [`ota-policy.md`](ota-policy.md); store builds go out weekly during the pilot through EAS (from sprint 3).

The Workers are `vela-staging` (the "Vela staging" account) and `vela-production` (the "Vela" account), named in `apps/worker/wrangler.jsonc`; `.github/workflows/deploy.yml` deploys them.

## Before an environment's first deploy

Once per environment, the founder and the co-founder do sections 11 and 12 of [`infra/README.md`](../README.md): the queues, the dead-letter queue and the R2 bucket exist with the names in `wrangler.jsonc`; every `PLACEHOLDER_` value for that environment in `wrangler.jsonc` (the host in `routes` and `PUBLIC_BASE_URL`, both privacy notice URLs on a domain Vela owns, never `vela.family`, the bot username, the admin chat id, the Hyperdrive id) is replaced, with `src/wrangler-config.test.ts` in the same commit; the GitHub environment holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`; after the deploy the Worker holds its secrets, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` included; and the Cloudflare Access application covers `/admin` only. The Worker refuses to run while any value still holds `PLACEHOLDER_` or a URL var is not https, so a Worker deployed with a placeholder left answers `/healthz` and nothing else, and a deploy whose queue, bucket, or zone does not exist fails.

## Rules

- Trunk-based. `main` is always deployable; `pnpm check` passes before every merge.
- `main` deploys to staging. Production deploys only from a tag, through CI, after the founder approves the `production` environment in GitHub. Never `wrangler deploy --env production` from a laptop.
- **Migrations expand, then contract.** A migration must work with the code already in production, because the migration runs first and the code follows. Adding tables, columns or indexes is one release; renaming or dropping takes two (stop using it, then remove it).
- **Never rename or remove the `MemberScheduler` Durable Object class** without a planned Wrangler migration: removing the class deletes every member's alarms and stored wake times.
- **Timing.** Deploy when no family's arrival hour falls in the next 30 minutes (the admin page lists the next arrivals). If the change touches turn prompts or preparation, also avoid 19:00–22:00 in any family's zone.
- A change to consent, notice or agreement wording follows the versioning rules in `plan/materials/pilot/README.md`.

## Steps

1. **Pull request.** CI green (lint, typecheck, tests). New behaviour has a test that fails without it. A migration's SQL is read in the diff. Copy changes have both `en` and `zh-TW` keys.
2. **Merge.** CI (the GitHub `staging` environment) runs the checks, applies migrations to the Neon `staging` branch, then deploys `vela-staging`. Until the `staging` environment holds its secrets, the two steps are done by hand, in this order. The co-founder never holds the staging connection string (`infra/README.md`, rule zero), so a migration is run by the founder, in their own terminal on the tested commit, pasting the staging string from the password manager at the hidden prompt:

   ```bash
   read -rsp "Staging connection string: " DATABASE_URL; echo; export DATABASE_URL
   pnpm --filter @vela/db migrate
   unset DATABASE_URL
   ```

   It prints "Migrations from … applied." Then the co-founder deploys `vela-staging` with the staging account's Wrangler sign-in (`pnpm --filter @vela/worker exec wrangler deploy --env staging`).
3. **Staging smoke test (15 minutes).**
   - `GET /healthz` returns 200, and `/admin` opens through Cloudflare Access (`/healthz` builds nothing, so only the admin page proves the configuration and the database).
   - In the staging family group, reply to the turn prompt with an ask; the bot answers "Into [name]'s morning."
   - **Arrival**, only if the staging test member has had no arrival delivered today (the scheduler delivers one per local day; a second release the same day, or a release after the morning's arrival, skips this line and says so in the release notes). The founder sets the arrival at least 15 minutes ahead and clears the stored wake, in the Neon console on branch `staging`, as in [`silence-drill.md`](silence-drill.md), "Setting the arrival hour H" (editing `arrival_time` alone leaves the old alarm in place). The arrival comes once at that time; tap an answer; the light line appears in the group.
   - The Worker's logs in the "Vela staging" dashboard show, since the deploy, no line whose `level` is `error` (such as `request_failed`, `queue_job_failed`, `cron_failed`, `scheduler_tick_failed`, `reconcile_tick_failed`, `outbound_failed`, `outbound_redrive_failed`), no `ConfigError`, and no uncaught exception. Sentry is not connected to the Worker yet (`SENTRY_DSN` is not read) and stays empty whatever fails, so these logs are the error check.
   - If the scheduler, gateway, quiet ladder or an adapter changed: run the staging silence drill ([`silence-drill.md`](silence-drill.md)).
4. **Tag.** The founder opens **GitHub → Releases → Draft a new release**, creates the tag `vYYYY.MM.DD` on the tested commit (add `.2` for a second release the same day), writes two lines (what changed; migration yes or no) and publishes.
5. **Approve.** The production job waits for the founder's approval of the `production` environment. Approve it.
6. **CI** (the GitHub `production` environment, the only place the production connection string and Cloudflare token exist) runs the checks, applies migrations to Neon `main`, then deploys `vela-production`.
7. **Watch for 30 minutes.** `/healthz` 200; `/admin` opens; the Worker's logs in the "Vela" dashboard show, since the deploy, no line whose `level` is `error`, no `ConfigError`, and no uncaught exception (as in step 3; Sentry is not connected yet); Healthchecks up; the next due arrivals delivered on time in the admin page; no `scheduler_missed`; dead-letter queues empty.

## Rollback

- **Code:** in the Cloudflare dashboard, **Workers & Pages → `vela-production` → Deployments**, pick the previous version and roll back (or run `wrangler rollback` for the production environment through CI). This reverts code only; secrets and the database stay as they are, which is why migrations expand before they contract.
- **A migration damaged data:** Sev 1 in [`incident.md`](incident.md), then "Doing it for real" in [`restore-drill.md`](restore-drill.md).
- After any rollback, add it to the incident note and fix forward through this runbook.

## How to know it worked

The CI production job is green; the version in the Cloudflare dashboard matches the tag; the smoke test passed; the 30-minute watch was clean; and at the first family's next arrival hour, the admin page shows the arrival delivered on time.
