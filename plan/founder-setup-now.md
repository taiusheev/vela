# Founder setup: what only you can do, in order

Updated 7 October 2026. Every step below needs your own account, money or a private key, so engineering cannot do it for you. Each one ends with the exact words to send Claude. Private keys go only into the hidden prompts of the launchers in `infra/scripts/` (double-click in Finder; macOS may ask once to allow Terminal). **Never paste a key, password or connection string into chat.**

The active checklist these unblock is [english-trial-readiness.md](english-trial-readiness.md).

| # | Step | Cost | Time | Unblocks |
|---|---|---|---|---|
| 1 | GitHub deploys staging by itself | free | 3 min | every merge to `main` reaches staging without Claude deploying by hand |
| 2 | Clerk tells Vela when a test account is deleted | free | 5 min | "Clerk lifecycle delivery" gate |
| 3 | A second Telegram account to play the parent | free (needs a second phone number) | 10 min | the synthetic dogfooding week: complete exchange, consent and failure cases |
| 4 | OpenAI key for staging | uses your existing OpenAI account | 10 min | "Live AI provider" gate; flag check with real AI |
| 5 | Apple Developer Program | US$99/year, your call | 15 min + Apple's review (1–2 days) | signed iPhone build, voice playback on a real phone, TestFlight |
| 6 | Production | domain + Neon/Clerk production, your call | later | real families |
| 7 | LINE test account for staging | free | 15 min | launch gate 7: Vela on LINE, tested with a test parent before any Taiwan family |

## Current status — reuse completed setup

Steps 1, 2, 3, 4 and 7 have their account/key setup completed; keep the instructions below for a specific failed configuration check, and do not repeat them during ordinary testing. Current main CI and automatic staging deployment passed. Clerk signed example delivery is verified; deletion of a real synthetic signed-in account is still open. The second Telegram account is the organiser, and the founder's LINE account plays the synthetic parent. LINE consent, the first scheduled arrival, two answers and the acknowledgement are verified on 7 October.

Engineering found and reproduced a Worker-runtime bug that prevented OpenAI calls from reaching the provider, and is repairing it. This is not evidence that a new key or more credit is needed. The complete family loop still needs a linked synthetic group, a human reply and its next-morning read-back. Signed iPhone/TestFlight and production remain open. See [the morning receipt](../infra/load-tests/trial-line-morning-2026-10-07.json) for recovery evidence and its limits.

## 1. GitHub deploys staging by itself (free)

1. Neon console → project **vela-staging** → **Connect** → switch **Connection pooling** off → copy the connection string.
2. Double-click `infra/scripts/set-github-staging-secrets.command`, paste at the hidden prompt, press Return.

It reuses the staging Cloudflare token already on this Mac and refuses anything except the direct vela-staging connection. After it, each merge to `main` runs the checks, then migrates and deploys staging. Production is unaffected; it still needs your approval and a `v*` tag.

Tell Claude: **"staging deploy secrets are in GitHub"**.

## 2. Clerk deletion webhook on staging (free)

1. clerk.com → application **Vela Light** → make sure the switch at the top says **Development**.
2. **Configure → Webhooks → Add Endpoint**.
   - Endpoint URL: `https://vela.vela-light-staging.workers.dev/webhooks/clerk`
   - Subscribe to events: tick only **user.deleted**.
   - **Create**.
3. On the new endpoint's page, next to **Signing Secret**, click the eye icon and copy the key (it starts `whsec_`).
4. Double-click `infra/scripts/put-staging-secret.command`, type `1`, and paste the key at the hidden prompt.
5. In Clerk, **Users → Create user** with a made-up address such as `deletetest+clerk_test@example.com` (set any password if asked), then open that user → **Delete user**.

Tell Claude: **"Clerk webhook key is on staging and I deleted the test user"**. Claude then checks the endpoint's delivery log and that staging refuses that account.

## 3. A second Telegram account for the test week (free)

The parent role in the test week must be a Telegram account that isn't your main one. It uses scripted test words only, never real news or health.

