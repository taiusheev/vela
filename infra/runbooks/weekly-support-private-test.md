# Weekly support: wider private-test handoff

24 October 2026. Preparation only. No participants, phone builds, production data or switches changed.

## What this candidate supports

A non-medical, organiser-reviewed report for this week, read in the app by its parent and the
organisers the parent explicitly named. Exact parent text/voice transcript quotes; optional fixed
interest/company/practical-help offers; original-conversation links; editable offers using the
existing chat composer; removal, withdrawal and reload. The ordinary chat and urgent-concern paths
are untouched. No automatic report sending, diagnosis, mood inference, new AI call or billing.

Private-test cohort: English-speaking adults who already have their own signed-in app account
linked to their own existing family membership. The parent must use their own account; a child must
never consent through the child's account on their behalf. Messenger-only parents are **not** ready
for this candidate: the separate report-permission messenger path is not implemented. Do not admit
these families through an organiser's screen or record an internal yes to work around that limit.
The Chinese screen translation is a draft; participant permission is explicitly English only.

The existing weekly read and generic support cards remain available under their existing rules.
The new entry is invisible when the report endpoint is unavailable. The report always labels the
parent's original words and who reviewed each suggestion. No health scores or silent monitoring.

## Required approval and device evidence before participants

1. Founder approves the exact proposed purpose and named-reader explanation in
   `plan/materials/pilot/weekly-support-private-test-review.en.md`. Existing memory/health-word
   permission and the approved v8 memory notice do not cover this purpose. Finish the applicable
   notice/script review and tell each family before activation; this draft is not the live notice.
2. Founder selects a bounded private cohort and explicitly approves activating that cohort. No broad
   wildcard is supported. No real family IDs or words belong in Git, test fixtures or receipts.
3. Engineering verifies a signed test iPhone with synthetic accounts: independently linked parent
   and organiser, no-access account, two parents, offline/retry, app relaunch, readable permission
   names/text, VoiceOver, large text, source correction/removal, author stop and expired review.
   A web journey or bundle export does not satisfy this step. Any installation on a founder's phone
   needs their approval. Keep the existing production app unchanged during this verification.
4. Complete the private-test acceptance matrix below, inspect current-head CI and staging smoke,
   then prepare the exact test-build release for founder approval. A merge is not a phone release.

## Activation, by engineering after approval

This release keeps `WEEKLY_SUPPORT=off`, `WEEKLY_SUPPORT_NOTICE=""`, and
`WEEKLY_SUPPORT_FAMILIES=""` in **all** environments, pinned by `wrangler-config.test.ts`.

For an approved test environment only, a reviewed follow-up changes the switch to `on`, sets
`WEEKLY_SUPPORT_NOTICE=weekly-support-private-test@1`, and supplies at most 50 explicit comma-separated
family UUIDs in `WEEKLY_SUPPORT_FAMILIES`. The normal API/pilot admission and session checks still
apply. Malformed or missing configuration exposes no report data. Never put a wildcard, secrets or
participant names in this value. Production stays off. A stage environment containing real private
participants must be treated as real family data, not as an unrestricted engineering sandbox.

No source is processed until the parent reads the five-minute, one-use presentation and agrees.
It lists every current named organiser. Changing a name, membership/account binding or roster
invalidates an outstanding presentation. Consent covers only messages received after that yes.
To change the named audience, the parent stops and reviews a fresh permission; old quotes do not
backfill. New members and changed membership/account bindings receive no historical report access.

The organiser opens Week → Open the weekly support report → Review this week's messages. Read the
whole source, choose a fixed offer category, choose its relevance (1/3/7 days), confirm ordinary
content, language understanding and continued relevance, and approve. No approval happens on category
selection. Discarding writes nothing; saved offers can be removed or replaced. Up to 3 eligible
source-based offers are shown, with no filler for sparse weeks. This is a reviewed draft report,
not a medical report or an automatically sent message. The parent can read/remove offers and stop
reports. The ordinary chat composer still requires a deliberate Send; an unfinished draft wins.

## Data and recovery

- Inputs: the parent's own answer text or voice transcript in their current local Monday–Sunday
  week, after permission, before 30-day expiry. No private organiser feedback, admin readings,
  kept-memory copies, media bytes or family observations. Source messages are not duplicated.
