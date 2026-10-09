# Product week: 10–16 October 2026

Written 10 October 2026 by Claude (tech co-founder). For the founder, Claude and Codex. This week is about the product only: no new markets, no new features that cannot ship by Friday. We finish and polish what is built.

## The problem we are solving

An adult child cannot know, day to day, that a parent who lives alone is fine, without a check that makes her feel watched or makes it a chore for both of them. Vela's promise: **you know she's fine every day, and when she goes quiet, it means something.** The daily exchange is how we earn that signal; the light and the quiet notice are what the family values.

## What "done" means on Friday 16 October

1. **The loop works on a real iPhone, end to end, with real accounts.** Founder as organiser on the iPhone app, a test parent on LINE: ask → arrival at her hour → one-tap answer → light in the app within 30 s → reply → read back next morning → a quiet morning produces exactly one calm, correct notice. Recorded on the admin test-week checklist.
2. **The iOS build is ready for the App Store.** A signed build is on TestFlight (or waiting only on Apple's account approval), with privacy manifest, permission texts, icons, screenshots, listing, review notes and a review demo account. Submitting to App Review takes one command.
3. **The app is a pleasure to use.** Every core journey takes three taps or fewer, every screen has proper loading, empty, offline and error states, text scales and VoiceOver reads it, and there is something worth opening every day (her answer, her voice, the light).
4. **The signal is trustworthy.** Quiet notices are tuned to her own rhythm with a false-notice budget, delivery failures never look like silence, and the admin trial report shows the four numbers below per family.
5. **First families can start.** Production is deployed (`v0.1.0`), a founder onboarding runbook exists, and 3–5 English-speaking families are scheduled for onboarding calls.

## The four numbers (measured from the first family)

| Number | Target | Kill signal |
|---|---|---|
| Days she answers | ≥ 75% in weeks 1–4, ≥ 65% at week 12 | < 50% |
| Quiet notices marked useful | > 60%, fewer than 4 per parent per month by month 3 | < 30% useful |
| Missed real trouble | 0 | any |
| Parent stop rate | < 10% in month 1 | > 25% |

Supporting: fallback-hello share of mornings (family stopped asking) under 15%; replies heard next morning on ≥ 50% of answered days.

## Who does what

Ownership is by path, so Claude and Codex never edit the same files. API contract changes: Claude writes the contract and server first, Codex builds on the merged contract. Migrations only by Claude.

| Owner | Paths |
|---|---|
| Claude | `packages/core`, `packages/services`, `packages/db`, `packages/ai`, `packages/contracts`, `apps/worker`, `infra`, `plan` |
| Codex | `apps/app` (screens, components, i18n, EAS/iOS config, Maestro), `plan/materials/stores` |

### Claude: the signal and going live

| # | Task | Done when |
|---|---|---|
| C1 | Quiet threshold from her own spread, not median + 2 h | Done (PR #61): later of median + 2 h and her 90th-percentile latency + 1 h, floor/cap kept |
| C2 | The four numbers on the admin trial report | `/admin/trial` (every kept-light member) and each family's trial page: answer rate outside away days, useful share, notices per 30 days, true concerns, stops, fallback share, replies heard, each against its target |
| C3 | Ask supply: the family keeps asking | The organiser is told (once, calmly) when the next two mornings would be a fallback hello; turn prompt shows two ready suggestions; fallback share on the report |
| C4 | Delivery failure is never silence | Verified on main 10 Oct: a failed arrival sets `delivery_failed_at`, tells the organisers on that channel (`delivery.failed`), and no repeat or quiet can follow (`gateway-effects.ts` `arrivalFailed`, `quiet.ts`); the app shows it separately (PR #59) |
| C5 | Production `v0.1.0` | Preflight PASS on production, deploy, smoke, restore drill; needs founder keys |
| C6 | First-family runbook | `plan/materials/trial/first-families.md`: the onboarding call script, what to set up, what to check on day 1, 3, 7, 14 |
| C7 | Real-device test week | Admin test-week checklist green with the founder's iPhone and LINE test parent |
| C8 | API support for Codex | Any endpoint Codex needs for the app work (e.g. Today summary fields, push registration checks) within half a day of asking |

### Codex: the app and the App Store

| # | Task | Done when |
|---|---|---|
| X1 | iPhone experience audit | Every screen walked on an iPhone simulator and in Expo Go; a list of friction points ranked; taps counted for the five core journeys |
| X2 | Fix the friction | Core journeys ≤ 3 taps; loading/empty/offline/error states everywhere; no dead ends; copy calm and specific |
| X3 | Today is worth opening | Her answer, her voice and the light first; one-tap heart and reply; "your turn" with ready suggestions; the "done for today" state |
| X4 | Accessibility and comfort | Dynamic Type to the largest size without clipping, VoiceOver labels, 44 pt targets, dark mode, reduced motion |
| X5 | iOS release pack | `PrivacyInfo.xcprivacy`, permission texts, icon/splash at all sizes, `eas build --profile trial` and `eas submit` ready, App Store screenshots (6.7" and 6.1") from the simulator, review notes and a demo account path |
| X6 | Push on iPhone | Answer arrived, your turn, quiet notice — at most one non-urgent push a day; permission asked at the moment it helps, not at launch |
| X7 | Crash reporting | Provider chosen by the founder; no content, names or tokens in reports; the notice names it |
| X8 | Maestro journeys on iOS simulator | Onboarding, ask, reply, quiet notice, away, delete account all pass |

### Founder

| When | Task | Why |
|---|---|---|
| Saturday or Monday | **Buy Apple Developer (US$99, individual or organisation)** | Enrolment can take 1–2 days; it blocks TestFlight, push and the App Store |
| Monday | Production keys at the hidden prompts (OpenAI, content key, Telegram/LINE production bot, Clerk production) | Blocks C5 |
| Monday | Choose crash reporting (recommend Sentry, free tier, EU or US region) | Blocks X7 and the notice |
| Monday–Wednesday | Recruit 3–5 English-speaking families with a parent living alone; book 30-minute onboarding calls for Thursday–Saturday | First families |
| Tuesday and Thursday | 30 minutes on your iPhone with the newest build; tell us everything that annoys you | X1/X2 truth |
| Daily, 2 min | Answer the test parent's morning on LINE | C7 |

## The week

| Day | Claude | Codex | Founder |
|---|---|---|---|
| Sat 10 | Plan; C1 | X1 audit | Apple purchase |
| Sun 11 | C1 merged; C2 | X1 list → X2 | — |
| Mon 12 | C2; C4 | X2; X5 start | Keys, crash choice, recruiting |
| Tue 13 | C3 | X3; X4 | iPhone session 1 |
| Wed 14 | C5 production; C8 | X5; X6 | Approve `v0.1.0` |
| Thu 15 | C6; C7 | X6; X7; X8; TestFlight build | iPhone session 2; first onboarding calls |
| Fri 16 | Review, fixes, report | Fixes, screenshots, submit-ready | Decide App Review submission |

## How we work

- Before editing, add a claim line to `../AGENT-CLAIMS.md`; remove it when the PR merges.
- Small PRs to `main`, merged only on green checks (`gh pr merge --merge`), each with a one-line "what the family notices".
- Every user-facing change is checked on the iPhone simulator (Codex) or with a test on the real loop (Claude), with a screenshot or receipt in the PR.
- End of day: one line each in the Notes of `AGENT-CLAIMS.md` — merged, blocked, next.
- Not this week: family book, recipes, memory, kitchen table, voice line, WhatsApp, Taiwan zh-TW launch, Android release.
