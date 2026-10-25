# Turning on payments: what the founder does

Written 25 October 2026. The app and server code are on branch `feat/revenuecat` (draft change). Everything below is done by the founder, in this order. Nothing here charges anyone: purchases stay off in production until step 6.

## 0. The decision first: who sells?

ADR-20 says **no payment in the app until the company exists**. The founder decided the company comes after the English trial.

| Option | What it means | Cost and risk |
|---|---|---|
| **A. Wait for the company (recommended)** | Set up everything below on the test system now; switch production on the day the company's Apple account and bank are ready. | No risk. Taiwan launch waits for the company anyway (a seller in Taiwan needs invoices and tax registration). |
| B. Sell as an individual now | The founder's own Apple developer account is the seller; income is personal income. | Moving apps and subscribers from a personal Apple account to a company later is possible but slow, and every subscriber stays on the old account's records. Counsel should agree first. |

Steps 1–5 are the same either way.

## 1. Confirm the RevenueCat email (2 minutes)

Open Gmail, find "Confirm your email" from RevenueCat, click the link. The banner in RevenueCat disappears.

## 2. Apple's paid-apps agreement (15 minutes, needs bank and tax details)

1. Open appstoreconnect.apple.com → **Business** (or "Agreements, Tax, and Banking").
2. **Paid Apps** → Set up → accept the agreement.
3. Add the bank account and tax forms Apple asks for. For option A, wait and use the company's.

## 3. The purchase key for RevenueCat (5 minutes)

1. App Store Connect → **Users and Access** → **Integrations** → **In-App Purchase** → **+**.
2. Name: `RevenueCat`. Create, then **Download** (Apple lets you download it once). The file is named like `SubscriptionKey_ABC123.p8`.
3. Note the **Key ID** (next to the key) and the **Issuer ID** (top of the page).
4. Open app.revenuecat.com → project **Vela Light** → **Apps** → **New app configuration** → **App Store**.
5. App name `Vela Light (iOS)`, bundle ID `family.vela.light`. Drop the `.p8` file in, paste Key ID and Issuer ID, **Save**.
6. Keep the `.p8` file somewhere private (a password manager). Never send it in chat.

## 4. The two subscriptions in App Store Connect (10 minutes)

1. App Store Connect → **Apps** → Vela Light → **Subscriptions** → **+** subscription group named `Vela Light`.
2. Add subscription: reference name `Vela Light yearly`, product ID **`vela_light_yearly`**, duration 1 year, price **NT$2,490** (Taiwan), let Apple fill other countries.
3. Add subscription: `Vela Light monthly`, product ID **`vela_light_monthly`**, 1 month, **NT$290**.
4. For each, add a display name and description in English and Traditional Chinese (Claude can write these).
5. In RevenueCat → **Product catalog** → **Products** → **Import** (or New) both product IDs; attach both to the entitlement `vela_light_pro`; in the offering `default`, set `$rc_annual` → `vela_light_yearly` and `$rc_monthly` → `vela_light_monthly`.

Tell Claude when this is done: Claude puts the App Store key (`appl_…`, public) into the test app's build settings.

## 5. Connect RevenueCat to the test server (2 minutes)

Double-click `infra/scripts/set-revenuecat-webhook.command`. It makes a password, saves it on the test server, and copies it; the window then tells you exactly where to paste it in RevenueCat (Integrations → Webhooks, Sandbox only). Nobody, including Claude, sees the password.

## 6. Production (later, after the decision in step 0)

Needs: the privacy notice with the RevenueCat lines approved (draft in `plan/materials/pilot/privacy-notice.billing-draft.en.md`, questions for counsel at the end), the server's `billing` switch on for the public product, and the same webhook step for production. Claude prepares each when the time comes.
