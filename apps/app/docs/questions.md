# Questions: a personal message and a visible plan

The page has one job: help a family member ask something in their own words and decide which
morning it reaches their parent. The first action opens the editor; the schedule comes next;
one editable starting point comes last. No separate Story day, family-book link, report card,
format catalogue or unavailable format menu appears here. Conversations provide the stories;
saving a question creates no book entry or new memory permission.

The editor begins with words and an inline microphone. Ideas open only when requested, in three
short rows plus the current contextual suggestion. A chosen idea fills the editor; it never sends.
A single photo attachment remains available where enabled. Existing chat links still open the two-photo and voice composers. Editing an existing scheduled
question preserves its original format and attachments without exposing the old format menu. Voice questions
record for up to a minute, with stop, playback and discard; sending waits until recording stops.
The server allows five seconds of stop headroom so a full-minute recording is not rejected by a late native duration tick.

A date in the next two weeks, chosen on a small Monday-first calendar, or next free morning cover
planning. Mornings that already hold a question carry a dot and cannot be chosen. The initial
date skips mornings already claimed in the loaded schedule. The Questions page shows the same
calendar with an amber dot on each planned morning and opens one morning at a time under it: the
question with Edit and Remove, or a free morning with a way to plan one for that day. Questions
waiting for any free morning have no date and follow below the calendar. The recipient's calendar determines
the dates. The server remains authoritative during races. Saving returns to the same parent's
schedule and confirms the save. Questions can be edited or removed by their own author until
preparation starts. Prepared questions remain visible with an explanation. Edit text stays in screen memory and is not added to durable device storage. Existing new-question drafts keep their encrypted retry behavior. A rejected edit leaves
the existing question in place; media and delivery identity survive a successful edit.

Personalisation begins with a short first question in the organiser's own words. Optional ideas
help without requiring another setup form. Existing interests, language, chosen form of address,
permitted recent mentions and up to five recent organiser-authored questions supply context.
Unchanged stock questions are excluded from writing examples, alongside accepted AI suggestions,
AI-authored sends, other authors, other parents and expired/withdrawn examples. This avoids the
first-week question bank teaching Vela its own generic voice. No new profile, data category,
recipient or retention period is added. The existing opt-in for sending in the organiser's name
is unchanged. Prompt v5 discourages interview language, invented familiarity and style overfitting
from one sample. Prompt wording and automated tests do not establish that parents find it natural.

Review still needs real parent feedback on question quality, native Traditional Chinese review,
and signed-iPhone microphone/keyboard/scheduling verification. Local demos use synthetic families
only and cannot deliver messages. No production or phone release is part of this change.

## Reviewed personal drafts (31 October 2026, first implementation)

`/personal-question` is a three-step reviewed drafting flow. The Questions entry appears only in
explicit demo builds or when the server advertises `personal_questions`. Notes are request-only:
chosen address, current comfort, talking rhythm, the actual question intent, up to two examples
written by this child to this parent, one avoided topic, and wording the child would never use.
Changing account, family or parent destroys the form. These choices affect only this draft, not
standing automatic questions, morning check-ins, or a permanent relationship profile.

The optional `POST /v1/families/:familyId/personal-question-drafts` route uses authenticated,
rate-limited active sessions and authorizes both before and after provider work. Caller identity is
read from membership, never accepted from the body. It neither reads another sibling's examples nor
retrieves parent replies. No setup words or provider output are written to the database; AI usage
records retain counters and identifiers only. Quiet time and obvious boundary conflicts call no
provider. Failed or flagged output yields no draft, never a generic signed substitute.

Reviewed drafting uses `suggest.personal.v2`; existing nightly work continues using `suggest.v5`.
Explicit boundaries, grounded intent and restrained register precede style matching. Literal guards
are conservative checks, not proof of semantic safety or authenticity; human review remains required.

The child edits the result, explicitly confirms it, then picks an available morning in the existing
two-week calendar. Composing uses the existing idempotent API with `ai_assisted: true` and
`text_language`. The saved `ask_composed.from_suggestion` marker excludes these words from independent
human style evidence, including after editing. Authorship remains child-reviewed; this is not
unattended sending. Draft notes are not copied into a scheduled question or its options.

`PERSONAL_QUESTION_DRAFTS` defaults off. The founder-selected TestFlight test release enables it
only in staging for synthetic evaluation. Development and production remain off; production on is
refused until a separately reviewed activation change. No provider/model was changed and no live consent or delivery behavior
was migrated. Demo previews reuse supplied words and are explicitly labeled as examples, with no AI,
persistence, or sending. They do not establish model quality.

