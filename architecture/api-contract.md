# API contract, v2

2026-09-25 (written 2026-09-13; §10's health check revised 2026-09-18 to the pilot Worker as built; shared schemas and the unmounted access-control foundation added 2026-09-21; durable mutation receipts added locally 2026-09-22; account linking by proof of the Telegram account, its migration, and the contention drill's findings 2026-09-23; mounted on the pilot Worker under `/v1`, on in development and staging and off in production, 2026-09-25, its staging deploy pending (ADR-29)). The contract between the Expo app (and the web admin) and the worker, plus the inbound webhooks. Every endpoint maps to spec v2 (`product/05-product-spec-v2.md`); every request and response is a Zod schema in `packages/contracts`, shared by the worker and the app, so a change breaks the build before it breaks a family.

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

Implemented and tested; from 25 September 2026 **served by the pilot Worker under `/v1`** wherever its `API_V1` is `on` (§ "Where the API runs"):

- `apps/worker/src/session.ts` exposes `createClerkSessionVerifier(options)`. Its caller supplies a trusted HTTPS issuer origin, an explicit list of authorized application origins, optional audience, and an explicit native-client opt-in for tokens without `azp`. The pilot Worker supplies the issuer from its var `CLERK_ISSUER`, lists no authorized parties and sets the native-client opt-in, so any request carrying `Origin` is refused. Use one verifier per configured issuer per isolate; do not construct it from request headers or token claims.
- Verification uses the pinned `jose` dependency and only the configured issuer's `/.well-known/jwks.json`: redirects are not followed, key requests time out after 5 seconds, keys are cached for 10 minutes, and unknown key IDs trigger a refresh only after a 30-second cooldown. Token-supplied `jku` and `jwk` do not choose the verification keys. Only an `Authorization: Bearer` token is read; cookies, query parameters and Cloudflare Access headers are not alternatives, even in development.
- The verifier requires RS256, JWT type, a nonblank key ID, issuer, subject, session ID, version 2 and integer `iat`, `nbf`, `exp` claims. Vela accepts at most a 120-second token lifetime and age with 5 seconds of clock skew. Pending or unknown session statuses are rejected; absent `sts` or `active` is accepted. `aud` is checked when configured, because ordinary Clerk session tokens do not require an audience. The result contains only `{authSubject, sessionId}`, never the token, email or claimed family role.
- If `azp` exists it must exactly match an allowed application origin. If the HTTP request includes `Origin`, it must both be allowed and equal the token's `azp`; two allowed origins cannot substitute for each other. Application origins must use HTTPS unless `allowLocalHttpParties` is explicitly true for loopback development origins only (`localhost`, `127.0.0.1`, `[::1]`); the issuer always requires HTTPS. Missing `azp` is refused unless `allowMissingAuthorizedParty` is explicitly true, and is still refused when the request carries an `Origin`. This permits native Expo bearer requests without weakening the default browser policy; it is not device attestation. Invalid tokens return no identity. Key-service or verification infrastructure failures throw `SessionVerificationUnavailable` without token or provider error details, rather than being misreported as a bad login.
- `packages/services/src/api-access.ts` exposes `authorizeFamilyAccess(dbOrTransaction, identity, familyId, requiredRole?)`. It joins `users.auth_subject` to `members.user_id` and the requested family, accepting only a non-deleted account, a non-deleted family, and an active or paused membership with no `left_at`. Pausing the light must not prevent reading the family or resuming it. Invited, left, deceased, Telegram-only/unmapped and cross-family callers receive the same `not_found` result. An eligible member lacking the server-required organiser role receives `forbidden`; a grant contains only the database's user, member and family IDs and role. There is no automatic account creation, email/phone linking or authorization cache.
- `apps/worker/src/api-security.ts` supplies reusable Hono authentication and family-authorization middleware. Authentication runs first; family authorization takes the family ID from the route's `:familyId`, not the body, query or headers. Missing/invalid identity is 401, nonmembership/missing family is 404, and a role refusal is 403, using the public error envelope; protected responses carry `Cache-Control: no-store`. Register the API's error handler through `withApiErrorNoStore(handler)` as well: it forces that header on the handler's returned response, including raw responses from failures inside the authentication middleware itself. The wrapper controls caching, not the error payload; the handler must return sanitized public errors. Operational failures propagate to the API error handler, not to a success or authentication refusal; the isolated read API below now supplies that handler. The middleware is tested in an isolated Hono app only; it exposes no new live route.

**Before production turns the API on** (from 25 September 2026 the configuration turns it on for development and staging, with the development Clerk instance, the online session checker and the admission limits of ADR-29; the items below that remain are still gates for production): configure and smoke-test the real Clerk issuer/client, wire and smoke-test the optional account-write capability and its online session checker, integrate verified lifecycle events and gateway rate limits, expose the proof-of-ownership account linking that §"Account linking" below now implements, and add the remaining endpoint-specific authorization and consent checks. Membership is not permission to operate on every nested resource: each query must constrain target member/exchange/media IDs to the authorized family. Mutations must recheck authorization and relevant state within their transaction, with locking where concurrent changes require it. Cryptographic verification alone does not check session revocation with Clerk; a revoked session's still-valid JWT can survive until expiry. Sensitive operations need an online session check or a revocation mechanism before exposure. Production and the existing Telegram/admin paths are unchanged.

