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

- The internal `loadMemorySharingView` now supplies authenticated author-only state. Implement
  HTTP transport and the live port adapter separately; it is not a server endpoint today.
- The author-state response must contain the COMPLETE current audience and eligible people,
  never a partial page silently treated as the whole set. The current bounded contract allows
  at most 50 recipients; larger families need an explicit integration design, not truncation.
  The internal loader returns null on overflow or ambiguous/invalid names. The reusable view
  now offers independent stop-sharing after a failed/unavailable detail load. Live integration
  must preserve that free path and removal/withdrawal, not disable them with the audience read.
  No live UI is connected yet.
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

## Current author-state reader

The internal loader uses one repeatable-read, read-only database snapshot for ownership, kept
source/consent eligibility, sharing revision and recipient permissions. It loads the entire
bounded eligible audience, not a first page. Current active/paused members with live bound
accounts are eligible; self, departed, invited, deceased and unbound/deleted accounts are omitted.
Current grant account/member generations, sharing revision, version and time decide `shared`.
No one is selected merely for joining, paying or becoming an organiser. Names are trimmed and
checked for normalized ambiguity; invalid/ambiguous names fail closed rather than guessing.
No new tables, receipts, cached quote copies, writes or payment requirement are introduced.

Snapshot results are observations as of the read, not authority to share later. A stop committed
while a read is in flight can make that snapshot old. The next read sees the stop, and prepare/
confirm must still revalidate the latest server-owned state. A real PostgreSQL test commits stop
on a second connection while the first snapshot is open, verifies the coherent old view and then
the fresh private view. Weakening isolation to read-committed makes this test fail.

## Independent revocation recovery

The controller now requires explicit immutable author/member and memory IDs. A server response
for another memory is rejected without showing its words or retargeting any later stop action.
Malformed scopes make no requests. A route ID is only a locator; it never authorizes a write.
The future live adapter/server must authenticate and authorize the current author on every stop.

After a failed or unavailable read, words remain hidden but Stop sharing and Check again remain
available. Retry is disabled while stopping; the stop action keeps its key across failed attempts
and ignores duplicate taps. It still reloads after writes: if that read fails, no success is claimed.
Disposal disables actions, clears words/keys and ignores a late stop response. Phase changes scroll
the preview back to the relevant heading, so a failed read is not hidden below the old screen.

28 controller tests now cover the original flow plus first-read failure, persistent unavailable
details, failed stop/retry, duplicate taps, wrong-memory responses, malformed scope and disposal.
Restoring the former requirement for a loaded view made the first-read revocation test fail;
the independent scope restores it. All examples remain synthetic and the only port is memory-only.
Browser review exercised failed details, failed stop, keyboard retry, refreshed private status
and a recipient with no access. At 320/390/768px both recovery actions measured 64px high, with
no horizontal overflow or old quote in the failed screen. Native accessibility remains unverified.
The updated production-mode export, even with demo mode explicitly enabled, rendered the preview
blank without console errors. Its synthetic home rendered normally as the positive control.
