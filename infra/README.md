# Infrastructure

16 September 2026 · build plan sprint 0 (tasks 0.2, 0.3, 0.4) · architecture §12–17 · owner: the founder owns every account; the co-founder builds on them

What runs where, how the founder creates each account, and how credentials reach the Worker without ever passing through a chat or the repository. The Worker's own configuration lives in `apps/worker/wrangler.jsonc` (code design §9); this folder records the resources, the providers and the runbooks.

| Document | Use it when |
|---|---|
| [`sub-processors.md`](sub-processors.md) | Adding a provider, answering "who processes our data", updating the privacy notice |
| [`runbooks/incident.md`](runbooks/incident.md) | Something is wrong for families, or a secret or personal data may be exposed |
| [`runbooks/data-requests.md`](runbooks/data-requests.md) | The founder changes family records by hand until the admin page's actions ship (build plan 1.12), and afterwards for what they do not cover: consent rows, nearby contacts, away, a death, someone leaving, copies, corrections, deletions, the end of a family's pilot |
| [`runbooks/release.md`](runbooks/release.md) | Deploying the Worker or running a migration |
| [`runbooks/restore-drill.md`](runbooks/restore-drill.md) | Quarterly, and whenever production data must be restored |
| [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) | A credential may be exposed, someone leaves, or every six months |
| [`runbooks/silence-drill.md`](runbooks/silence-drill.md) | Proving our failures never produce a quiet notice |
| [`runbooks/ota-policy.md`](runbooks/ota-policy.md) | Shipping a JavaScript-only fix to the mobile app (from sprint 3) |

## Rule zero: secrets

A secret is anything that grants access: API keys, bot tokens, database connection strings with passwords, webhook secrets, the Healthchecks ping URL, CI tokens.

- **Never paste a secret into a chat** (including the conversation with the co-founder), Telegram, LINE, email, an issue, a screenshot, a markdown file or any file in the repository.
- **The founder copies each secret from the provider's page straight into its destination**: the Cloudflare dashboard (Worker secrets, Hyperdrive), GitHub (environment secrets), or a hidden prompt in the founder's own terminal. A password manager is the only other place it may live.
- **The co-founder receives only identifiers**: account ids, project ids, resource names, bot usernames, chat ids, domains and hosts. Each account section below lists exactly what to hand over. The one credential on the development machine beyond development keys is the staging Cloudflare account's session (section 1), which reaches only staging and its synthetic data.
- Development keys are separate, low-limit keys that may sit in `apps/worker/.dev.vars` (ignored by git). Production keys, and any sign-in to the production Cloudflare account, never touch the development machine.
- If a secret is pasted anywhere by mistake, treat it as exposed and follow [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) now.

## Environments