Clerk references checked for this implementation: [manual verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification), [session claims](https://clerk.com/docs/guides/sessions/session-tokens).

### Where the API runs (25 September 2026, ADR-29)

The pilot Worker `vela` serves every path under `/v1` wherever its `API_V1` is `on`: in development, and in staging at `https://vela.vela-light-staging.workers.dev/v1/…`. Staging deploy: waits for the founder's key rotation and staging migrations 0001–0002 (infra/README.md §9a). Production's `API_V1` is `off`, so `/v1` answers 404 there and reads no Clerk setting. The API is dispatched before the pilot's routes and checks its own configuration: an unknown `API_V1`; outside development, a `PLACEHOLDER_` value in any variable or secret (the pilot's included, since it means the environment's setup is not finished); a missing or non-https `CLERK_ISSUER` or one with a path; an issuer or `CLERK_SECRET_KEY` of the wrong Clerk instance for the environment (development and staging: `*.clerk.accounts.dev` and `sk_test_`; production: neither, and `sk_live_`); a key without a Clerk secret key's shape; or, outside development, a missing rate-limit binding answers 503 `unavailable` and logs `api_config_refused` with the variable's name only; so does an app that fails to build. Staging requires the secret key, so its writes, the live session check and `POST /v1/families` are always served; development without a key serves reads only. Admission: at most 120 requests a minute per client address (per /64 for IPv6), checked after the configuration check and the off switch and before the app, and 20 writes a minute per account, checked after the body is validated and before the live session check. Either answers 429 `rate_limited`, the first with `Retry-After: 60` and the second without one, and neither writes a log line; a limiter that fails is skipped and logged as `api_rate_limit_failed`. A request carrying `Origin`, or a token carrying `azp`, is 401; `OPTIONS` is 404 and no `Access-Control-` header is sent. Each request that passes authentication and needs the database opens one connection through the environment's Hyperdrive and closes it before answering. A write's outbound rows are handed to the environment's outbound queue and its wakes to the member's scheduler after the commit. The API has no health route of its own: `GET /v1/me` without a token answering 401 shows it is mounted and configured, which is what the setup script's `check` step asks.

### Account provisioning and read APIs (21 September 2026)

`apps/worker/src/api-app.ts` implements `createApiApp(runtime)`, an isolated Hono app whose default configuration has exactly two read routes: `GET /v1/me` and `GET /v1/families/:familyId/plan`. The pilot Worker has mounted it under `/v1` since 25 September 2026 (§ "Where the API runs"); the admin Worker does not. Its two migrations, `0001_api_request_receipts` and `0002_account_linking`, are in the repository and have not been applied to staging or production yet: staging's come before its deploy (infra/README.md §9a). Unsupported methods (including HEAD) and unknown paths return 404 without opening the database.

`ApiRuntime` supplies the session verifier, a database-handle factory, the three read/access services and an error logger. Authentication runs before a matched read route opens a database; the request opens one handle and awaits its `close()` in `finally` on success, denial or failure. A cleanup failure logs `api_database_close_failed` with an error label only; it does not overwrite the original response or request error. The API does not construct Telegram, AI, speech, media, queue or scheduler ports. The family route uses the family guard, and the read service repeats its access conditions in the data query, so a grant cached earlier in the request is not sufficient. Responses are parsed through the shared schemas, which strip undeclared fields. All responses use `no-store`. The error boundary returns generic JSON: 503 `unavailable` for `SessionVerificationUnavailable`, 500 `internal` for other unexpected failures, including invalid service output. Only `errorLabel(error)` is logged, never the raw error, path, query, token or profile.

- **Explicit provisioning, internal only:** `provisionApiUser(dbOrTransaction, verifiedIdentity, profile)` in `packages/services/src/api-accounts.ts` accepts `ApiAccountProfile`: `{display_name, language, tz}`. The name is trimmed and must contain 1–80 characters; the language and IANA zone use the shared domain schemas. Unknown fields, including identity, role, email, phone and member IDs, are rejected. The subject comes only from the verified identity. An insert conflicts only on `users.auth_subject`: the first profile and UUID win, and repeats or racing calls return that existing live account unchanged. A retained soft-deleted account is not resurrected. Provisioning neither creates a family/membership nor attaches any Telegram member; no GET calls it. The optional HTTP provisioning route below calls the receipt-backed wrapper instead of exposing this low-level helper directly. Concurrent insert/reselect uses PostgreSQL's default READ COMMITTED behavior; callers choosing stronger transaction isolation must handle serialization failures by retrying the whole transaction.
- **`GET /v1/me`:** `loadApiMe` returns `ApiMe`, `{user: {id, display_name, language, tz}, memberships: [{member_id, role, status, family: {id, name, region, plan}}]}`. One SELECT uses the exact subject and excludes deleted accounts, non-active/non-paused or departed memberships, and deleted families. Memberships are ordered by their creation time then ID. An existing account with no eligible membership gets an empty list; an unmapped or deleted account gets 404 `not_found`, with no creation or mutation. Auth subjects, session IDs, email, phone and other members' private fields are not returned.
- **`GET /v1/families/:familyId/plan`:** `loadApiFamilyPlan` returns `ApiFamilyPlan`, `{family_id, plan, subscriptions: [{member_id, status, trial_ends_at, current_period_end, grace_until}]}`. Ordinary eligible members may read it. The query checks the caller's live membership and account, the family's deletion state, and both the subscription's family and its covered member's family. Only active/paused covered members without a departure time are included. Missing/nonmember/deleted callers share 404. An authorized family with no visible subscription rows gets an empty list, not an invented subscription status. Dates are ISO instants or explicit nulls. These are stored plan/status records, not computed billing entitlements; no trial is started and no expired status is rewritten. Provider, external subscription, payer, currency and price fields stay private.

`SubscriptionStatus` and `SUBSCRIPTION_STATUSES` now live in `@vela/contracts` and the database re-exports the same tuple. Its values and SQL CHECK remain unchanged. Linking an existing channel member goes only through the proof-of-ownership challenge below; neither matching profile text nor guessing a member ID grants membership.

### Opt-in account writes and lifecycle (22 September 2026; served by the pilot Worker from 25 September 2026, not deployed yet)

Only when `ApiRuntime.writes` is supplied does the isolated API register `POST /v1/me/provision` and `PATCH /v1/me`. That capability requires a clock, the two write services and an online `SessionActivityChecker`. Without it, writes still return 404. The pilot Worker supplies it wherever the API is on and `CLERK_SECRET_KEY` is set: always in staging, which requires the key, and in development when one is given; the admin Worker never serves the API.

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

Before production's account writes are enabled, apply the migrations there, configure its Clerk production instance and add its two `ratelimits` bindings (staging has both, with the development instance), wire verified disable/deletion lifecycle handling, review the notices/sub-processors, and run the provider smoke checks. The multi-connection PostgreSQL contention drill is done (§ "Durable mutation receipts" below).

### The lights of a family (23 September 2026)

`GET /v1/families/:familyId/lights` answers `MemberLight[]` for the caller's family: one row per kept-light member, read in that member's own local day. `loadApiLights` in `packages/services/src/api-lights.ts` takes the family authorization every other family read takes, then derives each state in this order: a paused member is `paused`, an unended away period covering her day is `away` with the day it ends, the day's exchange having an answer is `lit` with the time she answered, an unresolved quiet event on that exchange is `quiet` with its id, and anything else is `resting`. `usual_time` is her arrival time. After the kept-light members come those still **invited** — made by onboarding, not yet answered — with the state `none`: her light does not exist until she says yes, so she has no state of her own, but the organiser who has just set her up should not find an empty Today. Nothing is asked of her and nothing is scheduled; composing to her is refused until she says yes. A stranger, a family that is not the caller's and an unknown family all answer 404. The route is served wherever the API is (§ "Where the API runs").

### The Today screen (23 September 2026)

`GET /v1/families/:familyId/today` answers `ApiToday` for the caller’s family: `lights` exactly as the lights route answers them, `exchanges` with one entry per kept-light member who has an exchange in her own local day, and `tomorrow` with one entry per kept-light member whose next local day already holds a turn. `loadApiToday` in `packages/services/src/api-today.ts` takes the same family authorization and reads every day in the member’s own time zone, so a family spread across zones sees each person’s day and not the caller’s.

An exchange carries the asker’s name (null for Vela’s own hello, and for an ask whose asker was deleted), the ask, her latest answer with the time it arrived, the replies in the order they were written, and `seen_at` for the receipt chip. Her words are read as the read-back reads them: the transcript, else the text of what she wrote, else the choice she tapped, else the summary — so an answer that carried no words comes back with `text: null` and its kind, and the reader decides what to call it. A turn carries the holder (null when nobody holds turns, or the holder has left), the ask already composed for that morning, and a suggestion — never both of the last two, because a morning holds one ask and offering a second would invite a 409. A `turns` row exists only once the evening prompt has run, so an entry is returned whenever there is a turn row **or** an ask; an ask composed before the prompt would otherwise leave the asker with nothing to show for it (spec A7: composing "returns to Today with the tomorrow card updated"). Suggestions still have no writer, so that field is null outside tests.

A stranger, a family that is not the caller’s and an unknown family all answer 404. The route is served by the pilot Worker under `/v1` wherever the API is on (§ "Where the API runs"), and on a developer’s own machine by `apps/worker/scripts/api-dev.ts` for the app to read (infra/README.md, section 9a).

### Composing an ask (23 September 2026)

`POST /v1/families/:familyId/exchanges` is the first write a family makes. It takes `ComposeAsk` — `recipient_id`, `type`, `text`, `when` (`tomorrow`, `date` or `whenever`), `date` for a `date` ask, `vote_options` for a vote, and `on_behalf_of` — and answers 201 with `ApiComposedAsk`. `composeApiAsk` in `packages/services/src/api-asks.ts` runs it through `runApiMutation` as `exchange.compose:v1`, scoped to the family and the recipient, so a repeat replays the first answer and writes no second ask.

Only the types an arrival can carry from words alone are accepted: `question`, `word`, `story`, `recipe` and `vote`. A photo choice, a voice note and an old photo need media the app cannot yet attach, so they are refused rather than stored undeliverable. Family ownership is no longer the obstacle: `mediaByIds` takes the recipient's family and cannot return another family's row, dropping an id the family does not own and logging it as `media_outside_family`. Once the app can attach a file, `media_ids` can be accepted here — what is missing is the upload path, not the check.

Every date is the recipient's own local day. `tomorrow` is her next morning, a `date` ask must name a day after today and no more than 14 days ahead — retention clears an undelivered ask's words after 30 days, so nothing may be composed into that — and `whenever` carries no date at all. The one-ask-per-day rule is held by the recipient's member row, locked `for update` as the mutation's first statement, which is the lock `prepareDay` and the Telegram compose path take; `exchanges_one_per_day` stays the backstop whose firing is an incident, never a control path.

Two people in one family reaching for the same morning are different actors, so their actor advisory locks never meet and that row lock is the only thing between them — which the PGlite tests, on one connection, cannot prove. `packages/services/postgres-tests/api-compose-race.test.ts` puts both composes on her row through a third connection that holds it, then lets go: one gets 201, the other the 409 above naming the winner, and `exchanges_one_per_day` must not fire. A second race takes two different mornings, so the lock is shown to serialise without inventing a conflict. Both passed on PostgreSQL 18.6 on 24 September, in the whole drill's 36 tests. `pg_blocking_pids` names only a backend's direct blocker, so the second compose queues behind the first and not behind the holder; a race test that starts both at once leaves the queue order, and with it the winner, to chance.

A day already claimed answers **409** whose `details` are `{taken_by, date_alternative}`: who holds that morning (Vela when it is her own fallback hello) and the next one nobody holds within the window, or null. That is what A7 needs to say "Anna already has tomorrow morning" and offer the day after or whenever. The caller must be a live member of the family, and the recipient a kept-light member who is active and has not left; a stranger, another family, a paused recipient and an unknown family all answer 404.

**The family group hears when tomorrow is taken** (24 September 2026). When the ask claims her next morning and the family has a linked Telegram group, the mutation writes one queued `system` row to that group — `group.ask_from_app`, "Mia asked Mom something for tomorrow morning." — with the asker as its member and the ask as its exchange, and returns it in `AfterCommit`; the route hands it to the queue once the transaction has committed, and `reconcile` sends it if that fails ("The quiet notice", After the commit). It never carries the ask's words, which are hers to hear first. A later morning or a whenever ask says nothing yet, and a replay says nothing again. The pilot Worker serves the route wherever the API's writes are on and hands the group's row to its outbound queue at once; `api-dev.ts` serves it only when a Clerk secret key is present, because a write needs the live session check that only Clerk's backend can make.

### The Exchanges list (24 September 2026)

`GET /v1/families/:familyId/exchanges` answers `ApiExchangePage`: the same card Today shows, with the day it was for and the moment it arrived, newest first. `loadApiExchanges` in `packages/services/src/api-exchanges.ts` takes the same family authorization the other family reads take, and puts the family in the query itself: membership is not permission to read a nested id.

Only days that happened. An ask still waiting for its morning belongs on Today's tomorrow card, and a withdrawn one belongs nowhere, so the list carries only exchanges that were delivered. It reaches back `EXCHANGE_LIST_DAYS` (30) days and then stops, which is where the family book takes over (spec A8) — and is also where retention clears an exchange's words, so a longer list would be a list of blanks. That floor is applied to **every** page, not only the first, so a cursor invented by a caller cannot walk past the end the route promises.

Paging is on `exchanges.id`, which is uuidv7 and so already in the order the list reads. `scheduled_for` cannot carry a cursor: it is nullable, its index is `desc nulls first`, and two exchanges in one family can share a day, so it has no total order. A cursor that is not a uuid is ignored rather than trusted. `next_cursor` is null at the end.

The route is a read, so it needs no write capability and is served whether or not a Clerk secret key is present — unlike composing, which needs the live session check.

### Replying (24 September 2026)

`POST /v1/exchanges/:exchangeId/replies` takes `ComposeReply` — `{text}`, one to 1,000 characters of valid text — and answers 201 with `ApiReply`. `replyToApiExchange` in `packages/services/src/api-replies.ts` runs it through `runApiMutation` as `exchange.reply:v1`, with the exchange id in the fingerprint, so one key cannot be spent on two exchanges.

**Words only.** A heart, a laugh or a hug is the same `replies` row a Telegram reaction writes, and the Telegram path makes a member's reactions *equal* to their platform set — deleting any of that member's reaction rows it does not see, whatever their channel — while `replies_one_reaction_idx` has no channel column. An app reaction would vanish the next time that member reacted in the group, or collide with the reaction they already made there.

**Authorization comes from the exchange.** The path names no family, so no family middleware runs: the service locks the exchange `for update` in `authorize` — which `runApiMutation` runs on every attempt, a replay included — reads its family, and checks the caller is a live member of it. An exchange that does not exist, belongs to another family, was withdrawn, never reached her, or is older than the Exchanges list's thirty days all answer 404 alike, and so does a family that has ended. The same row lock serialises two members replying at once, which the actor lock does not, and the state is re-read under it before the transition, so a reply after the read-back leaves `read_back` where it is and `replied_at` keeps the first reply's time. `postgres-tests/api-reply-race.test.ts` proves it: two members' replies queued on the exchange row, a minute apart on their own clocks, leave both replies and the earlier time. The clocks are the point — `replied` plus a reply is `replied` again, so the state cannot show a lost update, and on one shared clock an overwrite writes the same instant it replaces; with `?? now` removed, the test sees the later time.

**Two refusals** carry `details.reason`: `not_answered` (409) when she has not answered yet, so there is nothing to reply to; and `her_own` (403) when the caller is the kept-light member herself — she may hold an account, and her own reply would be read back to her by name the next morning. The Telegram path keeps an early reply and logs a warning; this service has no logger, so it refuses instead.

**Which replies she hears.** Her next arrival reads back only her latest delivered exchange (`loadReadBack`), so a reply to any older one is kept for the family and never heard. Every card on Today and in the list carries `replies_reach_her`, and every reply `reaches_her`, computed by `readBackExchangeId` in `repo.ts` with the same selection; the app words the composer from it rather than promising a read-back it cannot keep. One window remains: the arrival captures its reply ids when it is enqueued and stamps them when it is sent, so a reply written in the seconds between the two is neither read back nor, the day after, still on her latest exchange.

The mutation sends nothing and wakes nothing — a reply reaches her through the next arrival, which reads the database. It needs the write capability, like composing.

### Creating a family (24 September 2026)

`POST /v1/families` takes `CreateFamily` — a two-letter `country` and `kept_light_member`: `display_name`, `address_form`, `language`, `tz`, `wake_time` — and answers 201 with `ApiCreatedFamily`: the family, the organiser's member id, her invited member with the arrival time half an hour after she wakes, and her invite: the link, when it expires, and `invite.text`, the words the organiser sends her, in her language (spec A4, copy key `invite.for_her`). `createApiFamily` in `packages/services/src/api-families.ts` runs as `family.create:v1`.

**The same rows Telegram onboarding writes**, through the same helpers (`insertInvitedMember`, `insertInvite`, `regionForCountry`): the family, the caller as organiser (`primary_surface` `app`, linked to the account), and her as an **invited** kept-light member — light off, not consented, out of the turn rotation — with a single-use invite good for a week. Nothing about her is consented here. The link opens the bot, which reads her `consent.request` and records her answer exactly as it does for a family made in Telegram; a test runs that flow against an app-made family, and until she says yes nobody may ask her anything.

The caller's account must exist first (`POST /v1/me/provision`), because the organiser's name, language and time zone come from it; a caller without one gets 404. An account that already runs a family gets **409** with `details.reason` `already_organiser`: the app shows one family, and a second would sit behind it with nothing to reach it by until there is a family switcher. That check is made in `mutate`, not `authorize`: `authorize` runs again on a replay, when the caller already *is* this family's organiser, and would refuse the replay its own answer. **No constraint backs it**: `members_family_id_user_id_key` keeps one account out of one family twice, not out of two families, so the rule is exactly as good as that check and the actor lock that runs one create at a time. `postgres-tests/api-family-create-race.test.ts` queues two creates from one account, with two keys, on that lock: one family, and a refusal that leaves no family, member, invite or event behind. With the check removed, the same test makes two families.

A1's age, city and "lives alone" are not asked: nothing stores or uses them, and the privacy notice does not cover them. The response carries the invite token, so the receipt that replays it holds the token for its 24 hours; it is never logged. The route needs the write capability and a family capability of its own — a token source and the bot the link opens — and answers 404 without them.

### The family (24 September 2026)

`GET /v1/families/:familyId` answers `ApiFamily`, what You shows (spec A12): the family's name and plan; `me`, the caller's member id and role; every live member — invited, active or paused, never one who has left — in the order they joined, each with a `light` of `on`, `waiting` (invited and not yet answered, which is how onboarding leaves a kept-light member, and how the lights row reads her) or `off`, and, where a subscription covers them, its status, trial end and period end; and `nearby`, the people who could look in, each with the member they are near and `consent` `yes`, `no` or `waiting`. `loadApiFamily` in `packages/services/src/api-family.ts` takes the same family authorization as the other family reads.

**The people nearby are for the organisers**, who set them up; anyone else gets `nearby: null`. **No number is in it**, for anyone: a number is given only in the quiet notice, to the people the notice is for. A contact near a member who has left is not listed. Prices are not in it either — the plan card is A13's, and nothing charges yet. A stranger, a family that is not the caller's and an unknown family all answer 404.

### Starting the trial (24 September 2026)

`POST /v1/families/:familyId/plan/trial` takes `StartTrial` — `{member_id}`, the kept-light member it covers — and answers 200 with `ApiTrial`: her member id, the subscription's status and when the trial ends. `startApiTrial` in `packages/services/src/api-trial.ts` runs it as `plan.trial:v1`, for the family's **organisers only**, since the one who pays is an organiser.

Her member row is locked first, the lock her arrivals and asks take, so two organisers starting at once make one trial. With no subscription yet, it writes one: provider `trial`, status `trial`, `trial_ends_at` thirty days on (`TRIAL_DAYS`), the caller's account as payer, no price and no interval; and records `trial_started`. A member who already has a subscription, in any state, is answered with it as it stands, so there is one trial per kept-light member. Two refusals, 409 with `details.reason`: `not_answered_yet` before her first answer (spec §16: the trial is "30 days after her first answer") and `light_off` when her light is not on. A member of another family, or one who has left, answers 404; her membership is checked in `authorize`, before the mutation helper's own scope check, whose refusal is not a 404.

**Nothing is charged or gated.** The pilot is free (spec Appendix A), no service checks the plan, and `families.plan` is left as it is: nothing would turn it back when the trial ends, because nothing ends a trial yet. The subscription row carries it, and `GET /v1/families/:id` shows it on You. Lapse, grace and checkout wait for billing.

### Pausing and leaving (24 September 2026)

`POST /v1/families/:familyId/members/:memberId/pause` takes `PauseMember` — `{paused}` — and answers 200 with `ApiMemberPause`, the member's status after it. `POST /v1/families/:familyId/members/:memberId/left` takes an empty body (`LeaveFamily`) and answers 200 with `ApiLeft`, the member and when they left. `pauseApiMember` and `leaveApiFamily` in `packages/services/src/api-members.ts` run them as `member.pause:v1` and `member.leave:v1`.

**Only one's own membership.** A member id that is not the caller's answers 404, as an unknown one does. Pausing an organiser's parent is not this route: she pauses in her own chat, and a family's absence is away mode (§5).

**What they do.** A paused member holds no turns — the rotation takes active members only — and a paused organiser is not sent the quiet notice, which goes to active organisers. Resuming makes them active again. Leaving sets `left`, `left_at` and `turns_in` false, as the founder's `mark_left` does, records `member_left` with `source: "app"`, and retention deletes the membership thirty days on. Asking for the state one is already in answers it as it stands. Pausing records no event: the events table's check names no pause, and adding one is a migration.

**Two refusals**, both 409 with `details.reason`: `last_organiser` when the caller organises the family and no other organiser is active — someone must still be told when her light goes quiet, so neither a pause nor a leave may take the last one away, and a paused organiser does not count; and `kept_light` when the caller keeps a light, whose pause and stop go through her own chat, where her arrivals, her health-words yes and her schedule are handled together (flows §3.13). The family's organiser rows are locked in id order before the caller's own, so two organisers pausing at once queue, and the second sees that the first is paused.

**Leave authorizes itself.** Once the caller has left they are no longer a live member, so the family check would refuse the replay of the very leave that made them one. The route has no family middleware; `authorize` accepts the caller's own row in a family that still exists whether it is live or left, and a later leave answers the time they left. The app clears everything it has read when a leave succeeds, and `/v1/me` then lists no family, so Today sends the reader to onboarding.

### The quiet notice (24 September 2026)

`GET /v1/quiet/:quietEventId` answers `ApiQuietNotice`: whose light it is, when today's ask reached her and when it was asked again, her usual answering time once there are enough answers to know it, when she last answered, when the event opened, `wait_until`, `resolved` (the outcome, when, and who said she was fine), and the people nearby who have said yes, with their numbers. Facts only — never her words. `loadApiQuiet` in `packages/services/src/api-quiet.ts` reads the family from the event, since the path names none, and answers **the family's organisers only**, as the Telegram notice goes only to them: the numbers are given to the people the notice is for. Anyone else, an event that does not exist and an id that is not a uuid all answer 404 alike.

`POST /v1/quiet/:quietEventId/fine` and `/wait` take an empty body (`QuietAction`) and answer 200 with `ApiQuietState` — the notice without its contacts. `resolveApiQuiet` runs them as `quiet.fine:v1` and `quiet.wait:v1` through the functions the Telegram buttons use (`resolveQuietAsFine`, `waitOnQuiet` in `quiet.ts`), so the two surfaces cannot close or delay an event differently. The event is locked `for update` in `authorize`, so a 404 is decided on every attempt including a replay. An event already settled — she answered a moment before the tap, or another organiser said she is fine — is answered as it stands rather than refused: the tap has nothing left to do, and the sheet shows how it was settled. The answer leaves out the contacts because it is kept a day to replay, and a number must not outlive the yes that let the family have it.

**A deadlock with her answer, found and fixed (24 September 2026).** Her answer and the quiet detector lock the exchange and then its quiet event; "she's fine" — here and on the Telegram button — locks the event and then writes the others' messages as outbound rows whose foreign key is that exchange, and each such insert takes `for key share` on it. While the exchange was locked `for update`, that closed a cycle, and PostgreSQL broke it by aborting one side: in the contention drill, **her answer** when it met a tap, and the detector when it did. Her answer was not lost — `handleInbound` rethrows, the webhook answers 500 and Telegram delivers the update again — but it was late by Telegram's retry, with an `inbound_failed` error on the one path that must never look broken, and a tap that lost to the detector answered the organiser 500. Both exchange locks are now `for no key update`, which still excludes every other writer of the row and admits only foreign-key checks; nothing on those paths deletes an exchange or changes its id. `postgres-tests/quiet-notice-race.test.ts` holds both races, fails on the old lock with SQLSTATE 40P01, and also covers her answer winning (the tap shows `answered_late` and sends nothing) and two organisers tapping at once (one close, one message to the other).

**After the commit.** "She's fine" tells everyone else who was told, and "wait" moves her scheduler's alarm; a mutation may not send a queue job or reach the scheduler, because both would outlive a rollback. So the mutation writes the messages as `queued` outbound rows (`insertOutbound`, the row half of `enqueueOutbound`) and marks her wake due, and returns an `AfterCommit` — the row ids and the members to wake — which the route hands to `runAfterCommit` once the transaction has committed. A replay returns nothing to do. If the handover fails, or the runtime has no `nudges` (the local `api:dev` server has none), nothing is lost: `reconcile` re-drives an outbound row still queued after ten minutes and ticks a member whose wake is overdue. The failure is logged as `api_after_commit_deliver_failed` or `api_after_commit_wake_failed` and the route still answers 200, since the write stands.

A quiet event opened during the learning period notifies nobody for its first eight hours, but it is a row like any other, so the light reads `quiet` and the app's organisers see the sheet at once: that is the in-app-only quiet the spec asks for. **Not built:** `ask-to-check`, which sends a nearby ask in the caller's name and so needs the actor stamp, and `useful`. The app shows Call beside each contact and no "Ask them to look in" until it is.

### Durable mutation receipts (22 September 2026; served by the pilot Worker from 25 September 2026, not deployed yet)

`runApiMutation` in `packages/services/src/api-idempotency.ts` provides database-only replay protection. The API's write routes call it, on the pilot Worker and locally; no deployed Worker serves them yet. Migration `0001_api_request_receipts` adds the receipt table; apply it before deploying the updated retention job. `0002_account_linking` follows it with `account_link_challenges` and the `account_linked` event name. The applied `0000_init` is unchanged, and no migration has been run against staging or production for this slice.

- The caller supplies a verified `SessionIdentity`, an opaque key, a server-owned versioned operation identifier, validated JSON input including every write-affecting argument, and optional family/member scopes. `ApiIdempotencyKey` accepts 1–200 ASCII letters, digits, `.`, `_`, `:`, `-`; clients should generate a new unpredictable key per logical mutation. A member scope requires its family. Canonical JSON sorts object keys, preserves array order, rejects non-JSON values and cycles, and bounds nesting to 32 and the complete fingerprint envelope to 16 KiB. The receipt stores SHA-256 hashes of the exact auth subject, key and envelope, not their raw values. Session IDs do not scope the key, so refreshing a session does not repeat a mutation. These hashes are pseudonymous data, not anonymization.
- One transaction first takes the actor advisory lock, then reserves the actor/key pair through its unique constraint, or locks the existing row after a concurrent request completes. The mandatory `authorize(tx)` callback runs after the reservation/lock on every attempt, including replay and conflict, before any saved response is returned. It must perform current account, membership, ownership and consent checks, with locks where concurrent permission changes require them; it must not make business changes. The helper additionally verifies a supplied member belongs to its family.
- For an unexpired receipt, the same fingerprint returns the original saved success result without calling `mutate(tx)`. A different operation, input or scope under that actor/key raises `ApiIdempotencyError` with `conflict`. A committed incomplete or invalid saved result fails closed rather than executing again. If concurrent cleanup leaves no receipt to lock, the helper reports `unavailable` without running the mutation.
- A new or expired receipt runs `mutate(tx)` once, then saves its result in the same transaction. Authorization, mutation, response-validation and receipt-write failures roll everything back. The supported `ApiMutationResponse` is `{status, body}` with status 200, 201, 202 or 204; 204 requires a null body. Saved JSON is limited to 16 KiB and copied before returning. Headers, cookies and error responses are not cached. The replay window is 24 hours from successful completion and is not extended by replay; at expiry the key is treated as a new request, whether or not nightly cleanup has removed its old row. Clients must not rely on deduplication beyond that window.
- Callbacks may write only through the supplied transaction, including durable outbox rows. No external requests or queue sends belong inside the callback: rollback cannot undo them. In particular, the existing `enqueueOutbound` also sends a queue job, so it must not be used as an atomic database-only callback without separating that send. Dispatch happens after commit with the gateway's existing deduplication/redrive rules.
- Under the actor lock, authorized requests also remove expired other receipts for that actor, preserving the current row for expiry reuse. At most 1,000 receipts per actor may remain for a new mutation; excess attempts roll back with `rate_limited` before mutation. Matching unexpired replays remain available at capacity, and other actors are independent. This storage bound is not a gateway request-rate limit: the per-address and per-account admission limits of § "Where the API runs" run before the provider call.
- The nightly retention job deletes receipts whose `expires_at <= now` and records only their count. It selects them `for update skip locked`, so it never waits for a request that holds one: a request reusing an expired receipt holds that row while it deletes the actor's other expired rows, and a job that waited would close a lock cycle, which PostgreSQL breaks by aborting one side, the night's remaining rules or the family's write (found by the contention drill, fixed 23 September 2026). A row a request holds is deleted the next night, inside the same 48-hour window. With healthy nightly execution, physical deletion is within 48 hours of completion; expiry and physical deletion are different. Family/member foreign keys cascade when their scoped rows are physically deleted, ending that receipt's replay retention early; current authorization and scope checks must reject retries for erased resources. Callers must attach the correct scopes for all data returned; mutations that remove their own receipt through a cascade are rejected/rolled back, not silently committed without replay protection.

**Before a write endpoint uses receipts:** wire header/error handling (400 `invalid`, 409 `conflict`, 503 `unavailable`), implement its authorization and ownership proof, and review its exact response fields. Account deletion must purge actor-scoped receipts, and resource-creation/deletion flows must handle associations to newly created resources and deletion of cached personal data explicitly; those lifecycle integrations are not supplied by this generic helper. Never cache session credentials or provider secrets. Signed media URLs, checkout/provider actions and other external effects need endpoint-specific handling, not a claim that this transaction makes them exactly-once. Review/version the public notices before storing live response-cache data; the prospective data-map entry does not change the current pilot notice. PGlite tests exercise replay and rollback, but do not replace an independent multi-connection PostgreSQL contention drill before live writes. That drill now exists as `packages/services/postgres-tests` (code design §8), run with `pnpm --filter @vela/services run test:postgres` against a disposable PostgreSQL 18; on 24 September 2026 it passed whole on 18.6 through local binaries, and through Docker in CI, where the `contention-drill` job now runs it on every push. Its runner had hardcoded vitest's path inside this package's own `node_modules`, where pnpm no longer hoists it: the drill would not start in either the main checkout or a worktree until it was made to resolve vitest instead of guessing, so a drill reported green on 23 September could not be rerun on 24 September at all. It found the deadlock fixed below, and it is the check to rerun when this helper, the linking services or the retention job changes; linking's own races are in it too (§"Account linking" above).

## 2. Families and members

| Method | Path | Purpose |
|---|---|---|
| POST | /families | Create a family: `{name, country, kept_light_member: {display_name, address_form, language, tz, wake_time, city}}` → family, member rows, region set **Built**, see below |
| GET | /families/:id | Family, members with their light and plan, nearby contacts' consent (organisers only) **Built**, see §1 "The family" |
| PATCH | /families/:id | name, story_day, turns_enabled |
| DELETE | /families/:id | Schedules deletion within 24 h |
| POST | /families/:id/members | Add a member (self-invite accepted, or organiser adds a kept-light member) |
| PATCH | /families/:id/members/:mid | address_form, language, tz, wake_time, turns_in, primary_surface, role |
| POST | /families/:id/members/:mid/light | `{on: boolean}` — for oneself: consent implicit; for another: requires their consent flow |
| POST | /families/:id/members/:mid/pause | Pause or resume (`{paused: boolean}`) **Built for oneself**, see §1 "Pausing and leaving" |
| POST | /families/:id/members/:mid/left | Member leaves **Built for oneself**, see §1 "Pausing and leaving" |
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
| POST | /exchanges/:id/replies | `{kind: heart|laugh|hug|text|voice|photo, text?, media_id?}` **Built** for words, see below |
| POST | /exchanges/:id/read-back | Parent surface: she heard yesterday's replies |
| GET | /families/:id/suggestions?for=me | The turn holder's suggestion(s) for tomorrow |
| POST | /suggestions/:id/use | Marks used; returns a prefilled compose body |

## 5. The light and the quiet ladder

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/lights | Per kept-light member: state, answered_at, usual_time, quiet_event? (widget endpoint; cheap, cacheable 60 s) |
| GET | /quiet/:qid | The notice: facts, usual time, settled state, consenting nearby contacts with numbers; organisers only (built, §1 "The quiet notice") |
| POST | /quiet/:qid/fine | "She's fine, I know why" → resolves with outcome fine_known (built) |
| POST | /quiet/:qid/wait | Wait 2 hours (built) |
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
| POST | /families/:id/plan/trial | Start the 30 days (after her first answer) `{member_id}` **Built**, see §1 "Starting the trial" |
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
