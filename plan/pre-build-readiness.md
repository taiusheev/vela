# Pre-build readiness, v2: are we ready to start building?

2026-09-18: updated because the founder's own parent, a Russian citizen living in Russia, cannot be the first pilot family (`plan/materials/pilot/legal-memo.md` Q6): sprint 1 opens with a dogfooding week on staging, and the first real families are families living in Taiwan, onboarded after that week passes and production is deployed (sprint 1 row, "What still needs the founder"). 2026-09-17: updated for the founder's decision that the pilot is free for families, so willingness to pay is asked on each organiser's day-30 call instead of counted in paying families (conditions 1 and 4, sprint 6, kill signals). Written 2026-09-13, evening, as the second pass, after the founder's four decisions of the same day: published evidence instead of a survey wave (`research/08–14`), spec v2 as the only spec (`product/05-product-spec-v2.md`), payments deferred with Singapore as the likely entity, and Russia deferred in favour of Taiwan, the US, Japan, Europe, and India (`market-order.md`). The first pass (morning) is kept below as history.

## Verdict

**Yes: start building now, in a changed order.** The two blockers from the morning are gone: the evidence base exists, and the spec no longer contradicts itself. What remains are tasks inside the first build sprint, not reasons to wait.

What we are ready for: the phase-0 instrument this week, the platform foundation next week, the app from week three, with the pilot families running on the instrument the whole time and the founder's onboarding calls doing the interviewing.

What we are not ready for, by decision rather than by gap: charging money (no entity yet; the pilot is free for families, decided 2026-09-17), a public launch (name clearance, final privacy policy), WhatsApp (Meta verification needs the entity), and the Russian market (deferred).

## The eight conditions, rechecked

| # | Condition (morning version) | Status tonight |
|---|---|---|
| 1 | Twenty interviews; four paying families; refusal under 30% | **Replaced** by research/08–14 with the founder's consent. The published record gives the answer rate (~80% → 65–75%), the refusal risk (30–40% for monitoring framing, avoidable by wording), the price band, and the channel reality. Interviews move into the pilot's onboarding calls. The pilot is free (2026-09-17), so paying families are not counted: each organiser is asked on the day-30 call whether they would pay for Vela Light at US$9.99 a month. |
| 2 | Spec v2 is the only spec, with acceptance criteria per screen | **Done.** 20 screens, the messenger path, the exchange state machine, revised parameters (Appendix B). |
| 3 | Pilot run two weeks; arrival content written down | **Moves into sprint 1.** The instrument is built first precisely so this happens while the platform is built. |
| 4 | Payments provider and entity decided and opened | **Deferred by decision** (Singapore likely). Not needed to build; needed before the first charge, and the pilot takes no payment at all (2026-09-17). Stripe, Paddle, and Lemon Squeezy all serve Singapore entities. |
| 5 | Privacy notice and consent script used in the pilot | **First task of sprint 1** (one day, co-founder). No family is onboarded before it exists. |
| 6 | Prompts v0 pass an eval set | **Sprint 1** (three days, co-founder), synthetic first, real pilot answers from week 2. |
| 7 | DDL, API contract, analytics events | **Sprint 2**; they are the first artefacts of the build itself. The event list is already in spec v2 §18. |
| 8 | Developer accounts, domain, name decision | **Founder, this week**: Telegram bot, Cloudflare, Anthropic key now (20 min); Apple and Google accounts need the entity, so they wait. |

## What the evidence changed in the build order

1. **The parent surface is the floor, not a phase-2 nicety.** Russia's messengers are blocked, throttled, or state-run; half of Taiwan's 70+ are offline. Our own app, installed by a visiting child, is the one channel we control. It moves up to sprint 3, right after the organiser flows.
2. **The voice line moves from phase 3 to phase 2.** A call that plays the family's voice and takes a keypress is the only path to the offline half. Design starts in sprint 4; build in phase 2.
3. **LINE first, WhatsApp second, Telegram only for the instrument.** Taiwan and Japan run on LINE (paid Messaging API plan from day one); Europe and India on WhatsApp once the entity exists; the US on the parent surface, SMS, and later the voice line. Russia is deferred, so MAX is dropped and Telegram stays only as the cheapest instrument and for families who already use it.
4. **Logging is a feature.** Nobody has published our exact loop; the pilot's per-day log and UCLA-3 measurements are the most valuable output of the first sprint. The event schema ships with the instrument, not after it.
5. **The quiet ladder ships with a learning period** and a 6-hour start, because one day in four or five will be silent even when everything works.
6. **Billing, when it comes, is annual-first, per protected parent, owned by the adult child.**

## The build plan, twelve weeks

> Superseded in detail by [`build-plan.md`](build-plan.md) (task level, definitions of done, sprint 0) on the evening of 2026-09-13. The table below is the summary.

