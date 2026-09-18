# Silence drill

18 September 2026 · architecture §1 constraint 5, §14, §16 · code design §8 · build plan 1.3, 1.8, 3.6 and "the silence drill runs nightly from sprint 1"

What it proves: **a real silence produces exactly one quiet notice, and our own failure never produces one.** A quarter of days go unanswered even when everything works (research/08), so both halves matter: a notice that never comes, and a notice that comes because we failed, both break the promise.

## When to use it

- **Automatically:** every night in CI, from sprint 1.
- **Live, in staging:** before the first family; after any change to the scheduler, the gateway, the quiet ladder or an adapter; monthly during the pilot; after an incident involving missed or late arrivals.
- **Never inject failures in production.** Production is covered by the daily review at the end.

## Part numbers

The build plan refers to these parts; the CI suite in `@vela/services` implements each as a named test.

| Part | Scenario | Expected result |
|---|---|---|
| 0 · control | The kept-light member does not answer | One repeat at delivery + 150 min ("In case you missed it:"); one quiet event at delivery + `quiet_after_min`; during the learning period the organiser is notified only from delivery + 480 min; a late answer resolves it with outcome `answered_late` and tells everyone who was told |
| 1 · delivery fails | The adapter fails for a cohort (blocked, unavailable) | Retries at 5, 15 and 30 min for temporary errors; `outbound.status = failed`; the organiser gets `delivery.failed` once; no repeat and **no quiet event** for that exchange |
| 2 · missed wake | A Durable Object alarm never fires | Reconciliation finds the member more than 10 min overdue, logs `scheduler_missed`, delivers once (with "Sorry this is late." past 180 min), never twice; the heartbeat is recorded when the run finishes |
| 3 · database down | Postgres unreachable during a tick | The tick skips cleanly; the webhook answers 500, so Telegram redelivers; an error in the logs; no quiet event; the next tick catches up |
| 4 · AI down | Claude or Deepgram fails | The light is lit on the raw answer; the family sees the answer with its media; `ai_calls.ok = false`; no quiet event; `understood_at` stays empty; `reconcile` re-runs the answer from 15 minutes after it arrived, with at most three attempts in all, without a second transcript post, translation or flag notice; after the third failed attempt the admin conversation gets `admin.understand_failed` once, with a link and no words (`architecture/decisions.md` ADR-25, [`incident.md`](incident.md)) |
| 5 · answer before the arrival | The kept-light member writes before her arrival time, the day after a delivered morning | The message goes to the previous day's exchange and the group; the arrival is still delivered at her hour; no repeat and **no quiet event** that day, because the earlier message counts as the day's answer (spec §19, `architecture/04-instrument-flows.md` §3.9) |

## Live drill in staging

Takes one morning. Needs two Telegram accounts the founder controls (one as the organiser, one as the kept-light test member), and the staging test family "Drill" in the founder's time zone. Never change these values in production.

**Setting the arrival hour H.** The founder does this in the Neon console, in staging's own project `vela-staging`, its default branch (the co-founder holds no staging connection string). Changing `arrival_time` alone does not move the scheduler: the member's alarm and `next_wake_at` still hold the old wake, and reconciliation only picks up members whose `next_wake_at` is empty or more than 10 minutes late. So clear `next_wake_at` in the same statement, choose H at least 30 minutes ahead (reconciliation runs every 15 minutes), and use a morning whose arrival has not been delivered yet: the scheduler delivers one arrival per local day. First check today's exchange:

```sql
SELECT scheduled_for, state, delivered_at FROM exchanges
WHERE recipient_id = '<test member id>' ORDER BY scheduled_for DESC NULLS LAST LIMIT 2;
```

If today's row has a `delivered_at`, run the drill on another morning. Otherwise:

```sql
UPDATE members
SET arrival_time = '<H, as HH:MM>', learning_until = current_date - 1, quiet_after_min = 240, next_wake_at = NULL
WHERE id = '<test member id>';
```

`learning_until` in the past makes the notice use the normal path; 240 minutes is the real floor. Within 15 minutes `next_wake_at` shows H in UTC; if it does not, stop and tell the co-founder.

