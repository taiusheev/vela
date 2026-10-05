# Content sealing

4 October 2026 · ADR-38 · build plan 5.7 · done by the founder, who holds each environment's key

## First deploy and existing rows

The setup script generates one random `CONTENT_KEY_V1` per environment, shows it once for the founder to save in the password manager, and waits for a hidden `SAVED` confirmation before putting it on both Workers. It writes an `CONTENT_KEY_V1_INITIALIZED` marker too: if the key disappears while the marker remains, setup refuses to generate a replacement that could not open existing ciphertext.

The `seal` step runs immediately before `deploy`. It takes the direct Neon connection string from the `database` step, or asks for it again when setup resumes after `secrets`. If the key was generated earlier in that run, setup reuses it in memory; otherwise it asks for the saved value without echoing it. The child receives both values through its environment, never its arguments. `packages/db/scripts/seal-existing.ts` locks each content table, re-seals all legacy values in one transaction, and prints only table and row counts. It is safe to repeat with the same key; a wrong key or damaged ciphertext rolls the transaction back and stops the deploy.

The schema preserves JSONB and array types for the SQL operations that depend on them. It seals strings at configured content paths and opens them in Drizzle. This includes `api_request_receipts.result`, whose successful response body may repeat an ask or reply while its idempotency receipt lives for up to 24 hours. The numeric answer `index` and `media_id`, inbound ids, photo ids and media group id in `exchanges.options`, outbound effects and `sentMedia`, and `message.replyToMessageId` remain clear by ADR-38's scope.

For staging, run the complete setup sequence during a quiet window with no family or organiser activity. Before starting, let pending work drain from `vela-outbound-staging`, `vela-media-staging`, and `vela-understand-staging`; LINE and its inbound queue are off in staging. Keep the app and bot idle until both Workers have deployed. The `seal` step briefly locks writes to content tables, then setup deploys the codec version right after it. Do not run `seal-existing` manually against an active old Worker; it could write a new plaintext row after the transaction commits. Production has no family data before the first deploy, so its first sealing pass has no rows to rewrite.

On macOS, the founder opens [`../scripts/setup-test-system.command`](../scripts/setup-test-system.command) in Terminal to run this sequence. It explains staging as Vela's test system and waits for `READY` after the founder and other testers have stopped using the app and bot. It keeps output in that terminal and pauses at the end. Report only completion or the failed step back to engineering; keep credentials and full output private. If the earlier `setup-staging.command` window is still waiting at `READY`, cancel it with Ctrl+C and use this launcher instead. Do not start a second setup while the first is running.

Before resealing, setup queries Cloudflare's [queue backlog metrics](https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/) for every configured queue, including the dead-letter queue. It stops if any backlog is nonzero or cannot be verified, so the founder does not have to inspect queues. These metrics are approximate; keeping the app and bot idle is still required, and engineering remains responsible for the cutover window. Setup does not delete queued messages to clear a backlog.

If setup reaches `webhook` and stops while checking the Telegram bot token, the earlier sealing and deployment steps have already returned successfully; do not restart the full sequence merely to repair Telegram. On macOS, [`../scripts/finish-test-system.command`](../scripts/finish-test-system.command) resumes at `webhook` and runs the final checks. It asks for the current staging bot token privately, checks that it belongs to the configured bot, and installs that same verified token on the pilot Worker before registering Telegram's webhook. It neither generates another content key nor repeats the database rewrite. The diagnostic distinguishes Telegram rejecting a credential from connection or availability failures; do not revoke a bot token solely because an earlier generic `getMe` error suggested it was invalid.

## 10× staging read load

Run this after staging has completed the reseal/deploy. Use a dedicated synthetic family, with an organiser session that can read it and at least one exchange delivered within the last 30 days containing a text ask, text answer, and text reply. Do not use the dogfooding family's real content. The test is read-only, loads up to 50 exchanges per request, checks that all three sealed text paths came back decoded, and never prints or exports response bodies.

The conservative pilot peak assumes ten families each open the Exchanges screen once in the same minute: 10 requests/minute. Ten times that load is 100 requests/minute, below staging's 120/minute `API_IP_LIMIT`. The script runs for five minutes at that rate and requires p95 under 1 second, fewer than 1% failed requests, no dropped iterations, and the synthetic ask, answer, and reply to decode on every response. If the expected family count changes, set `EXPECTED_PEAK_REQUESTS_PER_MINUTE`; the script refuses a scaled rate at or above the configured 120/minute limiter.

### Prepare the isolated family

After the restore rehearsal has finished, engineering opens [`../scripts/prepare-load-fixture.command`](../scripts/prepare-load-fixture.command). The founder signs in to the native staging app with a dedicated Clerk test account, without submitting onboarding or inviting anyone. At the bottom of onboarding, **Show test sign-in details** exposes only the account and sign-in identifiers. This control exists only in native development builds configured for the exact staging origin; it exports no JWT and has no relay endpoint. Existing fixture users can find it under **You → Account**.

The fixture helper privately receives the direct staging connection, saved content key, and dedicated account ID. It proves the key against existing source ciphertext before creating anything. One transaction inserts an artificial family, active organiser, paused recipient with light off, and one delivered synthetic ask/answer/reply. No channel links, subscriptions, consents, invitations, outbound jobs, push devices, or real people are created. Repeats verify the exact isolated fixture without updating it; unrelated accounts or altered fixtures are refused. `adr-38-staging-fixture.json` records only staging provenance, IDs, successful check booleans, and the post-commit verification time. Its typed-service decode check does not by itself prove the deployed API.

