# Founder: privacy and security actions

Prepared 5 November 2026 from the [November security review](../infra/security-review-2026-11.md). Engineering has done everything that does not need your accounts, your signature or your decision. What is left is below, in the order it is needed. None of it needs a password or key in chat: dates, names and "done" are fine to send Claude.

## Before any real family joins

### 1. Send two emails already drafted in your Gmail (2 minutes)

Open Gmail → **Drafts**. Two drafts are waiting, written in your name:

- **To security@deepgram.com**: "Request for Deepgram's Data Processing Addendum". Deepgram turns voice notes into text and publishes no DPA, so they send it on request.
- **To support@expo.dev**: "Request for Expo's Data Processing Addendum (push notifications)". Expo carries the app's pushes, and no DPA is published on its site.

Read each, change anything you like, press **Send**. When a DPA arrives, sign it as they ask, keep the signed PDF in your password manager or a private folder, and tell Claude: **"Deepgram DPA signed on <date>"** (or Expo's).

### 2. OpenAI: record the date and decide on zero retention (10 minutes)

OpenAI receives the families' words wherever AI is on. Its DPA has no signature step: you accepted it by using the API. Three things:

1. **The date.** Sign in at platform.openai.com → **Settings** → **Billing** → **Billing history**. Your first invoice or payment there is the earliest date we can record. Tell Claude: **"OpenAI API first used <date>"**.
2. **A copy.** Open openai.com/policies/data-processing-addendum in your browser → **Print** → **Save as PDF**. Keep it with the others. Claude cannot reach openai.com from its cloud session, which is why this one is yours.
3. **Zero data retention: your decision.** By default OpenAI may keep each request up to 30 days to check for abuse. With zero data retention it keeps nothing. It costs nothing, but OpenAI approves it case by case and replies can be slow. Our recommendation: **ask now**. It cannot hurt, and it is a strong answer when a family asks "who keeps my mother's words?". To ask: openai.com/contact-sales → fill in the form, and paste this in the message box:

   > I run Vela, a small invitation-only pilot that carries daily messages between older parents and their families, using the Chat Completions API with store set to false. The messages can include personal and health-related words. I would like to request Zero Data Retention for my organisation. Our requests send only text and images to standard models, with no files, assistants or stored conversations.

   Tell Claude **"ZDR requested"**, or **"no ZDR"** if you decide against it.

### 3. Check who can open the admin page (3 minutes per account)

The admin page shows family records. Only you should be able to open it. In the Cloudflare dashboard, for the account **Vela** and then for **Vela staging**:

1. Left menu → **Zero Trust** → **Access controls** → **Applications**.
2. Open the application for **vela-admin** → **Policies**.
3. The policy's **Include** rule must be either your own email address only, or **Cloudflare account** with you as the account's only member (**Manage account** → **Members** lists one person: you).

Tell Claude: **"admin access checked, only me"**, or describe what you see if it is anything else.

### 4. Dates for the providers you already use (5 minutes)

The records need the date you accepted each provider's terms, which is the date you signed up. A date is not a secret: send it in chat, and a month is fine if you only know that.

- **Cloudflare**: the "Vela" account, the "Vela staging" account, and the personal account that owns vela-light.com.
- **Neon**: your sign-up (the projects were created on 17 September 2026, so it is that day or earlier).
- **Clerk**: when you created the Vela application.
- **Telegram**: the day you created the production bot @VelaLightbot in BotFather.

### 5. Laptop and phone encryption (2 minutes)

- **Mac**: **System Settings** → **Privacy & Security** → **FileVault** is **On**.
- **iPhone**: a passcode is set (**Settings** → **Face ID & Passcode**). That alone turns encryption on.

Tell Claude: **"FileVault on, phone passcode on"**.

### 6. A lawyer (your decision on when)

The [legal memo](materials/pilot/legal-memo.md) lists 16 questions for a Taiwanese privacy lawyer, and its 5 October addendum asks for a review of Vietnamese law before the own-family week in Vietnam. Engineering cannot answer these. When you choose a lawyer, Claude can prepare a short brief for them from the memo.

## Only when that feature is switched on

| When | What | Where |
|---|---|---|
| Before production analytics (PostHog) collects anything | Generate and sign PostHog's DPA | PostHog → **Settings** → **Organization** → **Legal documents** → create the DPA, fill in your details, sign |
| Before error reports (Sentry) are connected | Accept Sentry's DPA | Sentry → **Settings** → **Legal & Compliance** → accept the Data Processing Addendum |
| Before photo questions are on for families | Approve notice v15, and tell families | `plan/materials/pilot/privacy-notice.v15-photo-questions-draft.md`. Claude then updates OpenAI's row in the provider list |

## Nothing to do now

- **The website bridge** (vela-light.com). Its new version, with the sign-up limit, goes live as one step of the production release in [`infra/runbooks/release.md`](../infra/runbooks/release.md), step 8. Do not publish it separately: it points at production, which is not live yet.