| Sprint | Weeks | Co-founder builds | Founder does | Exit |
|---|---|---|---|---|
| 1 · Instrument | 1–2 | Privacy and consent pack (EN, ZH-TW); bot updated to spec Appendix A (family group + private chat, asks, read-back, quiet notice, logging); prompts v0 + eval set; deploy | Accounts (20 min); a dogfooding week on staging starting by day 7, with the founder as organiser and a second Telegram account of the founder's, or a friend living in Taiwan who agrees (once the providers' data processing terms are in place, and with scripted test content only), as the kept-light member; three to five English- or Chinese-speaking families living in Taiwan from day 14, once that week has passed and production is deployed; every onboarding call doubles as an interview | Dogfooding week passed; three to five families living in Taiwan live; consent used without objection |
| 2 · Foundation | 3–4 | Postgres schema and migrations; API contract; adapter contract with Telegram ported and **LINE built** (paid plan); outbound gateway with the one-a-day budget; scheduler; AI service with logged, versioned prompts; event pipeline; Traditional Chinese strings | Five Taiwanese families recruited for LINE; first weekly reads written by hand from AI drafts; a native reviewer for the Chinese copy | The instrument's families migrated to the platform with no missed arrival; first LINE family live |
| 3 · App, family side | 5–7 | Expo app: A1–A8, A11–A14 (onboarding, Today, Ask, Exchanges, quiet notice, You, Light screen, widget); LINE and Telegram invite flows | Fifteen families across Taiwan and English-speaking countries; UCLA-3 at week 4 for the first cohort; decide entity | Ten families using the app for asks; answer rate ≥ 75% |
| 4 · Parent surface | 8–9 | P1–P6 (consent, question, photo choice, recording, answered, kitchen-table); TTS read-back in English and Chinese; voice-line design | Two parents on the parent surface via a visiting child (one in the US or Europe, one in Taiwan) | Parent surface answered by two parents for a week each |
| 5 · Depth and the second wave | 10–11 | Story day and the family book; weekly read in-app; memory suggestions; WhatsApp Business verification if the entity exists; Japanese localisation scoped | Ten Taiwanese families on LINE; pricing test design for NT$; pricing page copy | Weekly read opened by organisers; WhatsApp sandbox sending |
| 6 · Measure and decide | 12 | Precision page; the trial flow (no payment yet); metrics review | UCLA-3 at week 12; "if Vela stopped tomorrow" and "would you pay for Vela Light at US$9.99 a month?" at day 30 for every organiser; decide: open billing (needs entity) and public launch | Metrics against spec §18 targets; go or change one variable |

Kill signals, with the evidence-adjusted thresholds: answer rate under 50% by week 4, stop rate over 30% in month 1, fewer than 4 organisers saying on their day-30 call that they would pay for Vela Light at US$9.99 a month (asked, since the pilot is free and billing is not open; the same threshold as `execution-plan.md` and `build-plan.md`). Spec §18's paying target and its kill signal (families paying at day 90, [< 4%]) apply once billing is open, so the sprint 6 review measures the day-30 answer in their place.

## What still needs the founder

- Accounts this week (Telegram bot, Cloudflare, Anthropic key).
- A dogfooding week on staging starting by day 7: you as the organiser, and a second Telegram account of yours, or a friend living in Taiwan who agrees, as the kept-light member. A friend takes part only once the providers' data processing terms are in place (`infra/README.md`, "Founder tasks: data processing terms"), and uses only scripted test content, so staging holds nothing real but the friend's name, Telegram account and consent rows, which you delete when the week ends (`plan/materials/pilot/README.md`, "Before any family"). Your own parent is not onboarded: Russia's Federal Law 152-FZ, with the localisation rule of Law 23-FZ of 28 February 2025, forbids storing a Russian citizen's data outside Russia, and Telegram has been largely inaccessible in Russia since mid-March 2026 (`plan/materials/pilot/legal-memo.md` Q6). Your parent waits until a channel works in Russia and a lawyer has advised on 152-FZ; Russia stays deferred (`market-order.md`).
- The entity decision by week 6, so billing can open at week 12.
- A native reviewer for the Traditional Chinese copy, and the first families living in Taiwan (your friends and their families), onboarded from day 14, after the dogfooding week passes and production is deployed.

## What I do first, tomorrow

1. Privacy notice and consent script (EN, ZH-TW) for the pilot.
2. Bot to spec Appendix A, with the event log.
3. Prompts v0 and the eval set.

---

## Morning pass (kept for history)

### Verdict, morning

We were not ready to build the MVP. Three things stood between us and the first line of app code: zero evidence (no survey responses, interviews, or pilot family); a spec that contradicted itself (v1 described a Vela-composed "I'm fine" arrival; the interaction model replaced it with asks from people); and a payments decision that could not be opened (Stripe does not onboard Taiwan-registered businesses; the workarounds are a US or UK entity, or a merchant of record such as Lemon Squeezy, Paddle, or Polar).

### Gaps by tier, morning

Tier 1 (before MVP code): phase-0 evidence; spec v2; phase-0 instrument redesign; payments and entity; privacy and consent pack; AI prompts and evals; accounts. Tier 2 (during the build): DDL, API contract, analytics events; test strategy; SLOs and observability; content bank; messenger conversation design; name clearance; landing page; budget. Tier 3 (before launch): store listings; support and incident runbook; terms, refunds, pricing test; WhatsApp templates, LINE setup, MAX terms; a usability test with three people over 70.

Sources for the payments finding: [Stripe global availability](https://stripe.com/global), [doola: Stripe in Taiwan](https://www.doola.com/stripe-guide/how-to-open-a-stripe-account-in-taiwan/), [incorpuk: Stripe in Taiwan 2026](https://incorpuk.com/blog/how-to-open-stripe-account-in-taiwan/), [Lemon Squeezy 2026 update](https://www.lemonsqueezy.com/blog/2026-update), [Lemon Squeezy vs Polar vs Paddle](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026), [Merchant of record platforms 2026](https://dodopayments.com/blogs/best-merchant-of-record-platforms).