### Run the continuous check

Install local k6 using [Grafana's instructions](https://grafana.com/docs/k6/latest/set-up/install-k6/). Engineering prepared an official, checksum-verified portable macOS ARM64 v2.3.0 copy; [`../scripts/check-test-speed.command`](../scripts/check-test-speed.command) can use that temporary copy after rechecking the executable hash, or an installed `k6`. If the temporary copy has disappeared, the launcher stops for engineering to prepare it again.

Open that launcher after fixture preparation. It selects the exact account and family from the verified receipt, refuses a receipt older than 24 hours, and privately asks for the existing Clerk **Development** secret key and the native test sign-in ID. Production keys are refused. The provider key stays in the Node process and never reaches k6, an argument, or a file.

The earlier static bearer flow is insufficient: staging requires session tokens with at most a 120-second lifetime, while the check lasts five minutes. The runner uses Clerk's [standard session-token endpoint](https://clerk.com/docs/reference/backend/sessions/get-token) to request 60-second tokens for the existing dedicated session, checking that the session is active and belongs to the expected user before and after each mint. It verifies the signature, fixed issuer, session/user IDs, version, times, and absence of `azp` before exposing a token. Public documentation does not establish whether this endpoint always issues a native-compatible token; the private live preflight must prove it. An incompatible token stops the check without changing any API authentication rule.

A random capability protects a temporary `127.0.0.1` token bridge. Only the allowlisted k6 child receives its capability. The runner refreshes every 30 seconds, and k6 asks the local bridge for current authorization on each iteration. No public route or phone token export is added. The API membership preflight requires the exact synthetic family and its sole active organiser; the read preflight and every loaded response require the fixture's exact ask, answer, and reply on its only exchange. Vela latency and failure thresholds exclude bridge traffic, and at least 500 Vela reads are required. The [constant-arrival-rate executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/) maintains 100 scheduled reads per minute for the continuous five-minute scenario.

Never run this in k6 Cloud. HTTP debugging and raw child output are disabled; only curated numeric results reach Terminal. A successful report is `adr-38-staging-summary.json` plus `adr-38-staging-session-check.json` and a short engineering note recording date, deployed version, k6 version, rate, Vela read count, p95, failed requests, dropped iterations, and `content_decoded` (required to equal 1). Session evidence includes only provenance, check booleans, attempt/timing fields, and refresh counts. Each attempt resets stale success evidence before any credential prompt; an interrupted or failed run cannot count as passing.

## Local development

Generate a development-only key once and store it in your password manager:

```bash
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")'
```

Put the same value in `CONTENT_KEY_V1` in `apps/worker/.dev.vars` and `apps/worker/.env.local`. Keep development, staging, and production keys separate. The Worker, `api:dev`, `seed:dev`, and `consent:dev` all need the local value.

To re-seal an existing local database, set its `DATABASE_URL` in `apps/worker/.env.local`, then run:

```bash
pnpm --filter @vela/db run seal-existing
```

The command is transactional and idempotent with the same key. It never prints family content.

## Restore proof

Before creating a restored branch, the founder can run the read-only staging key check in [`../scripts/check-saved-messages.command`](../scripts/check-saved-messages.command). It privately asks for the current staging direct connection and the saved content key, verifies the host against the independently checked staging Hyperdrive origin, and opens one stored content value. On success it writes `infra/load-tests/adr-38-staging-key-check.json` with the time, staging hostname, check scope and local Git HEAD only. This proves the current database and saved key match; it does not count as a restore rehearsal or prove the deployed revision. The launcher never prints or saves the connection string, key or opened content.

Use [`../scripts/check-backup-recovery.command`](../scripts/check-backup-recovery.command) for the staging rehearsal. It receives credentials only through hidden prompts and passes them to the probe in a private child environment; no `.env.local` is created or changed. The complete protocol and its branch/hostname gates are in [`restore-drill.md`](restore-drill.md). Production credentials must never be saved to a local environment file.

It prints `opens`, `does not open`, `no sealed value available`, or `restore check could not read the restored branch`. `opens` confirms that the restored data and the saved key belong together; it never prints the opened value. `does not open` means a candidate sealed value failed authentication or decoding. `no sealed value available` proves nothing about the key. A branch connection or query failure is reported separately and is not evidence of a bad key. Production's pre-family restore drill may have no content to open; prove decryption with the staging rehearsal's synthetic sealed data rather than adding test content to production. Confirm the private process has ended and local configuration is unchanged after the drill.

## Missing or exposed key

Do not generate a replacement for an environment whose initialized marker remains. When setup finds a missing key, a key on only one Worker, or a missing marker, it asks for the saved key and reinstalls that value on both Workers before resealing. If setup cannot open existing ciphertext, it stops before deploy; restore the matching key from the password manager. The ciphertext cannot be recovered without that key; restore from a backup together with the matching key.

If a key may be exposed, follow [`incident.md`](incident.md) first. Rotation needs a new version and a re-seal plan that can open both old and new versions; the current `CONTENT_KEY_V1` codec does not rotate in place.
