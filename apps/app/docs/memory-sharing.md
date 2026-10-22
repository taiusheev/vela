# Named-memory sharing: internal reader and synthetic screen

The private collection and personal data copies remain author-only. The separate internal
`loadSharedKeptMemories` reader returns only an explicitly selected quote to its named recipient.
It does not expose the original answer ID or a source-conversation availability hint. It has
no HTTP route, service-barrel export, Worker caller, live app adapter or navigation entry.

Before pagination, the query checks the current authenticated account/member, membership
generation, current keep-sharing revision, confirmation version and grant time. Existing source,
author-account, consent, health, retention and deletion checks still apply. Later joiners and
new organisers do not inherit old permissions. Reads are not payment-gated. Ordinary source
expiry preserves chosen quotes; correction, withdrawal and invalidation do not.

## Screen and controller

`/memory-sharing-preview` requires development mode, explicit demo mode, no configured API and
no configured accounts. All words and people are synthetic, held only in memory. It is an
English draft, not consent acceptance. It makes no network request and writes no device storage.
Its real Lingui macros use a separate catalog; the family's locale and shared catalogs are
unchanged. Only English is loaded; generated Chinese/Japanese entries remain untranslated drafts.

The reusable view receives reviewed copy. It shows private/current audience, unchecked new
people, a separate exact-quote/named-recipient review, cancellation, failure/retry and stop-sharing.
Stopping sharing cannot recall something already read or copied. The preview can switch to a
synthetic recipient, fail the next action or invalidate the source.

The controller rejects another author's view, incomplete/duplicate audiences and mismatched
preview quotes, names, IDs or versions. It retains action keys on retry, prevents duplicate taps,
expires stale presentations without countdown pressure and reloads after writes. A successful
write followed by a failed read does not produce a success claim. Refresh clears old words
immediately; disposal clears session state and ignores late responses. Requests time out at 15s.

## Integration requirements

- Implement authenticated author-state transport and the port adapter separately. The new
  `MemorySharingView` contract is a future transport shape, not a server endpoint today.
- The author-state response must contain the COMPLETE current audience and eligible people,
  never a partial page silently treated as the whole set. The current bounded contract allows
  at most 50 recipients; larger families need an explicit integration design, not truncation.
- The server remains authority. Prepare and confirm must recheck current eligibility, authenticate
  the author, use server-owned single-use presentations and apply the COMPLETE selected audience.
  All writes go through the existing idempotent mutation boundary.
- A live client must reload on foreground/session changes, dispose on account/family change and
  clear stale words before rendering a new session. A synthetic perspective toggle is not proof
  of live account isolation or push invalidation.
- Keep reading, stop-sharing, removal, withdrawal and data-copy access independent of payment.
- Approve revised notices and translations, then build actual purpose/keep/share acceptance.
  Do not connect the older memory-review preview's keep@1/family-mode copy unchanged.
- Review native language, VoiceOver, Dynamic Type, signed-device and real-provider behavior
  before activation. No clinical advice, model processing or weekly-report engine is added here.

## Evidence

20 synthetic controller tests; 71 focused keep/sharing service cases; independent PostgreSQL
read assertions alongside existing stop/share and duplicate-confirmation races. Removing the
recipient predicates made the historical-access test fail; restoring them passed all 71 cases.
Browser review verified explicit review/cancel, Enter and Space selection, failure/retry,
recipient quote-only viewing and revoked access. Confirmation layouts at 320/390/768px had no
horizontal overflow and both actions measured 64px high. This is web evidence, not native proof.
The production-mode web export rendered this preview blank, with no console errors; its home
screen rendered normally as the positive control. No real-family access was exercised.
