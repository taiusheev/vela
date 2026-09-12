# Pre-build readiness: what is still missing before we write MVP code

2026-09-13. An audit of the planning foundation against what a build actually consumes. Verdict, then the inventory, then the gaps in three tiers with owners and effort, then the order for the next ten days, then the definition of "ready to build".

## Verdict

We are not ready to build the MVP, and the reasons are not more diagrams. Three things stand between us and the first line of app code:

1. **Zero evidence.** No survey responses, no interviews, no pilot family. Our own decision log says "don't deploy the bot before talking to customers"; the same logic applies harder to a two-month app build. Everything below is cheap next to building the wrong arrival.
2. **The spec contradicts itself.** `product/03-product-spec.md` still describes the arrival as a Vela-composed message answered with "☀️ I'm fine", with a Vela fallback and an opt-in "auto-ask" step where Vela messages a neighbour. `product/04-interaction-model.md` replaced that: every arrival is an ask from a person, her answer is a post, replies are read back the next morning. A builder reading both would build two products. The spec needs a v2 that absorbs the interaction model and adds acceptance criteria per screen.
3. **Payments as decided cannot be opened.** ADR "Stripe web checkout first" assumed Stripe. Stripe does not onboard businesses registered in Taiwan; the workarounds are a US or UK entity, or a merchant-of-record provider (Lemon Squeezy, now owned by Stripe; Paddle; Polar) that sells on our behalf and handles VAT. This is a founder decision that also fixes the legal entity, the bank account, and the app store accounts.

Ready to build **the phase-0 instrument** (the Telegram bot, updated to the interaction model) after roughly three days of spec work. Ready to build the MVP only after phase 0 returns numbers.

## What we have

| Area | Artefacts | State |
|---|---|---|
| Research | 7 reports, synthesis, ~550 sources | Done |
| Product | app plan v2, product spec v1, interaction model, bot spec | Spec v1 and interaction model disagree |
| Architecture | technical design (13 sections), 10 ADRs, drawio for architecture, database, daily loop | Solid; data model is a drawing, not DDL |
| Plan | execution plan (phases 0–3), master plan page with checklist, 30-day plan (superseded) | Done |
| Materials | surveys RU/EN/ZH-TW, interview script, recruitment posts, parent explainer (RU only) | Written, not yet posted |
| Design | design system v3, brand locked, 20-screen prototype, 5 Figma screens | Figma capped; no messenger conversation design |
| Code | phase-0 bot (Workers + D1 + Claude), type-checks, not deployed | Built for the old "I'm fine" model |
| Pitch | ikigai application v3 | Submitted |

## Gaps

### Tier 1: before any MVP code

