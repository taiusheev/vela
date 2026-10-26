# Notifications that earn their place

Vela's notifications should help a family respond or prepare a real exchange. Opening the app is not the goal. A useful reply or a prepared morning is.

## The workflow

| Moment | What the family receives | Interruption | When to stop |
| --- | --- | --- | --- |
| A parent answers a question | A short notice that the parent answered; tap opens the exchange | Silent; ordinary phone notification | Routine alerts off, outside the reader's 08:00–21:00, previous local day, or 12 hours after queueing |
| The evening before a person's turn | An invitation to prepare tomorrow's question; tap opens the suggestion | Silent; passive on iPhone | Routine alerts off, outside waking hours, turn already acted on, holder changed, missing turn, or tomorrow has begun for the parent |
| A morning stays quiet under Vela Light | Existing quiet notice; tap opens the quiet workflow | Existing audible, time-sensitive notice | Existing quiet-event and Light rules apply |
| A quiet morning is settled | Existing resolution, replacing the quiet event's lock-screen slot | Existing quiet-channel behavior | Existing quiet-event closure rules apply |

Routine notifications remain at most one **of each kind per member per day**, under the existing database budget. This is not a single account-wide daily limit. The setting is therefore called **Replies and turn reminders**, replacing the misleading **One moment a day**. Quiet-morning notices remain separate, as the existing settings explanation states.

The queue checks routine relevance immediately before handing a notification to the delivery provider. Provider expiry is also shortened to the remaining 12-hour freshness window, the reader's 21:00, and (for a turn) the parent's midnight, whichever comes first. An offline phone should not receive an old reminder with a newly reset delivery window. Provider expiry is a delivery request, not proof of exactly when a phone displays an alert.

## Permission and control

Keep the existing contextual offer after family setup or a first ask, plus the control in Settings. Do not ask at app launch. A person should understand the benefit before the system permission prompt appears. Keep permission refusal recoverable through phone settings. Turning off routine alerts must not remove the exchange from Vela.

Lock-screen text continues to contain only the permitted name/time information. Family answers, health words, question text, and voice content stay out. No badges, streak pressure, guilt, or repeated comeback reminders.

## What this change implements

- Reject stale routine queue entries, including the exact 12-hour expiry boundary.
- Bound offline provider delivery by bedtime and remaining freshness.
- Recheck a turn's holder, completion, existence, and the parent's local day before sending.
- Rename the routine notification control in English and Traditional Chinese.
- Preserve existing Light behavior, permission flow, notification budgets, and privacy boundaries.

The turn check is a last-moment relevance check, not a lock spanning an external delivery request. A turn completed after that check can still race with provider acceptance. An alert already handed to a provider cannot be reliably recalled by this server check.

## Follow-up product work

1. Separate reply and turn switches if family testing shows people want replies without reminders. That requires an account preference contract and storage change.
2. Evaluate a true account-wide routine cap and a cooldown across parents. Prefer replies over reminders, but do not silently discard an important reply merely because an evening prompt used the budget.
3. Offer user-selected quiet hours and timezone handling with clear travel behavior. The current fixed 08:00–21:00 window is retained.
4. Consider suppressing answer alerts when that exact exchange is already open. This needs a deliberately limited presence/read signal; it is not collected by this change.
5. Validate whether a settled morning needs sound, and whether a person should receive both Telegram and app alerts. These change Vela Light expectations and need a separate review.

## Release evidence

Use synthetic families for automated checks. Verify stale queues, bedtime expiry, completed and reassigned turns, timezone differences, preference changes, quiet notices, deep links, and permission recovery. Before release, check a real iPhone's foreground/background behavior, Focus, offline delivery, lock-screen replacement, and both languages. Automated provider acceptance is not device-arrival evidence.

Judge usefulness through observed family responses and prepared mornings, alongside notification-off feedback. Delivery and failure logs already exist without message content. This change adds no analytics collection or automatic experiments, and enables no production capability.
