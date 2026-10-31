# Free analytics operations

Status: EU PostHog project 315862 is connected and synthetic ingestion is verified. Public project metadata is in infra/analytics-project.json. Collection remains off in runtime configurations. No production ingestion, release, app distribution or payment setup is established.

## Free account setup

Founder completed EU signup on 22 October 2026. Billing was visibly verified as free, with an add-card upgrade prompt and 1M monthly product-analytics free limit. Do not add a payment card. Use only the public project token (phc_...) and project region; never request a personal API key or password. Do not install vendor snippets from onboarding: Vela already sends explicit minimal events.

Use the one free project for production. Unit tests use fake transport. The actual-ingestion smoke test used synthetic data marked development/staging in this project; every saved production chart excludes it. If a separate staging project is needed, confirm its pricing before creating it. Free quotas and product pricing can change: verify https://posthog.com/pricing before activation. Product analytics is the only product needed; no Groups add-on, replay, surveys or managed warehouse.

## Collection and switches

Website Worker: SITE_ANALYTICS=on, POSTHOG_PROJECT_TOKEN=<public token>, POSTHOG_REGION=eu. Absent or invalid config disables the relay. The configuration regression test currently pins switch/token absent; update it with the reviewed activation change, not an ad-hoc dashboard override.

App bundle: EXPO_PUBLIC_POSTHOG_TOKEN, EXPO_PUBLIC_POSTHOG_REGION=eu, EXPO_PUBLIC_ANALYTICS_ENVIRONMENT=production. The API must be configured and demo mode must be off. Missing configuration sends nothing. No native dependencies were added. Nevertheless validate the installed runtime and OTA policy before choosing app distribution.

Website permission is separate from waitlist signup. App permission is a separate English-only Usage privacy prompt and can be reopened using Usage privacy above the screen. Existing family privacy permission does not enable analytics. Other languages remain isolated untranslated drafts.

## What this implementation measures

Website: site_viewed, section_viewed, section_active_time, waitlist_opened, waitlist_submitted, waitlist_acknowledged, waitlist_failed, demo_step_viewed. Sections: hero, idea, exchange, care, faq, join. Timers count visible sections only while the page is visible and there was interaction in the preceding 30 seconds. Each 30-second flush sends integer seconds; partially visible adjacent sections can overlap. This estimates viewing, not reading. Counts cover opt-in browsers only; not all website visitors. Broad campaign buckets: instagram, facebook, google, university, direct, other. Only explicitly supplied recognized utm_source values receive those named buckets; untagged external referrals are other. No country/device breakdown is collected by this implementation.

An acknowledgment means the form displayed success; duplicate addresses and honeypot submissions are intentionally acknowledged too. Use Admin /admin/waitlist for total unique saved emails. Analytics attempted/acknowledged conversion and unique saved signups have different denominators. No email is sent to analytics.

App: app_usage_started (an opted-in scope mount, NOT an install), screen_viewed and screen_active_time for a fixed route list. Times are foreground times, capped at 30 minutes per observation. No route query parameters, message contents, names, accounts, family IDs or media. Random IDs are scoped to account on each device; guest and signed-in identities are separate. No stitching across authentication/devices or person profiles. Usage events support screen funnels and return-use cohorts; they do not prove successful setup, sending, receiving or payment.

Family setup/activation, asks/answers/replies, failures and weekly family retention use authoritative Vela server records. Existing /admin/trial reports cover exchanges; a unified growth/family overview is future work. Deleted staging families are not production acquisitions. No payment event has been fabricated or payment capability enabled.

## Founder dashboard recipes