1. Get a second phone number that can receive one SMS: a spare SIM, an eSIM or a family member's number they're happy to lend.
2. Telegram on iPhone → **Settings** → tap your name at the top, or long-press **Settings** → **Add Account** → enter the second number.
3. Give it an obviously synthetic name, for example "Test Parent".

Tell Claude: **"second Telegram account ready"**. Claude then sends you the day-by-day script ([staging-test-script.md](staging-test-script.md)) and checks each result on staging as you go.

## 4. OpenAI key for staging (you already have an OpenAI account)

Decided 6 October: Vela uses OpenAI instead of buying Anthropic credit. OpenAI is enabled on both staging Workers and its local 92-case golden set passed. The 7 October live calls exposed a Worker-runtime bug; engineering owns the fix and live retry verification. Production cannot run with AI off.

1. platform.openai.com → **Settings → Limits** (or **Billing**): check there is credit, and set a monthly budget (e.g. US$10).
2. **Projects → Create project** named `vela-staging`. Later, `vela-production`.
3. In project `vela-staging` → **API keys → Create new secret key**, name it `vela-staging` → copy it (starts `sk-`).
4. Double-click `infra/scripts/put-staging-secret.command`, type `3`, and paste it. It goes on both staging Workers. It does nothing until Claude switches staging's AI on, so the order is safe.

Tell Claude: **"OpenAI key is on staging"**. Claude switches `AI_PROVIDER` to `openai` on staging in a reviewed change and runs the AI test cases with scripted test words. Before any real family, the privacy notice must name OpenAI instead of Anthropic: Claude drafts that change for your approval.

## 5. Apple Developer Program (only if you approve US$99/year)

Needed for any build on a real iPhone, including voice-note playback, which Expo Go cannot do.

1. developer.apple.com/programs/enroll → **Start Your Enrollment** → sign in with your Apple ID (two-factor on) → **Individual / Sole Proprietor** → pay.
2. Wait for Apple's "Welcome to the Apple Developer Program" email.

Tell Claude: **"Apple Developer is active"**. Claude then prepares the App Store Connect app (`family.vela.light`) and signing. You approve one Expo/Apple sign-in prompt in your own Terminal, and Claude starts the `trial-staging` build for your iPhone. The TestFlight review text is ready in [materials/trial/testflight-review.en.md](materials/trial/testflight-review.en.md).

## 6. Production (later, after 1–5)

This needs your decisions on a domain, Clerk production and production Neon/R2. The exact sequence is in [english-trial-readiness.md](english-trial-readiness.md), "Production handoff". Claude prepares each configuration change for review. You only enter private keys at hidden prompts and approve the protected deployment.

## 7. LINE test account for staging (free)

Vela's Taiwan launch runs on LINE (decided 6 October). This first account is only for testing on staging; the real one comes before the first Taiwan family.

1. Go to `manager.line.biz` → sign in with your LINE account (or create a LINE Business ID) → turn on two-step verification.
2. **Create a LINE Official Account:** unverified account (未認證帳號), country **Taiwan**, name **Vela Light test**, any category close to "Lifestyle".
3. In the new account: **Settings → Messaging API → Enable Messaging API** → create a provider in your own name → agree to the terms.
4. **Settings → Response settings:** chat **off**, auto-response **off**, greeting message **off**, webhooks **on**.
5. Go to `developers.line.biz` → your provider → the **Vela Light test** channel:
   - **Basic settings** tab → copy the **Channel secret** (32 letters and digits).
   - Double-click `infra/scripts/put-staging-secret.command`, type `4`, paste it.
   - **Messaging API** tab → at the bottom, **Channel access token (long-lived) → Issue** → copy it.
   - Double-click the launcher again, type `5`, paste it.
6. On the **Messaging API** tab, note the **Bot basic ID** (it starts with `@`). It is not secret.

Tell Claude: **"LINE keys are on staging, basic ID @…"** (the basic ID is fine to send in chat). Claude then switches LINE on for staging, sets the webhook address in the LINE console with you, and runs the full morning loop with a test parent on LINE.
