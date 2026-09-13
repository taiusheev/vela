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
4. **Installing a Worker secret:** Cloudflare dashboard, **Workers & Pages → `vela-api` (or `vela-api-staging`) → Settings → Variables and Secrets →** the secret **→ Edit**, paste, save. Saving deploys a new version at once. The alternative is `pnpm --filter @vela/worker exec wrangler secret put NAME --env production` in your own terminal, pasting at the hidden prompt.

## Secrets and how to rotate each

| Secret | Lives in | Rotate at the provider | Effect while rotating | Verify |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Worker secret per environment | BotFather → your bot → API token → revoke; the old token stops at once | Sends fail until installed; the gateway retries at 5, 15 and 30 minutes | Re-register the webhook with the setup script; `getWebhookInfo` shows the URL and no last error; a test message sends |
| `TELEGRAM_WEBHOOK_SECRET` | Worker secret | New value from the password manager (32+ characters) | Webhooks are rejected until re-registered; Telegram retries | Re-register the webhook with the new secret; `pending_update_count` falls to 0 |
| `ANTHROPIC_API_KEY` | Worker secret; dev key in `.dev.vars` | Console → workspace → API keys → create; after verifying, disable and delete the old key | None | New `ai_calls` rows have `ok = true`; the old key's "last used" stops moving |
| `DEEPGRAM_API_KEY` | Worker secret; dev key in `.dev.vars` | Console → project → API keys → create; then delete the old key | None | A test voice answer gets a transcript |
| `ADMIN_TOKEN` | Worker secret; password manager | New value from the password manager | The admin page asks for the new token | The old token gets 401 |
| `HEALTHCHECKS_PING_URL` | Worker secret | Create a new check with the same schedule and integrations; delete the old one after the new one is up | None if the new check exists first | New check "up" within 5 minutes; old check deleted |
| Neon database password | Hyperdrive configurations; GitHub `DATABASE_URL_*` | Zero downtime: create a new role with the same grants, switch Hyperdrive and GitHub to it, then drop the old role. Fast: Neon → Roles → reset password (old fails at once) | A reset causes a few minutes of 503s; webhook providers retry | Hyperdrive → configuration → edit connection; `/healthz` and the admin page load; the next CI migration job connects |
| `LINE_CHANNEL_ACCESS_TOKEN` (sprint 2) | Worker secret | LINE Developers → channel → Messaging API → reissue; the old long-lived token stops | Sends fail until installed | A push to the test account succeeds |
| `LINE_CHANNEL_SECRET` (sprint 2) | Worker secret | LINE Developers → Basic settings → channel secret → issue | Webhook signatures fail until installed | A message from the test account is accepted (200) |
| `CLOUDFLARE_API_TOKEN` | GitHub secret | My Profile → API Tokens → the token → roll | CI deploys fail until updated; families unaffected | The next CI deploy is green |
| `NEON_API_KEY`, `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` | GitHub secrets | Create a new key, update GitHub, delete the old | CI only | The next CI run is green |
| `wrangler login` session | The development machine | `wrangler logout`, then revoke the session in Cloudflare | The co-founder cannot deploy staging until you log in again | `wrangler whoami` fails, then works after login |
| Account passwords and MFA | Password manager | Change the password, sign out other sessions, regenerate recovery codes | None | Sign-in works with the second factor |

Not secrets, no rotation needed: `SENTRY_DSN` (regenerate the client key only if it is abused), bot usernames, account and project ids, Hyperdrive ids.

## After an exposure

Check what was done with the credential during the exposure window: Anthropic and Deepgram usage pages, Cloudflare audit log, Neon activity, unexpected rows in `outbound`. If personal data could have been read or sent, continue with step 5 of [`incident.md`](incident.md).

## How to know it worked

The new credential works (the verify column), the old one is revoked or deleted at the provider, nothing was pasted anywhere on the way, and the log below has a row.

## Rotation log

Names and dates only. Never values.

| Date | Secret | Environment | Reason | Old credential revoked | By |
|---|---|---|---|---|---|
| | | | | | |