| # | Gap | Why it blocks | Owner | Effort |
|---|---|---|---|---|
| 1 | **Phase-0 evidence**: 20 interviews, the parent mock test, 10 pilot families for two weeks | Decides what the arrival must contain, whether parents refuse, whether anyone pays | Founder runs; co-founder synthesises | 4 weeks, already planned |
| 2 | **Product spec v2**: fold the interaction model into the spec; the exchange as a state machine (queued → delivered → seen → answered → replied → read back → archived); turn rules and what happens when nobody asks; receipts; drop or redefine "auto-ask"; acceptance criteria for all 20 prototype screens; empty, error, offline, and first-day states | A builder needs one source of truth | Co-founder | 2 days |
| 3 | **Phase-0 instrument redesign**: in phase 0 there is no app, so how does the family send asks? Decide between a Telegram family group with bot commands and a one-page web form; specify the bot's conversation as screens (copy, buttons, voice, "stop"); update `bot/` | The bot we have runs the old model | Co-founder | 2 days |
| 4 | **Payments and entity**: merchant of record vs foreign entity; which one; what it costs; how payouts reach a student in Taiwan | Fixes ADR on payments, the bank, and the Apple and Google developer accounts (organisation accounts need a legal entity and a DUNS number) | Founder decides on a one-page comparison from the co-founder | 1 day memo, decision by day 7 |
| 5 | **Privacy and consent pack for the pilot**: plain-language notice, consent script in RU/EN/ZH-TW, retention (30 days of answers, archive by choice), deletion on "stop", a data map; GDPR applies the moment one family member is in the EU (our own persona has Sam in Berlin) | We record elderly people's voices from day one of the pilot | Co-founder drafts; founder reads it to their own parent | 1 day |
| 6 | **AI prompt set v0 and eval set**: the real prompts (understand an answer, flag what matters now, draft answer chips, translate, suggest tomorrow's ask, weekly read) with 50 golden examples across RU/EN/ZH-TW and red-line tests (never diagnoses, never speaks as family, never quotes her without her seeing it) | Every AI output is a promise in the spec; without evals we cannot change a prompt safely | Co-founder; synthetic first, replaced with pilot answers | 3 days |
| 7 | **Accounts**: Telegram bot, Cloudflare, Anthropic key now; Apple Developer, Google Play, Expo EAS, Neon, domain before MVP | Nothing deploys without them | Founder | 20 minutes now; $124 one-off later |

### Tier 2: during the build, in parallel

| # | Gap | Owner | Effort |
|---|---|---|---|
| 8 | Postgres DDL and migrations from the drawio data model; the API contract between app and worker (OpenAPI); an analytics event schema that produces the ten metrics in the master plan | Co-founder | 3 days |
| 9 | Test strategy: unit tests for scheduler and ladder timing and the one-notification budget; AI evals in CI; device matrix for the parent surface (old Android, iOS with large text); accessibility checks; a "silence drill" that proves our own outage never fires a quiet notice | Co-founder | 2 days to write, ongoing to keep |
| 10 | SLOs and observability: arrival delivered within 5 minutes of the hour 99.5% of the time; alert on a missed tick; a dashboard for answer rate, latency, notices and their outcomes | Co-founder | 1 day |
| 11 | Content bank: 100 asks by type and culture, 52 story-day questions, the rules for drafting answer chips, all app and bot strings in RU/EN/ZH-TW, the parent explainer in EN and ZH-TW | Co-founder drafts; founder edits the Russian | 2 days |
| 12 | Messenger conversation design: the eldest's real first surface is Telegram, not the app; the flow deserves the same care as the 20 screens | Co-founder | 1 day, inside #3 |
| 13 | Name clearance for "Vela" (EUIPO, WIPO, TIPO, Rospatent) and a backup name; buy the domain | Founder, with a checklist from the co-founder | 2 hours plus filing fees later |
| 14 | Landing page and waitlist (already on the checklist) | Co-founder | 1 day |
| 15 | Budget: one-off (developer accounts $124, domain ~$15, entity $139–500 depending on #4) and monthly (under $25 to 100 families) | Co-founder | 1 hour |

### Tier 3: before launch

| # | Gap |
|---|---|
| 16 | Store listings in three languages; App Store review notes explaining the parent surface and the subscription |
| 17 | Support and incident runbook: who answers a family, what we say when a quiet notice was wrong, what happens when a kept-light member dies, what we do when a messenger is down |
| 18 | Terms, privacy policy final, refund policy, trial mechanics, the pricing test design ($9.99 vs $14.99 vs annual) |
| 19 | WhatsApp template approval, LINE channel setup, MAX terms review (technical open questions 2–4) |
| 20 | Usability test of the parent surface with three people over 70 before the phase-2 build |

## The next ten days

| Day | Founder | Co-founder |
|---|---|---|
| 1–2 | Post the survey in three places; create the Telegram bot, Cloudflare account, Anthropic key; book eight interviews | Product spec v2 (#2) |
| 3–4 | Interviews 1–4; show your parent the morning arrival, write down her words | Phase-0 instrument spec and bot update (#3, #12) |
| 5 | Interviews 5–6 | Privacy and consent pack (#5); payments and entity memo (#4) |
| 6–7 | Interviews 7–8; **decide payments and entity** | AI prompts and eval set v0 (#6) |
| 8–10 | Interviews 9–12; recruit the first pilot families | DDL, API contract, analytics events (#8); test strategy and SLOs (#9, #10) |

By day 10 the phase-0 instrument can go live with the founder's own parent, and the MVP has a spec, a data model, an API, prompts with evals, and a payments path.

## Definition of "ready to build the MVP"

All eight must be true:

1. Twenty interviews synthesised; at least four families paying for the pilot; parent refusal under 30%.
2. Product spec v2 is the only spec, with acceptance criteria for every screen.
3. The pilot has run two weeks and the arrival content that works is written down.
4. Payments provider and legal entity decided and opened.
5. Privacy notice and consent script used in the pilot without objection.
6. Prompts v0 pass the eval set; the eval set contains real pilot answers.
7. DDL, API contract, and analytics events exist and match the spec.
8. Developer accounts, domain, and the name decision (Vela Light or the backup) are done.

## Sources for the payments finding

Stripe's own availability page does not list Taiwan; third-party guides for Taiwan founders describe the US or UK entity route: [Stripe global availability](https://stripe.com/global), [How to open a Stripe account in Taiwan (doola)](https://www.doola.com/stripe-guide/how-to-open-a-stripe-account-in-taiwan/), [How to open Stripe account in Taiwan in 2026 (incorpuk)](https://incorpuk.com/blog/how-to-open-stripe-account-in-taiwan/). Merchant-of-record options and the 2026 Stripe Managed Payments development: [Lemon Squeezy 2026 update](https://www.lemonsqueezy.com/blog/2026-update), [Lemon Squeezy vs Polar vs Paddle](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026), [Merchant of record platforms 2026](https://dodopayments.com/blogs/best-merchant-of-record-platforms).
