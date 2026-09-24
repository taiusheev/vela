# API contract, v2

2026-09-22 (written 2026-09-13; §10's health check revised 2026-09-18 to the pilot Worker as built; shared schemas and the unmounted access-control foundation added 2026-09-21; durable mutation receipts added locally 2026-09-22; account linking by proof of the Telegram account, its migration, and the contention drill's findings 2026-09-23). The contract between the Expo app (and the web admin) and the worker, plus the inbound webhooks. Every endpoint maps to spec v2 (`product/05-product-spec-v2.md`); every request and response is a Zod schema in `packages/contracts`, shared by the worker and the app, so a change breaks the build before it breaks a family.

Conventions: JSON over HTTPS; `Authorization: Bearer <session>`; ids are uuids; times are ISO-8601 with offset; every mutating call accepts an `Idempotency-Key` header and returns the first result on replay; errors are `{error: {code, message, details?}}` with codes `unauthenticated`, `forbidden`, `not_found`, `invalid`, `conflict`, `budget`, `rate_limited`, `internal` (500), `unavailable` (503); pagination by cursor (`?cursor=&limit=`); all text fields are returned in the caller's language with `original` alongside when translated.

## 1. Auth and account

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | /auth/start | Start sign-in by phone or email | Sends OTP or magic link through the auth provider |
| POST | /auth/verify | Exchange code for a session | Returns `{session, user}` |
| POST | /auth/apple, /auth/google | Sign in with Apple / Google | |
| GET | /me | Current user, memberships, plan states | The app's first call |
| POST | /me/provision | Explicit first-run profile creation, or return the existing profile unchanged | Opt-in isolated route; requires Idempotency-Key and online session activity |
| PATCH | /me | display_name, language, tz | Opt-in isolated route; existing live account only, Idempotency-Key and online session activity required |
| DELETE | /me | Leave every family and delete the account | Retention rules apply (spec §17) |

### Authentication and family-access foundation (21 September 2026)

Implemented and tested, but **not mounted on either deployed Worker**:

- `apps/worker/src/session.ts` exposes `createClerkSessionVerifier(options)`. Its caller supplies a trusted HTTPS issuer origin, an explicit list of authorized application origins, optional audience, and an explicit native-client opt-in for tokens without `azp`. No Clerk environment variable or account credential is added to the current pilot configuration. Use one verifier per configured issuer per isolate; do not construct it from request headers or token claims.
- Verification uses the pinned `jose` dependency and only the configured issuer's `/.well-known/jwks.json`: redirects are not followed, key requests time out after 5 seconds, keys are cached for 10 minutes, and unknown key IDs trigger a refresh only after a 30-second cooldown. Token-supplied `jku` and `jwk` do not choose the verification keys. Only an `Authorization: Bearer` token is read; cookies, query parameters and Cloudflare Access headers are not alternatives, even in development.
- The verifier requires RS256, JWT type, a nonblank key ID, issuer, subject, session ID, version 2 and integer `iat`, `nbf`, `exp` claims. Vela accepts at most a 120-second token lifetime and age with 5 seconds of clock skew. Pending or unknown session statuses are rejected; absent `sts` or `active` is accepted. `aud` is checked when configured, because ordinary Clerk session tokens do not require an audience. The result contains only `{authSubject, sessionId}`, never the token, email or claimed family role.
- If `azp` exists it must exactly match an allowed application origin. If the HTTP request includes `Origin`, it must both be allowed and equal the token's `azp`; two allowed origins cannot substitute for each other. Application origins must use HTTPS unless `allowLocalHttpParties` is explicitly true for loopback development origins only (`localhost`, `127.0.0.1`, `[::1]`); the issuer always requires HTTPS. Missing `azp` is refused unless `allowMissingAuthorizedParty` is explicitly true, and is still refused when the request carries an `Origin`. This permits native Expo bearer requests without weakening the default browser policy; it is not device attestation. Invalid tokens return no identity. Key-service or verification infrastructure failures throw `SessionVerificationUnavailable` without token or provider error details, rather than being misreported as a bad login.
- `packages/services/src/api-access.ts` exposes `authorizeFamilyAccess(dbOrTransaction, identity, familyId, requiredRole?)`. It joins `users.auth_subject` to `members.user_id` and the requested family, accepting only a non-deleted account, a non-deleted family, and an active or paused membership with no `left_at`. Pausing the light must not prevent reading the family or resuming it. Invited, left, deceased, Telegram-only/unmapped and cross-family callers receive the same `not_found` result. An eligible member lacking the server-required organiser role receives `forbidden`; a grant contains only the database's user, member and family IDs and role. There is no automatic account creation, email/phone linking or authorization cache.
- `apps/worker/src/api-security.ts` supplies reusable Hono authentication and family-authorization middleware. Authentication runs first; family authorization takes the family ID from the route's `:familyId`, not the body, query or headers. Missing/invalid identity is 401, nonmembership/missing family is 404, and a role refusal is 403, using the public error envelope; protected responses carry `Cache-Control: no-store`. Register the API's error handler through `withApiErrorNoStore(handler)` as well: it forces that header on the handler's returned response, including raw responses from failures inside the authentication middleware itself. The wrapper controls caching, not the error payload; the handler must return sanitized public errors. Operational failures propagate to the API error handler, not to a success or authentication refusal; the isolated read API below now supplies that handler. The middleware is tested in an isolated Hono app only; it exposes no new live route.

