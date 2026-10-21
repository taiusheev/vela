# Vela Light: conversational memories and wellbeing

21 October 2026. Founder-approved direction. This supplement supersedes the narrow dated-plan
definition in product spec §12 and the paid-package boundary in §16. It defines intended behaviour,
not current availability. Existing notice, consent and production switches still apply until the
rollout below replaces them explicitly. The original spec governs all other behaviour.
For the future WELLBEING_REPORT flow, the report requirements below replace §13. The existing
weekly read continues under its current contract until that separate rollout is complete.

## Purpose

Help families remember a person's individuality and act thoughtfully on what that person shares.
An organiser should recognise their parent in the memories and find one useful action in the report.
The parent remains the author of their words and controls what is kept or shared.

## Paid boundaries

Free: daily asks, answers, replies, media, translation, turns, answered-today state, story questions,
basic story saving and reading, privacy controls and notice-accuracy information.
Light: quiet notices and nearby-contact actions; automatic conversational memory discovery,
organisation, search and follow-up; the weekly wellbeing report; family-book export.
Cancellation stops new paid processing after the grace period, not reading already saved memories.
Data access/copy and deletion remain free. The parent's ability to reply never depends on payment.
Keep the existing proposed US$9.99/month or US$79/year per kept-light person and no-card trial;
do not activate billing with this work. The organiser explicitly starts the 30 days after the first
answer; declining does not silently start it. The accuracy page is outside the paywall.

## Memories: "This is Mom"

Categories: preferences, stories, humour, meaningful people, moments, and follow-ups.
Examples: yellow flowers; the story of a first job; a cat stealing a chair; who a childhood friend
is; pride in a grandchild; a visit to ask about. Examples in code and design are synthetic.

P0 acceptance criteria:

- Each candidate carries family/person/source IDs, source revision, exact quote offsets, date,
  language and expiry. The original voice/photo is referenced, never duplicated without a policy.
- Show original words first, with a source action. AI titles are suggestions visibly attributed to
  Vela. Classification does not assert a permanent trait or inferred emotion.
- A person saying "I didn't like dinner tonight" must not create "dislikes cooking".
- A pending candidate expires with the source, normally 30 days. Long-term keeping requires an
  explicit choice under a new retention notice. The existing story-book exception is not blanket
  permission to save chat forever.
- Show suggested / kept / dismissed distinctly. Save is confirmed by the server; failure preserves
  the draft and offers retry. Dismissed selections do not return under a new title.
- The person controls keeping their own words. An organiser's suggestion to keep is not the
  person's consent. Provide a messenger path as well as an app path.
- Source correction invalidates the old revision; source removal/withdrawal hides derived content
  immediately and deletes copies, search entries, media and report references through retention.
- Only a live authorised family member can read. Owner correction/removal has explicit permissions;
  family membership alone cannot edit the person's words. No global search or cross-family cache.
- Health/unknown-sensitive content is excluded from general discovery and model input. A separate
  consented quote flow handles eligible health mentions. A model cannot declare its own input safe.
- Reading kept memories survives subscription lapse. Search pages are bounded and cursor-based.

P1: approved titles, linked recipes/photos, translated views with originals, follow-up reminders,
and a curated family book. Reminders require a tap and have a clear owner and completion action.

## Weekly report: "What would help this week?"

Order: a short account of the week; meaningful emotional/social moments; consented physical
wellbeing observations; up to 3 actionable suggestions; one memory worth keeping.
Positive experiences and interests deserve equal space to difficulties. Omit empty sections.

- Every personalised observation links to eligible source words. Distinguish what was explicitly
  said from deterministic observations about timing. Silence/short replies do not establish illness,
  loneliness, depression or cognitive decline.
- Every suggestion carries source references, a reason, a reviewed guidance-template version and
  an action such as call, ask, offer practical help, or discuss professional support.
- General wellbeing guidance is labelled general, with a source. It is never presented as evidence
  about the person. No medication, treatment, diagnosis, health score or promised health outcome.
- Health words stay out of generative models. Current health consent permits repeated quotations,
  not a new personalised health-advice service: add a purpose-specific consent and notice before
  enabling that service. Preserve no/stop/withdrawal across app and messenger.
- An eligible original quote can accompany a clinician-reviewed support template. Clinical review
  and evaluation precede family-facing health suggestions. Do not generate prescriptions from chat.
- Reports with sparse data explicitly say information is limited. Never fill empty slots with
  invented advice. A single meaningful event may be worth including; completeness is not a quota.
- The parent can see the observations and suggestions about them. Private organiser feedback and
  founder-only readings retain their existing separate permissions and are not repurposed.
- Urgent concerns follow the existing immediate concern pathway; Sunday is never the sole route.
- First pilot reports remain reviewed drafts. Reject/edit/approve is recorded with version and
  reviewer. Approval binds source revisions and consent; sending revalidates both.
- Removing a source or withdrawing consent also removes its contribution when a report is read.
  Historical rendered copies must not bypass this check. Reports expire under their defined policy.

## What success means

Pilot hypotheses, not proven outcomes: at least 80% of reviewed memory candidates are accurate and
worth keeping; at least 60% of reviewed report suggestions are rated useful; zero cross-family
exposure, unsupported personalised health claims or surviving withdrawn quotations in acceptance
fixtures. Ask the parent whether memories feel recognisable and respectful. Track corrections,
dismissals, duplicate candidates, report actions and processing cost without logging content.
Small pilot percentages must always show numerator and denominator. Health outcomes require
separate research; product engagement does not prove them.

## Sources for guidance development

- WHO, person-centred healthy ageing: https://www.who.int/health-topics/ageing/transforming-health-and-social-services-towards-a-more-person-centred-and-integrated-care
- WHO, social connection: https://www.who.int/health-topics/ageing/reducing-social-isolation-and-loneliness-among-older-people

These support the direction, not the clinical validation of a Vela feature.
