# Secrets rotation

17 September 2026 · architecture §13 · `infra/README.md` (rule zero) · done by the founder; the co-founder never sees a value

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
| `TELEGRAM_BOT_TOKEN` | Secret of `vela`, per environment | BotFather → your bot → API token → revoke; the old token stops at once | Sends fail until installed. Telegram answers a revoked token with "unauthorized", which the gateway does not retry: an arrival due before the new token is installed fails for that day, and its `delivery.failed` notice cannot be sent either (principle 4) | After installing the new token on `vela` (principle 5), register the webhook again with it: `pnpm --filter @vela/worker run setup -- --env <staging or production> --from webhook` in your own terminal (`infra/README.md`, section 7, step 6), which also makes a new webhook secret, as the next row says; `getWebhookInfo` shows the URL and no last error; a test message sends |
| `TELEGRAM_WEBHOOK_SECRET` | Secret of `vela` | Nobody makes a value: `pnpm --filter @vela/worker run setup -- --env <staging or production> --from webhook`, run in your own terminal, generates a new secret, puts it on `vela`, and registers it with Telegram (`infra/README.md`, section 7, steps 4 and 6). It asks for the bot token and a Cloudflare token for that account: for staging, the one in `apps/worker/.env`; for production, a new setup token made as section 11, step 3 says, with a TTL ending the next day, deleted after the run | Updates Telegram sends between the put and the registration are rejected; Telegram retries them | The script's `webhook` line says a new webhook secret is on `vela`, and its `check` step passes; `getWebhookInfo` shows no last error and `pending_update_count` falls to 0 |
| `ANTHROPIC_API_KEY` | Secret of both `vela` and `vela-admin`; dev key in `.dev.vars` | Console → workspace → API keys → create; install in both Workers; after verifying, disable and delete the old key | None | New `ai_calls` rows have `ok = true`; the admin page opens (the admin Worker refuses every page without the key); the old key's "last used" stops moving |
| `DEEPGRAM_API_KEY` | Secret of `vela`; dev key in `.dev.vars` | Console → project → API keys → create; then delete the old key | None | A test voice answer gets a transcript |
| Admin page access (Cloudflare Access on the whole `vela-admin` Worker, `architecture/decisions.md` ADR-22 and ADR-26; there is no admin token; `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are identifiers, not credentials) | The founder's Cloudflare Access sign-in | If the account Access signs the founder in with may be exposed, secure it first (password and second factor, as the last row); then revoke the admin Worker's Access sessions: **Zero Trust → Access controls → Applications**, select **Configure** on the application that protects `vela-admin`, then **Revoke existing tokens** | The founder signs in again to open the admin page | A new sign-in opens `https://vela-admin.<subdomain>.workers.dev/admin`; a request without an Access token is refused |
| Neon database password | Hyperdrive configurations; GitHub `DATABASE_URL` in environment `staging` and in environment `production` (ADR-23) | Zero downtime: create a new role with the same grants, switch Hyperdrive and GitHub to it, then drop the old role. Fast: Neon → Roles → reset password (old fails at once) | A reset causes a few minutes of 500s from the pilot Worker's webhook (Telegram redelivers) and from the admin page | Hyperdrive → configuration → edit connection; the admin page loads (`/healthz` builds nothing); the next CI migration job connects |
| `LINE_CHANNEL_ACCESS_TOKEN` (sprint 2) | Secret of `vela` | LINE Developers → channel → Messaging API → reissue; the old long-lived token stops | Sends fail until installed; an arrival due in the gap may be lost for the day (principle 4) | A push to the test account succeeds |
| `LINE_CHANNEL_SECRET` (sprint 2) | Secret of `vela` | LINE Developers → Basic settings → channel secret → issue | Webhook signatures fail until installed | A message from the test account is accepted (200) |
| `CLOUDFLARE_API_TOKEN` | GitHub environment secrets: `staging` (the "Vela staging" account's token) and `production` (the "Vela" account's token) | Signed in as that account's user: My Profile → API Tokens → the token → roll | CI deploys to that environment fail until updated; families unaffected | The next CI deploy to that environment is green |
| `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` | GitHub environment secrets | Create a new key, update GitHub, delete the old | CI only | The next CI run is green |
| "Vela staging" setup token (`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `apps/worker/.env`) | The development machine, in a git-ignored file the setup script run for staging saved (`infra/README.md`, section 1, step 8, and section 11). The only Cloudflare credential kept there | Signed in as the staging user: create a new token as `infra/README.md` section 11, step 3 says (TTL empty); delete `apps/worker/.env`; run `pnpm --filter @vela/worker run setup -- --env staging` in your own terminal and paste the new token and the account id, which the `account` step saves; once it says so, Ctrl+C at the next prompt stops the run (finished steps stay done), or let it run on, since every step skips what exists. Then **My Profile → API Tokens**, the old token's menu, **Delete**. After an exposure, delete the old token first | Wrangler on the development machine, and with it the co-founder's staging deploys, stops until the new token is saved; CI and families unaffected | The `account` step says it saved the staging token; `pnpm --filter @vela/worker exec wrangler deploy --env staging` succeeds; the old token is no longer listed |
| Production setup token (`vela-setup-production`) | Nowhere once the production setup has run: made with a TTL ending the next day, held only in the setup script's memory, and deleted after the run (`infra/README.md`, section 11, steps 3 and 8) | Signed in as the production user: **My Profile → API Tokens**; if the token is still listed, its menu, **Delete**. If it was ever written to a file, delete that file first (the setup script stops when `apps/worker/.env` holds the "Vela" account's id or token) | None: CI deploys production with its own token | The production user's token list has no `vela-setup-production`; `apps/worker/.env` holds no "Vela" account id or token |
| Account passwords and MFA | Password manager | Change the password, sign out other sessions, regenerate recovery codes | None | Sign-in works with the second factor |

Not secrets, no rotation needed: `SENTRY_DSN` (regenerate the client key only if it is abused), bot usernames, account and project ids, Hyperdrive ids, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. The heartbeat has no secret: the pilot Worker records it itself, and the GitHub watchdog reads the public `/healthz` (`infra/README.md`, section 6). `ADMIN_CONVERSATION_ID` is stored as a secret of `vela` so the founder's personal chat id stays out of the repository, but nobody can message that chat without the bot token.

**If the founder's Telegram account changes,** the pilot Worker needs the new account's chat id. The setup script cannot read it for a bot that already has a webhook, and it will not remove a webhook that may carry families' messages (`infra/README.md`, section 7, step 5). A private chat's id is the account's Telegram user id, the same for every bot, so read it through a temporary bot instead, never through someone else's bot:

1. In @BotFather, `/newbot` creates the temporary bot; copy its token. From the new account, send that bot `/start`.
2. In your own terminal (Git Bash), read its updates; the token goes to `curl` on its standard input:

   ```bash
   read -rsp "Temporary bot token: " TOKEN; echo
   printf 'url = "https://api.telegram.org/bot%s/getUpdates"\n' "$TOKEN" | curl -s -K -
   unset TOKEN
   ```

   The number after `"chat":{"id":` in the `/start` message is the chat id.
3. Install it on `vela` as `ADMIN_CONVERSATION_ID` (principle 5), then delete the temporary bot in @BotFather (`/deletebot`).
4. From the new account, send the Vela bot `/start`, because a bot can message only an account that has started it (as in `infra/README.md`, section 11, step 10, this begins an organiser setup). Verify: the next note Vela sends the founder, such as a weekly read to check, arrives in that chat.

## After an exposure

Check what was done with the credential during the exposure window: Anthropic and Deepgram usage pages, Cloudflare audit log, Neon activity, unexpected rows in `outbound`. If personal data could have been read or sent, continue with step 5 of [`incident.md`](incident.md).

## How to know it worked

The new credential works (the verify column), the old one is revoked or deleted at the provider, nothing was pasted anywhere on the way, and the log below has a row.

## Rotation log

Names and dates only. Never values.

| Date | Secret | Environment | Reason | Old credential revoked | By |
|---|---|---|---|---|---|
| | | | | | |
