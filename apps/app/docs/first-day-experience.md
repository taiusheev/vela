# First-day feedback: implementation and evidence

15 October 2026. The founder explicitly asked for this direction to replace queued inbox PR #95.

## What changed

| Feedback | Implementation |
| --- | --- |
| Non-contact invitation links | Nearby invitations provide a native URL item on iOS, and a standalone HTTPS URL after the message elsewhere. Telegram on iOS and macOS shows links from people outside the reader's contacts as plain text, so since 16 October the invite ends with “If the link doesn’t open, add me to your contacts, then tap it again.” and the app tells the organiser the same after sharing, with text message as the other route. |
| Configure Mom before acceptance | Organisers may read and save invited parents' morning time and language. This saves configuration without consent, activation, a scheduler wake, or a message. Active parents retain the existing tomorrow-effective timing rule. |
| Shorter nearby requests | The shared invitation is two short sentences. The English consent request uses short paragraphs and keeps the role, optional acceptance, withdrawal, retention, operator and privacy link. Its version is saved with the outbound request; old pending requests keep their original version and text hash. |
| Talk anytime | Today’s Reply opens a named conversation. Text can be sent immediately on a connected messenger. The existing morning composer remains separate; a pending parent's first text can wait for their acceptance. History refreshes while the conversation is focused. |
| Empty top-right header | Today has a labelled Family action leading to settings. |
| First interactions and days | Pending families can do useful preparation, save their own first question and edit the morning. Today explains the first interaction and a quiet day, with an action to begin. |
| Human morning messages | Authored words remain unchanged. Since 16 October a family question reads as a signed note: the words, then “— Mia” below; the greeting rotates through three wordings by her local date; the how-to-answer line appears on her first three mornings only; anytime messages are signed the same way. Unattended fallback questions stay signed by Vela and no longer open with “Nothing new from the family today”. Nothing is sent in a family member's name that they did not write. |
| Personal questions | Versioned `suggest.v2` receives up to five recent, distinct, bounded questions written by the selected organiser to that parent. Other relatives, withdrawn/old questions and accepted AI drafts are excluded from style examples. New authored asks invalidate unused future drafts so the next writer can use the new evidence. This does not prove generated tone quality. |
| Two arrows on Reply | The additional forward arrow is removed; the labelled reply action has one reply icon. |
| Repeated logos | Shared screen headings no longer repeat the brand lockup. The original warm palette, family typography and window motif remain. |
| Lit-window interaction history | Seven dated windows per parent show days with real parent messages, delivered family questions, or delivered read-back replies. Unattended questions, app opens, scheduling and failed sends do not light a window. Dates use the parent's zone and quiet days do not reset earlier lights. This is a message record, not a wellbeing or reciprocal-contact claim. |

## Delivery and recovery

Immediate text is a `now` exchange with no scheduled morning date and a `conversation` outbound row. Migration 0015 expands two check constraints; it adds no tables or columns. Each explicit message has its own exchange-based delivery key, outside the automated daily-arrival budget. The API commits an outbound row before handing it to the existing queue. Lost handoffs use the existing reconciliation path. Retries reuse the saved request identity, including when a parent accepts between attempts.

Delivery effects mark an immediate exchange delivered without waking a morning ladder. The morning scheduler never selects a `now` exchange. A pause or lost consent prevents queued conversation delivery. Pending and failed immediate messages remain visible in history; acceptance is not a read receipt. Parent responses can attach to the latest immediate exchange, and a valid quoted arrival resolves to the specifically quoted exchange. Sent messages whose effect recording was interrupted are repaired before recording a response.

Conversation drafts are scoped to account, family and recipient; changing family/recipient remounts the composer. An unknown recipient cannot silently become another parent. Existing morning read-back replies and photo/voice tools remain available in exchange details. The new anytime composer currently sends **text on linked messengers**. In-app live audio/video calls and a live conversation on the separate parent web surface are not implemented here.

## Research and review artifacts

- [100-product research decisions](../../../design/audit/first-day/research/decisions.md): 34 messaging/community, 33 family/care and 33 ritual/journal products. Every row distinguishes public-source capability from a Vela design inference. No installed competitor audit or retention result is claimed.
- [Interactive prototype](../../../design/audit/first-day/prototype.html): pending invitation, first welcome, conversation, morning preferences, short helper request, first-week guidance and style-example review.
- [Exported app browser checks](../../../design/audit/first-day/app-verification.json) and [prototype checks](../../../design/audit/first-day/verification.json) use synthetic families only. Prototype style examples and call options are explanatory demonstrations, not shipped AI-profile management or calling features.

## Release order and remaining evidence

Run `pnpm check`, hosted PostgreSQL contention and all demo journeys. Deploy migration and both Workers before distributing an app that can send `now`; old app versions cannot request this new timing. Respect the shared production-release reservation. This branch is not a production release or an installed iPhone update.

Remaining device/provider checks: a newly received non-contact Telegram invitation on iPhone, native share-sheet transfer, consent Start/Yes/No, first delivery after saved pending preferences, real immediate delivery and reply, native keyboard/large text/VoiceOver, and timezone/retry behavior with the real messenger. Generated-question tone needs a controlled quality review and family feedback. Future evidence must distinguish provider acceptance, parent acknowledgement and actual read-back.

Local validation: `pnpm check` passed all nine workspace tasks, with 1,511 service tests, 310 passing app tests (one pre-existing future gate skipped), and 216 AI tests. The exported Expo web app passed eight journey/layout groups, covering five screens at 320, 390, 430 and 736 pixels, with no runtime page errors. The separate prototype passed ten interaction/layout groups. These results do not certify native sharing, signed-device behavior or real model style quality.
