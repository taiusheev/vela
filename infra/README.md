# Infrastructure

13 September 2026 · build plan sprint 0 (tasks 0.2, 0.4) · architecture §12–17 · owner: the founder owns every account; the co-founder builds on them

What runs where, how the founder creates each account, and how credentials reach the Worker without ever passing through a chat or the repository. The Worker's own configuration lives in `apps/worker/wrangler.jsonc` (code design §9); this folder records the resources, the providers and the runbooks.

| Document | Use it when |
|---|---|
| [`sub-processors.md`](sub-processors.md) | Adding a provider, answering "who processes our data", updating the privacy notice |
| [`runbooks/incident.md`](runbooks/incident.md) | Something is wrong for families, or a secret or personal data may be exposed |
| [`runbooks/release.md`](runbooks/release.md) | Deploying the Worker or running a migration |
| [`runbooks/restore-drill.md`](runbooks/restore-drill.md) | Quarterly, and whenever production data must be restored |
| [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) | A credential may be exposed, someone leaves, or every six months |
| [`runbooks/silence-drill.md`](runbooks/silence-drill.md) | Proving our failures never produce a quiet notice |
| [`runbooks/ota-policy.md`](runbooks/ota-policy.md) | Shipping a JavaScript-only fix to the mobile app (from sprint 3) |

## Rule zero: secrets

A secret is anything that grants access: API keys, bot tokens, database connection strings with passwords, webhook secrets, the admin token, the Healthchecks ping URL, CI tokens.

- **Never paste a secret into a chat** (including the conversation with the co-founder), Telegram, LINE, email, an issue, a screenshot, a markdown file or any file in the repository.
- **The founder copies each secret from the provider's page straight into its destination**: the Cloudflare dashboard (Worker secrets, Hyperdrive) or GitHub (Actions secrets). A password manager is the only other place it may live.
- **The co-founder receives only identifiers**: account ids, project ids, resource names, bot usernames. Each account section below lists exactly what to hand over.
- Development keys are separate, low-limit keys that may sit in `apps/worker/.dev.vars` (ignored by git). Production keys never touch the development machine.
- If a secret is pasted anywhere by mistake, treat it as exposed and follow [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) now.

## Environments

| | dev | staging | production |
|---|---|---|---|
| Purpose | Build and test on one machine | Prove a change end to end before families see it | The pilot families |
| Data allowed | Synthetic only | Synthetic, plus the founder's own test accounts | Real families |
| Worker | `wrangler dev` (local) | `vela-api-staging` | `vela-api` |
| Database | PGlite in `.pglite/`, served by `pnpm --filter @vela/db dev-db` on port 54320 | Neon project `vela-apac`, branch `staging` | Neon project `vela-apac`, branch `main` |
| Hyperdrive | Local connection string | `vela-apac-staging` (query caching off) | `vela-apac` (query caching off) |
| Media | Wrangler's local R2 | R2 bucket `vela-media-apac-staging` | R2 bucket `vela-media-apac`, location hint Asia-Pacific |
| Queues | Local | `vela-outbound-staging`, `vela-media-staging`, `vela-understand-staging`, each with a `-dlq` | `vela-outbound`, `vela-media`, `vela-understand`, each with a `-dlq` |
| Scheduler | `MemberScheduler` Durable Object, local | `MemberScheduler` | `MemberScheduler` |
| Cron | Triggered by hand | Every 5 minutes (reconcile); nightly (metrics, retention) | Same |
| Telegram | Dev test bot | Staging test bot | "Vela Light" bot |
| LINE (sprint 2) | Test Official Account | Test Official Account | "Vela Light" Official Account, paid plan |
| Anthropic | Workspace `vela-dev`, low spend limit | Workspace `vela-staging` | Workspace `vela-production` |
| Deepgram | Key `vela-dev` | Key `vela-staging` | Key `vela-production` |
| Sentry | Off | Project `vela-worker`, environment `staging` | Project `vela-worker`, environment `production` |
| Healthchecks.io | None | Check `vela-staging-reconcile` (email) | Check `vela-production-reconcile` (pages the founder) |
| Who deploys | Co-founder | CI on merge to `main`; co-founder by hand until the job exists | CI on a tag, after the founder's approval |

Only the `apac` region exists in the pilot. Neon projects for `eu` and `us` are created in sprint 2 and stay idle (build plan 2.2). Query caching is off on every Hyperdrive configuration because Hyperdrive caches reads for 60 seconds by default, and the scheduler must read fresh rows.

### Worker configuration names (proposed)

The co-founder's `apps/worker/.dev.vars.example` becomes the source of truth once it exists.