| | dev | staging | production |
|---|---|---|---|
| Purpose | Build and test on one machine | Prove a change end to end before families see it | The pilot families |
| Data allowed | Synthetic only | Synthetic, plus the founder's own test accounts | Real families |
| Cloudflare account | None (local) | "Vela staging" account | "Vela" account |
| Worker | `vela-dev`, run by `wrangler dev` (local) | `vela-staging`, on a custom domain in the "Vela staging" account | `vela-production`, on a custom domain in the "Vela" account |
| Database | PGlite in `.pglite/`, served by `pnpm --filter @vela/db dev-db` on port 54320 | Neon project `vela-apac`, branch `staging` | Neon project `vela-apac`, branch `main` |
| Hyperdrive | Local connection string | `vela-apac-staging` (query caching off) | `vela-apac` (query caching off) |
| Media | Wrangler's local R2 | R2 bucket `vela-media-staging` | R2 bucket `vela-media-production`, location hint Asia-Pacific |
| Queues | Local | `vela-outbound-staging`, `vela-media-staging`, `vela-understand-staging`, and one dead-letter queue, `vela-dead-letter-staging` | `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, and one dead-letter queue, `vela-dead-letter-production` |
| Scheduler | `MemberScheduler` Durable Object, local | `MemberScheduler` | `MemberScheduler` |
| Cron | Triggered by hand | Every 5 minutes (reconcile); nightly (metrics, retention) | Same |
| Telegram | Dev test bot | Staging test bot | "Vela Light" bot |
| LINE (sprint 2) | Test Official Account | Test Official Account | "Vela Light" Official Account, paid plan |
| Anthropic | Workspace `vela-dev`, low spend limit | Workspace `vela-staging` | Workspace `vela-production` |
| Deepgram | Key `vela-dev` | Key `vela-staging` | Key `vela-production` |
| Sentry | Off | Project `vela-worker`, environment `staging` | Project `vela-worker`, environment `production` |
| Healthchecks.io | None | Check `vela-staging-reconcile` (email) | Check `vela-production-reconcile` (pages the founder) |
| Who deploys | Co-founder | CI on merge to `main` (`.github/workflows/deploy.yml`); co-founder by hand until the `staging` environment holds its secrets | CI on a tag, after the founder's approval |
| Who migrates | Co-founder (PGlite) | CI on merge to `main`, in the deploy job before `wrangler deploy`; the founder by hand until the `staging` environment holds its secrets ([`runbooks/release.md`](runbooks/release.md)) | CI on a tag, in the deploy job before `wrangler deploy`, after the founder's approval |

Only the `apac` region exists in the pilot, so **every pilot family is `apac`**, whatever its country: `families.region` must be `apac` for every family created before the region router exists (build plan 2.2). A family labelled `us` or `eu` would be looked up in an empty database once the router ships, and its arrivals and quiet notices would stop. Onboarding follows this rule (`architecture/decisions.md`, ADR-7 updated 14 September 2026): `Config.regions` lists the regions that exist, only `apac` in the pilot, and the country's preferred region falls back to `apac` when it does not exist (flows §3.1). The founder confirms the region after the first setups ([`runbooks/data-requests.md`](runbooks/data-requests.md), section A). Neon projects for `eu` and `us` are created in sprint 2 and stay idle (build plan 2.2); before either holds a family, the privacy notice needs a new version, because it says the database is in Singapore. Query caching is off on every Hyperdrive configuration because Hyperdrive caches reads for 60 seconds by default, and the scheduler must read fresh rows.

### Worker configuration names

The secrets are listed, without values, in `apps/worker/.dev.vars.example`; the variables are set per environment in `apps/worker/wrangler.jsonc`. Those two files are the source of truth, and this table follows them.

| Name | Kind | Set by | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | Founder | Per environment, from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | Founder | Telegram and the adapter accept 1 to 256 characters of A–Z, a–z, 0–9, `_` and `-`; generate 32 or more random letters and digits in the password manager |
| `ANTHROPIC_API_KEY` | Secret | Founder | Per workspace |
| `DEEPGRAM_API_KEY` | Secret | Founder | Per environment |
| `HEALTHCHECKS_PING_URL` | Secret | Founder | Anyone holding it can fake the heartbeat |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Secret | Founder | From the Cloudflare Access application for `/admin` in that environment's account (section 12): the team domain, `<team name>.cloudflareaccess.com` with no scheme or path, and the application's audience tag. The Worker checks both in every admin request's Access token and reads them as secrets |
| `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | Secret | Founder | Sprint 2 |
| `ENVIRONMENT` | Variable | Co-founder | `development`, `staging`, `production` |
| `TELEGRAM_BOT_USERNAME` | Variable | Co-founder | From the founder, per environment: that environment's bot username, without `@` (section 7) |
| `ADMIN_CONVERSATION_ID` | Variable | Co-founder | From the founder, per environment: the founder's chat id with that environment's bot (section 7, step 5). Not a credential: nobody can message the chat without the bot token. Empty in development, which sends no admin messages |
| `PUBLIC_BASE_URL` | Variable | Co-founder | `https://` and the Worker's host (section 1, step 10), which is also the environment's custom-domain route (`Config.publicBaseUrl`): links in admin messages point to `<PUBLIC_BASE_URL>/admin/families/<family id>`, Telegram's webhook is `<PUBLIC_BASE_URL>/webhooks/telegram`, and a POST to `/admin` must come from this origin |
| `PRIVACY_NOTICE_URL_EN`, `PRIVACY_NOTICE_URL_ZH_TW` | Variable | Co-founder | From the founder: the https URL of the published privacy notice in each language, on a domain Vela owns (`Config.privacyNoticeUrls`; other languages take the English URL). Vela's first message in a family group links the one in the family's language (`group.linked`, flows §3.3) |
| `REGIONS` | Variable | Co-founder | The regions whose database exists, comma separated: `apac` in the pilot |
| `SENTRY_DSN` | Variable | Co-founder | Not read by the Worker yet. A DSN only allows sending events, not reading them |
| Hyperdrive id, bucket and queue names | Binding | Co-founder | Identifiers, not secrets, in `wrangler.jsonc` |

