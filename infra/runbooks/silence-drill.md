# Silence drill

Architecture §1 constraint 5, §14, §16 · code design §8 · build plan 1.3, 1.8, 3.6 and "the silence drill runs nightly from sprint 1"

What it proves: **a real silence produces exactly one quiet notice, and our own failure never produces one.** A quarter of days go unanswered even when everything works (research/08), so both halves matter: a notice that never comes, and a notice that comes because we failed, both break the promise.

## When to use it

- **Automatically:** every night in CI, from sprint 1.
- **Live, in staging:** before the first family beyond the founder's own; after any change to the scheduler, the gateway, the quiet ladder or an adapter; monthly during the pilot; after an incident involving missed or late arrivals.
- **Never inject failures in production.** Production is covered by the daily review at the end.

## Part numbers

The build plan refers to these parts; the CI suite in `@vela/services` implements each as a named test.

| Part | Scenario | Expected result |
|---|---|---|
| 0 · control | The kept-light member does not answer | One repeat at delivery + 150 min ("In case you missed it:"); one quiet event at delivery + `quiet_after_min`; during the learning period the organiser is notified only from delivery + 480 min; a late answer resolves it with outcome `answered_late` and tells everyone who was told |
| 1 · delivery fails | The adapter fails for a cohort (blocked, unavailable) | Retries at 5, 15 and 30 min for temporary errors; `outbound.status = failed`; the organiser gets `delivery.failed` once; no repeat and **no quiet event** for that exchange |
| 2 · missed wake | A Durable Object alarm never fires | Reconciliation finds the member more than 10 min overdue, logs `scheduler_missed`, delivers once (with "Sorry this is late." past 180 min), never twice; the heartbeat ping is sent |
| 3 · database down | Postgres unreachable during a tick | The tick skips cleanly; webhooks answer 503; an error alert; no quiet event; the next tick catches up |
| 4 · AI down | Claude or Deepgram fails | The light is lit on the raw answer; the family sees the answer with its media; `ai_calls.ok = false`; no quiet event; `understand` retries later |

## Live drill in staging

Takes one morning. Needs two Telegram accounts the founder controls (one as the organiser, one as the kept-light test member), and the staging test family "Drill" in the founder's time zone. Set on the test member: `learning_until` in the past (so the notice uses the normal path), `quiet_after_min = 240` (the real floor). Never change these values in production.

**A · Real silence (part 0).** Set the arrival hour H a few minutes ahead. Do not answer.
Expect: the arrival at H; the repeat at H + 2:30; the organiser's quiet notice at H + 4:00 with the facts and the buttons. Tap **Wait 2 hours**: "I'll look again at [time]." Answer from the test member at about H + 4:30: the organiser sees "[Name] answered at [time]. Everything is lit again." In the database: one `quiet_events` row, outcome `answered_late`.

**B · Delivery failure (part 1).** On another morning, block the staging bot from the test member's account 10 minutes before H.
Expect: the organiser receives "We couldn't reach [Name] on Telegram today. Nothing else is known." exactly once; `outbound.status = failed`; no repeat; still no quiet notice at H + 5:00; no `quiet_events` row for that exchange. Unblock the bot afterwards.

**C · Heartbeat (part 2's alarm path).** In the Cloudflare dashboard, **`vela-api-staging` → Settings → Triggers**, remove the 5-minute cron.
Expect: Healthchecks marks `vela-staging-reconcile` down and emails within about 10 minutes; any arrival due meanwhile is still delivered by its Durable Object alarm. Restore by redeploying staging (`wrangler deploy --env staging` restores the triggers from configuration); the check is up again within 5 minutes.

**D · AI down (part 4).** The founder replaces the staging `ANTHROPIC_API_KEY` with an invalid value. The test member answers with a voice note.
Expect: "☀️ [Name] answered [asker] · [time]" in the group within seconds; the answer posted with its voice note even without a summary or translation; `ai_calls` rows with `ok = false`; no quiet notice. Restore by creating a new staging key in the Anthropic console, installing it, and deleting the old key ([`secrets-rotation.md`](secrets-rotation.md)).

Part 3 (database down) runs in CI only.

## Production: the daily review

Every day in the admin page, the founder checks:

- Every quiet notice has an outcome.
- No quiet notice exists for a day whose arrival failed, and every notice came at least `quiet_after_min` after the actual delivery time, not the scheduled hour. **One notice that breaks either rule is a Sev 1 incident and a kill signal** ([`incident.md`](incident.md)).
- Weekly: the counts of `scheduler_missed` and `arrival_delivery_failed`, and whether they are rising.

## How to know it worked

- CI: the nightly workflow is green. A red nightly run is a Sev 2 incident, and nothing is released until it is green.
- Staging: every scenario in the log below passed with the observed times written down.
- Any failure: no new family is onboarded until the cause is fixed and a test for it passes.

## Drill log

| Date | Scenario | Expected | Observed (times) | Pass | Notes | By |
|---|---|---|---|---|---|---|
| | | | | | | |
