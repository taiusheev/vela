# Security review, October 2026

Technical plan step 6.5. Reviewed by Claude on 8 October 2026, from the code on `main`, before production holds a family. Repeat it before the public launch and after any new public route, webhook or credential.

## Scope

Every way into the two Workers: the pilot Worker's webhooks (Telegram, LINE, Clerk), her phone's routes (`/device/*`), the media links LINE fetches, the public website and waitlist, the API under `/v1`, and the admin Worker behind Cloudflare Access. Supply-chain scanning is Codex's step 6.3 (PRs #43, #45).

## What holds

| Surface | How it is protected | Evidence |
|---|---|---|
| Telegram webhook | Secret header compared in constant time; since this review, checked before any body is read | `packages/adapters/src/telegram/verify.ts`, `apps/worker/src/app.ts` |
| LINE webhook | HMAC-SHA256 of the raw body, constant-time compare, key cached; 401 unsigned | `packages/adapters/src/line/verify.ts` |
| Clerk webhook | Svix signature over id.timestamp.body, 5-minute tolerance, 128 KiB cap | `apps/worker/src/clerk-webhook.ts` |
| Media links for LINE | HMAC over the storage key verified with Web Crypto; unknown or unsigned is the Worker's one 404 | `apps/worker/src/media-route.ts` |
| API `/v1` | Clerk JWT (issuer, expiry, session), live session check on writes, per-address and per-account write limits, no CORS, `Origin` refused | `apps/worker/src/session.ts`, `api-security.ts`, ADR-29 |
| Her phone | 43-character random device token, looked up per request; uploads capped | `/device/*` in `apps/worker/src/app.ts` |
| Admin | Cloudflare Access JWT: RS256 only, `aud`, `iss`, `exp`, `nbf`, key by `kid`; POSTs only from the admin origin; every family view logged | `apps/worker/src/access.ts`, ADR-22, ADR-26 |
| Content at rest | Family words sealed with AES-256-GCM per environment key | ADR-38, `packages/db/src/sealed.ts` |
| Website | Security headers, per-address waitlist limit, no cookies or trackers | PR #33 |
| Logs | Errors logged by label; message text, tokens and URLs never logged | `errorLabel`, tests that assert absent words |

## Found and fixed in this review

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | `/device/voice` read the whole body into memory before the token was checked, trusting `Content-Length`, which a client may omit | Memory exhaustion by anyone, without a token | Read in bounded pieces, never past 3 MiB or 60 s (`readUploadBody`) |
| 2 | `/device/messages`, `/webhooks/telegram` and `/webhooks/line` read bodies with no cap | Same, on public routes | Capped at 64 KiB (her phone) and 1 MiB (webhooks), 10 s |
| 3 | Telegram's body was read before its secret header was checked | An unsigned request cost a full body read | Header checked first; an unsigned request reads nothing |

Tests: `bounded request bodies` in `apps/worker/src/app.test.ts` sends 2–8 MiB bodies with no `Content-Length` to each route.

## Open, for the founder or later steps

1. **Cloudflare Access policy.** The admin Worker trusts any identity Access lets through. Check in the Zero Trust dashboard that the policy allows only the founder's email, for staging and for production.
2. **Two high-severity advisories without an upstream fix** (`braces`, `node-forge`, both in dev tooling, not in a Worker): tracked by Codex's scanner PR #43. Re-check when fixed releases exist.
3. **Production content key** (ADR-38) must be generated and installed before the first family, then its rotation rehearsed (technical plan 6.1).
4. **Clerk production instance:** the session checks assume `sk_live_` and a domain Vela owns (technical plan 1.3).
5. **Rate limit on `/device/*`:** a device token is unguessable, but the routes have no per-address limit before the database lookup. Add the API's address limit when the parent app is switched on (it is off in public v1).
