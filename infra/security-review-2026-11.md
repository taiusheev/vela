# Security and privacy review, November 2026

Reviewed by Claude on 3 November 2026, from the code on `main` at `45ddddf`, a month and 284 commits after [the October review](security-review-2026-10.md). Same scope as October (every way into the two Workers and the public website), plus what arrived since: the photo box and Vela's drafted photo questions (ADR-61), memories and memory sharing, reminders, weekly support, the move of AI calls to OpenAI's newer models, and the `vela-light.com` domain bridge (`infra/site-domain`). It also checks that the privacy notice still matches what the code does. Research, not legal advice: the legal questions stay with counsel (`plan/materials/pilot/legal-memo.md`, "Questions for a lawyer").

## What holds

| Area | What was checked | Result |
|---|---|---|
| Family boundaries in the API | All 80 route definitions in `apps/worker/src/api-app.ts` (some register several paths). 20 check family membership in the route (`createFamilyAuthorization`); 4 are her phone's, by device token; the rest check inside the service, through `authorizeFamilyAccess` or a helper that calls it (`lockBoxPhoto`, `lockForOrganiser`, `lockPresentation`, `currentMember`, `access`). Each service named by a route was read for that check | No route found that lets one family read or change another's records. Unknown and forbidden answer the same 404 |
| Drafted photo questions (ADR-61) | `packages/services/src/photo-questions.ts` | Only a live member, only for a photo they uploaded or may change; 5 MiB cap; drafts filtered for health checks, surveillance words and gendered pronouns; the AI call log stores no input or output. `PHOTO_QUESTION_AI` is off in production and pinned there by `wrangler-config.test.ts`, with notice v15 still a draft: the guarding-family-data gate is being followed |
| Website | `SITE_CSP`, `SITE_SECURITY_HEADERS`, `_headers`, the bridge | Strict CSP with no outside origin and no inline script; HSTS, no framing, no sniffing, a narrow Permissions-Policy; cookies and Authorization stripped at the bridge; private routes refused there |
| Analytics | `apps/app/src/analytics/provider.tsx`, `site-analytics.ts` | Asked before anything is sent, per account; no identity before the choice; production collection inactive |
| Logs | Every `logger.*` and `console.*` call in Worker, services and packages | No message content, transcripts or tokens; errors by label. The only `error.message` prints are in local scripts and evals |
| Notice against code | Each provider in `infra/sub-processors.md` against both notices | Every provider that receives family data is named in both languages; PostHog, which only the website and app's optional counts use, is named on the website privacy page |
| The 30-day promise | Every sealed column in `packages/db/src/schema.ts` against `applyRetention` (`packages/services/src/jobs.ts`) | Each table holding family words is cleared by the nightly run, including those added since October (question profiles, weekly support, memory keeps and candidates, reminders, quiet events' ask-to-check). Kept on purpose, as their notices say: the photo box until taken out (ADR-58, v13; `releaseBoxPhotosOfLeavers` takes out a leaver's photos the same night) and book stories (ADR-39). Dead jobs go at 14 days. The `stories` table is never written |
| Website promises | `site-legal.ts`, `site-privacy.ts`, the analytics relay | "We never send your IP address to PostHog" holds: the relay sends `$ip: null` and no request headers. The sign-up limit added below uses the address only "to protect it from abuse", as the website notice already says |
| Keys on the phone | `apps/app/src/device/token.ts`, `storage/flags.ts`, Clerk's `tokenCache` | Her device token and the organiser's session are in the phone's secure store (Keychain or Keystore), never in plain storage or a log |

## Found and fixed in this review

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | The domain bridge forwards sign-ups to the pilot Worker, and Cloudflare stamps every forwarded request with the bridge's own address. Behind `vela-light.com`, all visitors therefore shared one count of 120 a minute | One script could fill the waitlist with junk addresses, and while it ran, real visitors' sign-ups were refused | The bridge now counts each visitor by their own address before forwarding: 5 sign-ups and 60 usage events a minute (`WAITLIST_LIMIT`, `ANALYTICS_LIMIT` in `infra/site-domain/wrangler.jsonc`). Tests in `worker.test.mjs`. **Takes effect at the bridge's next publish from the founder's personal Cloudflare account** |
| 2 | October's open item 5: her phone's two write routes (`/device/messages`, `/device/voice`) had no per-address count before reading up to 3 MiB and looking up the token | Anyone could make the Worker read and query the database for every guessed token | The API's address limit, under its own `device:` key, now runs before anything is read. Test: `bounded request bodies` in `apps/worker/src/app.test.ts` |
| 3 | `zod` 4.6.4, which validates every request body, is below the fix for GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized constrained collections) | Body caps limited it, but a crafted body could still cost memory | 4.6.6. Its release-age exception in `pnpm-workspace.yaml` is removed: 4.6.6 is three weeks old |

## Still open

### For the founder (account owner)

These are the gaps that matter most before a real family: they are written promises, and the code cannot keep them for you.

1. **OpenAI's data processing terms.** OpenAI receives the families' words today wherever AI is on, and its terms are recorded as "not yet read in full", with no acceptance date (`sub-processors.md`). The rule there is terms in place before real family data. Also decide whether to apply for zero data retention: without it, OpenAI may keep requests up to 30 days for abuse monitoring.
2. **Deepgram's DPA** (ask security@deepgram.com), **Expo's terms** (none found yet), **PostHog's DPA** (generate and countersign in the organisation before any production collection), **Sentry's** (before it is connected). Record the dates for Cloudflare, Neon, Clerk and Telegram.
3. **Cloudflare Access policy** (October item 1): confirm in Zero Trust that only your own email can open the admin page, for staging and production.
4. **Laptop and phone encryption** (`security-plan.md`, measure 8): confirm and date.
5. **Publish the bridge** with finding 1's change, through the release runbook's protected step.

### For counsel

6. The 16 questions in the legal memo, and the Vietnam review in its 5 October addendum, before the own-family week. Nothing in this review answers them.
7. Notice v15 (photos shown to OpenAI to draft questions) is a new kind of data for OpenAI. It needs the founder's yes, the families told, and OpenAI's row in `sub-processors.md` updated, before production turns it on.

### For engineering, later

8. Behind the bridge, the pilot Worker still counts all bridge traffic under one key. Finding 1 limits each visitor at the bridge, so filling that shared count now takes many addresses. A full fix passes the visitor's address from the bridge with a shared secret, which needs a secret in both accounts.
9. 21 high-severity advisories remain in `pnpm audit --prod`, all in the phone app's build and sign-in tooling (`node-forge`, `@xmldom/xmldom`, `decode-uri-component` under Expo's CLI and prebuild, and `zod` 3 inside Expo's config tools), none in a Worker. They clear when Expo and Clerk release fixed versions; Renovate tracks them.