Next gates: run the expanded provider golden set and compare actual outputs; verify native behavior;
review parent comprehension and independent controls; decide the retained-profile contract and
retention; then implement relationship-sensitive automatic selection, invalidation and a first-month
review policy. A persistent profile, independent parent input, and adaptive automatic delivery are
not implemented by this first reviewed-draft slice. Real-family comfort and long-term benefit remain
unverified. A family pilot and production activation require their separate approved steps.


## Explicit private saved choices (31 October 2026, second implementation)

The request-only behavior above remains available. A separate, gated option now saves the child's
own setup for one parent: address, comfort/contact choices, 2 selected writing examples, up to 5
avoided topics and 3 unused phrases, plus language. The one-time question intent is never included.
`Save these choices for 30 days` is explicit. Loading or drafting does not renew the fixed expiry.
The private card shows the expiry date and expandable explanation/reload/forget controls. Initial
loading finishes before mounting the form, so an arriving response cannot overwrite newly typed words.
Switching account/family/parent destroys unsaved words and loads only that pair's authorized setup.

Saved choices are sealed, private to their author account and scoped to one parent. Siblings and
parents cannot read this setup through the app. Forgetting immediately clears saved words, hydrated
choices and the current candidate; a content-free revision prevents older requests from restoring
notes. Edited, forgotten or expired saved bases reject in-flight provider results and scheduling.
Conflict handling exposes Reload; expiry clears local choices/candidates even while the page is open.
The server validates the saved revision independently. Already-approved scheduled questions stay in
the schedule and must be removed there separately.

Own-data reads and forget remain available with collection/pilot admission off; saving requires both
personalization switches and parent eligibility. There is no durable device cache for these notes.
Example-mode saved choices live only in this screen's in-memory map, with explicit labeling, no
model, API persistence or sending. Tests use synthetic families; a browser demo is not a real-phone
or participant naturalness check.

Private profile collection is pinned OFF everywhere. Drafting alone is ON in synthetic staging
for the TestFlight test release; both switches stay OFF in production, which refuses ON. Migration 0032 adds only this private setup and lifecycle guards. The new notice supplement
question-profile.1 is **draft and unserved**. No nightly selection, check-in behavior or signer
setting is altered. Independent parent input, automatic-policy integration and first-month review
windows remain later approved implementation work; real-family activation is a separate gate.

## Consumer question flow and onboarding (31 October 2026)

The question itself now comes first. A person can type one intent and prepare a draft with unknown
comfort/contact choices; calibration is optional under **Make it sound like you**. A loaded quiet
choice remains visible and offers no draft. Address, comfort/contact, selected own-writing examples,
excluded topics/phrases and language remain editable there. Saving for 30 days is still explicit;
private data management and forget remain available inside the expanded preferences. Forget can
invalidate a pending provider result. No new collection, inferred defaults or automatic send is added.

The three stages now match the task: **Your idea → Your words → A morning**. Editing and explicit
approval occur before the calendar; editing the wording clears approval. The chosen date survives a
return to editing, but saving still requires current approval. The server remains authoritative for
eligibility, calendar conflicts, profile revisions and lifecycle. Stage changes return the scroll
position to the top. Phone-sized writing/review surfaces retain the existing Kept Light fonts and
palette, with a single primary action, named progress, keyboard insets and accessible disclosures.

**Onboarding decision:** keep the existing first question in onboarding; do not add another
relationship questionnaire before value. Its first-question screen now uses the same writing style,
a clear field label and a live delivery preview only after actual wording exists. It still uses the
existing manual first-question contract and privacy/save boundaries; no pre-consent AI call or
private-profile persistence is introduced. Detailed voice choices are offered contextually in the
reviewed-draft flow. Existing onboarding's other steps are unchanged by this scoped redesign.

Design basis: [Apple HIG: Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)
recommends brief, interactive and contextual onboarding;
[NN/G: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
supports deferring secondary controls. These are design guidelines, not evidence that this flow has
improved conversion or family naturalness; participant usability observation remains outstanding.

`personal-draft.yaml` walks the new idea/review/calendar path and optional quiet setting in the
synthetic web demo. Manual review covers 320/390 px layouts, English/Traditional Chinese, edited
approval, occupied dates, demo completion, profile management and onboarding. Native keyboard,
VoiceOver and participant behavior must still be checked on a signed phone; a browser capture is not
that evidence. The TestFlight test release enables draft previews only in synthetic staging.
Private profile storage remains OFF everywhere; no production or real-family activation is included.