Open [Vela growth and engagement](https://eu.posthog.com/project/315862/dashboard/1045170). Its 10 saved charts were created and query-tested on 22 October 2026. They remain empty until reviewed production activation. Recipes for extending the dashboard:
1. Opted-in website visitors: Trends, site_viewed, unique users, daily; break down source.
2. Website interest: section_viewed, unique users, break down section.
3. Section attention: section_active_time, aggregate average seconds, break down section. Averages are per flush event, not average total visit time; use sum(seconds)/unique users for total observed seconds per visitor.
4. Waitlist funnel: site_viewed -> waitlist_opened -> waitlist_submitted -> waitlist_acknowledged, same random browser ID. Some users use the visible footer form without opening the dialog, so also save site_viewed -> waitlist_submitted -> waitlist_acknowledged.
5. Form failures: waitlist_failed, total events.
6. App audience: screen_viewed, unique users, daily/weekly/monthly, filter surface=app.
7. App return use: Retention, first screen_viewed -> subsequent screen_viewed, day 1/7/30.
8. App screen visits: screen_viewed, total events, break down screen.
9. App foreground seconds: screen_active_time, sum seconds, break down screen.

Filter every insight to environment=production, and surface where needed. Call visitors “opted-in browsers/devices,” not exact people. Existing charts use summed section seconds rather than per-flush averages. Recording is disabled; Vela sends no SDK automatic events. Check Data management -> Activity for the named events and inspect a synthetic payload before any real usage.

Apple App Store Connect -> Analytics remains the authority for downloads, acquisition campaigns, paying users, subscriptions, revenue and churn. TestFlight metrics are beta installs; purchases there are sandbox transactions. Vela pilot is free. RevenueCat is not required just for analytics and has not been integrated.

Cloudflare domain traffic reporting can supply broader request/traffic totals, which include different traffic and bot definitions. Do not present them as the same denominator as consented PostHog visits. Cloudflare Web Analytics beacon and Clarity have not been installed.

## Privacy and deletion

Website sends events through a same-origin relay; only approved JSON fields are accepted. Visitor IP/headers/referrer and full URL are not forwarded. PostHog sees the relay connection. App connects directly to the configured PostHog Cloud region; PostHog receives transport network details. Geolocation enrichment and person profiles are disabled by event properties. Neither client uses cookies, replay or automatic capture.

Choice v1 is local to browser/device/account. Native choices live in SecureStore, web choices in localStorage. On 23 October 2026 the live Billing page confirmed the free plan, no card, and a 1M product-event limit. PostHog’s current official https://posthog.com/docs/data/events-retention documents a 1-year event query window on Free and 7 years on paid plans. A query window is not proof of physical deletion at its boundary: the revised website notice makes this explicit. Counsel must approve this vendor retention/deletion policy before collection, and any upgrade requires a fresh notice/policy review. Only founder should have project access. Withdrawal stops future collection and drops the local random identity; historical events require a separate deletion request. User can copy the displayed analytics ID before withdrawal for founder lookup. Do not link anonymous analytics to waitlist emails to identify a request.

Update/review website privacy notice, optional app notice and data-map before activation. Website zh-TW notice received an AI language/legal issue review on23October; no independent human native or counsel review is claimed. app notice deliberately loads its isolated English catalog for the English testing cohort. Existing family consent text and server records remain untouched.

## Verification and release

Automated tests exercise missing config, unknown fields/content, foreign origin, body size, relay failure, no transport before opt-in, withdrawal abort and stale account callbacks. Browser/native verification must additionally prove prompt, reject, allow, withdraw, foreground/background timing, account changes and private-storage failures. Native tests require a real installed build; unit tests do not prove it.

The separate routing proposal #152 does not establish the live domain proxy target. Confirm site -> correct database -> protected waitlist before relying on conversion totals. Follow normal reviewed merge, staging and protected production release. Synthetic ingestion and dashboard proof do not establish live collection. No live activation is claimed until those checks succeed.


## Campaign readiness follow-up (23 October 2026)

Live English/Traditional Chinese pages and privacy notices returned 200. Browser validation and a synthetic `example.invalid` signup displayed success. This does not prove a new unique row in production: the bridge remains domain-bridge-v1 with its documented staging target. Public private routes returned 404. Footer legal links on the production Worker returned 200; direct marketing-host legal routes still return 404. Small curl POST probes were blocked by Cloudflare before application validation, so they do not prove the app status codes.

Both languages fit 320px and 390px browser viewports. Deferred images load without completed-image failures. The existing PostHog dashboard visibly states collection is not live; empty charts are not evidence of zero visitors. Project lookup confirms EU, IP discard enabled and replay disabled. No billing, account security or collection settings were changed.

Security follow-up: waitlist input is bounded while streaming (2048 bytes, 3 seconds), and stalled valid prefixes are rejected before database access. The analytics relay likewise rejects stalled valid JSON before vendor delivery. Hono is patched from 4.13.7 to 4.13.13 for GHSA-5r4p-p66f-jhc7; the Worker does not use the affected serveStatic helper. Other Expo/toolchain advisories remain and are not a clean security-audit claim.

Routing PR152 must be integrated first, then this branch brought to that main and given fresh checks. No collection activation before the owner-approved notice/configuration, signed vendor DPA and actual production routing/deletion checks. The23October AI issue review does not invent independent counsel or human native clearance. The app analytics configuration remains absent. This website task does not authorise an app release or public family admission.

## Versioned website choice and targeted legal issue review

The website choice now records decision time and notice version locally. Only website-usage.v3 is accepted by the relay and included with permitted events. Earlier yes choices require a fresh choice; earlier no choices remain no. A stale cached client/config cannot enable collection. Withdrawal aborts pending client requests, drops timers and identity, and stops future capture. This is version-bound technical evidence, not an unforgeable signature or proof of the visitor’s identity.

On23October Timur requested an AI legal issue review instead of outside counsel. This is an engineering/research assessment, not licensed counsel or formal clearance. Current official Taiwan PDPA Articles3,7,8,11,13,19 and20 support assessing the collector identity, specific purpose, minimum fields, notified recipients/territory/period, informed affirmative choice, rights handling and purpose limits. The PDPC statutory page still lists the November2025 amendments’ commencement as undetermined; do not silently apply their new notification regime as current law. Sources: https://law.pdpc.gov.tw/EngLawContent.aspx?id=5&lan=E and https://www.pdpc.gov.tw/News_Html/100/ .

Actual PostHog organization Legal documents page showed no generated legal documents. Its DPA page expressly requires an organization-generated countersigned agreement; public preview text is not binding. The review form is prepared at the account’s Legal documents page, with no personal address entered, document sent, signature, billing or agreement acceptance by engineering. Before actual collection the account owner must use the correct personal-operator identity and privately enter the address/email, review and sign. This factual contract hold remains even after an AI issue review. Sources: https://posthog.com/dpa and the signed-in organization Legal documents view.

The configured EU storage region does not promise EU-only processing: the vendor DPA permits international subprocessors. Both website notices now say so. No medical, emergency-response, full public app, worldwide-jurisdiction or trademark clearance is established. The present review concerns a Taiwan-directed voluntary email waitlist and optional website usage counts only. Do not ask Facebook commenters for health histories or family contact details; use the site’s minimal form. Opening notifications must include a free simple way to stop contact; do not turn this list into newsletters or broader marketing. Review necessity monthly and delete if the project/purpose is abandoned. Verify rights requests and deletion through the existing runbook; do not claim synthetic UI signup proves a production row or a completed rights request.
