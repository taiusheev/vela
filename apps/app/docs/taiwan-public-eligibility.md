# Taiwan public eligibility — review implementation

Status: review only, 23 October 2026. No public activation, legal clearance, new live consent,
provider settings change or existing participant migration.

## What is built

The synthetic `/eligibility-preview` screen shows separate app-user and parent examples in English
and Traditional Chinese. Each person answers only for themselves: 18 or older; usual residence in
Taiwan; draft-notice read; draft-terms read. Preferred names and family roles already belong to the
existing profile/setup; the declaration does not duplicate them or treat a provider name as legal ID.
No birthday, ID number, document image, citizenship, diagnosis, address or marketing preference is
requested. Under-18, outside-Taiwan or undisclosed answers never call the record port.

The preview mounts only in a development build with demo mode and **both API and Clerk absent**.
It uses an in-memory fake and cannot save to a database or send messages. Actor changes remount a
fresh controller. Errors keep the answers for retry, double taps do not duplicate writes, language
changes clear document acknowledgements, and unmount discards late results.

The isolated internal service supports records for:

- an app account derived from an already verified Clerk session;
- a member derived from a verified **private Telegram sender**, never an organiser-provided member ID.

The server sets time, source and SHA-256 fingerprints of the exact language displayed. The body
cannot set another subject, a timestamp, an AI permission or a citizenship assertion. Records are
explicitly `review_only`; no service returns `admitted`, grants membership, turns on a light, or
changes an existing consent. SHA fingerprints support comparison; they are not a verified signature.

## Stored data and lifetime

Migration `0025_public_eligibility_review` adds nullable JSON records to `users.public_eligibility`
and `members.public_eligibility`. Existing rows default to null. No data backfill is performed.
A current record contains policy/terms version, language, self-declared adult/Taiwan values, the two
review acknowledgements, source, server time, text hashes, a pseudonymous actor fingerprint, and
`review_only` status. The actor fingerprint binds evidence to the authenticated identity; changing
a Telegram link cannot make the next identity inherit an earlier declaration.

Records share the account/member lifetime; account disable clears the user column and deletion of
the member row removes the member column. Own clear works with new collection off. Corrections
replace the current record; there is no new historical agreement archive. Save responses contain only
`recorded` and `review_only`, so the normal 24-hour idempotency receipts do not copy the declarations.
An old save replay cannot resurrect a cleared record. Existing consent records and deletion proofs
retain their own rules and are not relabelled as public signup permission.

Do not send these fields to AI, relatives, analytics, support logs or URL parameters. Names remain
in the existing profile rather than another eligibility table. The draft proposes the existing
Singapore/Cloudflare infrastructure; live collection requires an updated data map and notice.

## Off in every actual runtime

`PUBLIC_ELIGIBILITY_DEFAULT.enabled` is false. New records require an explicit internal
`synthetic-review` configuration and the matching review version. Production is not an accepted
service environment. No Worker runtime, route, bot handler, app navigation, account provisioning or
family-creation path calls the service. Runtime regression tests cover development, staging and
production. Clearing/own reads are service capabilities only, not new live endpoints.

The preview and internal synthetic configuration are not a substitute for enforcement. Do not
expose an endpoint or use these records as a family-access gate without completing the next section.
An eligibility change must not block existing stopping, deletion, data access or help paths.

## Before real public signup

1. Operator choice confirmed by the founder on 23 October 2026: Timur Aiusheev personally,
   initially as an individual in Taipei, Taiwan, with t.aiusheev@gmail.com for contact. Use this
   identity in the public documents; counsel still needs to check operator details and obligations.
2. Have Taiwan counsel confirm the adults-only service policy, capacity/representation cases,
   lawful bases, country/citizenship restrictions, overseas processing, consumer terms and retention.
   Taiwan residency alone is not legal clearance; existing exclusions and pilot admission stay intact.
3. Approve a new full privacy notice and full service terms with new versions. The short draft terms
   here are an outline only. Keep notice acknowledgement, terms agreement and optional feature
   permissions separate. Do not translate the two draft read checkboxes into blanket consent.
4. Native Taiwanese review of the new Chinese text. Recheck the currently effective law; the official
   Chinese law page marks some 2025 amendments as not yet effective. Do not infer commencement from
   an updated consolidated English text.
5. Add authenticated self-read/save/clear HTTP routes and verified private-channel integration, each
   with admission/notice presentation checks and authorization tests. The parent must receive the
   applicable notice and independently choose before participation; an organiser's country or answers
   are never copied to the parent. A Telegram participant using an app later needs proof-based
   identity reconciliation, not email/name matching.
6. Add server enforcement before **new public family participation**, not merely a dismissible app
   screen. Apply all approved market rules, version changes and corrections; preserve existing
   account recovery, Stop, consent withdrawal, erasure and support. Do not grandfather old users
   into a new agreement.
7. Test signed iPhone, VoiceOver, large text, verified Telegram sender, new/returning social and email
   accounts, residence changes, deletions and retries. Only then consider enabling an environment.

## Review material and primary legal sources

- `plan/materials/pilot/taiwan-eligibility-review.en.md` and `.zh-TW.md` are proposed collection and
  terms-review addenda, not replacements for the currently served notice or consent scripts.
- [Taiwan PDPA, Articles 3, 5–9, 19–21](https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=I0050021):
  rights, necessary collection, notices, consent and processing/transfer rules require application to
  the actual operator and flows. This implementation makes no legal approval decision.
- [Chinese PDPA and commencement status](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021).
- [Civil Code, Article 12](https://mojlaw.moj.gov.tw/eng/LawContentE.aspx?LSID=fl001351&media=print):
  18 is the age of majority. An adults-only product is a proposed product policy, not a universal
  legal requirement that every app exclude minors.
