# Infrastructure

17 September 2026 · build plan sprint 0 (tasks 0.2, 0.3, 0.4) · architecture §12–17 · ADR-26 · owner: the founder owns every account; the co-founder builds on them

What runs where, how the founder creates each account, and how credentials reach the Workers without ever passing through a chat or the repository. Vela runs as two Cloudflare Workers from one package, on Cloudflare's free workers.dev addresses, with no domain (`architecture/decisions.md`, ADR-26): the **pilot Worker** `vela` (Telegram's webhook, the privacy notice pages, the scheduler, the queues and cron; `apps/worker/wrangler.jsonc`) and the **admin Worker** `vela-admin` (the founder's admin pages, behind Cloudflare Access; `apps/worker/wrangler.admin.jsonc`). Those two files are the Workers' own configuration (code design §9); this folder records the resources, the providers and the runbooks.

| Document | Use it when |
|---|---|
| [`sub-processors.md`](sub-processors.md) | Adding a provider, answering "who processes our data", updating the privacy notice |
| [`runbooks/incident.md`](runbooks/incident.md) | Something is wrong for families, or a secret or personal data may be exposed |
| [`runbooks/data-requests.md`](runbooks/data-requests.md) | The founder changes family records by hand until the admin page's actions ship (build plan 1.12), and afterwards for what they do not cover: consent rows, nearby contacts, away, a death, someone leaving, copies, corrections, deletions, the end of a family's pilot |
| [`runbooks/release.md`](runbooks/release.md) | Deploying the Workers or running a migration |
| [`runbooks/restore-drill.md`](runbooks/restore-drill.md) | Quarterly, and whenever production data must be restored |
| [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) | A credential may be exposed, someone leaves, or every six months |
| [`runbooks/silence-drill.md`](runbooks/silence-drill.md) | Proving our failures never produce a quiet notice |
| [`runbooks/ota-policy.md`](runbooks/ota-policy.md) | Shipping a JavaScript-only fix to the mobile app (from sprint 3) |

## Rule zero: secrets

A secret is anything that grants access: API keys, bot tokens, database connection strings with passwords, webhook secrets, the Healthchecks ping URL, CI tokens.

- **Never paste a secret into a chat** (including the conversation with the co-founder), Telegram, LINE, email, an issue, a screenshot, a markdown file or any file in the repository.
- **The founder copies each secret from the provider's page straight into its destination**: the Cloudflare dashboard (Worker secrets, Hyperdrive), GitHub (environment secrets), or a hidden prompt in the founder's own terminal. A password manager is the only other place it may live.
- **The co-founder receives only identifiers**: account ids, project ids, resource names, bot usernames, workers.dev subdomains and hosts. Each account section below lists exactly what to hand over. The founder's personal Telegram chat id is not handed over either: it goes straight into the pilot Worker's secret `ADMIN_CONVERSATION_ID`. The one credential on the development machine beyond development keys is the staging Cloudflare account's session (section 1), which reaches only staging and its synthetic data.
- Development keys are separate, low-limit keys that may sit in `apps/worker/.dev.vars` (ignored by git). Production keys, and any sign-in to the production Cloudflare account, never touch the development machine.
- If a secret is pasted anywhere by mistake, treat it as exposed and follow [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) now.

## Environments

| | dev | staging | production |
|---|---|---|---|
| Purpose | Build and test on one machine | Prove a change end to end before families see it | The pilot families |
| Data allowed | Synthetic only | Synthetic, plus the founder's own test accounts; from sprint 2, the consented benchmark clips in `vela-benchmark` (below) | Real families |
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
| Cron | Triggered by hand | Every 5 minutes (reconcile); nightly (metrics, retention); on `vela` only | Same |
| Telegram | Dev test bot | Staging test bot | "Vela Light" bot |
| LINE (sprint 2) | Test Official Account | Test Official Account | "Vela Light" Official Account, paid plan |
| Anthropic | Workspace `vela-dev`, low spend limit | Workspace `vela-staging` | Workspace `vela-production` |
| Deepgram | Key `vela-dev` | Key `vela-staging` | Key `vela-production` |
| Sentry | Off | Project `vela-worker`, environment `staging` (not connected to the Workers yet) | Project `vela-worker`, environment `production` (not connected yet) |
| Healthchecks.io | None | Check `vela-staging-reconcile` (email) | Check `vela-production-reconcile` (pages the founder) |
| Who deploys | Co-founder | CI on merge to `main` (`.github/workflows/deploy.yml`), both Workers; co-founder by hand until the `staging` environment holds its secrets | CI on a tag, after the founder's approval, both Workers |
| Who migrates | Co-founder (PGlite) | CI on merge to `main`, in the deploy job before either Worker is deployed; the founder by hand until the `staging` environment holds its secrets ([`runbooks/release.md`](runbooks/release.md)) | CI on a tag, in the deploy job before either Worker is deployed, after the founder's approval |

Only the `apac` region exists in the pilot, so **every pilot family is `apac`**, whatever its country: `families.region` must be `apac` for every family created before the region router exists (build plan 2.2). A family labelled `us` or `eu` would be looked up in an empty database once the router ships, and its arrivals and quiet notices would stop. Onboarding follows this rule (`architecture/decisions.md`, ADR-7 updated 14 September 2026): `Config.regions` lists the regions that exist, only `apac` in the pilot, and the country's preferred region falls back to `apac` when it does not exist (flows §3.1). The founder confirms the region after the first setups ([`runbooks/data-requests.md`](runbooks/data-requests.md), section A). Neon projects for `eu` and `us` are created in sprint 2 and stay idle (build plan 2.2); before either holds a family, the privacy notice needs a new version, because it says the database is in Singapore. Query caching is off on every Hyperdrive configuration because Hyperdrive caches reads for 60 seconds by default, and the scheduler must read fresh rows.

**The one exception to staging's synthetic data, from sprint 2.** The STT benchmark (build plan 2.5) keeps the consented voice clips in a private R2 bucket, `vela-benchmark`, in the "Vela staging" account (`plan/materials/pilot/data-map.md`, row 23). Only the founder uploads, reads and deletes them, and deletes them within 30 days after the benchmark. The development machine's Wrangler sign-in reaches every bucket in that account (access rules, below), so for this bucket keeping the co-founder away from real voices rests on policy, not on the account (data map, gap 19). Decide before the first clip is uploaded whether that stands or the bucket moves to the "Vela" account.

### Worker configuration names

The secrets are listed, without values, in `apps/worker/.dev.vars.example`, which says which Worker reads each; the variables are set per environment in `apps/worker/wrangler.jsonc` (pilot) and `apps/worker/wrangler.admin.jsonc` (admin). Those three files are the source of truth, and this table follows them.

| Name | Kind | Worker | Set by | Notes |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | `vela` | Founder | Per environment, from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | `vela` | Founder | Telegram and the adapter accept 1 to 256 characters of A–Z, a–z, 0–9, `_` and `-`; generate 32 or more random letters and digits in the password manager |
| `ANTHROPIC_API_KEY` | Secret | `vela` and `vela-admin` | Founder | Per workspace, the same key in both Workers of an environment. The admin Worker translates a sent weekly read for her, and refuses every admin page without the key |
| `DEEPGRAM_API_KEY` | Secret | `vela` | Founder | Per environment |
| `HEALTHCHECKS_PING_URL` | Secret | `vela` | Founder | Anyone holding it can fake the heartbeat |
| `ADMIN_CONVERSATION_ID` | Secret | `vela` | Founder | Your personal chat id with that environment's bot (section 7, step 5). A secret of the pilot Worker, never a value in `wrangler.jsonc` (ADR-26). Outside development the pilot Worker refuses to start without it (`ConfigError:ADMIN_CONVERSATION_ID`), because you would otherwise never hear of a flag, a weekly read to check, or an answer nobody could read. Left empty in `.dev.vars`, a laptop sends no admin messages. The admin Worker does not read it |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Secret | `vela-admin` | Founder | From the Cloudflare Access application that protects the `vela-admin` Worker in that environment's account (section 12): the team domain, `<team name>.cloudflareaccess.com` with no scheme or path, and the application's audience (AUD) tag. The admin Worker checks both in every admin request's Access token |
| `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | Secret | `vela` | Founder | Sprint 2 |
| `ENVIRONMENT` | Variable | Both | Co-founder | `development`, `staging`, `production` |
| `TELEGRAM_BOT_USERNAME` | Variable | `vela` | Co-founder | From the founder, per environment: that environment's bot username, without `@` (section 7) |
| `PUBLIC_BASE_URL` | Variable | Both | Co-founder | The admin Worker's origin in that environment: `https://vela-admin.vela-light.workers.dev` (production), `https://vela-admin.vela-light-staging.workers.dev` (staging), `http://localhost:8787` locally. In the pilot Worker it is `Config.publicBaseUrl`: links in admin messages point to `<PUBLIC_BASE_URL>/admin/families/<family id>`. In the admin Worker it is the one origin a POST to `/admin` may come from. Telegram's webhook is not built from it (section 7, step 6) |
| `PRIVACY_NOTICE_URL_EN`, `PRIVACY_NOTICE_URL_ZH_TW` | Variable | `vela` | Co-founder | The pilot Worker's origin plus `/privacy` and `/privacy/zh-TW`, pages the pilot Worker serves itself from the pilot pack's Markdown: `https://vela.vela-light.workers.dev/privacy` and `https://vela.vela-light.workers.dev/privacy/zh-TW` in production, the same paths on `https://vela.vela-light-staging.workers.dev` in staging (`Config.privacyNoticeUrls`; other languages take the English URL). Vela's first message in a family group links the one in the family's language (`group.linked`, flows §3.3) |
| `REGIONS` | Variable | `vela` | Co-founder | The regions whose database exists, comma separated: `apac` in the pilot |
| `SENTRY_DSN` | Variable | Neither yet | Co-founder | Not read by either Worker yet, and not in either wrangler file. A DSN only allows sending events, not reading them |
| Hyperdrive id, bucket and queue names | Binding | — | Co-founder | Identifiers, not secrets. The Hyperdrive id and the outbound queue appear in both wrangler files, and `apps/worker/src/wrangler-config.test.ts` holds them equal |

In staging and production, the Hyperdrive ids (in both wrangler files) and the bot usernames are `PLACEHOLDER_` values until the founder creates them (section 11); nobody fills one with a guess. The hosts and notice URLs are already filled in, from the workers.dev subdomains (section 1, step 10). Outside development the pilot Worker refuses to run while any variable or secret still contains `PLACEHOLDER_`, a URL variable is not https, a secret is missing (`ADMIN_CONVERSATION_ID` included), or either privacy notice still holds a bracketed blank such as `[FOUNDER FULL NAME]`: every webhook update with something to handle, queue job, cron run, and alarm fails before it opens a database connection, and the log names the variable or the notice file (`ConfigError:PUBLIC_BASE_URL`, `ConfigError:privacy-notice.en.md`), never its value. The notice pages check only the notices: an unfilled notice also makes both pages fail, and once both are filled the pages answer even while a placeholder, a URL that is not https, or a missing secret stops everything else. The admin Worker refuses the same way for a placeholder, a `PUBLIC_BASE_URL` that is not https, or a missing secret. `/healthz` builds nothing and still answers, so neither it nor the notice pages prove the configuration. The admin page and its write actions need a valid Cloudflare Access token and, for a POST, a request from the admin Worker's own origin (`architecture/decisions.md`, ADR-22 and ADR-26), so there is no admin token.

GitHub Actions (set by the founder): **no repository secrets.** A repository secret is readable by a workflow on any pushed branch, which would get around the production approval, so every value the deploy workflow reads is an **environment** secret (**Settings → Environments →** the environment **→ Environment secrets**):

| Environment | Deployment rule | Environment secrets |
|---|---|---|
| `staging` | Branch `main` only | `CLOUDFLARE_API_TOKEN` (the "Vela staging" account's token), `CLOUDFLARE_ACCOUNT_ID` (the "Vela staging" account id), `DATABASE_URL` (the Neon `staging` branch) |
| `production` | Tags `v*` only; the founder as required reviewer | `CLOUDFLARE_API_TOKEN` (the "Vela" account's token), `CLOUDFLARE_ACCOUNT_ID` (the "Vela" account id), `DATABASE_URL` (the Neon `main` branch) |

`.github/workflows/deploy.yml` reads exactly these three as `secrets.CLOUDFLARE_API_TOKEN`, `secrets.CLOUDFLARE_ACCOUNT_ID` and `secrets.DATABASE_URL`, so each environment holds its own under the same names (`architecture/decisions.md`, ADR-23) and the deploy job reads whichever environment it runs in. An account id is an identifier, not a credential; it is an environment secret only because the workflow reads it from there, and an environment variable of that name would not reach the job. The deploy job runs the lint, typecheck and tests, then the migrations with `DATABASE_URL` (once), then deploys the pilot Worker (`wrangler deploy --env <environment>`), then the admin Worker (`wrangler deploy -c wrangler.admin.jsonc --env <environment>`), which binds the `MemberScheduler` class the pilot Worker exports. The same token deploys both, since both Workers live in the environment's one account. Until an environment holds its secrets, the founder runs that environment's migrations by hand ([`runbooks/release.md`](runbooks/release.md), build plan 0.3).

There is no `NEON_API_KEY`: CI tests run on PGlite. If CI later creates a Neon branch per pull request (architecture §16), it does so in a separate Neon project used only by CI, with an API key limited to that project, and never branches from `main`, which holds real families. Later: `EXPO_TOKEN` (sprint 3), `SENTRY_AUTH_TOKEN`, each in the environment that uses it.

## Access rules

- The founder is the owner of every account, with multi-factor authentication on each. No shared passwords.
- The co-founder is an AI coding agent working on the founder's development machine. It works in dev and staging with synthetic data, may deploy staging, and never reads production message content, production secrets or production database connection strings. It may see content-free production signals: events, `metrics_daily` counts, Sentry errors, deployment status.
- **These rules are enforced by accounts, not only by policy, wherever Cloudflare allows it.** A Wrangler sign-in or a Workers API token covers every Worker, bucket and secret in a Cloudflare account; it cannot be limited to one Worker. So staging lives in its own Cloudflare account, and the development machine is signed in to that account only (section 1). Apart from the founder's own dashboard sign-in, a production-capable Cloudflare credential exists only in the GitHub `production` environment. The benchmark bucket `vela-benchmark` is the one place this rests on policy instead (Environments, above).
- Production changes go through CI on a tag the founder approves ([`runbooks/release.md`](runbooks/release.md)). Nobody runs `wrangler deploy --env production` from a laptop, with either wrangler file.
- The co-founder uses the founder's GitHub session on the development machine. Environment rules stop a workflow on any branch from reading production secrets, but the session itself could approve a production deployment, so that last gate still rests on policy: only the founder approves, in the GitHub web interface, after reading the release notes.
- Only the founder's own sign-in passes Cloudflare Access to the production admin Worker (ADR-22, ADR-26, section 12). Every admin page view and every admin action writes `admin_access_log`; a change made in the Neon console is logged by hand ([`runbooks/data-requests.md`](runbooks/data-requests.md)).
- Cloudflare Access protects `vela-admin` and nothing else. Never turn on **Protect all Workers** on the Workers & Pages page: account-level Access would also cover `vela`, and Telegram's webhook and the families' privacy notice pages would stop answering.

## The founder's account checklist (sprint 0, task 0.2)

Do these in order; each takes 5 to 15 minutes. Start with a password manager (Bitwarden's free plan is enough) and an authenticator app; store every recovery code in the password manager. A Worker secret can be added only once that Worker exists (section 11): until then, each value a step below sends to a Worker secret waits in the password manager.

**Done when:** both Workers deploy to staging; `https://vela.vela-light-staging.workers.dev/healthz` returns 200 and the two notice pages open; `https://vela-admin.vela-light-staging.workers.dev/admin` opens through Cloudflare Access (which proves the admin Worker's configuration, its secrets and the database, since `/healthz` builds nothing); the staging bot's webhook shows no error; and the staging Healthchecks check is up (which proves the pilot Worker's, because `reconcile` pings only after its deps are built and its run has finished) (build plan 0.2). Sections 11 and 12 bring these together.

### 1. Cloudflare

Two separate Cloudflare users, each owning one account: **"Vela"** for production and **"Vela staging"** for dev and staging. A Wrangler sign-in reaches every account its user belongs to, and Workers permissions cannot be limited to one Worker, so a single account would let the development machine read production voice notes, tail production logs, or deploy production.

1. **Production.** Sign up at `dash.cloudflare.com` with your main email address, verify it, then **My Profile → Authentication → Two-factor authentication**: add a security key or an authenticator app. Name the account "Vela".
2. **Workers & Pages**: subscribe to Workers Paid ($5 a month, as budgeted in architecture §18).
3. **R2**: enable it (it asks for a payment method; the pilot stays inside the free allowance).
4. Read and accept the Cloudflare Data Processing Addendum (link in `sub-processors.md`).
5. **Production resources**, created by you in this account's dashboard (the co-founder never signs in to it, and no Wrangler sign-in to it may exist on the development machine), with exactly the names in `apps/worker/wrangler.jsonc`, before the first production deploy, which fails while any is missing: on the **R2 object storage** page, **Create bucket** `vela-media-production`, choosing Asia-Pacific under **Location**; **Queues → Create** `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, and the dead-letter queue `vela-dead-letter-production` (one for all three). The admin Worker needs nothing of its own: it binds these. The staging ones are created with Wrangler (section 11).
6. **Production CI token:** **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**, account resources limited to "Vela", create it, and paste it straight into the GitHub `production` environment as `CLOUDFLARE_API_TOKEN`.
7. **Staging.** Sign up again with a second email address (an alias such as `yourname+staging@…` works), add two-factor authentication, and name the account "Vela staging". Accept the DPA. If `wrangler deploy --env staging` later reports that a binding needs Workers Paid, subscribe this account too (another $5 a month).
8. **Sign the development machine in to staging only.** In a private browser window, sign in to the staging user. On the development machine run `pnpm --filter @vela/worker exec wrangler login` yourself and approve it in that private window, then run `pnpm --filter @vela/worker exec wrangler whoami` and check that it lists only "Vela staging". This lets the co-founder create staging buckets and queues and deploy staging; it cannot reach the production account. Never approve a Wrangler sign-in on this machine while signed in as the production user.
9. **Staging CI token:** as step 6, signed in as the staging user, limited to "Vela staging", pasted into the GitHub `staging` environment as `CLOUDFLARE_API_TOKEN`.
10. **The workers.dev subdomains, which make the Workers' hosts.** Vela buys no domain and creates no zone, DNS record or route (ADR-26). Every Worker answers on `https://<Worker name>.<account subdomain>.workers.dev`, and Cloudflare's documentation says how to set the subdomain: "In the Cloudflare dashboard, go to the **Workers & Pages** page. Select **Change** next to **Your subdomain**." If Cloudflare asks for a subdomain the first time you open Workers & Pages, enter it there instead.
    1. In the "Vela" account, set the subdomain to `vela-light`.
    2. In the "Vela staging" account, set it to `vela-light-staging`.
    3. If a name is taken, use `velalight` (production) or `velalight-staging` (staging), and tell the co-founder. The header of `apps/worker/wrangler.jsonc` is the one list of what then changes: `WORKERS_DEV_SUBDOMAINS` in `apps/worker/src/wrangler-config.test.ts`, the hosts in both wrangler files, and the privacy notice links in `plan/materials/pilot` (the nearby-contact consent texts and the pilot README), which that test fails on until they agree; then, with no test to catch them, the bots' privacy policy links and the `WORKER_URL` in section 7, steps 3 and 6, and every document `git grep vela-light` lists.
    4. The hosts that follow are already in the wrangler files: production pilot `https://vela.vela-light.workers.dev`, admin `https://vela-admin.vela-light.workers.dev`; staging pilot `https://vela.vela-light-staging.workers.dev`, admin `https://vela-admin.vela-light-staging.workers.dev`. Deploying creates each Worker's address; there is nothing to create for it yourself.
    5. Set the subdomain before the first deploy and never change it afterwards: the privacy notice link in every family group's first message, the bot's privacy policy link and Telegram's webhook are all built on it.
11. **Hand over:** both account ids (Workers & Pages overview, right-hand column), saying which is which, and the workers.dev subdomain each account shows.

### 2. Neon

1. Sign up at `console.neon.tech` (with Google or GitHub, which must have multi-factor authentication on).
2. **New project:** name `vela-apac`, **Postgres 18** (the schema uses Postgres 18's native `uuidv7()`), provider AWS, region **Asia Pacific (Singapore)**, database name `vela`.
3. **Branches:** `main` is production. Create a branch `staging` from `main` now, while `main` is still empty. A branch copies its parent's data and its roles with their passwords, so on the `staging` branch open **Roles** and reset the role's password: staging's connection string then cannot open `main`. Never create, reset or restore `staging` from `main` once a family exists, because it would copy their data.
4. **Settings → Instant restore:** note the restore window. The Free plan allows at most 6 hours; before the first family beyond your own, decide whether to move to the Launch plan and set 7 days (see `runbooks/restore-drill.md`).
5. Accept the Neon DPA (link in `sub-processors.md`).
6. Connection strings: from **Connect**, copy the **direct** (not pooled) connection string of each branch and paste it only into (a) a Cloudflare Hyperdrive configuration (step 7), (b) the GitHub environment secret `DATABASE_URL` of the matching environment (the `staging` branch's string in environment `staging`, the `main` branch's in environment `production`), and (c) a hidden prompt in your own terminal when a runbook asks for it.
7. In Cloudflare, **Storage & Databases → Hyperdrive → Create configuration**: in the "Vela staging" account, `vela-apac-staging` with the staging string; in the "Vela" account, `vela-apac` with the main string. Turn caching off in each configuration's settings (or ask the co-founder to run `wrangler hyperdrive update <id> --caching-disabled` for the staging one, which needs no secret). One configuration per account serves both Workers.
8. No Neon API key in sprint 0 (see GitHub Actions above): an account key could read the `main` branch's connection string.
9. **Hand over:** the Neon project id, region, branch names, database and role names (never passwords), and both Hyperdrive configuration ids, which the co-founder puts into both `apps/worker/wrangler.jsonc` and `apps/worker/wrangler.admin.jsonc` in place of `PLACEHOLDER_HYPERDRIVE_ID_STAGING` and `PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION` (section 11).

### 3. Anthropic

1. Sign up at `platform.claude.com` (the console formerly at console.anthropic.com), create the organisation "Vela".
2. **Billing:** add a small prepaid credit, switch off auto-reload, and set an organisation spend limit.
3. **Workspaces:** create `vela-dev`, `vela-staging`, `vela-production`, each with a monthly spend limit (for example $10, $10 and $50; your call).
4. In each workspace create one API key named after it. Paste the staging and production keys straight into the secret `ANTHROPIC_API_KEY` of both Workers of the matching environment, `vela` and `vela-admin`. Put the dev key into `apps/worker/.dev.vars` yourself.
5. The Data Processing Addendum is part of Anthropic's Commercial Terms; nothing to sign.
6. **Hand over:** the workspace names.

### 4. Deepgram

1. Sign up at `console.deepgram.com`, create a project `vela`.
2. **API Keys:** create `vela-dev`, `vela-staging`, `vela-production` with the Member role. Paste staging and production into the pilot Worker's secret `DEEPGRAM_API_KEY`; the dev key into `.dev.vars`.
3. Ask Deepgram for its DPA (its privacy policy points to security@deepgram.com). Every request sets `mip_opt_out=true`, which the co-founder implements.
4. **Hand over:** the project id.

### 5. Sentry

Not connected to the Workers yet (`SENTRY_DSN` is not read); the account exists so the EU data location is fixed from the start.

1. Sign up at `sentry.io`. When creating the organisation, choose the **European Union** data storage location; it cannot be changed later.
2. Create the organisation `vela` and a project `vela-worker` for Cloudflare Workers.
3. **Settings → Security & Privacy:** turn on the data scrubber and default scrubbers, and turn on "prevent storing of IP addresses". **Settings → General:** require two-factor authentication.
4. **Alerts:** an issue alert that emails you on new issues in `production`.
5. **Hand over:** organisation slug, project slug and the DSN.

### 6. Healthchecks.io

1. Sign up at `healthchecks.io`, create the project "Vela".
2. Add check `vela-production-reconcile`: period 5 minutes, grace 5 minutes, so a silence over 10 minutes alerts (architecture §15). Add check `vela-staging-reconcile` the same way.
3. **Integrations:** keep email; add Telegram for the production check so the page reaches your phone.
4. Copy each check's ping URL straight into the matching pilot Worker's secret `HEALTHCHECKS_PING_URL`.
5. **Hand over:** the two check names.

### 7. Telegram bots

1. In Telegram, open **@BotFather** (confirm the verified badge). Send `/newbot`, display name **Vela Light**, a username ending in `bot`. BotFather shows the token: paste it straight into the production pilot Worker's secret `TELEGRAM_BOT_TOKEN`.
2. Repeat for a staging bot ("Vela Light staging") and a dev bot. The staging token goes into the staging pilot Worker's secret; the dev token into `.dev.vars`.
3. For each bot in BotFather: leave **group privacy on** (BotFather's default). Families ask by replying to Vela's evening message or with `/ask` and `/later`, which privacy mode delivers, so the family's ordinary conversation never reaches Vela unless an organiser makes the bot an administrator (flows §1). Allow joining groups, set the description and about text, and set the picture. Set up the bot's **privacy policy** in @BotFather as a link to the pilot Worker's English notice page: `https://vela.vela-light.workers.dev/privacy` for the production bot, `https://vela.vela-light-staging.workers.dev/privacy` for the staging and dev bots. Telegram's bot developer terms say that when its Standard Bot Privacy Policy does not properly describe how a bot uses personal data, the bot "must set up a Privacy Policy in @BotFather" (telegram.org/tos/bot-developers), and Vela's handling is described only in its own notice. The page answers once both notices are filled in and deployed (section 11, step 4); until then it answers 500.
4. For each environment, generate a webhook secret in the password manager: **32 to 256 characters, letters and digits only** (turn symbols off in the generator). Telegram and the adapter accept 1 to 256 characters of A–Z, a–z, 0–9, `_` and `-`, and refuse anything else. Paste it into the pilot Worker's `TELEGRAM_WEBHOOK_SECRET`.
5. **Your chat id, before any webhook exists.** Telegram refuses `getUpdates` while a bot has a webhook, so do this first, for each bot. From your own Telegram account, open the bot and tap **Start**. Then, in your own terminal (Git Bash), paste the token at the hidden prompt:

   ```bash
   read -rsp "Bot token: " TOKEN; echo
   curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | grep -o '"chat":{"id":[0-9-]*'
   curl -s "https://api.telegram.org/bot$TOKEN/deleteWebhook?drop_pending_updates=true"
   unset TOKEN
   ```

   The number after `"id":` is your chat id. Keep the staging and production bots' chat ids in the password manager until that environment's pilot Worker exists, then paste each straight into that Worker's secret `ADMIN_CONVERSATION_ID` (section 11, step 7). It is a secret of `vela`, never a value in `wrangler.jsonc`, and nobody hands it over (ADR-26). Development leaves it empty in `.dev.vars` and sends no admin messages. The last call discards your `/start`, which would otherwise reach the Worker once the webhook exists and begin an organiser setup (this call is the only place pending updates are dropped: the setup script in step 6 keeps them).
6. **Webhook and command menu, once that environment's pilot Worker is deployed** (section 11). In your own terminal (Git Bash), at the repository's root, paste the token and the webhook secret at the hidden prompts, and give the environment's **pilot** origin as `WORKER_URL` (`https://vela.vela-light-staging.workers.dev` for the staging bot, `https://vela.vela-light.workers.dev` for the production bot), never the admin origin, which Cloudflare Access closes to Telegram:

   ```bash
   read -rsp "Bot token: " TELEGRAM_BOT_TOKEN; echo; export TELEGRAM_BOT_TOKEN
   read -rsp "Webhook secret: " TELEGRAM_WEBHOOK_SECRET; echo; export TELEGRAM_WEBHOOK_SECRET
   WORKER_URL="https://vela.vela-light-staging.workers.dev" pnpm --filter @vela/worker telegram:setup
   unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
   ```

   `apps/worker/scripts/telegram-setup.ts` refuses a `WORKER_URL` that is not https and a secret outside Telegram's alphabet, registers the origin plus `/webhooks/telegram` (any path pasted with it is replaced) with the secret and the updates the adapter parses (`TELEGRAM_ALLOWED_UPDATES`, imported from `@vela/adapters`: `message`, `callback_query`, `message_reaction`, `my_chat_member`), sets `/ask` and `/later` as the command menu in groups and no menu in private chats, and prints the webhook URL, whether pending updates were kept, the updates, the commands, the bot's username, and whether group privacy is on. It never prints the token or the secret. **Pending updates are kept** unless you add `--drop-pending-updates` after `telegram:setup`; never add it once a family uses the bot, because the updates Telegram is still holding are real answers and asks. Any other argument is refused before Telegram is called, so a mistyped flag changes nothing. If it says group privacy is off, turn it back on in BotFather (step 3). No `chat_member` update is needed, which would also need the bot to be an administrator: when someone leaves the family group, Telegram's `left_chat_member` service message arrives inside `message`, even in privacy mode (flows §3.16). Then check that Telegram reaches the Worker:

   ```bash
   read -rsp "Bot token: " TOKEN; echo
   curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
   unset TOKEN
   ```

   It shows the pilot origin plus `/webhooks/telegram` and no `last_error_message`.
7. **Hand over:** the three bot usernames, saying which environment each is for (`TELEGRAM_BOT_USERNAME`, without `@`). Not the chat ids: they are secrets you set yourself (step 5).

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

### 11. The first deploy of each environment

Staging first; production follows through [`runbooks/release.md`](runbooks/release.md). The pilot Worker refuses to run in an environment while a wrangler file still holds a `PLACEHOLDER_` value for it or either privacy notice still holds a bracketed blank, and the admin Worker while its file holds a placeholder, so steps 1 to 5 come before anything can reach a family.

1. **Queues, dead-letter queue and bucket**, with exactly the names in `apps/worker/wrangler.jsonc`, before the first deploy: `wrangler deploy` fails while a queue or bucket it binds does not exist. The admin Worker binds the same outbound queue and needs nothing more.
   - **Staging:** the co-founder runs these on the development machine, signed in to "Vela staging" only (section 1, step 8):

     ```bash
     pnpm --filter @vela/worker exec wrangler queues create vela-outbound-staging
     pnpm --filter @vela/worker exec wrangler queues create vela-media-staging
     pnpm --filter @vela/worker exec wrangler queues create vela-understand-staging
     pnpm --filter @vela/worker exec wrangler queues create vela-dead-letter-staging
     pnpm --filter @vela/worker exec wrangler r2 bucket create vela-media-staging
     ```

   - **Production:** `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, `vela-dead-letter-production`, and the bucket `vela-media-production`, created by you in the "Vela" account's dashboard (section 1, step 5), because Wrangler is never signed in to production on the development machine.
2. **Hyperdrive ids.** The co-founder replaces `PLACEHOLDER_HYPERDRIVE_ID_STAGING` and `PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION` with the ids of `vela-apac-staging` and `vela-apac` (section 2, step 9), in both `wrangler.jsonc` and `wrangler.admin.jsonc`; `src/wrangler-config.test.ts` fails while the two files differ or an id is neither its placeholder nor a 32-character lowercase hex id. `PLACEHOLDER_HYPERDRIVE_ID_DEV` stays: `wrangler dev` uses the local connection string.
3. **Bot usernames.** The co-founder replaces `PLACEHOLDER_STAGING_BOT_USERNAME` and `PLACEHOLDER_PRODUCTION_BOT_USERNAME` (`TELEGRAM_BOT_USERNAME`) with what you handed over in section 7. The chat id is not in any file: it is a secret (step 7).
4. **Privacy notices.** Both notices are filled in before the staging deploy, because the pilot Worker serves them and refuses to start while either holds a bracketed blank (`plan/materials/pilot/README.md`, "Before first use"). You fill in, in `plan/materials/pilot/privacy-notice.en.md` and `privacy-notice.zh-TW.md`, every bracketed placeholder: `[FOUNDER FULL NAME]` (`[創辦人全名]`), `[CONTACT ADDRESS]` (`[聯絡信箱]`, including the one in each notice's opening lines), `[NOTES TOOL]` (`[筆記工具]`) and `[NOTES TOOL LOCATION]` (`[筆記工具所在地]`). `[Name]` and `[名字]` stay: they quote the pause message. The co-founder then runs `pnpm --filter @vela/worker notices` and commits the regenerated `apps/worker/src/notices.generated.ts` with the notices; `src/notices.test.ts` fails in CI while the module is stale. The hosts and notice URLs need nothing: they are in the wrangler files already (section 1, step 10).
5. **GitHub.** The environment holds its three secrets (section 10).
6. **Deploy.** Merge that commit to `main`: the deploy job migrates the Neon `staging` branch, deploys `vela`, then deploys `vela-admin`. Production deploys from a tag, after your approval ([`runbooks/release.md`](runbooks/release.md)).
7. **Worker secrets**, once the Workers exist. For each value: **Workers & Pages →** the Worker **→ Settings → Variables and Secrets → Add**, type **Secret**, the variable name, the value pasted straight from its source or the password manager, then **Deploy**. For staging you may instead run `pnpm --filter @vela/worker exec wrangler secret put <NAME> --env staging` in your own terminal and paste at the prompt, adding `-c wrangler.admin.jsonc` for the admin Worker.
   - **`vela`:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` (section 7), `ANTHROPIC_API_KEY` (section 3), `DEEPGRAM_API_KEY` (section 4), `HEALTHCHECKS_PING_URL` (section 6), and `ADMIN_CONVERSATION_ID` (section 7, step 5).
   - **`vela-admin`:** `ANTHROPIC_API_KEY` (section 3), and `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (section 12).

   Until all of `vela`'s are in, each cron run fails and logs `cron_failed` with `ConfigError:<variable>` naming a missing one; that is expected.
8. **Access:** section 12, for `vela-admin`.
9. **Webhook:** section 7, step 6, with this environment's bot and pilot origin.
10. **Check:** `https://vela.<subdomain>.workers.dev/healthz` answers `ok`; `https://vela.<subdomain>.workers.dev/privacy` and `/privacy/zh-TW` open on a phone with no sign-in; `https://vela.<subdomain>.workers.dev/admin` answers `not found`; `https://vela-admin.<subdomain>.workers.dev/admin` opens the overview through Cloudflare Access; both Workers' logs in the dashboard show no `ConfigError`; the Healthchecks check is up.

### 12. Cloudflare Access for the admin Worker

In each Cloudflare account, "Vela staging" first, once `vela-admin` has been deployed there (section 11, step 6). Access protects the whole `vela-admin` Worker: Cloudflare's Workers documentation (developers.cloudflare.com/workers/configuration/cloudflare-access, "Protect one Worker", last updated 18 August 2026) says protecting one Worker "automatically protects every domain associated with the Worker, including its routes, Custom Domains, `workers.dev` hostname, and previews". The pilot Worker `vela` stays public, because Telegram's webhook and the notice pages must answer without a sign-in, so never protect it and never use **Protect all Workers** (access rules). Only your own sign-in may pass (ADR-22, ADR-26); the admin Worker checks the Access token again on every `/admin` request, so a mistake here cannot open the page, and a request without a valid token gets 401.

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
5. **The admin Worker's secrets.** In `vela-admin` (**Workers & Pages →** `vela-admin` **→ Settings → Variables and Secrets → Add**, type **Secret**, then **Deploy**): `ACCESS_TEAM_DOMAIN` = `<team name>.cloudflareaccess.com`, with no `https://` and no path, and `ACCESS_AUD` = the tag. They do not go on `vela`.
6. **Check,** in a private browser window: `https://vela-admin.<subdomain>.workers.dev/` asks for the Access sign-in before anything else, which shows Access covers the whole Worker; after you sign in it opens the overview at `/admin`. A "Not signed in" page after signing in means the Worker did not accept the token: check both secrets. `https://vela.<subdomain>.workers.dev/healthz` and `/privacy` answer with no sign-in.
7. **Hand over:** the team domain, for the resource register.

### Later, not in sprint 0

| Account or resource | When | Why |
|---|---|---|
| R2 bucket `vela-benchmark`, in the "Vela staging" account | Sprint 2, before the first clip | The consented voice clips for the STT benchmark (build plan 2.5; data map, row 23). Created by you on the **R2 object storage** page (**Create bucket**); R2 buckets are not public by default, and it stays private. Decide first where it belongs (Environments, above) |
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
| R2 bucket `vela-benchmark` ("Vela staging", sprint 2) | |
| Telegram bots (dev · staging · production) | |
| LINE accounts (test · production) | |
| Sentry organisation and project | |
| Healthchecks checks | |
| Anthropic workspaces | |
| Deepgram project id | |
