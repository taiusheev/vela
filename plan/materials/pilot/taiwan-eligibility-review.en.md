# Taiwan public signup: proposed notice and terms changes

23 October 2026 · Review draft · Not approved or served · No live permission

This is a proposed addition to the existing private-test materials. It does not convert the pilot
into a public service, change existing participants' permissions, waive existing admission or market
holds, or establish that Taiwan-only residence resolves every applicable law.

## Confirmed operator and proposed service

On 23 October 2026 the founder confirmed that Vela will initially be operated personally by
Timur Aiusheev, an individual in Taipei, Taiwan, with t.aiusheev@gmail.com for contact.
The public documents should identify this individual as the operator. This confirms the operator
choice; it does not establish company registration or legal clearance for public operation.

The proposed first public scope is adults aged 18 or older who usually reside in Taiwan. Each
participant answers for themselves. Do not require a person to declare another adult's age,
citizenship, capacity or consent. An app account and its display name are not verified legal identity.
Uncertain age/residence answers do not submit declarations or enroll the person.

## Proposed collection notice addition

Purpose: assess the proposed launch scope and remember the person's own current declaration.
Use the existing preferred name/account reference. Store only the person's self-declared 18+ and
usual Taiwan-residence answers, language, version of the displayed notice and terms, text
fingerprints, server timestamp and source (own app account or own private Telegram sender).
Do not add date of birth, national ID, passport, address, medical history or marketing fields.

Proposed infrastructure is the existing Singapore database and Cloudflare infrastructure
internationally; Clerk handles app authentication. Do not send the declaration to AI providers,
relatives or analytics. The final notice must confirm recipients and processing regions against
actual deployment. Existing handling of family messages requires its separate full disclosure.

Keep the current declaration with the person's account/member record. Replace it on correction,
clear it on an own-clear request, clear the account record on disable and remove the member record
with member erasure. No separate historical eligibility ledger is proposed. Technical mutation
receipts last up to 24 hours and do not duplicate the declaration values. Counsel must confirm the
appropriate retention and whether any agreement-proof archive is needed before production.

Declining or not supplying these answers prevents completing the proposed public signup. It must
not remove existing privacy rights, help, Stop, consent withdrawal, account deletion or data requests.
Contact the operator to request access, correction, cessation or deletion. No declaration grants
another adult's permission or enables a feature in their name.

## Proposed interface, not final contract acceptance

1. “Are you 18 or older?” — 18 or older / Under 18 / Prefer not to say.
2. “Do you usually live in Taiwan?” — Taiwan / Somewhere else / Prefer not to say.
3. Open the draft collection notice and draft terms; acknowledge reading each separately.
4. In the synthetic preview, choose **Record test declaration**. No live agreement is created.

The final reviewed public flow would need an explicit service-terms agreement, a separately
worded notice acknowledgement and any specific permission actually needed for a feature. AI,
health-related, sharing and marketing permissions cannot be inferred from these read checkboxes.

## Service terms outline for counsel

Identify the actual operator; explain eligibility, lawful family communication and participant
responsibilities; make the non-medical/non-emergency scope clear; provide support, suspension,
termination, data-rights and complaint paths; address pricing/cancellation/refunds if any, mandatory
consumer rights and dispute terms. This outline is not complete or ready to accept. Do not copy
private-pilot agreement wording into public contracts without review.

## Decisions still required

Confirm operator details, lawful bases, capacity/representation cases, whether and how existing
citizenship restrictions apply, cross-border processing, retention/contract evidence, electronic
acceptance and consumer rights. Existing restrictions stay in place pending a recorded review.
Residence and adulthood are self-declarations, not a legal eligibility verdict.

Primary sources: [PDPA](https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=I0050021),
[Chinese text and commencement status](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021),
[Civil Code Article 12](https://mojlaw.moj.gov.tw/eng/LawContentE.aspx?LSID=fl001351&media=print).
The implementation and exact screen text are in `apps/app/docs/taiwan-public-eligibility.md` and
`packages/contracts/src/public-eligibility.ts`. Taiwan counsel and native-language review remain
required before issuing new live documents or collecting real declarations.
