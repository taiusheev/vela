# Vela security rules

Vela holds what older parents and their families write to each other. These rules add to the reviewer's built-in checks. Flag a change that breaks one.

## Inbound requests

- Telegram and LINE webhooks verify their secret (Telegram's secret-token header, LINE's `X-Line-Signature` HMAC) with `constantTimeEqual` from `packages/adapters/src/constant-time.ts` before acting on the body. Never compare secrets with `===`.
- Every request body is read with `readBoundedText` (`apps/worker/src/app.ts`) under a fixed byte limit, before parsing, whatever `Content-Length` says.
- `/v1/*` app API routes require a verified Clerk session and check that the signed-in person belongs to the family they name. A family id, member id or exchange id from the request is never trusted on its own (IDOR).
- Admin routes accept only a verified Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, `apps/worker/src/access.ts`).
- Stored media is served only through signed, expiring URLs made with `MEDIA_URL_SECRET`, never a public bucket path.

## Writes and data

- Every API write goes through `runApiMutation` with an idempotency key. A double send or a false quiet notice is a safety failure, not a nuisance.
- Drizzle queries use bound parameters. `sql.raw` never receives text that came from a request, a message or the AI.
- What people wrote is sealed in the database (ADR-38). New columns that hold their words use the sealed helpers.
- Logs carry an event name and flat fields only. Never log message content, transcripts, phone numbers, Telegram or LINE ids, push tokens or secrets. Log caught errors as `errorLabel(error)`, never `error.message` or `String(error)`.
- Health words, founder-only readings (ADR-48) and anything the privacy notice does not cover must not reach the app API, a sent message, or the AI prompt.

## Secrets and config

- Secrets live in Wrangler secrets or GitHub environment secrets, never in `wrangler.jsonc` vars, source, tests, fixtures or docs. `EXPO_ACCESS_TOKEN` is never a var.
- Production switches that are off (`MEMORY`, `BOOK`, `WEEKLY_INSIGHT`) stay pinned off in `apps/worker/src/wrangler-config.test.ts` unless the commit is the founder-approved one that turns them on.
- Workflow files never print secrets, never use `pull_request_target` with a checkout of the PR head, and pin any newly added action outside GitHub's own `actions/*` to a full commit SHA.

## AI calls

- Text from families or the AI is data, not instructions. Prompts keep it inside clearly marked fields, and AI output is validated against its schema before use.
- AI output never decides who is notified, whether a quiet notice is sent, or anything about death or illness. Code decides.
