# Secrets rotation

Architecture §13 · `infra/README.md` (rule zero) · done by the founder; the co-founder never sees a value

## When to use it

- **Now**, if a secret may be exposed: pasted into any chat (including with the co-founder), committed, shown in a screenshot, sent on Telegram or LINE, printed in a log or a Sentry event, on a lost device, or named in a provider's breach notice.
- When a person or tool with access stops working on Vela.
- After any Sev 1 incident that involved access.
- On schedule every 6 months during the pilot; the first round is due 13 March 2027.

## Principles

1. Create the new credential, install it, verify it works, then revoke the old one. Where a provider revokes on reissue, install within minutes.
2. One secret at a time; verify before the next.
3. The value goes from the provider's page straight into its destination. Never through a chat, a file or the repository.
4. **Timing.** A rotation that is not an exposure follows the release timing rule ([`release.md`](release.md)): start only when no family's arrival hour falls in the next 30 minutes (the admin page lists the next arrivals). This matters for the Telegram bot token, the LINE channel access token and the Neon password: between revoking the old value and installing the new one, sends fail, and a revoked token is a permanent error, not a temporary one, so an arrival due in that gap is not retried and is lost for the day. After an exposure, rotate now and check the admin page for arrivals marked failed; tell those organisers yourself ([`incident.md`](incident.md), messages to organisers).
5. **Installing a Worker secret:** in the Cloudflare dashboard of the environment's account ("Vela" or "Vela staging"), go to the **Workers & Pages** page, select the Worker that holds the secret (the pilot Worker `vela` or the admin Worker `vela-admin`; the table says which), **Settings →** under **Variables and Secrets** select **Edit**, replace the value, and select **Deploy**. Deploying makes a new version live at once. A secret both Workers hold (`ANTHROPIC_API_KEY`) is installed in both before the old value is revoked. Production secrets go in only this way, signed in to the "Vela" account in the browser. For staging, the alternative is `pnpm --filter @vela/worker exec wrangler secret put NAME --env staging` in your own terminal, adding `-c wrangler.admin.jsonc` for the admin Worker, and pasting at the hidden prompt; the development machine is never signed in to the production account (`infra/README.md`, Cloudflare).

## Secrets and how to rotate each

| Secret | Lives in | Rotate at the provider | Effect while rotating | Verify |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret of `vela`, per environment | BotFather → your bot → API token → revoke; the old token stops at once | Sends fail until installed. Telegram answers a revoked token with "unauthorized", which the gateway does not retry: an arrival due before the new token is installed fails for that day, and its `delivery.failed` notice cannot be sent either (principle 4) | Re-register the webhook with the new token (`infra/README.md`, Telegram step 6); `getWebhookInfo` shows the URL and no last error; a test message sends |
| `TELEGRAM_WEBHOOK_SECRET` | Secret of `vela` | New value from the password manager: 32 to 256 characters, letters, digits, `_` and `-` only (turn symbols off; the adapter refuses to start with any other character) | Webhooks are rejected until re-registered; Telegram retries | Re-register the webhook with the new secret (`infra/README.md`, Telegram step 6); `pending_update_count` falls to 0 |
| `ANTHROPIC_API_KEY` | Secret of both `vela` and `vela-admin`; dev key in `.dev.vars` | Console → workspace → API keys → create; install in both Workers; after verifying, disable and delete the old key | None | New `ai_calls` rows have `ok = true`; the admin page opens (the admin Worker refuses every page without the key); the old key's "last used" stops moving |
| `DEEPGRAM_API_KEY` | Secret of `vela`; dev key in `.dev.vars` | Console → project → API keys → create; then delete the old key | None | A test voice answer gets a transcript |
| Admin page access (Cloudflare Access on the whole `vela-admin` Worker, `architecture/decisions.md` ADR-22 and ADR-26; there is no admin token; `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are identifiers, not credentials) | The founder's Cloudflare Access sign-in | If the account Access signs the founder in with may be exposed, secure it first (password and second factor, as the last row); then revoke the admin Worker's Access sessions: **Zero Trust → Access controls → Applications**, select **Configure** on the application that protects `vela-admin`, then **Revoke existing tokens** | The founder signs in again to open the admin page | A new sign-in opens `https://vela-admin.<subdomain>.workers.dev/admin`; a request without an Access token is refused |
| `HEALTHCHECKS_PING_URL` | Secret of `vela` | Create a new check with the same schedule and integrations; delete the old one after the new one is up | None if the new check exists first | New check "up" within 5 minutes; old check deleted |
| Neon database password | Hyperdrive configurations; GitHub `DATABASE_URL` in environment `staging` and in environment `production` (ADR-23) | Zero downtime: create a new role with the same grants, switch Hyperdrive and GitHub to it, then drop the old role. Fast: Neon → Roles → reset password (old fails at once) | A reset causes a few minutes of 500s from the pilot Worker's webhook (Telegram redelivers) and from the admin page | Hyperdrive → configuration → edit connection; the admin page loads (`/healthz` builds nothing); the next CI migration job connects |
| `LINE_CHANNEL_ACCESS_TOKEN` (sprint 2) | Secret of `vela` | LINE Developers → channel → Messaging API → reissue; the old long-lived token stops | Sends fail until installed; an arrival due in the gap may be lost for the day (principle 4) | A push to the test account succeeds |
| `LINE_CHANNEL_SECRET` (sprint 2) | Secret of `vela` | LINE Developers → Basic settings → channel secret → issue | Webhook signatures fail until installed | A message from the test account is accepted (200) |
| `CLOUDFLARE_API_TOKEN` | GitHub environment secrets: `staging` (the "Vela staging" account's token) and `production` (the "Vela" account's token) | Signed in as that account's user: My Profile → API Tokens → the token → roll | CI deploys to that environment fail until updated; families unaffected | The next CI deploy to that environment is green |
| `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` | GitHub environment secrets | Create a new key, update GitHub, delete the old | CI only | The next CI run is green |
| `wrangler login` session | The development machine, signed in to the "Vela staging" account only | `wrangler logout`, then revoke the session in the staging user's Cloudflare profile | The co-founder cannot deploy staging until you sign in again (`infra/README.md`, Cloudflare step 8) | `wrangler whoami` fails, then lists only "Vela staging" after signing in |
| Account passwords and MFA | Password manager | Change the password, sign out other sessions, regenerate recovery codes | None | Sign-in works with the second factor |

Not secrets, no rotation needed: `SENTRY_DSN` (regenerate the client key only if it is abused), bot usernames, account and project ids, Hyperdrive ids, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. `ADMIN_CONVERSATION_ID` is stored as a secret of `vela` so the founder's personal chat id stays out of the repository, but nobody can message that chat without the bot token; if the founder's Telegram account changes, set the new chat id the same way (principle 5; `infra/README.md`, Telegram step 5).

## After an exposure

Check what was done with the credential during the exposure window: Anthropic and Deepgram usage pages, Cloudflare audit log, Neon activity, unexpected rows in `outbound`. If personal data could have been read or sent, continue with step 5 of [`incident.md`](incident.md).

## How to know it worked

The new credential works (the verify column), the old one is revoked or deleted at the provider, nothing was pasted anywhere on the way, and the log below has a row.

## Rotation log

Names and dates only. Never values.

| Date | Secret | Environment | Reason | Old credential revoked | By |
|---|---|---|---|---|---|
| | | | | | |
