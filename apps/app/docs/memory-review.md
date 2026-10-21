# Conversational memory review

## Scope and authority

The approved Light direction is in product/06-light-memories-wellbeing.md. This change builds a
reusable parent-facing decision view, a session-scoped controller and a synthetic development
preview. It does not wire permanent keeping, source extraction, consent acceptance or an API.
The candidate backend from PR132 and durable keep backend from PR135 are independent and remain
unwired/off in runtime configuration. PR136 adds personal-copy pages, not complete export delivery.

Operate mode: the parent reads a meaningful quote, checks its original conversation and decides
whether to keep it beyond 30 days. Approved revised policy: suggestions and keeps are author-private
by default. Sharing requires a separate explicit named-audience grant; no sharing backend exists yet.
The existing Kept Light palette, Literata family words and labelled controls are visual authority.
No existing Today, Memories, Sunday, navigation, shared components or theme files were changed.

## Interaction contract

- Source: read the original question and answer, then return without changing anything.
- Keep: exact quote, longer retention explanation, private visibility, clear Yes and Back.
- Dismiss: leave a suggestion out; the original conversation is unchanged.
- Kept: readable collection, with a separate author-only removal decision.
- Failed change: retain the exact decision and quote; retry with the same idempotency key.
- Pending: do not claim success or accept duplicate submissions. Requests are bounded to 15 seconds.
- Unavailable source: remove the stale quote and say nothing new was kept.
- Refresh: clear stale words before rechecking permissions. Late older reads cannot replace new data.
- Account change/unmount: abort requests, clear words and keys, ignore late results.
- Screen transitions: host resets scroll through onScreenChange, so quote and consent text start
  at the top. Native screen-reader focus must be verified during real navigation integration.

MemoryReviewPort is an explicit transport boundary, not a backend implementation. A production
adapter must parse server responses, paginate bounded collections, enforce current identity,
author permissions, source revision, revocable consent and retention in the server transaction.
Client checks are convenience and defence in depth, never authorization. A timeout may hide an
already-committed write; retry must return the same result rather than create a second copy.
The internal backend now supports candidates/dismissal and durable keeping/read/removal. There
is still no authenticated HTTP adapter for this view and no real purpose-consent acceptance.
Author-wide withdrawal from PR137 is backend-only, not an app or messenger control.

The synthetic preview still uses old family-wide memory.keep@1 text. The backend now requires
proposed private memory.keep@2 and purpose consent.rich_memories@2; old confirmations are rejected.
Do not connect the preview unchanged or mistake its family-mode examples for live access.
Update the view/controller/catalogs to explicit audience-approved sharing before integration.
No real acceptance flow records these versions. Notice/language/safety review precedes activation.

## Preview and localization

Route: /memory-review-preview. The route requires __DEV__, explicit EXPO_PUBLIC_DEMO_MODE=true,
no API and no configured accounts. It has no production navigation entry and cannot become an
API fallback. All example words are synthetic; simulated decisions reset on reload/viewer/language
changes, make no network request and write no device storage.

The preview offers author/family views, failure and changed-source controls, reset and English /
Traditional Chinese. The isolated Lingui feature catalog lives under i18n/locales/memory-review;
its messages do not modify the shared app catalogs or activate the family's global locale. The
two feature message files are excluded from the global catalog and explicitly included in the
feature catalog. Both catalogs are still checked by normal Lingui extraction/sync. The nested
Traditional Chinese catalog is complete but remains a draft pending native-language review.

The view receives copy rather than freezing English text inside it. Integration must supply the
selected language and resolve per-person names, dates and permissions from authorized responses.

## Evidence and remaining work

- 14 controller cases: explicit confirmation, duplicate taps, stable retry keys, author-only
  actions, source unavailability, removal, failed dismissal, mismatched results, failed/late reads,
  account changes and stalled-request recovery.
- Feature catalog test checks complete Traditional Chinese, interpolation and compiler validity.
- Browser review exercised source reading, keep/cancel, failure/retry, kept collection, remove,
  family read-only controls, changed sources, keyboard Enter and Chinese layout. At 320px, the
  confirmation had no horizontal overflow and its primary action measured 64px high.
- Browser screenshots are review evidence, not native screenshots. Signed iPhone, VoiceOver,
  Dynamic Type, live Telegram, real consent, persistent storage and hosted capacity remain unproven.

The durable quote/keep-grant transaction and expiry/deletion races are implemented in PR135;
personal-copy reads are implemented in PR136. Next: approved notice and purpose-consent wording,
fresh acceptance presentations invalidated by withdrawal, and owner-authenticated app/messenger
adapters. A review draft is in plan/materials/pilot/memory-consent-review.en.md, not the live notice.
Verify actual keep/remove/withdrawal, free readable data copies and screening before linking this
view from live Memories. The weekly wellbeing report remains a separate slice.