**Before mounting API routes:** configure and smoke-test the real Clerk issuer/client, wire and smoke-test the optional account-write capability and its online session checker, integrate verified lifecycle events and gateway rate limits, expose the proof-of-ownership account linking that §"Account linking" below now implements, and add the remaining endpoint-specific authorization and consent checks. Membership is not permission to operate on every nested resource: each query must constrain target member/exchange/media IDs to the authorized family. Mutations must recheck authorization and relevant state within their transaction, with locking where concurrent changes require it. Cryptographic verification alone does not check session revocation with Clerk; a revoked session's still-valid JWT can survive until expiry. Sensitive operations need an online session check or a revocation mechanism before exposure. Production and the existing Telegram/admin paths are unchanged.

Clerk references checked for this implementation: [manual verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification), [session claims](https://clerk.com/docs/guides/sessions/session-tokens).

### Account provisioning and read APIs (21 September 2026)

`apps/worker/src/api-app.ts` implements `createApiApp(runtime)`, an isolated Hono app whose default configuration has exactly two read routes: `GET /v1/me` and `GET /v1/families/:familyId/plan`. It is **not mounted in the pilot or admin Worker**, and no deployment or Clerk configuration is part of this slice; its two migrations, `0001_api_request_receipts` and `0002_account_linking`, are in the repository and have not been applied to staging or production. Unsupported methods (including HEAD) and unknown paths return 404 without opening the database.

`ApiRuntime` supplies the session verifier, a database-handle factory, the three read/access services and an error logger. Authentication runs before a matched read route opens a database; the request opens one handle and awaits its `close()` in `finally` on success, denial or failure. A cleanup failure logs `api_database_close_failed` with an error label only; it does not overwrite the original response or request error. The API does not construct Telegram, AI, speech, media, queue or scheduler ports. The family route uses the family guard, and the read service repeats its access conditions in the data query, so a grant cached earlier in the request is not sufficient. Responses are parsed through the shared schemas, which strip undeclared fields. All responses use `no-store`. The error boundary returns generic JSON: 503 `unavailable` for `SessionVerificationUnavailable`, 500 `internal` for other unexpected failures, including invalid service output. Only `errorLabel(error)` is logged, never the raw error, path, query, token or profile.

- **Explicit provisioning, internal only:** `provisionApiUser(dbOrTransaction, verifiedIdentity, profile)` in `packages/services/src/api-accounts.ts` accepts `ApiAccountProfile`: `{display_name, language, tz}`. The name is trimmed and must contain 1–80 characters; the language and IANA zone use the shared domain schemas. Unknown fields, including identity, role, email, phone and member IDs, are rejected. The subject comes only from the verified identity. An insert conflicts only on `users.auth_subject`: the first profile and UUID win, and repeats or racing calls return that existing live account unchanged. A retained soft-deleted account is not resurrected. Provisioning neither creates a family/membership nor attaches any Telegram member; no GET calls it. The optional HTTP provisioning route below calls the receipt-backed wrapper instead of exposing this low-level helper directly. Concurrent insert/reselect uses PostgreSQL's default READ COMMITTED behavior; callers choosing stronger transaction isolation must handle serialization failures by retrying the whole transaction.
- **`GET /v1/me`:** `loadApiMe` returns `ApiMe`, `{user: {id, display_name, language, tz}, memberships: [{member_id, role, status, family: {id, name, region, plan}}]}`. One SELECT uses the exact subject and excludes deleted accounts, non-active/non-paused or departed memberships, and deleted families. Memberships are ordered by their creation time then ID. An existing account with no eligible membership gets an empty list; an unmapped or deleted account gets 404 `not_found`, with no creation or mutation. Auth subjects, session IDs, email, phone and other members' private fields are not returned.
- **`GET /v1/families/:familyId/plan`:** `loadApiFamilyPlan` returns `ApiFamilyPlan`, `{family_id, plan, subscriptions: [{member_id, status, trial_ends_at, current_period_end, grace_until}]}`. Ordinary eligible members may read it. The query checks the caller's live membership and account, the family's deletion state, and both the subscription's family and its covered member's family. Only active/paused covered members without a departure time are included. Missing/nonmember/deleted callers share 404. An authorized family with no visible subscription rows gets an empty list, not an invented subscription status. Dates are ISO instants or explicit nulls. These are stored plan/status records, not computed billing entitlements; no trial is started and no expired status is rewritten. Provider, external subscription, payer, currency and price fields stay private.

`SubscriptionStatus` and `SUBSCRIPTION_STATUSES` now live in `@vela/contracts` and the database re-exports the same tuple. Its values and SQL CHECK remain unchanged. Linking an existing channel member goes only through the proof-of-ownership challenge below; neither matching profile text nor guessing a member ID grants membership.

### Opt-in account writes and lifecycle (22 September 2026; not deployed)

Only when `ApiRuntime.writes` is supplied does the isolated API register `POST /v1/me/provision` and `PATCH /v1/me`. That capability requires a clock, the two write services and an online `SessionActivityChecker`. Without it, writes still return 404. No deployed entry point supplies it, and neither the pilot nor admin Worker mounts this API app.

- Both paths authenticate the bearer token first, require a valid `Idempotency-Key`, and accept only uncompressed UTF-8 `application/json`. Bodies are streamed with a 4096-byte limit, bounded read count and a 10-second total deadline; declared size never substitutes for counting actual bytes. Malformed key/JSON/schema is 400, unsupported media/encoding is 415, oversized data is 413, and a stalled body is 408. Rejection precedes provider activity checks or database creation. Cancellation is not awaited indefinitely; a cancellation failure logs only its error label.
- `ApiAccountProfile` is the complete first-run body. `ApiAccountPatch` is a strict, nonempty subset of `display_name`, `language`, `tz`, rejecting explicit undefined fields. Names must be well-formed Unicode without NUL after trimming, at most 80 UTF-16 code units. Both reject identity, role, email, phone, member/family IDs, invite tokens and linking instructions. User-profile changes never change member profiles, schedules, channel links or consent.
- `createClerkSessionActivityChecker({secretKey, fetch?})` in `session.ts` checks `GET https://api.clerk.com/v1/sessions/<sid>` using the configured backend credential, after JWT verification. It validates the session-ID path segment, never follows redirects, never caches successful activity, uses a five-second abort deadline and bounds streamed JSON to 64 KiB. Only an exact session/user match with backend status `active` returns true. A missing, mismatched or inactive session returns false; transport, malformed response, credential, redirect and provider-limit failures become sanitized `SessionVerificationUnavailable`. The API requires literal true on every write, including replay, or returns 401 before database acquisition; verification outages return 503. No credential or provider body is logged or returned. This check is not a substitute for JWT verification and is not distributed atomicity with a later database commit. References: Clerk [getSession](https://clerk.com/docs/reference/backend/sessions/get-session) and [Backend Session](https://clerk.com/docs/reference/backend/types/backend-session).
- `provisionApiAccount` and `updateApiAccount` in `api-account-writes.ts` use fixed operations `account.provision:v1` and `account.update:v1`, the verified subject and the parsed profile/patch. Both return 200 `ApiUser` plus `Idempotency-Replayed: true` or `false`; creation uses 200 because an already-existing profile is a valid unchanged result. Neither body nor response contains membership assignments. Authorization locks the current account inside the receipt transaction, including before replay. Retained deleted accounts are denied, and a missing account cannot receive an old unexpired provisioning response. PATCH never creates an account and updates only supplied fields.
- `runApiMutation` now takes a transaction-scoped advisory lock on the actor hash before receipt or account locks. This also serializes different keys for the same actor. `disableApiAccount` takes that same lock, records/preserves the first account tombstone (including for a subject with no prior local account) and purges all that actor's receipts atomically. It prevents delayed provisioning from reviving an account and prevents a racing write from leaving a cached profile after disable. It is an internal lifecycle primitive, not a public DELETE route or complete data-subject erasure: membership departure, retained profile removal, provider lifecycle verification and webhook wiring still need their own implementation.
- Expected mutation failures map to generic 400 `invalid`, 404 `not_found`, 409 `conflict`, 429 `rate_limited`, or 503 `unavailable`, without input details; unexpected failures remain 500. Request-local database cleanup and no-store responses apply equally to writes.

### Account linking by proof of the Telegram account (23 September 2026, no route yet)

A pilot invite proves possession of an invitation and is consumed by the Telegram consent flow; it is not proof that a Clerk session owns an already-linked Telegram member, and names, email, phone or member IDs never stand in for that proof. `packages/services/src/account-linking.ts` implements the separate challenge instead, in three internal steps backed by `account_link_challenges` (migration `0002_account_linking`). Nothing calls them yet: no HTTP route, no bot command, no deployment, and `POST /v1/me/link` stays 404 even with writes enabled.

- **`startAccountLink(deps, identity, key)`** runs through `runApiMutation` as `account.link.start:v1`. It locks the caller's live account, invalidates that owner's other challenges that are still open and unexpired, and inserts one bound to the hash of the calling session, valid for 15 minutes. It returns 201 with `{challenge_id, expires_at}` and no code. A completed or already expired challenge is left alone.
- **`issueAccountLinkCode(deps, challengeId, event)`** is the Telegram half and takes no session and no key. It accepts only a private `start` event on Telegram whose sender is the conversation, so the code can reach nobody but the owner of that account. Under the actor's advisory lock it locks the owner, the challenge, then the member, its family and its channel link, refusing a member who is not active or paused, one who has left, a deleted family and a blocked link. It binds the challenge to that family, member, channel link and the hash of the Telegram id, stores the hash of a fresh 22-character code, and returns the code for the bot to show. Reissuing for the same Telegram identity only rotates the code, spending no attempt and never extending the expiry; a different identity is refused, and a member already linked to another account is a conflict.
- **`completeAccountLink(deps, identity, key, challengeId, code)`** runs as `account.link.complete:v1`, scoped to the bound family and member. It requires the same session that started the challenge and the same account, re-locks the owner, the challenge and the target, checks the bound Telegram identity again, and compares the supplied code with the stored hash in constant time. A wrong code spends one of five attempts and answers `{linked: false}`; the fifth invalidates the challenge. On success it sets `members.user_id` when that member has none, marks the challenge completed, clears the code hash, writes an `account_linked` event, and answers `{linked: true, member_id, family_id}`. Repeating the call replays that answer through the receipt; a member claimed by another account, or a second member of the same family already held by this account, is a conflict.

The mechanism is therefore in place, but linking is still unavailable to a person: exposing it needs a route and a bot command, the consent copy that explains what linking does, and the same activation gates as the other writes.

Before real account writes are enabled, apply the migrations, configure the real Clerk instance and gateway limits, wire verified disable/deletion lifecycle handling, review the notices/sub-processors, and run the provider smoke checks. The multi-connection PostgreSQL contention drill is done (§ "Durable mutation receipts" below).

### The lights of a family (23 September 2026)

`GET /v1/families/:familyId/lights` answers `MemberLight[]` for the caller's family: one row per kept-light member, read in that member's own local day. `loadApiLights` in `packages/services/src/api-lights.ts` takes the family authorization every other family read takes, then derives each state in this order: a paused member is `paused`, an unended away period covering her day is `away` with the day it ends, the day's exchange having an answer is `lit` with the time she answered, an unresolved quiet event on that exchange is `quiet` with its id, and anything else is `resting`. `usual_time` is her arrival time. A stranger, a family that is not the caller's and an unknown family all answer 404. The route is registered on the isolated API app and, like the rest of it, is mounted nowhere.

### The Today screen (23 September 2026)

`GET /v1/families/:familyId/today` answers `ApiToday` for the caller’s family: `lights` exactly as the lights route answers them, `exchanges` with one entry per kept-light member who has an exchange in her own local day, and `tomorrow` with one entry per kept-light member whose next local day already holds a turn. `loadApiToday` in `packages/services/src/api-today.ts` takes the same family authorization and reads every day in the member’s own time zone, so a family spread across zones sees each person’s day and not the caller’s.

An exchange carries the asker’s name (null for Vela’s own hello, and for an ask whose asker was deleted), the ask, her latest answer with the time it arrived, the replies in the order they were written, and `seen_at` for the receipt chip. Her words are read as the read-back reads them: the transcript, else the text of what she wrote, else the choice she tapped, else the summary — so an answer that carried no words comes back with `text: null` and its kind, and the reader decides what to call it. A turn carries the holder (null when nobody holds turns, or the holder has left), the ask already composed for that morning, and a suggestion — never both of the last two, because a morning holds one ask and offering a second would invite a 409. A `turns` row exists only once the evening prompt has run, so an entry is returned whenever there is a turn row **or** an ask; an ask composed before the prompt would otherwise leave the asker with nothing to show for it (spec A7: composing "returns to Today with the tomorrow card updated"). Suggestions still have no writer, so that field is null outside tests.

A stranger, a family that is not the caller’s and an unknown family all answer 404. The route is registered on the isolated API app and, like the rest of it, is mounted on neither deployed Worker; `apps/worker/scripts/api-dev.ts` serves it on a developer’s own machine for the app to read (infra/README.md, section 9a).

### Composing an ask (23 September 2026)

`POST /v1/families/:familyId/exchanges` is the first write a family makes. It takes `ComposeAsk` — `recipient_id`, `type`, `text`, `when` (`tomorrow`, `date` or `whenever`), `date` for a `date` ask, `vote_options` for a vote, and `on_behalf_of` — and answers 201 with `ApiComposedAsk`. `composeApiAsk` in `packages/services/src/api-asks.ts` runs it through `runApiMutation` as `exchange.compose:v1`, scoped to the family and the recipient, so a repeat replays the first answer and writes no second ask.

Only the types an arrival can carry from words alone are accepted: `question`, `word`, `story`, `recipe` and `vote`. A photo choice, a voice note and an old photo need media the app cannot yet attach, so they are refused rather than stored undeliverable. Family ownership is no longer the obstacle: `mediaByIds` takes the recipient's family and cannot return another family's row, dropping an id the family does not own and logging it as `media_outside_family`. Once the app can attach a file, `media_ids` can be accepted here — what is missing is the upload path, not the check.

Every date is the recipient's own local day. `tomorrow` is her next morning, a `date` ask must name a day after today and no more than 14 days ahead — retention clears an undelivered ask's words after 30 days, so nothing may be composed into that — and `whenever` carries no date at all. The one-ask-per-day rule is held by the recipient's member row, locked `for update` as the mutation's first statement, which is the lock `prepareDay` and the Telegram compose path take; `exchanges_one_per_day` stays the backstop whose firing is an incident, never a control path.

A day already claimed answers **409** whose `details` are `{taken_by, date_alternative}`: who holds that morning (Vela when it is her own fallback hello) and the next one nobody holds within the window, or null. That is what A7 needs to say "Anna already has tomorrow morning" and offer the day after or whenever. The caller must be a live member of the family, and the recipient a kept-light member who is active and has not left; a stranger, another family, a paused recipient and an unknown family all answer 404.

The mutation sends nothing. A `runApiMutation` callback may not enqueue, so unlike the Telegram path this composes no confirmation into the family group — a family on Telegram sees a morning claimed with no notice until that is carried after commit. The route is mounted on neither deployed Worker; `api-dev.ts` serves it only when a Clerk secret key is present, because a write needs the live session check that only Clerk's backend can make.

### The Exchanges list (24 September 2026)

`GET /v1/families/:familyId/exchanges` answers `ApiExchangePage`: the same card Today shows, with the day it was for and the moment it arrived, newest first. `loadApiExchanges` in `packages/services/src/api-exchanges.ts` takes the same family authorization the other family reads take, and puts the family in the query itself: membership is not permission to read a nested id.

Only days that happened. An ask still waiting for its morning belongs on Today's tomorrow card, and a withdrawn one belongs nowhere, so the list carries only exchanges that were delivered. It reaches back `EXCHANGE_LIST_DAYS` (30) days and then stops, which is where the family book takes over (spec A8) — and is also where retention clears an exchange's words, so a longer list would be a list of blanks. That floor is applied to **every** page, not only the first, so a cursor invented by a caller cannot walk past the end the route promises.

Paging is on `exchanges.id`, which is uuidv7 and so already in the order the list reads. `scheduled_for` cannot carry a cursor: it is nullable, its index is `desc nulls first`, and two exchanges in one family can share a day, so it has no total order. A cursor that is not a uuid is ignored rather than trusted. `next_cursor` is null at the end.

The route is a read, so it needs no write capability and is served whether or not a Clerk secret key is present — unlike composing, which needs the live session check.

### Durable mutation receipts (22 September 2026, not exposed)

`runApiMutation` in `packages/services/src/api-idempotency.ts` provides database-only replay protection. The optional account-write routes call it locally; no deployed route calls it. Migration `0001_api_request_receipts` adds the receipt table; apply it before deploying the updated retention job. `0002_account_linking` follows it with `account_link_challenges` and the `account_linked` event name. The applied `0000_init` is unchanged, and no migration has been run against staging or production for this slice.

- The caller supplies a verified `SessionIdentity`, an opaque key, a server-owned versioned operation identifier, validated JSON input including every write-affecting argument, and optional family/member scopes. `ApiIdempotencyKey` accepts 1–200 ASCII letters, digits, `.`, `_`, `:`, `-`; clients should generate a new unpredictable key per logical mutation. A member scope requires its family. Canonical JSON sorts object keys, preserves array order, rejects non-JSON values and cycles, and bounds nesting to 32 and the complete fingerprint envelope to 16 KiB. The receipt stores SHA-256 hashes of the exact auth subject, key and envelope, not their raw values. Session IDs do not scope the key, so refreshing a session does not repeat a mutation. These hashes are pseudonymous data, not anonymization.
- One transaction first takes the actor advisory lock, then reserves the actor/key pair through its unique constraint, or locks the existing row after a concurrent request completes. The mandatory `authorize(tx)` callback runs after the reservation/lock on every attempt, including replay and conflict, before any saved response is returned. It must perform current account, membership, ownership and consent checks, with locks where concurrent permission changes require them; it must not make business changes. The helper additionally verifies a supplied member belongs to its family.
- For an unexpired receipt, the same fingerprint returns the original saved success result without calling `mutate(tx)`. A different operation, input or scope under that actor/key raises `ApiIdempotencyError` with `conflict`. A committed incomplete or invalid saved result fails closed rather than executing again. If concurrent cleanup leaves no receipt to lock, the helper reports `unavailable` without running the mutation.
- A new or expired receipt runs `mutate(tx)` once, then saves its result in the same transaction. Authorization, mutation, response-validation and receipt-write failures roll everything back. The supported `ApiMutationResponse` is `{status, body}` with status 200, 201, 202 or 204; 204 requires a null body. Saved JSON is limited to 16 KiB and copied before returning. Headers, cookies and error responses are not cached. The replay window is 24 hours from successful completion and is not extended by replay; at expiry the key is treated as a new request, whether or not nightly cleanup has removed its old row. Clients must not rely on deduplication beyond that window.
- Callbacks may write only through the supplied transaction, including durable outbox rows. No external requests or queue sends belong inside the callback: rollback cannot undo them. In particular, the existing `enqueueOutbound` also sends a queue job, so it must not be used as an atomic database-only callback without separating that send. Dispatch happens after commit with the gateway's existing deduplication/redrive rules.
- Under the actor lock, authorized requests also remove expired other receipts for that actor, preserving the current row for expiry reuse. At most 1,000 receipts per actor may remain for a new mutation; excess attempts roll back with `rate_limited` before mutation. Matching unexpired replays remain available at capacity, and other actors are independent. This storage bound is not a gateway request-rate limit: admission limits before provider calls are still required before live activation.
- The nightly retention job deletes receipts whose `expires_at <= now` and records only their count. It selects them `for update skip locked`, so it never waits for a request that holds one: a request reusing an expired receipt holds that row while it deletes the actor's other expired rows, and a job that waited would close a lock cycle, which PostgreSQL breaks by aborting one side, the night's remaining rules or the family's write (found by the contention drill, fixed 23 September 2026). A row a request holds is deleted the next night, inside the same 48-hour window. With healthy nightly execution, physical deletion is within 48 hours of completion; expiry and physical deletion are different. Family/member foreign keys cascade when their scoped rows are physically deleted, ending that receipt's replay retention early; current authorization and scope checks must reject retries for erased resources. Callers must attach the correct scopes for all data returned; mutations that remove their own receipt through a cascade are rejected/rolled back, not silently committed without replay protection.

**Before a write endpoint uses receipts:** wire header/error handling (400 `invalid`, 409 `conflict`, 503 `unavailable`), implement its authorization and ownership proof, and review its exact response fields. Account deletion must purge actor-scoped receipts, and resource-creation/deletion flows must handle associations to newly created resources and deletion of cached personal data explicitly; those lifecycle integrations are not supplied by this generic helper. Never cache session credentials or provider secrets. Signed media URLs, checkout/provider actions and other external effects need endpoint-specific handling, not a claim that this transaction makes them exactly-once. Review/version the public notices before storing live response-cache data; the prospective data-map entry does not change the current pilot notice. PGlite tests exercise replay and rollback, but do not replace an independent multi-connection PostgreSQL contention drill before live writes. That drill now exists as `packages/services/postgres-tests` (code design §8), run with `pnpm --filter @vela/services run test:postgres` against a disposable PostgreSQL 18; on 23 September 2026 it passed whole on 18.6 through local binaries, while its Docker path has not yet been exercised. It found the deadlock fixed below, and it is the check to rerun when this helper, the linking services or the retention job changes; linking's own races are in it too (§"Account linking" above).

## 2. Families and members

| Method | Path | Purpose |
|---|---|---|
| POST | /families | Create a family: `{name, country, kept_light_member: {display_name, address_form, language, tz, wake_time, city}}` → family, member rows, region set |
| GET | /families/:id | Family, members with light states (§2.2), nearby contacts, plan |
| PATCH | /families/:id | name, story_day, turns_enabled |
| DELETE | /families/:id | Schedules deletion within 24 h |
| POST | /families/:id/members | Add a member (self-invite accepted, or organiser adds a kept-light member) |
| PATCH | /families/:id/members/:mid | address_form, language, tz, wake_time, turns_in, primary_surface, role |
| POST | /families/:id/members/:mid/light | `{on: boolean}` — for oneself: consent implicit; for another: requires their consent flow |
| POST | /families/:id/members/:mid/pause | Pause or resume (`{paused: boolean}`) |
| POST | /families/:id/members/:mid/left | Member leaves |
| POST | /families/:id/members/:mid/deceased | Any member marks it; every schedule stops within the hour |
| POST | /families/:id/invites | `{channel: link|line|whatsapp|telegram|sms|email, for_member_id?}` → `{url, token, expires_at, invite_text}` |
| POST | /invites/:token/accept | Accept into the family |
| GET | /families/:id/members/:mid/what-family-sees | The last 7 summaries and the last weekly read, in her language (symmetry, §9) |

## 3. Nearby contacts

| Method | Path | Purpose |
|---|---|---|
| POST | /families/:id/members/:mid/nearby | `{name, relation, phone, channel?}` → consent request sent in the organiser's name |
| DELETE | /families/:id/nearby/:cid | |
| POST | /nearby/:token/consent | Consent or decline (from the contact's message) |

## 4. Exchanges (the core)

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/today | The Today screen (A6): lights, today's exchange per kept-light member, tomorrow's turn and suggestion. **Built**, see below |
| GET | /families/:id/exchanges?cursor= | Exchanges newest first (A8), with answers, replies, receipts, translations **Built**, see below |
| GET | /exchanges/:id | One exchange in full |
| POST | /families/:id/exchanges | Compose an ask: `{recipient_id, type, text?, options?, media_ids?, voice_hello_id?, when: tomorrow|date|whenever, date?, on_behalf_of?}` → exchange (state composed). `409 conflict` with `{taken_by}` if that date already has an ask; body may include `date_alternative` | **Built** for words-only asks, see below
| DELETE | /exchanges/:id | Withdraw before delivery only |
| POST | /exchanges/:id/seen | Parent surface: she opened it |
| POST | /exchanges/:id/answer | Parent surface: `{kind: voice|chip|photo_pick|vote|heart|text|fine, media_id?, payload?}` → lights the light synchronously, enqueues understanding |
| POST | /exchanges/:id/replies | `{kind: heart|laugh|hug|text|voice|photo, text?, media_id?}` |
| POST | /exchanges/:id/read-back | Parent surface: she heard yesterday's replies |
| GET | /families/:id/suggestions?for=me | The turn holder's suggestion(s) for tomorrow |
| POST | /suggestions/:id/use | Marks used; returns a prefilled compose body |

## 5. The light and the quiet ladder

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/lights | Per kept-light member: state, answered_at, usual_time, quiet_event? (widget endpoint; cheap, cacheable 60 s) |
| POST | /quiet/:qid/fine | "She's fine, I know why" → resolves with outcome fine_known |
| POST | /quiet/:qid/wait | Wait 2 hours |
| POST | /quiet/:qid/ask-to-check | `{contact_id}` → nearby_ask sent in the caller's name (actor required) |
| POST | /quiet/:qid/useful | `{useful: boolean}` one-tap verdict for the precision page |
| POST | /families/:id/members/:mid/away | `{from, to?}` or `{until_back: true}` |
| DELETE | /families/:id/members/:mid/away | End away mode |
| GET | /families/:id/precision | Notices, outcomes, shares (the precision page) |

## 6. Story day, the family book, memory

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/book | Stories and recipes, with play URLs |
| POST | /families/:id/book/questions | Add or vote a story question |
| POST | /stories/:id/keep | `{kept: boolean}` (her "don't keep that one") |
| POST | /families/:id/book/export | Vela Light: PDF export job → `{job_id}`; GET /jobs/:id |
| GET | /families/:id/reminders | Suggested and created reminders |
| POST | /families/:id/reminders | Create from a suggestion (only after a tap) |

## 7. Weekly read, settings, billing

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/weekly-reads?member= | Reads; free plan returns the seven lights and a `locked` flag |
| POST | /weekly-reads/:id/opened | Event only |
| GET | /me/notifications | The one-a-day setting and hour |
| PATCH | /me/notifications | `{hour}` only; frequency cannot be raised |
| GET | /families/:id/plan | Plan, trial, per-member subscription states |
| POST | /families/:id/plan/trial | Start the 30 days (after her first answer) |
| POST | /families/:id/plan/checkout | Web checkout session (provider decided later) |
| POST | /webhooks/billing/:provider | Provider events |

## 8. Media

| Method | Path | Purpose |
|---|---|---|
| POST | /media/upload-url | `{kind, mime, bytes, duration_ms?}` → signed PUT URL and media_id (R2, region bucket) |
| POST | /media/:id/complete | Marks uploaded; triggers transcoding if needed |
| GET | /media/:id/url | Signed GET URL, 15 minutes |

## 9. Inbound webhooks (channels)

| Path | Verification | Events parsed |
|---|---|---|
| POST /webhooks/line | X-Line-Signature (HMAC-SHA256, channel secret) | message (text, audio, image, sticker), postback (chip/photo/vote/consent), follow, unfollow; read receipts not available |
| POST /webhooks/whatsapp | X-Hub-Signature-256 (app secret); GET verify challenge | messages (text, audio, image, button/interactive replies), statuses (sent, delivered, read) |
| POST /webhooks/telegram | secret token header | message (text, voice, photo, sticker), callback_query, message_reaction, my_chat_member (blocked) |
| POST /webhooks/voice/:provider | provider signature | call status, DTMF digit, recording ready |

Rule: verify, parse into `InboundEvent[]`, acknowledge within 1 s, do all work from the queue. The answer path (light, cancel repeat, resolve quiet) runs before the queue for kept-light members because it is a single indexed write.

## 10. Internal and admin

| Method | Path | Purpose |
|---|---|---|
| POST | /internal/tick | Cron entry: due arrivals, repeats, quiet notices, turn prompts, weekly reads, retention; protected by a worker-internal secret |
| GET | /admin/families?q= | Search (admin allow-list; every read logged) |
| GET | /admin/families/:id | The family as the co-founder sees it: exchanges, AI outputs, quiet events, deliveries |
| GET | /admin/metrics?from=&to= | metrics_daily rollups |
| GET | /admin/ai-calls?call=&version= | Prompt outputs by version for evals |
| POST | /admin/flags | Feature flags |
| GET | /healthz | On the pilot Worker, as built (`apps/worker/src/app.ts`, `heartbeat.ts`): whether reconciliation is running, for the GitHub watchdog outside Cloudflare. It reads the time of the last successful reconcile from the `ReconcileHeartbeat` Durable Object and never touches the database. 200 `{status: "ok", lastReconcileAgeSeconds}` while that reconcile finished at most 35 minutes ago; otherwise 503 `{status: "stale"}`, or 503 `{status: "no_reconcile_yet"}` before the first. `cache-control: no-store`; no content and no ids; no authentication. There is no `/readyz` |

## 11. Core types (Zod, `packages/contracts`)

**Implemented foundation, 21 September 2026 (build plan 2.1, partial).** `packages/contracts/src/api.ts`, exported from the package root, provides `ApiErrorCode` and `ApiErrorBody` (the envelope in the conventions, with optional JSON-object `details`), `PageQuery`, `MemberLight`, `SetLight` (`{on: boolean}`), and `PauseMember` (`{paused: boolean}`), with inferred TypeScript types. The account/read slice in §1 additionally implements `ApiAccountProfile`, `ApiAccountPatch`, `ApiUser`, `ApiMe` and `ApiFamilyPlan`, the mutation plumbing `ApiIdempotencyKey` and `ApiMutationResponse`, and the linking shapes `ApiLinkChallenge`, `ApiLinkCode` and `ApiLinkOutcome`. These schemas alone expose no HTTP route and perform no authentication, membership, consent, or idempotency checks; the service and Worker boundaries enforce access separately. The remaining request/response shapes below are design sketches, not implemented exports.

`PageQuery` accepts HTTP query strings: optional nonempty opaque `cursor` and optional digits-only `limit`, parsed into a positive safe integer (`PageQueryInput` is the string-valued input type; `PageQuery` is the parsed type). Empty, fractional, signed, exponential and unsafe limits are rejected, as are unknown query fields. Omitted fields stay absent: endpoint-specific defaults, maximum page sizes, cursor encoding and cursor scoping must be implemented before any list route is exposed. The light and pause request bodies are strict and accept actual JSON booleans only. Response schemas strip undeclared fields; they do not sanitise text or error details, which callers must populate with deliberately public values only. `MemberLight` reuses the domain's `LightState`, `LocalDate` and `LocalTime`: usual time is `HH:MM`, dates must exist, timestamps include `Z` or a numeric offset, and nullable fields must be present explicitly.

```ts
export const Lang = z.enum(["en", "zh-TW", "ja", "de", "hi", "ru"]);
export const ExchangeType = z.enum(["question","photo_choice","voice_note","word","story","recipe","memory_photo","vote","hello"]);
export const ExchangeState = z.enum(["composed","scheduled","delivered","seen","answered","replied","read_back","archived","withdrawn"]);
export const LightState = z.enum(["resting","lit","quiet","away","paused","none"]);

export const MemberLight = z.object({
  member_id: z.uuid(), display_name: z.string(), state: LightState,
  answered_at: z.iso.datetime({ offset: true }).nullable(), usual_time: LocalTime.nullable(),
  away_until: LocalDate.nullable(), quiet_event_id: z.uuid().nullable(),
});

export const ComposeExchange = z.object({
  recipient_id: z.string().uuid(), type: ExchangeType,
  text: z.string().max(500).optional(), options: z.record(z.unknown()).optional(),
  media_ids: z.array(z.string().uuid()).max(2).default([]), voice_hello_id: z.string().uuid().optional(),
  when: z.enum(["tomorrow","date","whenever"]), date: z.string().date().optional(), on_behalf_of: z.string().max(60).optional(),
});

export const Answer = z.object({
  kind: z.enum(["voice","chip","photo_pick","vote","heart","text","fine"]),
  media_id: z.string().uuid().optional(), payload: z.record(z.unknown()).optional(),
});

export const Exchange = z.object({
  id: z.string().uuid(), family_id: z.string().uuid(), recipient: MemberLight.pick({member_id: true, display_name: true}),
  asker: z.object({member_id: z.string().uuid().nullable(), display_name: z.string(), on_behalf_of: z.string().nullable()}),
  type: ExchangeType, state: ExchangeState, text: z.string().nullable(), original: z.object({lang: Lang, text: z.string()}).nullable(),
  media: z.array(z.object({id: z.string().uuid(), kind: z.enum(["audio","image"]), url: z.string().url(), duration_ms: z.number().optional()})),
  scheduled_for: z.string().date().nullable(), delivered_at: z.string().datetime().nullable(), seen_at: z.string().datetime().nullable(),
  answer: z.object({kind: z.string(), transcript: z.string().nullable(), summary: z.string().nullable(), media: z.any().nullable(), received_at: z.string().datetime()}).nullable(),
  replies: z.array(z.object({member: z.string(), kind: z.string(), text: z.string().nullable(), media: z.any().nullable(), created_at: z.string().datetime()})),
  receipts: z.object({seen: z.string().datetime().nullable(), answered: z.string().datetime().nullable(), read_back: z.string().datetime().nullable()}),
});
```

## 12. Channel adapter contract (worker-internal)

```ts
export interface ChannelAdapter {
  readonly id: "line" | "whatsapp" | "telegram" | "voice" | "app";
  readonly capabilities: { buttons: boolean; voiceIn: boolean; voiceOut: boolean; readReceipts: boolean; images: boolean; templatesOutsideWindow: boolean };
  send(link: ChannelLink, msg: OutboundMessage): Promise<{ externalId: string }>;      // must be idempotent on msg.idempotencyKey
  verify(req: Request): Promise<boolean>;
  parse(req: Request): Promise<InboundEvent[]>;
  resolveIdentity(ev: InboundEvent): Promise<ChannelLink | null>;
}
export type OutboundMessage = {
  kind: "arrival" | "repeat" | "ack" | "consent" | "nearby_ask" | "system";
  text: string; lang: Lang; media?: MediaRef[]; voice?: MediaRef; buttons?: { id: string; label: string }[];
  idempotencyKey: string; exchangeId?: string;
};
export type InboundEvent = {
  channel: ChannelAdapter["id"]; externalUserId: string; externalMessageId: string; at: string;
  kind: "text" | "voice" | "image" | "sticker" | "button" | "reaction" | "read" | "follow" | "unfollow" | "blocked" | "dtmf";
  payload: { text?: string; buttonId?: string; mediaUrl?: string; mime?: string; durationMs?: number; reaction?: string; digit?: string };
};
```

Deviations recorded per adapter in `architecture/02-technical-architecture-v2.md` §6.
