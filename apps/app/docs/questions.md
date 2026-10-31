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

Reviewed drafting uses `suggest.personal.v1`; existing nightly work continues using `suggest.v5`.
Explicit boundaries, grounded intent and restrained register precede style matching. Literal guards
are conservative checks, not proof of semantic safety or authenticity; human review remains required.

The child edits the result, explicitly confirms it, then picks an available morning in the existing
two-week calendar. Composing uses the existing idempotent API with `ai_assisted: true` and
`text_language`. The saved `ask_composed.from_suggestion` marker excludes these words from independent
human style evidence, including after editing. Authorship remains child-reviewed; this is not
unattended sending. Draft notes are not copied into a scheduled question or its options.

`PERSONAL_QUESTION_DRAFTS` is absent/off by default in every deployment configuration. An explicit on
can configure synthetic development/staging evaluation. Production on is refused until a separately
reviewed activation change. No provider/model was changed and no live consent or delivery behavior
was migrated. Demo previews reuse supplied words and are explicitly labeled as examples, with no AI,
persistence, or sending. They do not establish model quality.

Next gates: run the expanded provider golden set and compare actual outputs; verify native behavior;
review parent comprehension and independent controls; decide the retained-profile contract and
retention; then implement relationship-sensitive automatic selection, invalidation and a first-month
review policy. A persistent profile, independent parent input, and adaptive automatic delivery are
not implemented by this first reviewed-draft slice. Real-family comfort and long-term benefit remain
unverified. A family pilot and production activation require their separate approved steps.