In staging and production, every host, bot username, chat id, notice URL, and Hyperdrive id in `wrangler.jsonc` is a `PLACEHOLDER_` value until the founder chooses it (section 11); nobody fills one with a guess. Outside development the Worker refuses to run while any variable or secret still contains `PLACEHOLDER_`, or while `PUBLIC_BASE_URL` or a notice URL is not https: every webhook update with something to handle, admin page, queue job, cron run, and alarm fails before it opens a database connection, and the log names the variable (`ConfigError:PUBLIC_BASE_URL`), never its value. `/healthz` builds nothing and still answers, so it does not prove the configuration. The admin page and its write actions need a valid Cloudflare Access token and, for a POST, a same-origin request (`architecture/decisions.md`, ADR-22), so there is no admin token.

GitHub Actions (set by the founder): **no repository secrets.** A repository secret is readable by a workflow on any pushed branch, which would get around the production approval, so every value the deploy workflow reads is an **environment** secret (**Settings → Environments →** the environment **→ Environment secrets**):

| Environment | Deployment rule | Environment secrets |
|---|---|---|
| `staging` | Branch `main` only | `CLOUDFLARE_API_TOKEN` (the "Vela staging" account's token), `CLOUDFLARE_ACCOUNT_ID` (the "Vela staging" account id), `DATABASE_URL` (the Neon `staging` branch) |
| `production` | Tags `v*` only; the founder as required reviewer | `CLOUDFLARE_API_TOKEN` (the "Vela" account's token), `CLOUDFLARE_ACCOUNT_ID` (the "Vela" account id), `DATABASE_URL` (the Neon `main` branch) |

`.github/workflows/deploy.yml` reads exactly these three as `secrets.CLOUDFLARE_API_TOKEN`, `secrets.CLOUDFLARE_ACCOUNT_ID` and `secrets.DATABASE_URL`, so each environment holds its own under the same names (`architecture/decisions.md`, ADR-23) and the deploy job reads whichever environment it runs in. An account id is an identifier, not a credential; it is an environment secret only because the workflow reads it from there, and an environment variable of that name would not reach the job. The deploy job runs the lint, typecheck and tests, then the migrations with `DATABASE_URL`, then `wrangler deploy`; until an environment holds its secrets, the founder runs that environment's migrations by hand ([`runbooks/release.md`](runbooks/release.md), build plan 0.3).

There is no `NEON_API_KEY`: CI tests run on PGlite. If CI later creates a Neon branch per pull request (architecture §16), it does so in a separate Neon project used only by CI, with an API key limited to that project, and never branches from `main`, which holds real families. Later: `EXPO_TOKEN` (sprint 3), `SENTRY_AUTH_TOKEN`, each in the environment that uses it.

## Access rules

- The founder is the owner of every account, with multi-factor authentication on each. No shared passwords.
- The co-founder is an AI coding agent working on the founder's development machine. It works in dev and staging with synthetic data, may deploy staging, and never reads production message content, production secrets or production database connection strings. It may see content-free production signals: events, `metrics_daily` counts, Sentry errors, deployment status.
- **These rules are enforced by accounts, not only by policy, wherever Cloudflare allows it.** A Wrangler sign-in or a Workers API token covers every Worker, bucket and secret in a Cloudflare account; it cannot be limited to one Worker. So staging lives in its own Cloudflare account, and the development machine is signed in to that account only (section 1). Apart from the founder's own dashboard sign-in, a production-capable Cloudflare credential exists only in the GitHub `production` environment.
- Production changes go through CI on a tag the founder approves ([`runbooks/release.md`](runbooks/release.md)). Nobody runs `wrangler deploy --env production` from a laptop.
- The co-founder uses the founder's GitHub session on the development machine. Environment rules stop a workflow on any branch from reading production secrets, but the session itself could approve a production deployment, so that last gate still rests on policy: only the founder approves, in the GitHub web interface, after reading the release notes.
- Only the founder's own sign-in passes Cloudflare Access to the production admin page (ADR-22, section 12). Every admin page view and every admin action writes `admin_access_log`; a change made in the Neon console is logged by hand ([`runbooks/data-requests.md`](runbooks/data-requests.md)).

## The founder's account checklist (sprint 0, task 0.2)

Do these in order; each takes 5 to 15 minutes. Start with a password manager (Bitwarden's free plan is enough) and an authenticator app; store every recovery code in the password manager. A Worker secret can be added only once that environment's Worker exists (section 11): until then, each value a step below sends to a Worker secret waits in the password manager.

**Done when:** `wrangler deploy --env staging` succeeds, `GET /healthz` on staging returns 200, `/admin` on staging opens through Cloudflare Access (which proves the configuration, the secrets and the database, since `/healthz` builds nothing), the staging bot's webhook shows no error, and the staging Healthchecks check is up (build plan 0.2). Sections 11 and 12 bring these together.

### 1. Cloudflare

Two separate Cloudflare users, each owning one account: **"Vela"** for production and **"Vela staging"** for dev and staging. A Wrangler sign-in reaches every account its user belongs to, and Workers permissions cannot be limited to one Worker, so a single account would let the development machine read production voice notes, tail production logs, or deploy production.

1. **Production.** Sign up at `dash.cloudflare.com` with your main email address, verify it, then **My Profile → Authentication → Two-factor authentication**: add a security key or an authenticator app. Name the account "Vela".
2. **Workers & Pages**: subscribe to Workers Paid ($5 a month, as budgeted in architecture §18).
3. **R2**: enable it (it asks for a payment method; the pilot stays inside the free allowance).
4. Read and accept the Cloudflare Data Processing Addendum (link in `sub-processors.md`).
5. **Production resources**, created by you in this account's dashboard (the co-founder never signs in to it, and no Wrangler sign-in to it may exist on the development machine), with exactly the names in `apps/worker/wrangler.jsonc`, before the first production deploy, which fails while any is missing: **R2 → Create bucket** `vela-media-production`, location hint Asia-Pacific; **Queues → Create** `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, and the dead-letter queue `vela-dead-letter-production` (one for all three). The staging ones are created with Wrangler (section 11).
6. **Production CI token:** **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**, account resources limited to "Vela", create it, and paste it straight into the GitHub `production` environment as `CLOUDFLARE_API_TOKEN`.
7. **Staging.** Sign up again with a second email address (an alias such as `yourname+staging@…` works), add two-factor authentication, and name the account "Vela staging". Accept the DPA. If `wrangler deploy --env staging` later reports that a binding needs Workers Paid, subscribe this account too (another $5 a month).
8. **Sign the development machine in to staging only.** In a private browser window, sign in to the staging user. On the development machine run `pnpm --filter @vela/worker exec wrangler login` yourself and approve it in that private window, then run `pnpm --filter @vela/worker exec wrangler whoami` and check that it lists only "Vela staging". This lets the co-founder create staging buckets and queues and deploy staging; it cannot reach the production account. Never approve a Wrangler sign-in on this machine while signed in as the production user.
9. **Staging CI token:** as step 6, signed in as the staging user, limited to "Vela staging", pasted into the GitHub `staging` environment as `CLOUDFLARE_API_TOKEN`.
10. **A domain Vela owns, and the Worker's hosts.** Each deployed Worker answers only on a custom domain on a zone in its own account (`routes` in `wrangler.jsonc`), and families open the privacy notice link in Vela's first group message, so the hosts and the notice must be on domains Vela owns. **Never use `vela.family`**: it belongs to another company (a family calendar app, `design/research-identity.md`), and a link there would send families to its site. Never guess any other domain either.
    1. Register the domain Vela will use. In the "Vela" account, **Add a domain** on the Free plan, set the two nameservers Cloudflare shows at the registrar, and wait until the domain is **Active**.
    2. The "Vela staging" account needs a zone of its own. Cloudflare activates a domain in one account at a time, so register a second domain Vela owns, used only for staging, and add it to "Vela staging" the same way.
    3. Choose one host in each zone for the Worker, for example `api.` followed by the domain. Deploying creates the host's DNS record and certificate; create no record for that host yourself.
    4. Publish the privacy notice in English and in Traditional Chinese at https URLs on the production domain. Staging may link the same two URLs.
11. **Hand over:** both account ids (Workers & Pages overview, right-hand column), saying which is which; each zone's domain and Worker host; and the two notice URLs. The co-founder puts the hosts and URLs into `wrangler.jsonc` in place of the `PLACEHOLDER_` values (section 11).

### 2. Neon

1. Sign up at `console.neon.tech` (with Google or GitHub, which must have multi-factor authentication on).
2. **New project:** name `vela-apac`, **Postgres 18** (the schema uses Postgres 18's native `uuidv7()`), provider AWS, region **Asia Pacific (Singapore)**, database name `vela`.
3. **Branches:** `main` is production. Create a branch `staging` from `main` now, while `main` is still empty. A branch copies its parent's data and its roles with their passwords, so on the `staging` branch open **Roles** and reset the role's password: staging's connection string then cannot open `main`. Never create, reset or restore `staging` from `main` once a family exists, because it would copy their data.
4. **Settings → Instant restore:** note the restore window. The Free plan allows at most 6 hours; before the first family beyond your own, decide whether to move to the Launch plan and set 7 days (see `runbooks/restore-drill.md`).
5. Accept the Neon DPA (link in `sub-processors.md`).
6. Connection strings: from **Connect**, copy the **direct** (not pooled) connection string of each branch and paste it only into (a) a Cloudflare Hyperdrive configuration (step 7), (b) the GitHub environment secret `DATABASE_URL` of the matching environment (the `staging` branch's string in environment `staging`, the `main` branch's in environment `production`), and (c) a hidden prompt in your own terminal when a runbook asks for it.
7. In Cloudflare, **Storage & Databases → Hyperdrive → Create configuration**: in the "Vela staging" account, `vela-apac-staging` with the staging string; in the "Vela" account, `vela-apac` with the main string. Turn caching off in each configuration's settings (or ask the co-founder to run `wrangler hyperdrive update <id> --caching-disabled` for the staging one, which needs no secret).
8. No Neon API key in sprint 0 (see GitHub Actions above): an account key could read the `main` branch's connection string.
9. **Hand over:** the Neon project id, region, branch names, database and role names (never passwords), and both Hyperdrive configuration ids, which the co-founder puts into `wrangler.jsonc` in place of `PLACEHOLDER_HYPERDRIVE_ID_STAGING` and `PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION` (section 11).

### 3. Anthropic

1. Sign up at `platform.claude.com` (the console formerly at console.anthropic.com), create the organisation "Vela".
2. **Billing:** add a small prepaid credit, switch off auto-reload, and set an organisation spend limit.
3. **Workspaces:** create `vela-dev`, `vela-staging`, `vela-production`, each with a monthly spend limit (for example $10, $10 and $50; your call).
4. In each workspace create one API key named after it. Paste the staging and production keys straight into the matching Worker secret `ANTHROPIC_API_KEY`. Put the dev key into `apps/worker/.dev.vars` yourself.
5. The Data Processing Addendum is part of Anthropic's Commercial Terms; nothing to sign.
6. **Hand over:** the workspace names.

### 4. Deepgram

1. Sign up at `console.deepgram.com`, create a project `vela`.
2. **API Keys:** create `vela-dev`, `vela-staging`, `vela-production` with the Member role. Paste staging and production into the Worker secret `DEEPGRAM_API_KEY`; the dev key into `.dev.vars`.
3. Ask Deepgram for its DPA (its privacy policy points to security@deepgram.com). Every request sets `mip_opt_out=true`, which the co-founder implements.
4. **Hand over:** the project id.

### 5. Sentry

1. Sign up at `sentry.io`. When creating the organisation, choose the **European Union** data storage location; it cannot be changed later.
2. Create the organisation `vela` and a project `vela-worker` for Cloudflare Workers.
3. **Settings → Security & Privacy:** turn on the data scrubber and default scrubbers, and turn on "prevent storing of IP addresses". **Settings → General:** require two-factor authentication.
4. **Alerts:** an issue alert that emails you on new issues in `production`.
5. **Hand over:** organisation slug, project slug and the DSN.

### 6. Healthchecks.io

1. Sign up at `healthchecks.io`, create the project "Vela".
2. Add check `vela-production-reconcile`: period 5 minutes, grace 5 minutes, so a silence over 10 minutes alerts (architecture §15). Add check `vela-staging-reconcile` the same way.
3. **Integrations:** keep email; add Telegram for the production check so the page reaches your phone.
4. Copy each check's ping URL straight into the matching Worker secret `HEALTHCHECKS_PING_URL`.
5. **Hand over:** the two check names.

### 7. Telegram bots

1. In Telegram, open **@BotFather** (confirm the verified badge). Send `/newbot`, display name **Vela Light**, a username ending in `bot`. BotFather shows the token: paste it straight into the production Worker secret `TELEGRAM_BOT_TOKEN`.
2. Repeat for a staging bot ("Vela Light staging") and a dev bot. The staging token goes into the staging Worker secret; the dev token into `.dev.vars`.
3. For each bot in BotFather: leave **group privacy on** (BotFather's default). Families ask by replying to Vela's evening message or with `/ask` and `/later`, which privacy mode delivers, so the family's ordinary conversation never reaches Vela unless an organiser makes the bot an administrator (flows §1). Allow joining groups, set the description and about text, set the picture, and set the **privacy policy link** to the published privacy notice (Telegram requires one), on a domain Vela owns (section 1, step 10). Give the co-founder the notice's URL in each language for `PRIVACY_NOTICE_URL_EN` and `PRIVACY_NOTICE_URL_ZH_TW`.
4. For each environment, generate a webhook secret in the password manager: **32 to 256 characters, letters and digits only** (turn symbols off in the generator). Telegram and the adapter accept 1 to 256 characters of A–Z, a–z, 0–9, `_` and `-`, and refuse anything else. Paste it into `TELEGRAM_WEBHOOK_SECRET`.
5. **Your chat id, before any webhook exists.** Telegram refuses `getUpdates` while a bot has a webhook, so do this first, for each bot. From your own Telegram account, open the bot and tap **Start**. Then, in your own terminal (Git Bash), paste the token at the hidden prompt:

   ```bash
   read -rsp "Bot token: " TOKEN; echo
   curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | grep -o '"chat":{"id":[0-9-]*'
   curl -s "https://api.telegram.org/bot$TOKEN/deleteWebhook?drop_pending_updates=true"
   unset TOKEN
   ```

   The number after `"id":` is your chat id. Give the staging and production bots' chat ids to the co-founder for that environment's `ADMIN_CONVERSATION_ID` in `wrangler.jsonc` (a variable, not a secret: nobody can message the chat without the bot token); development leaves it empty and sends no admin messages. The last call discards your `/start`, which would otherwise reach the Worker once the webhook exists and begin an organiser setup (the setup script in step 6 keeps pending updates).
6. **Webhook and command menu, once that environment's Worker is deployed** (section 11). In your own terminal (Git Bash), at the repository's root, paste the token and the webhook secret at the hidden prompts, and give the environment's `PUBLIC_BASE_URL` as `WORKER_URL`:

   ```bash
   read -rsp "Bot token: " TELEGRAM_BOT_TOKEN; echo; export TELEGRAM_BOT_TOKEN
   read -rsp "Webhook secret: " TELEGRAM_WEBHOOK_SECRET; echo; export TELEGRAM_WEBHOOK_SECRET
   WORKER_URL="https://<host>" pnpm --filter @vela/worker telegram:setup
   unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
   ```

   `apps/worker/scripts/telegram-setup.ts` refuses a `WORKER_URL` that is not https and a secret outside Telegram's alphabet, registers `<WORKER_URL>/webhooks/telegram` with the secret and the updates the adapter parses (`TELEGRAM_ALLOWED_UPDATES`, imported from `@vela/adapters`: `message`, `callback_query`, `message_reaction`, `my_chat_member`), sets `/ask` and `/later` as the command menu in groups and no menu in private chats, and prints the webhook URL, the updates, the bot's username, and whether group privacy is on. It never prints the token or the secret. If it says group privacy is off, turn it back on in BotFather (step 3). No `chat_member` update is needed, which would also need the bot to be an administrator: when someone leaves the family group, Telegram's `left_chat_member` service message arrives inside `message`, even in privacy mode (flows §3.16). Then check that Telegram reaches the Worker:

   ```bash
   read -rsp "Bot token: " TOKEN; echo
   curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
   unset TOKEN
   ```

   It shows the URL and no `last_error_message`.
7. **Hand over:** the three bot usernames, saying which environment each is for (`TELEGRAM_BOT_USERNAME`, without `@`), and the staging and production chat ids from step 5.

### 8. LINE Official Account and Messaging API channel

Needed now so the account exists; the adapter is built in sprint 2 (build plan 2.3).

1. Sign in at `manager.line.biz` with a LINE Business ID and turn on two-step verification.
2. **Create an account:** unverified (未認證帳號), country Taiwan, name **Vela Light**. Create a second one, "Vela Light test", for staging.
3. **Settings → Messaging API → Enable**, create a provider in your own name (there is no entity yet), agree to the terms.
4. In `developers.line.biz`, open the channel: **Basic settings** shows the channel secret; **Messaging API** issues a long-lived channel access token. Keep both only in the password manager until sprint 2, then paste them into `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`.
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

Staging first; production follows through [`runbooks/release.md`](runbooks/release.md). The Worker refuses to run in an environment while `wrangler.jsonc` still holds a `PLACEHOLDER_` value for it, so steps 1 to 5 come before anything can reach a family.

1. **Queues, dead-letter queue and bucket**, with exactly the names in `apps/worker/wrangler.jsonc`, before the first deploy: `wrangler deploy` fails while a queue or bucket it binds does not exist.
   - **Staging:** the co-founder runs these on the development machine, signed in to "Vela staging" only (section 1, step 8):

     ```bash
     pnpm --filter @vela/worker exec wrangler queues create vela-outbound-staging
     pnpm --filter @vela/worker exec wrangler queues create vela-media-staging
     pnpm --filter @vela/worker exec wrangler queues create vela-understand-staging
     pnpm --filter @vela/worker exec wrangler queues create vela-dead-letter-staging
     pnpm --filter @vela/worker exec wrangler r2 bucket create vela-media-staging
     ```

   - **Production:** `vela-outbound-production`, `vela-media-production`, `vela-understand-production`, `vela-dead-letter-production`, and the bucket `vela-media-production`, created by you in the "Vela" account's dashboard (section 1, step 5), because Wrangler is never signed in to production on the development machine.
2. **Hyperdrive ids.** The co-founder replaces `PLACEHOLDER_HYPERDRIVE_ID_STAGING` and `PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION` with the ids of `vela-apac-staging` and `vela-apac` (section 2, step 9). `PLACEHOLDER_HYPERDRIVE_ID_DEV` stays: `wrangler dev` uses the local connection string.
3. **Bots and chat ids.** The co-founder replaces `PLACEHOLDER_STAGING_BOT_USERNAME` and `PLACEHOLDER_PRODUCTION_BOT_USERNAME` (`TELEGRAM_BOT_USERNAME`) and `PLACEHOLDER_STAGING_ADMIN_CHAT_ID` and `PLACEHOLDER_PRODUCTION_ADMIN_CHAT_ID` (`ADMIN_CONVERSATION_ID`) with what you handed over in section 7.
4. **Hosts and notice URLs.** The co-founder replaces `PLACEHOLDER_STAGING_HOST` and `PLACEHOLDER_PRODUCTION_HOST`, in `routes` and in `PUBLIC_BASE_URL` (`https://<host>`), and `PLACEHOLDER_<ENVIRONMENT>_PRIVACY_NOTICE_URL_EN` and `_ZH_TW`, with the hosts and URLs from section 1, step 10. The same commit changes `apps/worker/src/wrangler-config.test.ts`, which holds every host and notice URL as a placeholder until then, to name them.
5. **GitHub.** The environment holds its three secrets (section 10).
6. **Deploy.** Merge that commit to `main`: the deploy job migrates the Neon `staging` branch and deploys `vela-staging`. Production deploys from a tag, after your approval ([`runbooks/release.md`](runbooks/release.md)).
7. **Worker secrets**, once the Worker exists: **Workers & Pages →** `vela-staging` (or `vela-production`) **→ Settings → Variables and Secrets → Add**, type **Secret**, each value pasted straight from its source or the password manager: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` (section 7), `ANTHROPIC_API_KEY` (section 3), `DEEPGRAM_API_KEY` (section 4), `HEALTHCHECKS_PING_URL` (section 6), and `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (section 12). Until all are in, each cron run fails and logs `cron_failed` with `ConfigError:<variable>` naming a missing one; that is expected.
8. **Webhook:** section 7, step 6, with this environment's bot and `PUBLIC_BASE_URL`.
9. **Check:** `https://<host>/healthz` answers `ok`; `https://<host>/admin` opens the overview through Cloudflare Access; the Worker's logs in the dashboard show no `ConfigError`; the Healthchecks check is up.

### 12. Cloudflare Access for the admin page

In each Cloudflare account, "Vela staging" first, once its domain is active (section 1, step 10). Only your own sign-in may pass (ADR-22); the Worker checks the Access token again on every `/admin` request, so a mistake here cannot open the page, and a request without a valid token gets 401.

1. Open **Zero Trust** from the account's dashboard. On first use, choose a team name and the Free plan. The team domain is `<team name>.cloudflareaccess.com`.
2. **Settings → Authentication:** keep the **One-time PIN** login method, which emails a code to the address you sign in with.
3. **Access → Applications → Add an application → Self-hosted.** Name it `Vela admin` (`Vela admin staging` in the staging account). Its domain is the Worker's host from section 1, step 10, with the path `admin`, so the application covers `/admin` and the pages under it only: Telegram's webhook and `/healthz` must stay reachable without a sign-in.
4. **Policy:** action **Allow**, include **Emails**, with your own email address only. Save the application.
5. On the application's overview, copy the **Application Audience (AUD) Tag**.
6. In that environment's Worker (**Workers & Pages →** `vela-staging` or `vela-production` **→ Settings → Variables and Secrets → Add**, type **Secret**): `ACCESS_TEAM_DOMAIN` = `<team name>.cloudflareaccess.com`, with no `https://` and no path, and `ACCESS_AUD` = the tag.
7. **Check,** in a private browser window: `https://<host>/admin/families/check` asks for the Access sign-in, which shows the application covers the pages under `/admin`; after you sign in, `https://<host>/admin` opens the overview; `https://<host>/healthz` answers with no sign-in.
8. **Hand over:** the team domain, for the resource register.

### Later, not in sprint 0

| Account | When | Why |
|---|---|---|
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
| Domain on the "Vela" account (production) | |
| Domain on the "Vela staging" account (staging only) | |
| Worker hosts (staging · production) | |
| Privacy notice URLs (English · Traditional Chinese) | |
| Cloudflare Access team domains (staging · production) | |
| Neon project id (`vela-apac`) | |
| Hyperdrive `vela-apac-staging` id | |
| Hyperdrive `vela-apac` id | |
| Telegram bots (dev · staging · production) | |
| LINE accounts (test · production) | |
| Sentry organisation and project | |
| Healthchecks checks | |
| Anthropic workspaces | |
| Deepgram project id | |
