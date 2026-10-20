# Parent setup, refreshes and notification settings

20 October 2026. The founder rejected the proposed visual directions and deferred the color and Today redesign. Existing navigation, conversation, Sunday, Memories and portrait/light presentation stay as they are.

## Less setup clutter in the parent's Telegram chat

After the parent chooses Yes, the original consent message keeps its exact consent text and choice. Telegram renders completed setup text as an expandable quote, with the choice outside it. The first-morning confirmation updates that same message through the existing durable outbound gateway instead of adding a separate thank-you bubble. The separate, optional health-words question remains separate; after it is answered its completed text also becomes expandable, with the recorded choice visible.

Consent versions, evidence hashes, opt-out behavior and the first-morning schedule are unchanged. Pending consent text is never collapsed. LINE retains its existing separate confirmation because it cannot edit messages. An event without a message ID also retains the separate confirmation.

The gateway records the existing Telegram message ID as the confirmation receipt. It retries temporary and uncertain edit failures without sending another bubble; repeating the same edit is idempotent. If Telegram explicitly reports that the message has been deleted or cannot be edited, the confirmation is sent as a new message. Already completed historical setup chats are not scanned, edited or deleted by this change.

Telegram's [MessageEntity documentation](https://core.telegram.org/bots/api#messageentity) defines `expandable_blockquote` and UTF-16 offsets. Formatting uses explicit entities, never markup interpreted from a parent's or organiser's name. Actual collapse/expansion appearance still needs a real Telegram client check.

## Share overlapping reads

Settings requests Today and Family together, both of which refresh the shared account query. Overlapping refreshes now join a request already in progress rather than cancelling and restarting it. The deterministic QueryObserver regression starts two overlapping cached-account refreshes and verifies one request, zero cancellations and the updated result. Independent reads start in parallel; successful pause changes also refresh Family and Account in parallel.

Explicit refresh still bypasses cache freshness, polling and permission checks remain in place, and authentication/session cleanup is unchanged. This verifies fewer redundant reads, not a real-device latency improvement.

## Notification preferences tell the truth

The existing Settings notification switch distinguishes loading, unavailable, saving, saved and refused changes. An unread setting is disabled and labelled as unread rather than described as a confirmed enabled preference. A failed initial read offers retry. Saving and saved feedback is announced; a refusal restores the server value. Rapid repeat taps cannot start simultaneous writes. Retrying the same failed choice reuses its idempotency key. The setting still controls ordinary notifications only; quiet notices keep their existing behavior.

## Validation boundary

Focused tests cover the durable confirmation update and retry/fallback behavior, preserved consent proof and timing, UTF-16 quote ranges and literal markup, overlapping reads, notification failure recovery and duplicate-tap protection. Root checks and browser/CI results are recorded with the change. Synthetic tests do not prove physical iPhone speed, real Telegram appearance/delivery, or VoiceOver behavior. No family-history cleanup, real messages, production deployment or app distribution is performed by these tests.