- Existing understanding must have completed; flags, health mentions, unsupported language labels,
  scripts incompatible with the English/Chinese screening lexicons,
  sensitive whole text, withdrawn exchanges and expired/deleted words exclude a source. Typed messages use the parent's declared language (they have no voice-language field). Human
  review is still required; a model never declares its own input safe. No content goes to AI here.
- Persisted: permission version/notice/text fingerprint, encrypted named-audience snapshots with
  membership/account bindings; exact-source digests, fixed category/template version, reviewer,
  review time and expiry. No rendered quote, advice or complete report is stored.
- Discover up to 50 current-week source messages. Read approved sources by exact identifier, not
  through that discovery page; newer messages cannot displace an approved quote. Keep at most 3
  currently valid offers globally, including across calendar weeks. Discard invalid/expired
  references when saving another review.
- Recheck permission, active membership, audience, source digest, template version and screening on
  every read/review. Corrections, deletion, retention and withdrawal hide derived quotes on the
  next read. The app reloads on focus and every 30 seconds; read errors hide stale report content.
  Stop refreshes report queries in the current app. A screenshot already taken cannot be revoked.
- Stop bypasses processing/notice/cohort switches while retaining parent-only authentication.
  A parent who stopped daily messages or left the family can still withdraw through their own
  unchanged account/membership binding; this grants no report read or new processing. It
  rotates permission revision, clears audience names, removes review references and invalidates
  presentations in one transaction. Replays cannot re-enable processing. Parent locking serialises
  review/withdrawal. No stored report words can survive source deletion.
- References expire in at most 7 days after review and never more than 30 days after the source;
  approved offers stay visible across the week boundary until their individual relevance deadline. Nightly retention deletes expired
  presentations and selections. Family/author/source deletion cascades. Standing purpose metadata
  is kept while the author uses the family; stop clears its names, subject deletion removes it.
- Report queries exist only in session memory (`gcTime:0`), with no disk report cache. Write receipts
  contain identifiers/status only, never quotes. Logs use error labels, not bodies or message words.
- Rollback: set processing off first; leave authenticated stop available. Verify report reads 404,
  parent stop still succeeds, and no pending send exists (this feature creates none). Do not remove
  the tables before permissions/stops are handled. Do not change the legacy weekly concern path.

## Acceptance matrix and evidence

Run with synthetic accounts, not real-family copies. Save only synthetic screenshots.

| Case | Required result |
| --- | --- |
| Parent/no permission, no/stop, stale/expired screen | No quotes or suggestions, chat continues |
| Named organiser/parent vs stranger/new organiser/other parent/family | Exact authorised audience only |
| Member leaves/rejoins or account binding changes | Old audience grant fails closed |
| Parent ordinary message after yes | Exact quote + timestamp; approval required for fixed offer |
| Health outside a benign phrase, unknown language, failed understanding | Entire source excluded |
| Source corrected/deleted/expired, exchange withdrawn | Old reviewed item disappears; stale save conflicts |
| Review and stop from separate database connections, both orders | No references survive stop |
| Two reviewers race for the third slot | At most 3 active source selections |
| Cold open, offline/error, focus/pull refresh, parent switching | No stale quote exposed; bounded retry |
| Offer chosen with an existing chat draft | Draft preserved; no automatic or double send |
| Feature/notice/cohort off | Report unavailable; parent stop remains available |
| Sparse or new week | No filler; an earlier reviewed offer stays until its own deadline |
| More than 50 new messages | Approved sources are revalidated by ID and stay visible |

Automated gates: `pnpm check`; disposable PostgreSQL 18 `test:postgres`; Worker HTTP integration
with the real migrated synthetic database (part of Worker test); Maestro `weekly-private-report`.
Check newest remote results and the automatic staging release/protection smoke after integration.
Record the signed-device result separately. No clinical usefulness or real-family outcomes are
established by these engineering checks. For the first cohort, record useful/total reviewed offers
and corrections without collecting message words into analytics; stop expansion on any access leak,
unsupported personalised claim or surviving withdrawn quotation.
