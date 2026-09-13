# Incident runbook

Architecture §13–15 · founder leads, co-founder investigates with content-free data

## When to use it

- Healthchecks.io pages: no heartbeat for more than 10 minutes.
- Sentry alerts: Postgres unreachable, an arrival unsent past its hour + 5 minutes, adapter failures above 5% in 15 minutes on one channel, dead-letter queue growth, a budget-index rejection for `arrival` or `quiet_notice`.
- A family reports: no morning message, two messages, a message to the wrong person, or a quiet notice on a day our message failed or was late.
- A secret or personal data may be exposed.

Not an incident: one AI or transcription call failing, or one person blocking the bot. The light is already lit, but a failed call is **not retried**: `@vela/ai` resolves every provider error to a safe default, so that answer is stored with summary "answered" and no flag, and its flag check never runs. The founder's daily review ([`silence-drill.md`](silence-drill.md)) reads such answers by hand ("Answers whose AI calls failed", below).

| Severity | Meaning | Respond |
|---|---|---|
| 1 | Families affected now, or personal data may be exposed | Immediately, any hour |
| 2 | Degraded; families not affected yet (DLQ growing, AI down, failures rising) | Within 2 hours, and before the next arrivals are due |
| 3 | No family impact (staging broken, one alert that should never fire) | Next working day |

## Steps

1. **Open an incident note** (private, family codes only, no message content): time, who noticed, the symptom, severity. Add a line for every action.
2. **Protect the families first (first 15 minutes).**
   - If a recent release is a plausible cause, roll it back before diagnosing ([`release.md`](release.md), Rollback).
   - Open the admin page: for each affected member, was today's arrival delivered, late or failed? Did any quiet notice go out on a day our message failed or was late? If yes, send that organiser the correction below now.
   - A message to the wrong person, a leaked credential or exposed data: go to step 5 at once, then come back.
3. **Find the failing layer.**

   | Symptom | Look first |
   |---|---|
   | Heartbeat missing | cloudflarestatus.com (Workers, Cron Triggers, Durable Objects); Workers Logs for the `scheduled` handler. Durable Object alarms still deliver arrivals if only cron is degraded: confirm in the admin |
   | Postgres unreachable | neonstatus.com; Neon plan limits (compute hours, storage); the Hyperdrive configuration. Webhooks answer 503 and Telegram retries |
   | Adapter failures | Telegram `getWebhookInfo` (last error, pending updates); 429 rate limits; a revoked token |
   | Dead-letter growth | The DLQ messages (ids only): fix the cause, then re-drive |
   | Two arrivals in one day | Should be impossible (`exchanges_one_per_day`, `outbound_budget_idx`); treat as Sev 1 and a kill signal |
   | AI or STT down | Sev 2. Arrivals, the light and the group posts still work, but nothing is retried: every answer in the outage keeps the safe defaults (no transcript or translation, summary "answered", no flag), so words about a fall or pain would not reach the organiser. Once the provider is back, read each affected answer (below) and pass any words that matter to the organiser by hand the same day |

4. **Fix and verify** through the normal release path (hotfix PR → CI → tag). Wait until reconciliation logs no `scheduler_missed` for 15 minutes, the admin shows every due arrival delivered or marked late, and the DLQ is empty.

### Answers whose AI calls failed

No re-run of `understandAnswer` exists yet (flows §3.10 has none); until it does, the founder does the flag check by hand. In the Neon console, branch `main`, first log the read for each family you will open ([`data-requests.md`](data-requests.md), rule 2), then list the answers since the outage began:

```sql
SELECT a.id, e.family_id, a.member_id, a.received_at, a.kind, a.transcript, a.payload
FROM answers AS a
JOIN exchanges AS e ON e.id = a.exchange_id
WHERE a.received_at >= '<outage start, with zone>'::timestamptz
  AND (a.understood_at IS NULL
    OR EXISTS (
      SELECT 1 FROM ai_calls AS c
      WHERE c.input_ref ->> 'answer_id' = a.id::text AND c.ok = false
    ))
ORDER BY a.received_at;
```

Read each text; for a voice answer without a transcript, listen to the voice note (its `media.storage_key` names the object in R2, "Vela" account). For any mention of a fall, pain, a stranger at the door or a request for money, send the organiser her own words, as `flag.notice` would have. Note in the incident note how many answers were read, never their content.
5. **If personal data may be exposed:**
   1. Contain: rotate the credential ([`secrets-rotation.md`](secrets-rotation.md)); rotate `ADMIN_TOKEN` if the admin page could be involved; remove any public access; delete a misdelivered bot message (Telegram lets a bot delete its own messages for 48 hours).
   2. Scope: which families and people, which data, from when to when (`outbound`, `admin_access_log`, Cloudflare and Neon audit logs).
   3. Tell the affected people **within 72 hours** of learning of it, in plain words: what happened, what data, what we did, what they can do, how to reach the founder. Organisers first; organiser and founder agree how to tell the person the light is for (a call, not a message).
   4. Notify the Taiwan authority as the amended Personal Data Protection Act requires, confirming the current rule and deadline with counsel at the time; for any EU family, 72 hours to the authority. Record every breach, including ones that need no notice.
6. **Tell organisers** of affected families before they would notice, using the templates below.
7. **Close** after 24 hours stable. Within 48 hours write a review in the incident note: timeline, families affected, whether any double send or false quiet notice happened, cause, and the test that would have caught it. **A double send or false quiet notice caused by us that the tests did not catch stops onboarding**: no new family until that test exists and passes (build plan, kill signals).

## Messages to organisers

| Situation | English | 繁體中文（待母語審閱） |
|---|---|---|
| Late arrival | This morning's message to [Name] was late because of a problem on our side, not anything at [Name]'s. It has now been sent. [Founder], Vela | 今天早上給 [名字] 的訊息晚送了，是我們這邊的問題，和 [名字] 那邊無關，現在已經送出。[創辦人]，Vela |
| False quiet notice | Please disregard today's quiet notice about [Name]. Our morning message did not go out on time, so the notice was wrong. Nothing is known to be wrong at [Name]'s. I'm sorry for the worry. | 今天關於 [名字] 沒有回覆的通知請忽略。我們早上的訊息沒有準時送出，所以那則通知是錯的。目前沒有任何跡象顯示 [名字] 那邊有狀況。讓您擔心了，真的很抱歉。 |
| Data exposed | Something went wrong on our side: [what happened]. It affected [what data] between [times]. We have [what we did]. [What they can do.] Reply here or write to [CONTACT ADDRESS] with any question. | 我們這邊出了問題：[發生了什麼]。影響到 [哪些資料]，時間是 [時間]。我們已經 [採取的措施]。[對方可以做什麼。] 有任何問題，請直接回覆或寫信到 [聯絡信箱]。 |

## How to know it worked

Healthchecks shows the check up; the admin shows every due arrival delivered or marked late and no quiet notice on a day our message failed; the DLQ is empty; every affected organiser has been told; the review is written and links the new test.
