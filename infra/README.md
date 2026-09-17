# Infrastructure

17 September 2026 · build plan sprint 0 (tasks 0.2, 0.3, 0.4) · architecture §12–17 · ADR-18 (update of 18 September 2026), ADR-23, ADR-26 · decisions L10, L11 and W1 to W5 · owner: the founder owns every account; the co-founder builds on them

What runs where, how the founder creates each account, and how credentials reach the Workers without ever passing through a chat or the repository: after signing up, the founder runs one setup script per environment (section 11), which takes every key at a hidden prompt and puts it where it belongs. Vela runs as two Cloudflare Workers from one package, on Cloudflare's free workers.dev addresses, with no domain (`architecture/decisions.md`, ADR-26): the **pilot Worker** `vela` (Telegram's webhook, the privacy notice pages, the scheduler, the queues and cron; `apps/worker/wrangler.jsonc`) and the **admin Worker** `vela-admin` (the founder's admin pages, behind Cloudflare Access; `apps/worker/wrangler.admin.jsonc`). Those two files are the Workers' own configuration (code design §9); this folder records the resources, the providers and the runbooks.

| Document | Use it when |
|---|---|
| [`sub-processors.md`](sub-processors.md) | Adding a provider, answering "who processes our data", updating the privacy notice, checking providers' data processing terms |
| [`security-plan.md`](security-plan.md) | Answering "how is the data protected, and who holds which access"; every six months, and before a new provider or kind of data |
| [`runbooks/incident.md`](runbooks/incident.md) | Something is wrong for families, or a secret or personal data may be exposed |
| [`runbooks/data-requests.md`](runbooks/data-requests.md) | The founder changes family records by hand until the admin page's actions ship (build plan 1.12), and afterwards for what they do not cover: consent rows, nearby contacts, away, a death, someone leaving, copies, corrections, deletions, the end of a family's pilot |
| [`runbooks/release.md`](runbooks/release.md) | Deploying the Workers or running a migration |
| [`runbooks/restore-drill.md`](runbooks/restore-drill.md) | Quarterly, and whenever production data must be restored |
| [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) | A credential may be exposed, someone leaves, or every six months |
| [`runbooks/silence-drill.md`](runbooks/silence-drill.md) | Proving our failures never produce a quiet notice |
| [`runbooks/ota-policy.md`](runbooks/ota-policy.md) | Shipping a JavaScript-only fix to the mobile app (from sprint 3) |

## Rule zero: secrets

A secret is anything that grants access: API keys, bot tokens, database connection strings with passwords, webhook secrets, CI tokens.

- **Never paste a secret into a chat** (including the conversation with the co-founder), Telegram, LINE, email, an issue, a screenshot, a markdown file or any file in the repository.
- **The founder copies each secret from the provider's page straight into its destination**: a hidden prompt of the setup script in the founder's own terminal (section 11), GitHub (environment secrets), or, for a change the script does not make, the Cloudflare dashboard. A password manager is the only other place it may live.
- **The co-founder receives only identifiers**: account ids, project ids, resource names, bot usernames, workers.dev subdomains and hosts. Each account section below lists exactly what to hand over. The founder's personal Telegram chat id is not handed over either: the setup script reads it from Telegram and puts it straight into the pilot Worker's secret `ADMIN_CONVERSATION_ID`. The one credential on the development machine beyond development keys is the "Vela staging" account's API token in `apps/worker/.env`, which the setup script saves there for staging only (section 11) and which reaches only staging and its synthetic data. The co-founder never opens that file.
- Development keys are separate, low-limit keys that may sit in `apps/worker/.dev.vars` (ignored by git). Keep that file on the development machine: when it is missing, `wrangler dev` hands the values in `.env` to the local Worker as well. Production keys are never saved on the development machine: during production's one setup they exist only in the setup script's memory, typed by the founder at hidden prompts, and the production setup token expires the next day (section 11). Nobody signs in to the production Cloudflare account on the development machine.
- If a secret is pasted anywhere by mistake, treat it as exposed and follow [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) now.

## Environments

| | dev | staging | production |
|---|---|---|---|
| Purpose | Build and test on one machine | Prove a change end to end before families see it | The pilot families |
| Data allowed | Synthetic only | Synthetic, plus the founder's own test accounts | Real families; from sprint 2, the consented benchmark clips in `vela-benchmark` (below) |
| Cloudflare account | None (local) | "Vela staging" account, workers.dev subdomain `vela-light-staging` | "Vela" account, workers.dev subdomain `vela-light` |
| Workers | `vela-dev` (pilot) and `vela-admin-dev` (admin), run by `wrangler dev` (local) | `vela` and `vela-admin` | `vela` and `vela-admin` |
| Hosts | `http://localhost:8787` (`pnpm dev` serves the pilot Worker there, `pnpm --filter @vela/worker dev:admin` the admin Worker) | Pilot `https://vela.vela-light-staging.workers.dev`; admin `https://vela-admin.vela-light-staging.workers.dev` | Pilot `https://vela.vela-light.workers.dev`; admin `https://vela-admin.vela-light.workers.dev` |
| Privacy notice pages | `/privacy` and `/privacy/zh-TW` on localhost, blanks and all | `https://vela.vela-light-staging.workers.dev/privacy` and `/privacy/zh-TW` | `https://vela.vela-light.workers.dev/privacy` and `/privacy/zh-TW` |
| Admin page sign-in | None: a request with no Access token passes as `development` | Cloudflare Access on the whole `vela-admin` Worker (section 12) | Same |
| Database | PGlite in `.pglite/`, served by `pnpm --filter @vela/db dev-db` on port 54320 | Neon project `vela-apac`, branch `staging` | Neon project `vela-apac`, branch `main` |
| Hyperdrive | Local connection string | `vela-apac-staging` (query caching off), bound by both Workers | `vela-apac` (query caching off), bound by both Workers |
| Media | Wrangler's local R2 | R2 bucket `vela-media-staging` | R2 bucket `vela-media-production`, location hint Asia-Pacific |
| Queues | Local | `vela-outbound-staging`, `vela-media-staging`, `vela-understand-staging`, and one dead-letter queue, `vela-dead-letter-staging`; the pilot Worker consumes all three, the admin Worker only sends to `vela-outbound-staging` | `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, and one dead-letter queue, `vela-dead-letter-production`; as in staging |
| Scheduler | `MemberScheduler` Durable Object, local | `MemberScheduler`, in `vela`; `vela-admin` binds it by `script_name` | Same |
| Cron | Triggered by hand | Every 15 minutes (reconcile, which records the heartbeat when it finishes); nightly (metrics, retention); on `vela` only | Same |
| Telegram | Dev test bot | Staging test bot | "Vela Light" bot |
| LINE (sprint 2) | Test Official Account | Test Official Account | "Vela Light" Official Account, paid plan |
| Anthropic | Workspace `vela-dev`, low spend limit | Workspace `vela-staging` | Workspace `vela-production` |
| Deepgram | Key `vela-dev` | Key `vela-staging` | Key `vela-production` |
| Sentry | Off | Project `vela-worker`, environment `staging` (not connected to the Workers yet) | Project `vela-worker`, environment `production` (not connected yet) |
| Watchdog (section 6) | None | `staging` in `.github/watchdog.json`, `https://vela.vela-light-staging.workers.dev/healthz`, enabled after staging's first deploy; a failure emails the founder | `production`, `https://vela.vela-light.workers.dev/healthz`, enabled after production's first deploy; the same |
| Who deploys | Co-founder | The founder's setup script the first time (section 11); then CI on merge to `main` (`.github/workflows/deploy.yml`), both Workers; co-founder by hand until the `staging` environment holds its secrets | The founder's setup script the first time (section 11); then only CI on a tag, after the founder's approval, both Workers |
| Who migrates | Co-founder (PGlite) | The setup script, before its first deploy; then CI on merge to `main`, in the deploy job before either Worker is deployed; the founder by hand until the `staging` environment holds its secrets ([`runbooks/release.md`](runbooks/release.md)) | The setup script, before its first deploy; then CI on a tag, in the deploy job before either Worker is deployed, after the founder's approval |

Only the `apac` region exists in the pilot, so **every pilot family is `apac`**, whatever its country: `families.region` must be `apac` for every family created before the region router exists (build plan 2.2). A family labelled `us` or `eu` would be looked up in an empty database once the router ships, and its arrivals and quiet notices would stop. Onboarding follows this rule (`architecture/decisions.md`, ADR-7 updated 14 September 2026): `Config.regions` lists the regions that exist, only `apac` in the pilot, and the country's preferred region falls back to `apac` when it does not exist (flows §3.1). The founder confirms the region after the first setups ([`runbooks/data-requests.md`](runbooks/data-requests.md), section A). Neon projects for `eu` and `us` are created in sprint 2 and stay idle (build plan 2.2); before either holds a family, the privacy notice needs a new version, because it says the database is in Singapore. Query caching is off on every Hyperdrive configuration because Hyperdrive caches reads for 60 seconds by default, and the scheduler must read fresh rows.

**The benchmark clips live in production, from sprint 2.** The STT benchmark (build plan 2.5) keeps the consented voice clips of real families in a private R2 bucket, `vela-benchmark`, in the **"Vela"** (production) account, decided on 17 September 2026 (`plan/materials/pilot/README.md`, the "Benchmark storage" row): they are personal data, and the staging token on the development machine reaches every bucket in the "Vela staging" account, so the account, not a policy, keeps the co-founder away from real voices. Only the founder uploads, reads and deletes them, and deletes them within 30 days after the benchmark (`plan/materials/pilot/data-map.md`, row 23; gap 19, closed).

### Worker configuration names

The secrets are listed, without values, in `apps/worker/.dev.vars.example`, which says which Worker reads each; the variables are set per environment in `apps/worker/wrangler.jsonc` (pilot) and `apps/worker/wrangler.admin.jsonc` (admin). Those three files are the source of truth, and this table follows them.

| Name | Kind | Worker | Set by | Notes |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | `vela` | Founder, at the setup script's prompt | Per environment, from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | `vela` | Setup script | Telegram and the adapter accept 1 to 256 characters of A–Z, a–z, 0–9, `_` and `-`. The script generates 48 random letters and digits, puts them on `vela` and registers the same value with Telegram; nobody types it |
| `ANTHROPIC_API_KEY` | Secret | `vela` and `vela-admin` | Founder, at the setup script's prompt | Per workspace, the same key in both Workers of an environment (the script puts one key on both). The admin Worker translates a sent weekly read for her, and refuses every admin page without the key |
| `DEEPGRAM_API_KEY` | Secret | `vela` | Founder, at the setup script's prompt | Per environment |
| `ADMIN_CONVERSATION_ID` | Secret | `vela` | Setup script | Your personal chat id with that environment's bot, which the script reads from Telegram after you send the bot `/start` (section 7, step 5). A secret of the pilot Worker, never a value in `wrangler.jsonc` (ADR-26). Outside development the pilot Worker refuses to start without it (`ConfigError:ADMIN_CONVERSATION_ID`), because you would otherwise never hear of a flag, a weekly read to check, or an answer nobody could read. Left empty in `.dev.vars`, a laptop sends no admin messages. The admin Worker does not read it |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Secret | `vela-admin` | Founder, at the setup script's prompts | From the Cloudflare Access application that protects the `vela-admin` Worker in that environment's account (section 12): the team domain, `<team name>.cloudflareaccess.com` with no scheme or path, and the application's audience (AUD) tag. The admin Worker checks both in every admin request's Access token |
| `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | Secret | `vela` | Founder | Sprint 2 |
| `ENVIRONMENT` | Variable | Both | Co-founder | `development`, `staging`, `production` |
| `TELEGRAM_BOT_USERNAME` | Variable | Both | Setup script | Per environment: that environment's bot username, without `@`, which the script asks Telegram for (`getMe`) and writes over the placeholder in `wrangler.jsonc` and `wrangler.admin.jsonc`; the co-founder commits both (section 11). From 17 September 2026 the admin Worker holds the same value in `wrangler.admin.jsonc`, for the link `create_invite` sends the organiser (ADR-26 update), and `src/wrangler-config.test.ts` holds the two equal |
| `PUBLIC_BASE_URL` | Variable | Both | Co-founder | The admin Worker's origin in that environment: `https://vela-admin.vela-light.workers.dev` (production), `https://vela-admin.vela-light-staging.workers.dev` (staging), `http://localhost:8787` locally. In the pilot Worker it is `Config.publicBaseUrl`: links in admin messages point to `<PUBLIC_BASE_URL>/admin/families/<family id>`. In the admin Worker it is the one origin a POST to `/admin` may come from. Telegram's webhook is not built from it (section 7, step 6) |
| `PRIVACY_NOTICE_URL_EN`, `PRIVACY_NOTICE_URL_ZH_TW` | Variable | `vela` | Co-founder | The pilot Worker's origin plus `/privacy` and `/privacy/zh-TW`, pages the pilot Worker serves itself from the pilot pack's Markdown: `https://vela.vela-light.workers.dev/privacy` and `https://vela.vela-light.workers.dev/privacy/zh-TW` in production, the same paths on `https://vela.vela-light-staging.workers.dev` in staging (`Config.privacyNoticeUrls`; other languages take the English URL). Vela's first message in a family group links the one in the family's language (`group.linked`, flows §3.3) |
| `REGIONS` | Variable | `vela` | Co-founder | The regions whose database exists, comma separated: `apac` in the pilot |
| `SENTRY_DSN` | Variable | Neither yet | Co-founder | Not read by either Worker yet, and not in either wrangler file. A DSN only allows sending events, not reading them |
| Hyperdrive id, bucket and queue names | Binding | — | Co-founder; the setup script writes the Hyperdrive id | Identifiers, not secrets. The Hyperdrive id and the outbound queue appear in both wrangler files, and `apps/worker/src/wrangler-config.test.ts` holds them equal |
| Durable Object classes `MemberScheduler` and `ReconcileHeartbeat` | Binding | `vela` (the admin Worker binds `MemberScheduler` only) | Co-founder | Declared with their migrations in `wrangler.jsonc`. `ReconcileHeartbeat` is one object that keeps only the time of the last successful reconcile, which `/healthz` reads (section 6); it needs no secret and no resource of its own |

In staging and production, the Hyperdrive ids (in both wrangler files) and the bot usernames are `PLACEHOLDER_` values until the setup script writes the values Cloudflare and Telegram return (section 11); nobody fills one with a guess. The hosts and notice URLs are already filled in, from the workers.dev subdomains (section 1, step 10). Outside development the pilot Worker refuses to run while any variable or secret still contains `PLACEHOLDER_`, a URL variable is not https, a secret is missing (`ADMIN_CONVERSATION_ID` included), or either privacy notice still holds a bracketed blank such as `[FOUNDER FULL NAME]`: every webhook update with something to handle, queue job, cron run, and alarm fails before it opens a database connection, and the log names the variable or the notice file (`ConfigError:PUBLIC_BASE_URL`, `ConfigError:privacy-notice.en.md`), never its value. The notice pages check only the notices: an unfilled notice also makes both pages fail, and once both are filled the pages answer even while a placeholder, a URL that is not https, or a missing secret stops everything else. The admin Worker refuses the same way for a placeholder, a `PUBLIC_BASE_URL` that is not https, or a missing secret. `/healthz` builds no deps and never touches the database, so it answers even then, but it answers `ok` only while a reconcile has finished in the last 35 minutes, which a Worker refusing its configuration never does (section 6); the notice pages prove nothing about the configuration. The admin page and its write actions need a valid Cloudflare Access token and, for a POST, a request from the admin Worker's own origin (`architecture/decisions.md`, ADR-22 and ADR-26), so there is no admin token.

GitHub Actions (set by the founder): **no repository secrets.** A repository secret is readable by a workflow on any pushed branch, which would get around the production approval, so every value the deploy workflow reads is an **environment** secret (**Settings → Environments →** the environment **→ Environment secrets**):

| Environment | Deployment rule | Environment secrets |
|---|---|---|
| `staging` | Branch `main` only | `CLOUDFLARE_API_TOKEN` (the "Vela staging" account's token), `CLOUDFLARE_ACCOUNT_ID` (the "Vela staging" account id), `DATABASE_URL` (the Neon `staging` branch) |
| `production` | Tags `v*` only; the founder as required reviewer | `CLOUDFLARE_API_TOKEN` (the "Vela" account's token), `CLOUDFLARE_ACCOUNT_ID` (the "Vela" account id), `DATABASE_URL` (the Neon `main` branch) |

`.github/workflows/deploy.yml` reads exactly these three as `secrets.CLOUDFLARE_API_TOKEN`, `secrets.CLOUDFLARE_ACCOUNT_ID` and `secrets.DATABASE_URL`, so each environment holds its own under the same names (`architecture/decisions.md`, ADR-23) and the deploy job reads whichever environment it runs in. An account id is an identifier, not a credential; it is an environment secret only because the workflow reads it from there, and an environment variable of that name would not reach the job. The deploy job runs the lint, typecheck and tests, then the migrations with `DATABASE_URL` (once), then deploys the pilot Worker (`wrangler deploy --env <environment>`), then the admin Worker (`wrangler deploy -c wrangler.admin.jsonc --env <environment>`), which binds the `MemberScheduler` class the pilot Worker exports. The same token deploys both, since both Workers live in the environment's one account. An environment's first migrations and deploy are the setup script's (section 11); after that, until the environment holds its secrets, the founder runs that environment's migrations by hand ([`runbooks/release.md`](runbooks/release.md), build plan 0.3).

There is no `NEON_API_KEY`: CI tests run on PGlite. If CI later creates a Neon branch per pull request (architecture §16), it does so in a separate Neon project used only by CI, with an API key limited to that project, and never branches from `main`, which holds real families. Later: `EXPO_TOKEN` (sprint 3), `SENTRY_AUTH_TOKEN`, each in the environment that uses it.

## Access rules

- The founder is the owner of every account, with multi-factor authentication on each. No shared passwords.
- The co-founder is an AI coding agent working on the founder's development machine. It works in dev and staging with synthetic data, may deploy staging, and never reads production message content, production secrets or production database connection strings. It may see content-free production signals: events, `metrics_daily` counts, Sentry errors, deployment status.
- **These rules are enforced by accounts, not only by policy, wherever Cloudflare allows it.** A Wrangler sign-in or a Workers API token covers every Worker, bucket and secret in a Cloudflare account; it cannot be limited to one Worker. So staging lives in its own Cloudflare account, and the only Cloudflare credential kept on the development machine is the "Vela staging" token in `apps/worker/.env` (section 11). Apart from the founder's own dashboard sign-in, a production-capable Cloudflare credential is kept only in the GitHub `production` environment; the founder's short-lived production setup token exists only while the setup script runs, and is deleted afterwards (section 11). The benchmark bucket `vela-benchmark` is in the "Vela" account for the same reason (Environments, above).
- Production changes go through CI on a tag the founder approves ([`runbooks/release.md`](runbooks/release.md)). Nobody runs `wrangler deploy --env production` from a laptop, with either wrangler file. The one exception is the production setup itself: the founder's own run of the setup script deploys production once, before any family (section 11).
- The co-founder uses the founder's GitHub session on the development machine. Environment rules stop a workflow on any branch from reading production secrets, but the session itself could approve a production deployment, so that last gate still rests on policy: only the founder approves, in the GitHub web interface, after reading the release notes.
- Only the founder's own sign-in passes Cloudflare Access to the production admin Worker (ADR-22, ADR-26, section 12). Every admin page view and every admin action writes `admin_access_log`; a change made in the Neon console is logged by hand ([`runbooks/data-requests.md`](runbooks/data-requests.md)).
- Cloudflare Access protects `vela-admin` and nothing else. Never turn on **Protect all Workers** on the Workers & Pages page: account-level Access would also cover `vela`, and Telegram's webhook and the families' privacy notice pages would stop answering.

## The founder's account checklist (sprint 0, task 0.2)

Do these in order; each takes 5 to 15 minutes. Start with a password manager (Bitwarden's free plan is enough) and an authenticator app; store every recovery code in the password manager. Sections 1 to 10 create the accounts and the things only a person can create (sign-ups, the bots, the workspaces, the notification setting for the watchdog). Every key they produce goes into the setup script's hidden prompts (section 11), which also creates the queues, the bucket and the Hyperdrive configuration and puts each Worker's secrets: you can create each key when the script asks for it, which is the safest, or keep it in the password manager until then.

**Done when:** the setup script's last line for staging is `check: every check passed` (both Workers deployed, `https://vela.vela-light-staging.workers.dev/healthz` answering, the two notice pages answering 200, `/admin` on the admin Worker closed without Access); `https://vela-admin.vela-light-staging.workers.dev/admin` opens through Cloudflare Access in your browser (which proves the admin Worker's configuration, its secrets and the database); within 15 minutes `/healthz` on staging answers 200 with `"status":"ok"` (which proves the pilot Worker's configuration, its database and its cron, because the heartbeat is recorded only when a reconcile has finished); and, once the co-founder has enabled staging in `.github/watchdog.json`, a manual run of the watchdog is green (section 6) (build plan 0.2). Sections 11 and 12 bring these together.

### 1. Cloudflare

Two separate Cloudflare users, each owning one account: **"Vela"** for production and **"Vela staging"** for dev and staging. A Wrangler sign-in reaches every account its user belongs to, and Workers permissions cannot be limited to one Worker, so a single account would let the development machine read production voice notes, tail production logs, or deploy production.

1. **Production.** Sign up at `dash.cloudflare.com` with your main email address, verify it, then **My Profile → Authentication → Two-factor authentication**: add a security key or an authenticator app. Name the account "Vela".
2. **Workers & Pages**: subscribe to Workers Paid ($5 a month, as budgeted in architecture §18).
3. **R2**: enable it (it asks for a payment method; the pilot stays inside the free allowance).
4. **Data processing terms.** Nothing to click: the Cloudflare Data Processing Addendum is part of the Self-Serve Subscription Agreement you accept by signing up. Save a PDF of the DPA's current version (6.4 on 17 September 2026) in the password manager's notes, and write the account's sign-up date in `sub-processors.md`, "Accepted on" ("Founder tasks: data processing terms", below).
5. **Production resources**: nothing to create by hand. The setup script's `resources` step (section 11) creates, in this account and with exactly the names in `apps/worker/wrangler.jsonc`, the bucket `vela-media-production` (location hint Asia-Pacific), the queues `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, and the dead-letter queue `vela-dead-letter-production` (one for all three), and skips any that already exist. The admin Worker needs nothing of its own: it binds these. Staging's are created the same way in "Vela staging".
6. **Production CI token:** **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**, account resources limited to "Vela", create it, and paste it straight into the GitHub `production` environment as `CLOUDFLARE_API_TOKEN`.
7. **Staging.** Sign up again with a second email address (an alias such as `yourname+staging@…` works), add two-factor authentication, and name the account "Vela staging". Note its sign-up date too (step 4). If `wrangler deploy --env staging` later reports that a binding needs Workers Paid, subscribe this account too (another $5 a month).
8. **The development machine reaches staging only, through a token.** No `wrangler login` is needed: the setup script, run for staging (section 11), saves the "Vela staging" token it was given to `apps/worker/.env` (ignored by git; the script checks that with `git check-ignore` first), and Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from that file whenever it runs in `apps/worker`. That lets the co-founder deploy staging; the token is limited to the "Vela staging" account and cannot reach production. If this machine has an older Wrangler sign-in, run `pnpm --filter @vela/worker exec wrangler logout`. Never approve a Wrangler sign-in on this machine while signed in as the production user.
9. **Staging CI token:** as step 6, signed in as the staging user, limited to "Vela staging", pasted into the GitHub `staging` environment as `CLOUDFLARE_API_TOKEN`.
10. **The workers.dev subdomains, which make the Workers' hosts.** Vela buys no domain and creates no zone, DNS record or route (ADR-26). Every Worker answers on `https://<Worker name>.<account subdomain>.workers.dev`, and Cloudflare's documentation says how to set the subdomain: "In the Cloudflare dashboard, go to the **Workers & Pages** page. Select **Change** next to **Your subdomain**." If Cloudflare asks for a subdomain the first time you open Workers & Pages, enter it there instead.
    1. In the "Vela" account, set the subdomain to `vela-light`.
    2. In the "Vela staging" account, set it to `vela-light-staging`.
    3. The setup script's `account` step compares the account's subdomain with the hosts in the wrangler files and stops if they differ. If a name is taken, use `velalight` (production) or `velalight-staging` (staging), and tell the co-founder before running the script. The header of `apps/worker/wrangler.jsonc` is the one list of what then changes: `WORKERS_DEV_SUBDOMAINS` in `apps/worker/src/wrangler-config.test.ts`, the hosts in both wrangler files, and the privacy notice links in `plan/materials/pilot` (the nearby-contact consent texts, the pilot README, and the cross-links in `privacy-notice.en.md` and `privacy-notice.zh-TW.md`, after which `pnpm --filter @vela/worker notices` regenerates `apps/worker/src/notices.generated.ts`), which that test fails on until they agree; then, with no test to catch them, the bots' privacy policy links (section 7, step 3), the webhook, registered again with `pnpm --filter @vela/worker run setup -- --env <environment> --from webhook` (section 7, step 6), and every document `git grep vela-light` lists.
    4. The hosts that follow are already in the wrangler files: production pilot `https://vela.vela-light.workers.dev`, admin `https://vela-admin.vela-light.workers.dev`; staging pilot `https://vela.vela-light-staging.workers.dev`, admin `https://vela-admin.vela-light-staging.workers.dev`. Deploying creates each Worker's address; there is nothing to create for it yourself.
    5. Set the subdomain before the first deploy and never change it afterwards: the privacy notice link in every family group's first message, the bot's privacy policy link and Telegram's webhook are all built on it.
11. **Hand over:** both account ids (Workers & Pages overview, right-hand column), saying which is which, and the workers.dev subdomain each account shows.

### 2. Neon

1. Sign up at `console.neon.tech` (with Google or GitHub, which must have multi-factor authentication on).
2. **New project:** name `vela-apac`, **Postgres 18** (the schema uses Postgres 18's native `uuidv7()`), provider AWS, region **Asia Pacific (Singapore)**, database name `vela`.
3. **Branches:** `main` is production. Create a branch `staging` from `main` now, while `main` is still empty. A branch copies its parent's data and its roles with their passwords, so on the `staging` branch open **Roles** and reset the role's password: staging's connection string then cannot open `main`. Never create, reset or restore `staging` from `main` once a family exists, because it would copy their data.
4. **Settings → Instant restore:** note the restore window. The Free plan allows at most 6 hours; before the first family beyond your own, decide whether to move to the Launch plan and set 7 days (see `runbooks/restore-drill.md`).
5. **Data processing terms.** Neon's terms are Databricks' Master Cloud Services Agreement, which incorporates the Databricks Data Processing Addendum, with Neon's own schedule on top, accepted by using the service. Write the project's sign-up date in `sub-processors.md`; signing a copy of the DPA on `databricks.com/legal/dpa` is optional ("Founder tasks: data processing terms", below).
6. Connection strings: open the project, select **Connect**, choose the branch, the database `vela` and the role that owns it, turn **Connection pooling** off, and copy the **direct** connection string (its host has no `-pooler`). Neon's documentation says schema migrations need a direct connection, and Cloudflare's says Hyperdrive, which pools connections itself, takes the direct string. Paste it only into (a) the setup script's `Neon connection string` prompt (section 11), which runs the migrations with it and creates the Hyperdrive configuration from it, (b) the GitHub environment secret `DATABASE_URL` of the matching environment (the `staging` branch's string in environment `staging`, the `main` branch's in environment `production`), and (c) a hidden prompt in your own terminal when a runbook asks for it.
7. **Hyperdrive**: nothing to create by hand. The setup script's `database` step creates `vela-apac-staging` in the "Vela staging" account from the staging string and `vela-apac` in the "Vela" account from the main string, both with caching off, and turns caching off on one that already exists with it on. One configuration per account serves both Workers.
8. No Neon API key in sprint 0 (see GitHub Actions above): an account key could read the `main` branch's connection string.
9. **Compute hours: watch them.** Neon's Free plan (neon.com/pricing, checked 17 September 2026) gives each project **100 compute-unit hours a month** ("compute size × hours running"), suspends compute until the next billing month when they are used up, and scales a compute to zero after 5 minutes without activity. Every `reconcile` wakes the database, so it runs every **15 minutes**, not 5 (decision W3): a reconcile every 5 minutes would never let the compute sleep, about 180 compute hours a month at the smallest size (0.25 compute units × 720 hours). The estimate at 15 minutes, per branch whose Worker is deployed: each run wakes the compute, which stays up for about 5 more minutes, so about a third of the month, roughly 60 compute hours at 0.25 units, before any family's traffic (arrivals, answers, the admin page and the nightly jobs add more, and Hyperdrive's pooled connections may keep a compute up longer than the queries do). **Both branches, `main` and `staging`, spend the same project's 100 hours**, so production and staging deployed together, each reconciling every 15 minutes, are likely to pass the limit before the month ends, and a suspended project stops arrivals and quiet notices for production as well. So:
    - After each environment's first deploy, check **Neon console → project `vela-apac` → Usage** daily for the first week, then weekly, and note the month's compute hours in the resource register.
    - **Decision needed before production is deployed while staging runs:** give staging its own Neon project (the Free plan allows many projects, each with its own 100 hours, and a separate project also stops a branch from ever copying production data), or delete staging's reconcile cron except while testing (the silence drill and releases need it).
    - Move to the Launch plan (billed per compute hour, with a 7-day restore window; step 4) before any family beyond the founder's own week of dogfooding, or earlier if the month's usage is on course to pass 80 hours.
10. **Hand over:** the Neon project id, region, branch names, database and role names (never passwords). The Hyperdrive ids need no hand-over: the setup script writes each over `PLACEHOLDER_HYPERDRIVE_ID_STAGING` or `PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION` in both `apps/worker/wrangler.jsonc` and `apps/worker/wrangler.admin.jsonc`, and the co-founder commits them (section 11).

### 3. Anthropic

1. Sign up at `platform.claude.com` (the console formerly at console.anthropic.com), create the organisation "Vela".
2. **Billing:** add a small prepaid credit, switch off auto-reload, and set an organisation spend limit.
3. **Workspaces:** create `vela-dev`, `vela-staging`, `vela-production`, each with a monthly spend limit (for example $10, $10 and $50; your call).
4. In each workspace create one API key named after it. Paste the staging and production keys straight into the setup script's `Anthropic API key` prompt for the matching environment (section 11), which puts the key on both Workers, `vela` and `vela-admin`, as `ANTHROPIC_API_KEY`. Put the dev key into `apps/worker/.dev.vars` yourself.
5. **Data processing terms.** Nothing to sign: Anthropic's Commercial Terms, which apply from your first use of the Console or the API, incorporate its Data Processing Addendum. Write the date the organisation was created in `sub-processors.md` ("Founder tasks: data processing terms", below).
6. **Hand over:** the workspace names.

### 4. Deepgram

1. Sign up at `console.deepgram.com`, create a project `vela`.
2. **API Keys:** create `vela-dev`, `vela-staging`, `vela-production` with the Member role. Paste staging and production into the setup script's `Deepgram API key` prompt (section 11), which puts each on the pilot Worker as `DEEPGRAM_API_KEY`; the dev key into `.dev.vars`.
3. **Data processing terms: a founder task before any real voice note.** Deepgram publishes no DPA; ask for it from your own email at security@deepgram.com, sign it, keep the signed copy in the password manager's notes, and write the date in `sub-processors.md` ("Founder tasks: data processing terms", below). Every request sets `mip_opt_out=true`, which the co-founder implements.
4. **Hand over:** the project id.

### 5. Sentry

Not connected to the Workers yet (`SENTRY_DSN` is not read); the account exists so the EU data location is fixed from the start.

1. Sign up at `sentry.io`. When creating the organisation, choose the **European Union** data storage location; it cannot be changed later.
2. Create the organisation `vela` and a project `vela-worker` for Cloudflare Workers.
3. **Settings → Security & Privacy:** turn on the data scrubber and default scrubbers, and turn on "prevent storing of IP addresses". **Settings → General:** require two-factor authentication.
4. **Alerts:** an issue alert that emails you on new issues in `production`.
5. **Data processing terms: a founder task before `SENTRY_DSN` is connected.** In the organisation's **Legal & Compliance** section (only an Owner or Billing member can do it), accept the Data Processing Addendum (version 5.1.0 on 17 September 2026), and write the date in `sub-processors.md`.
6. **Hand over:** organisation slug, project slug and the DSN.

### 6. The watchdog: GitHub Actions reading `/healthz`

If the pilot Worker, its cron or the database stops, no arrival and no quiet notice goes out, and a family reads the silence as "all fine". Cloudflare does not alert on a cron that stops, and the Worker cannot report its own silence, so something outside Cloudflare has to notice (ADR-18, update of 18 September 2026). There is no account to create:

- **The heartbeat, inside the pilot Worker.** Each time `reconcile` finishes (every 15 minutes), the pilot Worker records the time in a single Durable Object, `ReconcileHeartbeat`. `GET /healthz` on the pilot Worker reads that time and never touches the database, so Neon can sleep: it answers 200 with `{"status":"ok","lastReconcileAgeSeconds":<n>}` while the last successful reconcile is at most 35 minutes old, and 503 with `{"status":"stale"}` or, before the first reconcile ever, `{"status":"no_reconcile_yet"}`. It holds no content and no ids. 35 minutes is two missed runs plus five minutes, so one late cron does not alert and two missed runs do.
- **The watchdog, outside Cloudflare.** `.github/workflows/watchdog.yml` runs every 15 minutes on GitHub's schedule, and whenever it is started by hand (**GitHub → Actions → watchdog → Run workflow**). It reads `.github/watchdog.json`, which lists each environment's `/healthz` URL and whether it is `enabled`, and checks every enabled one with `curl` (with a timeout, three tries 20 seconds apart). A run fails, with a job summary naming the environment and what it answered, when any enabled environment does not answer 200 with `"status":"ok"`. It uses no secret and no GitHub environment. A disabled environment is skipped, so nothing fails before a deploy exists.

What GitHub's documentation says, and what follows from it (checked 17 September 2026):

- **Failures reach you by email only if your notification setting allows it.** "Notifications for scheduled workflows are sent to the user who last modified the cron syntax in the workflow file" (docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows, `schedule`). The co-founder commits with your GitHub account, so that user is you. Whether GitHub emails you is your setting: **founder task, once:** GitHub → **Settings → Notifications → System → Actions**, choose **Email** (and **On GitHub** if you like), select **Only notify for failed workflows**, and **Save** (docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).
- **Scheduled runs can be late.** "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour." The shortest interval is every 5 minutes. So the email usually comes about 35 to 50 minutes after the last successful reconcile, and later when GitHub is busy: the watchdog is a backstop, not a pager with a guaranteed delay.
- **Scheduled workflows run only on the default branch.** "Scheduled workflows will only run on the default branch", so the watchdog starts once `watchdog.yml` and `watchdog.json` are on `main`.
- **A quiet repository switches it off.** "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" (this repository is public). The daily review checks the watchdog's runs weekly ([`runbooks/silence-drill.md`](runbooks/silence-drill.md)); to switch it back on: **Actions → watchdog → Enable workflow** (docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).
- **It costs nothing here.** "GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners" (docs.github.com/en/billing/concepts/product-billing/github-actions). If the repository is ever made private, the Free plan includes 2,000 minutes a month for private repositories, and a run every 15 minutes is about 2,900 runs a month beside CI: check the billing before making it private, and change the schedule or the plan first.

Steps:

1. **Now:** the notification setting above.
2. **After each environment's first successful deploy** (section 11), once its `/healthz` answers `ok`: the co-founder sets that environment's `enabled` to `true` in `.github/watchdog.json` and commits it to `main`. Then run the watchdog by hand once and see it green.
3. **Test it once per environment:** the staging silence drill, part C ([`runbooks/silence-drill.md`](runbooks/silence-drill.md)), stops staging's cron and checks that the email comes.
4. **Hand over:** nothing.

### 7. Telegram bots

1. In Telegram, open **@BotFather** (confirm the verified badge). Send `/newbot`, display name **Vela Light**, a username ending in `bot`. BotFather shows the token; you do not need to keep it: when the setup script asks for `Telegram bot token` (section 11), send `/mybots` to @BotFather, choose the bot, select **API Token**, and paste it there. The script checks it with Telegram (`getMe`) and puts it on the pilot Worker as `TELEGRAM_BOT_TOKEN`.
2. Repeat for a staging bot ("Vela Light staging") and a dev bot. The staging token goes into the setup script run for staging; the dev token into `.dev.vars`.
3. For each bot in BotFather: leave **group privacy on** (BotFather's default). Families ask by replying to Vela's evening message or with `/ask` and `/later`, which privacy mode delivers, so the family's ordinary conversation never reaches Vela unless an organiser makes the bot an administrator (flows §1). Allow joining groups, set the description and about text, and set the picture. Set up the bot's **privacy policy** in @BotFather as a link to the pilot Worker's English notice page: `https://vela.vela-light.workers.dev/privacy` for the production bot, `https://vela.vela-light-staging.workers.dev/privacy` for the staging and dev bots. Telegram's bot developer terms say that when its Standard Bot Privacy Policy does not properly describe how a bot uses personal data, the bot "must set up a Privacy Policy in @BotFather" (telegram.org/tos/bot-developers), and Vela's handling is described only in its own notice. The page answers once that environment's pilot Worker is deployed (section 11); both notices are already filled in (section 11, step 4).
4. **The webhook secret: nobody makes one.** The setup script's `telegram` step generates it with a cryptographic random source, 48 letters and digits (Telegram and the adapter accept 1 to 256 characters of A–Z, a–z, 0–9, `_` and `-`), puts it on the pilot Worker as `TELEGRAM_WEBHOOK_SECRET`, and registers the same value with Telegram at its `webhook` step. A run that resumes at `--from webhook` cannot read the Worker's secret back, so it makes a new one and puts it on both sides.
5. **Your chat id, before any webhook exists.** Telegram answers `getUpdates` only while a bot has no webhook, so the setup script reads your chat id at its `telegram` step, before its `webhook` step. It asks you to send `/start` to the bot from your own Telegram account and press Enter, shows the first name of each private chat that sent `/start` and asks whether it is you, and keeps the chat id you confirm, without showing it, for the pilot Worker's secret `ADMIN_CONVERSATION_ID`. It is a secret of `vela`, never a value in `wrangler.jsonc`, and nobody hands it over (ADR-26). Development leaves it empty in `.dev.vars` and sends no admin messages. The script then confirms the updates it read (`getUpdates` with the next `offset`), so your `/start` never reaches the Worker and begins an organiser setup once the webhook exists; nothing else is dropped, and pending updates are kept everywhere else. If the pilot Worker already holds `ADMIN_CONVERSATION_ID`, the script keeps it and asks for no `/start`. If the bot already has a webhook and the Worker has no chat id, the script stops rather than remove a webhook that may carry families' messages. Only for a bot no family uses yet, remove the webhook in your own terminal (Git Bash), then run the script again with `--from telegram`; the token goes to `curl` on its standard input, never on its command line:

   ```bash
   read -rsp "Bot token: " TOKEN; echo
   printf 'url = "https://api.telegram.org/bot%s/deleteWebhook"\n' "$TOKEN" | curl -s -K -
   unset TOKEN
   ```

6. **Webhook and command menu, once that environment's pilot Worker is deployed.** The setup script's `webhook` step does this with the environment's **pilot** origin from `wrangler.jsonc` (`https://vela.vela-light-staging.workers.dev` for the staging bot, `https://vela.vela-light.workers.dev` for the production bot), never the admin origin, which Cloudflare Access closes to Telegram. It calls the same code as `pnpm --filter @vela/worker telegram:setup` (`apps/worker/scripts/telegram-webhook.ts`, where `telegram:setup` takes the origin as `WORKER_URL`): it registers the origin plus `/webhooks/telegram` with the secret and the updates the adapter parses (`TELEGRAM_ALLOWED_UPDATES`, imported from `@vela/adapters`: `message`, `callback_query`, `message_reaction`, `my_chat_member`), sets `/ask` and `/later` as the command menu in groups and no menu in private chats, and prints the webhook URL, whether pending updates were kept, the updates, the commands, the bot's username, and whether group privacy is on. It never prints the token or the secret. **Pending updates are kept**: the setup script never drops them, because once a family uses the bot the updates Telegram is still holding are real answers and asks. If it says group privacy is off, turn it back on in BotFather (step 3). No `chat_member` update is needed, which would also need the bot to be an administrator: when someone leaves the family group, Telegram's `left_chat_member` service message arrives inside `message`, even in privacy mode (flows §3.16). To register the webhook again later (for example after the pilot Worker's origin changed), run the setup script with `--from webhook`. To see that Telegram reaches the Worker, in your own terminal (Git Bash):

   ```bash
   read -rsp "Bot token: " TOKEN; echo
   printf 'url = "https://api.telegram.org/bot%s/getWebhookInfo"\n' "$TOKEN" | curl -s -K -
   unset TOKEN
   ```

   It shows the pilot origin plus `/webhooks/telegram` and no `last_error_message`.
7. **Hand over:** the dev bot's username, without `@`, for `TELEGRAM_BOT_USERNAME` at the top level of `wrangler.jsonc`. The staging and production usernames need no hand-over: the setup script writes them into `wrangler.jsonc`. Not the chat ids: they are secrets the script sets (step 5).

### 8. LINE Official Account and Messaging API channel

Needed now so the account exists; the adapter is built in sprint 2 (build plan 2.3).

1. Sign in at `manager.line.biz` with a LINE Business ID and turn on two-step verification.
2. **Create an account:** unverified (未認證帳號), country Taiwan, name **Vela Light**. Create a second one, "Vela Light test", for staging.
3. **Settings → Messaging API → Enable**, create a provider in your own name (there is no entity yet), agree to the terms.
4. In `developers.line.biz`, open the channel: **Basic settings** shows the channel secret; **Messaging API** issues a long-lived channel access token. Keep both only in the password manager until sprint 2, then paste them into the pilot Worker's `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`.
5. **Response settings** in LINE Official Account Manager: chat off, automatic responses off, greeting message off, webhooks on.
6. Stay on the free plan until the first Taiwanese family; move to the paid plan before they start (market order, ADR-16).
7. **Hand over:** each account's basic id (`@…`) and channel id.

### 9. Expo

1. Sign up at `expo.dev`, create the organisation `vela`, turn on two-factor authentication.
2. In sprint 3: **Access tokens → Create** `github-actions`, paste into GitHub as `EXPO_TOKEN`.
3. **Hand over:** the organisation name.

### 10. GitHub

1. **Settings → Environments:** create `staging` with the deployment branch rule "Selected branches and tags" → branch `main`; create `production` with the rule → tag pattern `v*`, and add yourself as a required reviewer.
2. Add each environment's three secrets listed above (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`) as each account is created. The deploy workflow reads all three from **Environment secrets**, so none goes under environment variables. Leave **Repository secrets** empty.

### 11. The first deploy of each environment: the setup script

Staging first; production once staging has passed. One script, run by you in your own terminal once per environment, does everything between the accounts and a working environment: it takes each key at a hidden prompt, creates the Cloudflare resources, migrates the database, writes the identifiers Cloudflare and Telegram return into the wrangler files, puts each Worker's secrets, deploys both Workers, registers the webhook, and checks the result (`apps/worker/scripts/setup-environment.ts`). A secret you paste is never shown (only its length is: "received, 40 characters"), never passed to a program on its command line (Wrangler receives it on standard input, the migrations in their environment), and never written to disk, except the staging token in `apps/worker/.env`. Every line the script prints is also checked against every secret it has seen, and a secret found there is replaced by `[hidden]`. The pilot Worker refuses to run in an environment while a wrangler file still holds a `PLACEHOLDER_` value for it or either privacy notice still holds a bracketed blank, and the admin Worker while its file holds a placeholder; the script fills the placeholders before it deploys, and step 4 covers the notices.

1. **Before you run it**, for that environment: the Cloudflare account with its workers.dev subdomain (section 1, steps 1 to 4, 7 and 10); the Neon branch (section 2, steps 1 to 5); the Anthropic workspace (section 3) and the Deepgram project (section 4); the bot with its BotFather settings (section 7, steps 1 to 3); and, for Access, a Zero Trust organisation or the ten minutes to create one (section 12, step 1). The keys themselves you create or copy when the script asks.
2. **Where to run it.** In a terminal that can hide what you type: Windows Terminal (with PowerShell, or with Git Bash inside it) or PowerShell, at the repository's root, on the commit you mean to deploy, after `pnpm install`. If standard input is not a terminal (Git Bash's own window can start Node without one), the script refuses before asking anything. You run it, never the co-founder. What it prints holds no secret, so the output may be shared.
3. **The Cloudflare token.** The script prints this template before its first prompt. Signed in as that account's user: **My Profile → API Tokens → Create Token → Create Custom Token → Get started**, token name `vela-setup-staging` or `vela-setup-production`, and these permissions, each a row of **Account**, the permission and the level:
   - Account · Workers Scripts · Edit (deploys, Worker secrets, the workers.dev subdomain)
   - Account · Workers R2 Storage · Edit (the media bucket)
   - Account · Queues · Edit (the queues and their consumers)
   - Account · Hyperdrive · Edit (the database configuration)
   - Account · Account Settings · Read (the account's name, which the script checks)

   **Account Resources: Include →** that one account, and no permission beyond these rows. For **production**, set **TTL** to end tomorrow, and after the run delete the token (**My Profile → API Tokens**, the token's menu, **Delete**): CI deploys with its own token (section 1, step 6), and nothing on this machine may keep a production credential. For **staging**, leave TTL empty: the script saves the token to `apps/worker/.env` so Wrangler on this machine keeps reaching "Vela staging" (section 1, step 8).
4. **Privacy notices: nothing to do.** Both notices, `plan/materials/pilot/privacy-notice.en.md` and `privacy-notice.zh-TW.md`, were filled in on 17 September 2026 (the founder's name, the contact address and the notes tool), and their pages were regenerated into `apps/worker/src/notices.generated.ts`. The pilot Worker serves them and refuses to start while either holds a bracketed blank (`plan/materials/pilot/README.md`, "Before first use"), so a bracket added to a notice later stops it again; only the quoted `[Name]` and `[名字]` are allowed, because they quote the pause message. After any later edit to a notice, the co-founder runs `pnpm --filter @vela/worker notices` and commits the regenerated module in the same commit; `src/notices.test.ts` fails in CI while the module is stale. The hosts and notice URLs need nothing: they are in the wrangler files already (section 1, step 10). The script's `check` step fails while a notice page does not answer.
5. **GitHub.** The environment holds its three secrets (section 10). The script does not need them, but every deploy after it does.
6. **Run it.** For staging, then, once staging has passed, for production:

   ```bash
   pnpm --filter @vela/worker run setup -- --env staging
   pnpm --filter @vela/worker run setup -- --env production
   ```

   Write `run`: without it, pnpm starts its own `setup` command instead. The steps run in this order, and each prints one line saying what it did or found:

   | Step | What it does |
   |---|---|
   | `account` | Checks the token with Cloudflare, that the account is named "Vela staging" or "Vela" (if not, you type the environment's name to go on), and that its workers.dev subdomain is the one the wrangler files are built on. Staging: saves `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to `apps/worker/.env`, only after `git check-ignore` confirms that git ignores the file, and on a later run uses them without asking while the token still works. Production: saves nothing, and stops if `apps/worker/.env` holds that account's id or token |
   | `resources` | Creates the three queues, the dead-letter queue and the R2 media bucket (location hint Asia-Pacific) with the names in `wrangler.jsonc`, skipping any that exist |
   | `database` | Runs the migrations (`packages/db/src/migrate.ts`) with the connection string in the child process's environment, then creates the Hyperdrive configuration (`vela-apac-staging` or `vela-apac`) through the Cloudflare API with caching off, or finds the existing one, checks that it points at the same host, database and role, and turns its caching off if it is on. Writes the id over that environment's `PLACEHOLDER_HYPERDRIVE_ID_…` in both wrangler files, touching nothing else, and refuses to overwrite a different id |
   | `telegram` | Checks the bot token with Telegram (`getMe`), writes the bot's username over `PLACEHOLDER_…_BOT_USERNAME` in `wrangler.jsonc` and `wrangler.admin.jsonc`, reads your chat id (section 7, step 5), and generates the webhook secret (section 7, step 4). Skipped when the username is written and `vela` already holds the token, the webhook secret and your chat id |
   | `secrets` | Puts each secret on the Worker that reads it with `wrangler secret put`, the value on standard input: on `vela`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_CONVERSATION_ID`, `ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY`; on `vela-admin`, `ANTHROPIC_API_KEY`. A secret a Worker already holds is kept and not asked for, except the three from the `telegram` step, which are put whenever that step ran. The first put creates a Worker that does not exist yet, which the next step replaces |
   | `deploy` | Refuses while a placeholder for the environment is left, then runs `wrangler deploy --env <environment>` for `vela` and `wrangler deploy -c wrangler.admin.jsonc --env <environment>` for `vela-admin`, printing Wrangler's output. For production it says again that this is the one deploy from a laptop |
   | `access` | Prints a short form of section 12's steps 1, 3 and 4, numbered 1 to 3 in the terminal (step 2 needs nothing), waits for Enter, then asks for the team domain and the audience tag and puts them on `vela-admin` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Skipped when `vela-admin` holds both |
   | `webhook` | Registers the webhook and the command menu (section 7, step 6), keeping pending updates |
   | `check` | Checks that `/privacy` and `/privacy/zh-TW` on the pilot origin answer 200, that `/healthz` answers (right after a first deploy it is 503 with `no_reconcile_yet` until the first reconcile, within 15 minutes), and that `/admin` on the admin origin does not answer 200 without a sign-in (saying whether Cloudflare Access asked for one); then prints what to do next |

   If a step fails, the script says why and prints the command that resumes there, such as `pnpm --filter @vela/worker run setup -- --env staging --from database`. Every step skips what already exists, so running from the start again is also safe. `--help` lists the steps. Ctrl+C at a prompt stops the run; steps already finished stay done.
7. **The prompts, in order.** A prompt marked hidden shows nothing as you type or paste. One marked hidden until checked also shows nothing, then prints the identifier once it passes its check, so a key pasted there by mistake is never shown. Press Enter after each. A prompt is skipped when what it feeds already exists (step 6).

   | Step | Prompt | Where to find the value | Where it goes |
   |---|---|---|---|
   | `account` | `Cloudflare API token (hidden)` | The token from step 3, copied from Cloudflare's page as it is created | Cloudflare's token check; for staging, `apps/worker/.env`; every Cloudflare call and Wrangler run of this setup |
   | `account` | `Account ID (hidden until checked)` | That account's **Workers & Pages** overview, right-hand column (32 characters; an identifier, not a secret); a token pasted here by mistake is refused without being shown | The same |
   | `database` | `Neon connection string (hidden)` | Neon console, project `vela-apac`, **Connect**: branch `staging` (staging) or `main` (production), database `vela`, the role that owns it, **Connection pooling** off, then copy (section 2, step 6). A pooled string (host with `-pooler`) is refused | The migrations, then the Hyperdrive configuration |
   | `telegram` | `Telegram bot token (hidden)` | @BotFather → `/mybots` → the bot ("Vela Light staging" or "Vela Light") → **API Token**. A token for another bot than the one `wrangler.jsonc` names is refused | `TELEGRAM_BOT_TOKEN` on `vela` |
   | `telegram` | `From your own Telegram account, open @<bot>, send /start, then press Enter here` | Telegram, on your own account | Your chat id, never shown: `ADMIN_CONVERSATION_ID` on `vela` |
   | `telegram` | `Is "<first name>" you? Type yes or no` | The first name on your own Telegram account | The same |
   | `secrets` | `Anthropic API key (hidden)` | platform.claude.com, workspace `vela-staging` or `vela-production`, a key named after the workspace (section 3) | `ANTHROPIC_API_KEY` on `vela` and `vela-admin` |
   | `secrets` | `Deepgram API key (hidden)` | console.deepgram.com, project `vela`, **API Keys**, the key `vela-staging` or `vela-production` with the Member role (section 4) | `DEEPGRAM_API_KEY` on `vela` |
   | `access` | `When Access is applied, press Enter` | Section 12, steps 1, 3 and 4 (step 2 needs nothing), in that account's dashboard | — |
   | `access` | `Team domain (hidden until checked)` | `<team name>.cloudflareaccess.com`: **Zero Trust → Settings** shows the team name (section 12, step 1); a pasted `https://` and trailing slash are removed | `ACCESS_TEAM_DOMAIN` on `vela-admin` |
   | `access` | `Application Audience (AUD) tag (hidden)` | **Zero Trust → Access controls → Applications → Configure** (the application for `vela-admin`) **→ Additional settings** (section 12, step 4); 64 characters of 0–9 and a–f | `ACCESS_AUD` on `vela-admin` |
   | `webhook` | `Telegram bot token (hidden)` | As at the `telegram` step; asked here only when this run skipped that step | Telegram's `setWebhook` and `setMyCommands` |

   A hidden value that is empty or does not look right is asked for again, up to three times, with the reason shown and never the value. The `database` prompt comes on every run, because the migrations run on every run and apply only what is new.
8. **Afterwards.** The wrangler files now hold the environment's Hyperdrive id and bot username (identifiers, not secrets): the co-founder commits them, and `src/wrangler-config.test.ts` checks them. For production, delete the setup token (step 3). Every later deploy of either environment goes through [`runbooks/release.md`](runbooks/release.md); run the script again only to repair an environment, or with `--from webhook` to register the webhook again.
9. **Access** is section 12, which the `access` step prints and waits on.
10. **Check.** The script's last line is `check: every check passed`. Then, by eye: `https://vela.<subdomain>.workers.dev/privacy` and `/privacy/zh-TW` open on a phone with no sign-in; `https://vela.<subdomain>.workers.dev/admin` answers `not found`; `https://vela-admin.<subdomain>.workers.dev/admin` opens the overview through Cloudflare Access; both Workers' logs in the dashboard show no `ConfigError`; within 15 minutes `https://vela.<subdomain>.workers.dev/healthz` answers 200 with `"status":"ok"`, after which the co-founder enables the environment in `.github/watchdog.json` (section 6, step 2); and `/start` to the bot from your own account begins an organiser setup.

### 12. Cloudflare Access for the admin Worker

In each Cloudflare account, "Vela staging" first, once `vela-admin` has been deployed there: the setup script's `access` step comes right after its `deploy` step, prints a short form of steps 1, 3 and 4 below (numbered 1 to 3 in the terminal; step 2 needs nothing), and waits for you (section 11). Access protects the whole `vela-admin` Worker: Cloudflare's Workers documentation (developers.cloudflare.com/workers/configuration/cloudflare-access, "Protect one Worker", last updated 18 August 2026) says protecting one Worker "automatically protects every domain associated with the Worker, including its routes, Custom Domains, `workers.dev` hostname, and previews". The pilot Worker `vela` stays public, because Telegram's webhook and the notice pages must answer without a sign-in, so never protect it and never use **Protect all Workers** (access rules). Only your own sign-in may pass (ADR-22, ADR-26); the admin Worker checks the Access token again on every `/admin` request, so a mistake here cannot open the page, and a request without a valid token gets 401.

1. **Zero Trust, on first use.** "In the Cloudflare dashboard, select **Zero Trust**." On the onboarding screen choose a team name, then the Free plan (it asks for payment details and does not charge). The team domain is `<team name>.cloudflareaccess.com`; Zero Trust shows the team name under **Settings**.
2. **Sign-in method.** New Zero Trust organisations use the Cloudflare identity provider as their default login method: you sign in to the admin page with this account's Cloudflare user, which has your second factor from section 1. **Zero Trust → Integrations → Identity providers** lists it; nothing to change.
3. **Protect the Worker.** The documentation's path is "**Workers & Pages** > select your Worker > **Access**":
   1. In the Cloudflare dashboard, go to the **Workers & Pages** page.
   2. Select `vela-admin` from the application list.
   3. Select the **Access** tab.
   4. Select **Protect this Worker behind Access**.
   5. Choose **All traffic**.
   6. Under **Authentication policy**, choose **Cloudflare account**, which "allows members of this Cloudflare account to sign in": you are the account's only member.
   7. Select **Apply Access**.

   Cloudflare's October 2025 changelog put an earlier form of this switch under **Settings → Domains & Routes →** `workers.dev` **→ Enable Cloudflare Access**; if your dashboard shows that instead of the **Access** tab, use it for `vela-admin` and allow only your own email. If anyone else is ever added to the Cloudflare account, narrow the policy to your own email first (step 4's application, **Configure**).
4. **The audience tag.** "In the Cloudflare dashboard, go to **Zero Trust** > **Access controls** > **Applications**. Select **Configure** for your application. From **Additional settings**, copy the **Application Audience (AUD) Tag**." The application is the one step 3 created for `vela-admin`.
5. **The admin Worker's secrets.** Press Enter at the setup script's `access` step, then paste the team domain `<team name>.cloudflareaccess.com` (a pasted `https://` or trailing slash is removed; the script shows the domain once it passes its check) and the tag, each at its hidden prompt. The script puts them on `vela-admin` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` with `wrangler secret put`. They do not go on `vela`.
6. **Check,** in a private browser window: `https://vela-admin.<subdomain>.workers.dev/` asks for the Access sign-in before anything else, which shows Access covers the whole Worker; after you sign in it opens the overview at `/admin`. A "Not signed in" page after signing in means the Worker did not accept the token: check both secrets. `https://vela.<subdomain>.workers.dev/healthz` and `/privacy` answer with no sign-in.
7. **Hand over:** the team domain, for the resource register.

### Founder tasks: data processing terms

Before real family data reaches a provider, its data processing terms are in place and dated in [`sub-processors.md`](sub-processors.md) (decision L10; `plan/materials/pilot/legal-memo.md`, C9). The co-founder read each provider's current terms on 17 September 2026 and wrote in that file what they are and how they are accepted; the co-founder cannot see your accounts, so only you can confirm a date. Write each date in the "Accepted on" column yourself, or tell the co-founder the date (a date is not a secret):

| Provider | What you do | When |
|---|---|---|
| Cloudflare ("Vela" and "Vela staging") | Nothing to click: the DPA is part of the Self-Serve Subscription Agreement. Note each account's sign-up date, and save a PDF of the DPA version in force (6.4) | When each account is created (section 1) |
| Neon | Nothing to click: the Databricks DPA is incorporated in the terms you accept by using Neon. Note the project's sign-up date; optionally sign a copy at `databricks.com/legal/dpa` | Now (the project exists) |
| Anthropic | Nothing to click: the DPA is incorporated in the Commercial Terms. Note the date the organisation was created | When the organisation is created (section 3) |
| Deepgram | **Ask for the DPA** at security@deepgram.com, sign it, keep the signed copy | Before any real voice note reaches Deepgram, so before the first family |
| Sentry | **Accept the DPA** in the organisation's Legal & Compliance section | Before `SENTRY_DSN` is connected to either Worker |
| Telegram | Nothing: bot developers get no processing terms; Telegram carries the chats under its own terms. Note the date the production bot was created | When the bot is created (section 7) |
| Google Drive | Nothing available for a personal account. Keep the notes minimal (pilot pack README, "Placeholders", notes tool), and ask counsel (memo lawyer question 9) | Before the first family beyond your own |
| OpenAI, Groq, Microsoft | Not used yet: each gets its terms read, its row in `sub-processors.md` and its line in the privacy notice before it receives anything | Sprint 2 |

Every six months, and when a provider announces new terms, the co-founder reads the terms again and updates "Last checked"; a change that the notice does not cover goes to you before it applies.

### Later, not in sprint 0

| Account or resource | When | Why |
|---|---|---|
| R2 bucket `vela-benchmark`, in the "Vela" (production) account | Sprint 2, before the first clip | The consented voice clips for the STT benchmark (build plan 2.5; data map, row 23), which are real families' personal data, so never in "Vela staging" (Environments, above). Created by you in the "Vela" account's dashboard on the **R2 object storage** page (**Create bucket**); R2 buckets are not public by default, and it stays private |
| Microsoft Azure (Speech) | Sprint 2 | Text-to-speech read-back; region Southeast Asia |
| OpenAI, Groq | Sprint 2 | Second-opinion transcription and the STT benchmark (must be added to the privacy notice first) |
| Clerk, PostHog | Sprint 3 | App accounts, app analytics |
| Instatus | Before the first family beyond the founder's own | Status page |
| Apple, Google developer accounts | When the entity exists | Need a D-U-N-S number |
| Twilio, Meta WhatsApp | Phase 2, after the entity | Voice line, WhatsApp |

## Resource register

Fill in as resources are created. Identifiers only, never secrets.

| Resource | Identifier |
|---|---|
| Cloudflare account id ("Vela", production) | |
| Cloudflare account id ("Vela staging") | |
| workers.dev subdomain ("Vela" · "Vela staging"; planned `vela-light` · `vela-light-staging`) | |
| Worker hosts, pilot and admin (staging · production) | |
| Privacy notice URLs (English · Traditional Chinese; production) | |
| Cloudflare Access team domains (staging · production) | |
| Neon project id (`vela-apac`) | |
| Hyperdrive `vela-apac-staging` id | |
| Hyperdrive `vela-apac` id | |
| R2 bucket `vela-benchmark` ("Vela", production, sprint 2) | |
| Telegram bots (dev · staging · production) | |
| LINE accounts (test · production) | |
| Sentry organisation and project | |
| Watchdog environments enabled in `.github/watchdog.json` (staging · production), with the commit | |
| Neon compute hours used, by month | |
| Data processing terms: dates recorded in `sub-processors.md` (Cloudflare "Vela" · "Vela staging", Neon, Anthropic, Deepgram, Sentry) | |
| Anthropic workspaces | |
| Deepgram project id | |