**A · Real silence (part 0).** Set the arrival hour H as above. Do not answer.
Expect: the arrival at H; the repeat at H + 2:30; the organiser's quiet notice at H + 4:00 with the facts and the buttons. Tap **Wait 2 hours**: "I'll look again at [time]." Answer from the test member at about H + 4:30: the organiser sees "[Name] answered at [time]. Everything is lit again." In the database: one `quiet_events` row, outcome `answered_late`.

**B · Delivery failure (part 1).** On another morning, set H as above, then block the staging bot from the test member's account 10 minutes before H.
Expect: the organiser receives "We couldn't reach [Name] on Telegram today. Nothing else is known." exactly once; `outbound.status = failed`; no repeat; still no quiet notice at H + 5:00; no `quiet_events` row for that exchange. Unblock the bot afterwards.

**C · Heartbeat and watchdog (part 2's alarm path).** Needs `staging` enabled in `.github/watchdog.json` (`infra/README.md`, section 6). In the Cloudflare dashboard ("Vela staging" account), go to the **Workers & Pages** page, select the pilot Worker `vela` (the admin Worker `vela-admin` has no cron), **Settings → Triggers → Cron Triggers**, select the three dot icon next to the 15-minute cron (`*/15 * * * *`), and select **Delete**. Note the time.
Expect: `https://vela.vela-light-staging.workers.dev/healthz` answers 503 with `{"status":"stale"}` once the last successful reconcile is more than 35 minutes old; the watchdog's next scheduled run after that fails with a summary naming `staging` and `stale` (or run it at once: **GitHub → Actions → watchdog → Run workflow**), and GitHub emails the founder; any arrival due meanwhile is still delivered by its Durable Object alarm. Write down how long the email took after the cron was deleted: up to about 50 minutes, longer when GitHub delays scheduled runs. Restore by redeploying the pilot Worker (`pnpm --filter @vela/worker exec wrangler deploy --env staging`, which replaces the Worker's cron triggers with those in `wrangler.jsonc`); `/healthz` answers `ok` within 15 minutes, and the next watchdog run is green.

**D · AI down (part 4).** The founder replaces the staging `ANTHROPIC_API_KEY` with an invalid value. The test member answers with a voice note.
Expect: "☀️ [Name] answered [asker] · [time]" in the group within seconds; the answer posted with its voice note even without a summary or translation; `ai_calls` rows with `ok = false`; no quiet notice; the answer's `understood_at` empty. Restore the key within 10 minutes of the answer by creating a new staging key in the Anthropic console, installing it, and deleting the old key ([`secrets-rotation.md`](secrets-rotation.md)). Then expect, between 15 and 30 minutes after the answer: `reconcile` re-runs it, `understood_at` is set, and the transcript appears in the group exactly once (ADR-25). If the attempts are used up first, the staging admin conversation gets `admin.understand_failed` once, with a link and no words, and the answer is listed by the query in [`incident.md`](incident.md).

Parts 3 (database down) and 5 (answer before the arrival) run in CI only.

## Production: the daily review

Every day in the admin page, the founder checks:

- Every quiet notice has an outcome.
- No quiet notice exists for a day whose arrival failed, and every notice came at least `quiet_after_min` after the actual delivery time, not the scheduled hour. **One notice that breaks either rule is a Sev 1 incident and a kill signal** ([`incident.md`](incident.md)).
- Answers from the last day that are still not understood: every `admin.understand_failed` notice (open its link), and the query in [`incident.md`](incident.md), which also finds answers `reconcile` never re-ran. Their flag check never succeeded, so read each and tell the organiser by hand about anything that matters, with her words only when she has a standing health-words yes ([`incident.md`](incident.md), "Answers whose AI calls failed").
- The watchdog: no failure email since yesterday, or each one explained in an incident note. Once a week, the latest `watchdog` runs in **GitHub → Actions** are green and still scheduled (GitHub disables a scheduled workflow in a public repository after 60 days without repository activity; `infra/README.md`, section 6).
- Weekly: the counts of `scheduler_missed` and `arrival_delivery_failed`, and whether they are rising.

## How to know it worked

- CI: the nightly workflow is green. A red nightly run is a Sev 2 incident, and nothing is released until it is green.
- Staging: every scenario in the log below passed with the observed times written down.
- Any failure: no new family is onboarded until the cause is fixed and a test for it passes.

## Drill log

| Date | Scenario | Expected | Observed (times) | Pass | Notes | By |
|---|---|---|---|---|---|---|
| | | | | | | |
