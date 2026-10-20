---
name: guarding-family-data
description: Vela's rules for family data, consent and the privacy notice. Use before changing what Vela collects, keeps, shows, sends, logs or gives to the AI (answers, voice, photos, health words, weekly reads, readings, send-as-me, notices, consent), and before writing tests, fixtures, evals, screenshots or PR text that could hold a family's words.
---

# Guarding family data

Vela holds what an older parent and her family say to each other. A broken promise here costs the family's trust, and a pilot safety mistake ends the trial. When a rule below and a request conflict, stop and ask the founder in plain words: it is a product and legal decision, not a technical one.

**Family data** means anything a family member wrote or said (answers, transcripts, voice, photos, recipes, stories), her health words, names, phone numbers, Telegram and LINE ids, push tokens, and anything derived from them.

## The promise is the notice

The privacy notice and the consent script are what families agreed to:

- `plan/materials/pilot/privacy-notice.en.md` and `.zh-TW.md`, generated into `apps/worker/src/notices.generated.ts` (`apps/worker/scripts/notice-markdown.ts`)
- `plan/materials/pilot/consent-script.en.md` and `.zh-TW.md`

Before a change goes in, check it against the current notice. A change to what Vela collects, how long it keeps it, who sees it, what the AI receives, or what is sent in someone's name needs:

1. a new notice version (and consent script, if the ask changes), approved by the founder;
2. the feature behind a per-environment switch, off in production, pinned in `apps/worker/src/wrangler-config.test.ts` (as `MEMORY`, `BOOK` and `WEEKLY_INSIGHT` are);
3. the families told before production turns it on. The commit that turns it on changes the pinning test.

## Rules in the code

- **Logs.** Log an event name and flat fields through the `Logger` port. Never log message content, transcripts, phone numbers or tokens. Log a caught error as `errorLabel(error)`, never its message or `String(error)`: a failed query's message carries the family's words.
- **Storage.** What people wrote is sealed in the database (ADR-38). Retention clears her words at 30 days unless an ADR says otherwise (the family book, ADR-39). Do not add copies (caches, stats, logs, exports) that outlive retention or survive a withdrawal or account deletion (ADR-43).
- **The AI words, code decides** (ADR-46). The model gets no numbers to restate and may not add a pattern, cause, praise, concern or advice. No mood labels (`answers.mood_words` stays unused). Lines she can read never name a feeling she did not put into words.
- **Health words** never go to the model. They appear only as her own quoted words, under a current `consent.health_words@2` yes, from answers given after that yes (ADR-47). Never a diagnosis, test result or medicine name.
- **Founder-only readings** (ADR-48) stay on the admin draft page: never in the app's API, never in a sent message, never in "what does the family see".
- **Send-as-me** (ADR-49): only the organiser's own opt-in, only an AI draft written for them, never a bank question in a person's name; the family's view says "written by Vela".
- **Death or serious illness** is never inferred or acted on by code. The founder confirms it through admin, and every word about it is soft.

## Rules while building

- Tests, fixtures, evals, screenshots, logs pasted into chat, and PR text use **synthetic families only**. Never copy a real family's words, names, ids or photos into the repo or a PR.
- Never point a tool or MCP server at the production database. Reading production family data needs the founder's explicit yes for that specific read.
- Secrets never enter the repo or a chat; the founder enters them (`infra/README.md`).

## Before opening the PR

Write these answers in the PR description when the change touches family data:

- What data, whose, and who will see it.
- Where it is stored, and when it is cleared or withdrawn.
- Which notice line covers it, or which new version it needs.
- The switch's state per environment, and the test that pins it.
- The test that proves the gate (consent, switch or retention) holds.