| Name | Kind | Set by | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | Founder | Per environment, from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | Founder | 32 or more random characters from the password manager |
| `ANTHROPIC_API_KEY` | Secret | Founder | Per workspace |
| `DEEPGRAM_API_KEY` | Secret | Founder | Per environment |
| `ADMIN_TOKEN` | Secret | Founder | Bearer token for `/admin`; 32 or more random characters |
| `HEALTHCHECKS_PING_URL` | Secret | Founder | Anyone holding it can fake the heartbeat |
| `ADMIN_CONVERSATION_ID` | Secret | Founder | Not a credential, but it is the founder's personal chat id |
| `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | Secret | Founder | Sprint 2 |
| `ENVIRONMENT` | Variable | Co-founder | `development`, `staging`, `production` |
| `TELEGRAM_BOT_USERNAME` | Variable | Co-founder | From the founder |
| `SENTRY_DSN` | Variable | Co-founder | A DSN only allows sending events, not reading them |
| Hyperdrive id, bucket and queue names | Binding | Co-founder | Identifiers, not secrets |

GitHub Actions (repository **Settings → Secrets and variables → Actions**, set by the founder): `CLOUDFLARE_API_TOKEN`, `DATABASE_URL_STAGING`, `NEON_API_KEY` as repository secrets; `DATABASE_URL_PRODUCTION` as a secret of the `production` environment; `CLOUDFLARE_ACCOUNT_ID` as a variable. Later: `EXPO_TOKEN` (sprint 3), `SENTRY_AUTH_TOKEN`.

## Access rules

- The founder is the owner of every account, with multi-factor authentication on each. No shared passwords.
- The co-founder is an AI coding agent working on the founder's development machine. It works in dev and staging with synthetic data, may deploy staging, and never reads production message content, production secrets or production database connection strings. It may see content-free production signals: events, `metrics_daily` counts, Sentry errors, deployment status.
- Production changes go through CI on a tag the founder approves ([`runbooks/release.md`](runbooks/release.md)). Nobody runs `wrangler deploy --env production` from a laptop.
- The production admin token is held by the founder only. Every admin read of a family writes `admin_access_log`.

## The founder's account checklist (sprint 0, task 0.2)

Do these in order; each takes 5 to 15 minutes. Start with a password manager (Bitwarden's free plan is enough) and an authenticator app; store every recovery code in the password manager.

**Done when:** `wrangler deploy --env staging` succeeds, `GET /healthz` on staging returns 200, the staging bot's webhook shows no error, and the staging Healthchecks check is up (build plan 0.2).

### 1. Cloudflare

1. Sign up at `dash.cloudflare.com`, verify the email, then **My Profile → Authentication → Two-factor authentication**: add a security key or an authenticator app.
2. **Workers & Pages**: subscribe to Workers Paid ($5 a month, as budgeted in architecture §18).
3. **R2**: enable it (it asks for a payment method; the pilot stays inside the free allowance).
4. Read and accept the Cloudflare Data Processing Addendum (link in `sub-processors.md`).
5. On the development machine, run `pnpm --filter @vela/worker exec wrangler login` yourself and approve in the browser. This lets the co-founder create buckets and queues and deploy staging; secret values stay write-only in Cloudflare and cannot be read back.
6. CI token: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**, scope it to your account, create it, and paste it straight into GitHub as `CLOUDFLARE_API_TOKEN`.
7. **Hand over:** the account id (Workers & Pages overview, right-hand column).

### 2. Neon

1. Sign up at `console.neon.tech` (with Google or GitHub, which must have multi-factor authentication on).
2. **New project:** name `vela-apac`, **Postgres 18** (the schema uses Postgres 18's native `uuidv7()`), provider AWS, region **Asia Pacific (Singapore)**, database name `vela`.
3. **Branches:** `main` is production. Create a branch `staging` from `main`.
4. **Settings → Instant restore:** note the restore window. The Free plan allows at most 6 hours; before the first family beyond your own, decide whether to move to the Launch plan and set 7 days (see `runbooks/restore-drill.md`).
5. Accept the Neon DPA (link in `sub-processors.md`).
6. Connection strings: from **Connect**, copy the **direct** (not pooled) connection string of each branch and paste it only into (a) a Cloudflare Hyperdrive configuration (step 7) and (b) GitHub secrets `DATABASE_URL_STAGING` and `DATABASE_URL_PRODUCTION`.
7. In Cloudflare, **Storage & Databases → Hyperdrive → Create configuration**: `vela-apac-staging` with the staging string, `vela-apac` with the main string. Turn caching off in each configuration's settings (or ask the co-founder to run `wrangler hyperdrive update <id> --caching-disabled`, which needs no secret).
8. Neon API key for CI branches: **Account settings → API keys → Create**, paste into GitHub as `NEON_API_KEY`.
9. **Hand over:** the Neon project id, region, branch names, database and role names (never passwords), and both Hyperdrive configuration ids.

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
3. For each bot in BotFather: turn **group privacy off** (so Vela can see messages starting "ask:" and "whenever:"), allow joining groups, set the description and about text, set the picture, and set the **privacy policy link** to the published privacy notice (Telegram requires one).
4. Generate a webhook secret of 32 or more characters in the password manager for each environment and paste it into `TELEGRAM_WEBHOOK_SECRET`.
5. The webhook is registered by the adapter's setup script (`setWebhook`, code design §6), run by you in your own terminal session, or by an admin-only route the co-founder adds; neither shows the token to the co-founder.
6. **Hand over:** the three bot usernames. For `ADMIN_CONVERSATION_ID`, send `/start` to each bot from your own account; the same setup script, run in your terminal, prints your chat id, and you set it as a secret.

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

1. **Settings → Environments:** create `staging` and `production`; on `production`, add yourself as a required reviewer.
2. Add the Actions secrets and variables listed above as each account is created.

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
| Cloudflare account id | |
| Neon project id (`vela-apac`) | |
| Hyperdrive `vela-apac-staging` id | |
| Hyperdrive `vela-apac` id | |
| Telegram bots (dev · staging · production) | |
| LINE accounts (test · production) | |
| Sentry organisation and project | |
| Healthchecks checks | |
| Anthropic workspaces | |
| Deepgram project id | |
