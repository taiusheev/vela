# Sub-processors

17 September 2026 · architecture §12–13 · one page, kept in step with `plan/materials/pilot/privacy-notice.en.md` and `plan/materials/pilot/data-map.md`

Every outside company that processes personal data for Vela. The controller during the pilot is the founder as a private individual; there is no entity yet. Links were current on 13 September 2026, when they were last checked; confirm each before relying on it for a filing. Where a page was opened while writing this list, the link column says *checked*.

## Rules

- A provider that will receive family content is added here, and to the privacy notice, **before** it receives anything, and organisers are told at least 14 days ahead. For an EU launch the notice period becomes 30 days (architecture §12).
- Each provider's DPA is accepted or signed before real family data reaches it. Record the date in the last column.
- Providers receive the minimum: the AI never receives nearby contacts' numbers or billing data; logs and error reports never carry message content, transcripts, phone numbers or tokens.

## In use in the pilot (sprint 1)

| Provider | Purpose | Personal data it receives | Region | DPA or privacy terms | DPA accepted |
|---|---|---|---|---|---|
| **Cloudflare, Inc.** (US) | Runs the two Workers (the pilot Worker `vela` and the admin Worker `vela-admin`, ADR-26), Durable Objects, Queues, Hyperdrive; serves the privacy notice pages; stores media in R2; Cloudflare Access signs the founder in to the admin page | All categories while processed; voice notes and photos at rest; scheduler state (member id, time zone, arrival time); queue jobs (ids only); the founder's sign-in email (Access); from sprint 2, the consented benchmark voice clips in the private R2 bucket `vela-benchmark` ("Vela" account, data map row 23) | Processing on the global network; R2 bucket with the Asia-Pacific location hint, which Cloudflare describes as best effort rather than a guarantee (jurisdiction restrictions exist only for the EU, US and FedRAMP) | DPA: https://www.cloudflare.com/cloudflare-customer-dpa/ (*checked*; requires acceptance) · Privacy: https://www.cloudflare.com/privacypolicy/ | |
| **Neon** (a Databricks company) | Postgres database, point-in-time restore | Everything stored in the database (data map rows 1–10, 12–19) | Singapore, AWS `ap-southeast-1` | DPA: https://neon.com/dpa · Privacy: https://www.databricks.com/legal/privacynotice (neon.com's privacy link redirects there, *checked*) | |
| **Anthropic, PBC** (US) | AI calls: understand, flag, chips, suggest, translate, readback, hello, weekly read | Answer text and transcripts, asks, replies, members' first names, roles and languages, memory facts | United States; `inference_geo` is not pinned during the pilot (architecture §9.3) | DPA: https://www.anthropic.com/legal/data-processing-addendum (*checked*; incorporated into the Commercial Terms) · Terms: https://www.anthropic.com/legal/commercial-terms | Incorporated |
| **Deepgram, Inc.** (US) | Speech to text | Voice notes; a language hint | United States (an EU endpoint exists and is not used) | Privacy: https://deepgram.com/privacy (*checked*; DPA on request via security@deepgram.com) · Sub-processors: https://deepgram.com/privacy/subprocessors | |
| **Telegram** | Carries the phase-0 instrument's messages | Everything sent through the bot; users' public profile (name, username, language) | Telegram's own data centres (the Netherlands for UK and EEA users; elsewhere not stated) | Privacy: https://telegram.org/privacy (*checked*) · Bot developer terms: https://telegram.org/tos/bot-developers (*checked*; bots must publish a privacy policy) | Platform terms |
| **Functional Software, Inc. (Sentry)** (US) | Error reports | Record ids, error messages, stack traces; IP storage off; no content by rule | EU data storage location chosen at sign-up | DPA: https://sentry.io/legal/dpa/ (*checked*) · Privacy: https://sentry.io/privacy/ | |
| **Google LLC** (US), Google Drive | The founder's pilot notes, in the founder's own Google account, in a private folder "Vela pilot" shared with no one | Call notes, loneliness questionnaire answers and research quotes, filed under a family code instead of a name (data map rows 5 and 22) | Google's servers in the United States and other countries; a personal account offers no choice of location | Privacy: https://policies.google.com/privacy · Terms: https://policies.google.com/terms (added 17 September 2026) | None: personal account, on Google's own terms (data map gap 10; `plan/materials/pilot/legal-memo.md`, C11 and question 9) |

## Added later in the build

| Provider | From | Purpose | Personal data | Region | DPA or privacy terms |
|---|---|---|---|---|---|
| **LY Corporation (LINE)** | Sprint 2 | Messages for Taiwanese families | As Telegram | Japan and LINE's own data centres | Privacy: https://www.lycorp.co.jp/en/company/privacypolicy/ (line.me's policy link redirects there, *checked*) |
| **Microsoft (Azure AI Speech)** | Sprint 2 | Text-to-speech for read-back | Text of asks and replies to be spoken | Southeast Asia (Singapore) region, to be selected | https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA |
| **OpenAI** | Sprint 2 | Second-opinion transcription when Deepgram's confidence is low; STT benchmark | Voice notes | United States | https://openai.com/policies/data-processing-addendum/ |
| **Groq** | Sprint 2 (benchmark only) | Whisper benchmark on consented clips | 30 consented voice clips | United States | https://groq.com/privacy-policy/ |
| **Clerk** | Sprint 3 | Accounts for organisers and members | Name, email, phone, sign-in events | United States | https://clerk.com/legal/dpa |
| **650 Industries (Expo)** | Sprint 3 | Builds, updates, push delivery | Push tokens; notification text in transit | United States | https://expo.dev/privacy |
| **Apple (APNs), Google (FCM)** | Sprint 3 | Push notifications | Notification text in transit, device tokens | Global | Platform terms |
| **PostHog** | Sprint 3 | App funnels and flags; never content | Pseudonymous ids, app events | EU (PostHog Cloud EU) | https://posthog.com/dpa |
| **Meta (WhatsApp Cloud API)** | After the entity | Messages in Europe and India | As Telegram | Meta's data centres | https://www.whatsapp.com/legal/business-data-processing-terms |
| **Twilio** | Phase 2 | Voice line and SMS | Phone numbers, call audio, keypresses | United States | https://www.twilio.com/en-us/legal/data-protection-addendum |
| **RevenueCat, App Store, Google Play** | After the entity | Billing | Payer and subscription data | United States | To be added with billing |

## Used by the team, receiving no family data

| Provider | Purpose | What it holds | Terms |
|---|---|---|---|
| GitHub | Code, CI | Code and synthetic test data; anonymised golden-set text only | https://github.com/customer-terms/github-data-protection-agreement |
| Healthchecks.io | Heartbeat from outside Cloudflare (ADR-18) | Ping times only | https://healthchecks.io/privacy/ (*checked*; hosted with Hetzner, backups on AWS) |
| Instatus | Status page (before the first family beyond the founder's own) | Status text; subscriber emails if enabled | To be added when created |

## Outside this list

- **Payments:** none. The pilot is free for families, so no payment provider processes anything for Vela until billing opens with the entity (RevenueCat and the app stores, above).
