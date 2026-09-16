This memo is research by Vela's tech co-founder, an AI. It is not legal advice, and a lawyer must check it before any public launch.

# Legal memo: Taiwan's Personal Data Protection Act and the Vela pilot

Version `legal-memo.v1` · 17 September 2026 · for the founder and counsel · reviews the pack at `privacy-notice.v1`, `consent-script.v1`, `nearby-consent.v1`, `organiser-agreement.v1` and `data-map.v1`, and the code at commit 8991fdf with the working tree of 17 September 2026

Six questions about the pilot under Taiwan's Personal Data Protection Act (個人資料保護法, "the Act") and its Enforcement Rules (施行細則, "the Rules"), plus the laws of the countries where a pilot family might live. Each answer gives the short answer, the reasoning with sources, a confidence level, and what Vela's documents or code should change. All the changes are collected in the table at the end, followed by the questions for a lawyer.

## How this memo was made

- Two researchers worked on the questions separately. Every claim in this memo was then checked on 17 September 2026 against the source it cites. The links are under "Sources".
- **Not every source is the official text.** Most are. The others are marked as such in "Sources": a law firm's newsletter (T21); unofficial consolidations and copies of Russian and Kazakh law (R1 to R6, K1 to K3); a secondary copy of an order (R7); a news report (R8); and copies of official texts kept by the Taipei City Government (T17, T18) and by Cornell's Legal Information Institute (U4). Where a point of law rests on T21, R1 to R7 or K1 to K3, the text says so next to the claim or its confidence. A lawyer should check those points against the official text first.
- **Confidence.** *High* means a statute or a regulator's letter answers the point directly. *Medium* means the rule is clear, but applying it to Vela takes a judgement that no authority has made. *Low* means no authority exists and the answer is reasoned by analogy.
- **"The person"** means the person the light is for.
- **Where the researchers disagreed, the source settled it:**
  1. **Which articles the 2025 amendment changes.** It adds Articles 1-2, 20-1 and 21-1 to 21-5 rather than amending them [T1].
  2. **Whether the pilot charges a fee.** The pack now says the pilot is free (README, decision 13). One researcher had read an earlier text.
  3. **Placeholders.** The founder's name and contact address are filled in both notices.
  4. **Which letter says electronic consent can be written consent.** Both Ministry of Justice letters exist and say the same thing [T16] [T17].
  5. **The fine for failing to secure data.** Article 48(2) of the text in force sets NT$20,000 to 2,000,000 [T2].
  6. **The January 2026 drafts.** Each researcher described part of them; both parts match the law firm newsletter that reports them [T21].
- **Dropped because they could not be sourced or checked:**
  - notice given by hyperlink (the source page could not be read);
  - an insurance-sector letter on guardians;
  - Kazakhstan treating health data as "limited access" data;
  - the claim that the Ministry of Justice's English translation already shows the amended text;
  - whether the EU has amended the GDPR through the "Digital Omnibus" (now a question for a lawyer).

## 0. Which version of the law is in force

**Short answer.** The text in force is the one amended on 31 May 2023. The amendment promulgated on 11 November 2025 is not in force: Taiwan's national law database, with data to 4 September 2026, says 「本法規部分或全部條文尚未生效，最後生效日期：未定」 [T1]. The Executive Yuan sets the start date once the act creating the Personal Data Protection Commission has passed [T14] [T15].

**What this means today** [T2]:
- **Restricting transfers abroad.** The power belongs to the authority in charge of the industry (中央目的事業主管機關, Article 21).
- **Security.** Article 27(1) sets the duty.
- **Breaches.** Article 12 requires notice to the people affected only.
- **Supervision.** The industry's authority supervises, or the city or county government where there is none (Articles 22, 25, 47, 48).

**Once the 2025 amendment is in force** [T1]:
- the Commission becomes the authority;
- a breach must also be reported to it (amended Article 12);
- security duties move to a new Article 20-1.

**Drafts of 22 January 2026, not in force.** As a law firm's newsletter summarises them (a secondary source; the drafts themselves were not read), the Commission's preparatory office proposed [T21]:
- **Security measures for everyone.** Common measures for every non-government agency, with extra measures for Article 6 data (draft Article 11).
- **Stronger measures for large organisations only.** These cover companies that are not SMEs and hold 10,000 or more records.
- **Breach notice to people.** Tell the people affected within 72 hours.
- **Breach report to the Commission.** Report within 72 hours when special-category data is involved, the system holds 10,000 or more records, or 100 or more records are affected.

**Confidence: high** on the text in force and on the amendment not being in force [T1] [T2]. **Medium** on the details of the January 2026 drafts, which rest on the newsletter's summary [T21]; they are not in force and change nothing today.

**Changes**
- `infra/runbooks/incident.md`, step 4, says to "notify the Taiwan authority as the amended Personal Data Protection Act requires". Replace this with the rule in force:
  - tell the people affected, 「即時」, with the facts of the breach and the measures taken (Article 12; Rules Article 22);
  - report to the Ministry of Digital Affairs within 72 hours if its regulation applies (Q5);
  - check the rule again once the amendment takes effect.
- `README.md`, "Review notes": record that the 2025 amendment was not in force on 4 September 2026, and check again before any public launch.

## Q1. Are the "health words" in answers special-category data under Article 6?

### Short answer

**Most health words are ordinary personal data.** Examples: "my knee hurts", "I fell", "I'm not eating", "I saw the doctor". The Rules define medical data (醫療) and health-examination data (健康檢查) by where the data came from: an examination or treatment by a doctor or other medical professional, or a prescription or procedure based on one. Words the person chooses to say do not meet that definition.

**What a doctor produced may be different.** When an answer passes on what a doctor found or prescribed, Article 6 may apply. Examples: "the doctor says it's diabetes", "they changed my pills", a test result. The content is data that a diagnosis or prescription produced, and no authority says whether repeating it yourself takes it outside the definition.

**Only written consent fits.** If Article 6 applies, the one exception that fits Vela is the person's written consent (Article 6(1)(6)). It must be given separately, after the full notice. Vela has no such consent today.

### Reasoning

**The rule.** Article 6(1): 「有關病歷、醫療、基因、性生活、健康檢查及犯罪前科之個人資料，不得蒐集、處理或利用。」 Exception 6: 「經當事人書面同意。但逾越特定目的之必要範圍…或其同意違反其意願者，不在此限。」 [T2]

**How the Rules define the three relevant terms** (Rules Article 4 [T3]):
- **病歷 (medical records):** the items of Medical Care Act Article 67(2). These are records doctors make, examination and test reports, and records other medical staff make [T6].
- **醫療 (medical care):** 「病歷及其他由醫師或其他之醫事人員…所為之診察及治療；或基於以上之診察結果，所為處方、用藥、施術或處置所產生之個人資料」.
- **健康檢查 (health examination):** 「以醫療行為施以檢查所產生之資料」.

**What the authorities have said**
- **Self-measured data.** National Development Council, 發法字第1072002136號 of 21 November 2018 [T9]. Readings a person takes on their own device and gives straight to a business are ordinary data 「若未涉及醫事人員診察、治療等」. They become Article 6 data when the business obtains them for medical staff to examine or treat.
- **Doctor visits.** Ministry of Justice, 法律字第10503510230號 of 18 July 2016 [T18]. Dates of doctor visits and the clinic's address 「雖非屬『醫療之個人資料』」, but they are still personal data. So "saw the doctor on Thursday" is ordinary data.
- **The category code.** The official category C111 健康紀錄 gives as examples 「醫療報告、治療與診斷紀錄、檢驗結果」 [T20]. That is exactly the grey zone of a relayed diagnosis.
- **Nothing on repeated diagnoses.** No letter or judgment addresses a patient repeating a diagnosis in a message.

**Where such words end up in Vela**
- **Mentions.** `understand.v3` stores "health or body words the elder used about themself, for example 'knee hurts', 'doctor'" in `answers.mentions`.
- **Summaries.** It writes a summary "keeping the elder's own words", which is kept while the family uses Vela.
- **Flags.** `flag.v1` raises a health flag and sends the organisers a verbatim `evidenceQuote` (`flag.notice`), kept in `flag_reason` for 30 days.
- **Transcripts.** The transcript is posted to the family group and kept for 30 days.
- **Memory.** `memory_facts` of kind `health` is planned for sprint 5 (`data-map.md` row 29).

A relayed diagnosis can therefore sit in a summary for as long as the family uses Vela.

**Why the other exceptions do not fit**
- **Disclosed by the person (6(1)(3)).** This needs disclosure 「對不特定人或特定多數人」 (Rules Article 13 [T3]), and a family group is neither.
- **Legal duty (6(1)(2) and (5)).** Vela has no legal duty to collect this data.
- **Danger to life or body (Article 20(1)(3)).** The other use exceptions in Article 20(1) cover only data 「除第六條第一項所規定資料外」 [T2]. They cannot support passing on Article 6 data in a flag.

**Nobody else can consent for the person.** National Development Council, 發法字第1080010426號 of 28 May 2019 [T9]: someone who is not the data subject 「無法代為同意」 under Article 6(1)(6). The organiser cannot consent for the person.

**How the written consent must be given.** Article 6(2): 「其中前項第六款之書面同意，準用第七條第一項、第二項及第四項規定，並以書面為之」 [T2]. That brings in these requirements:

1. **Notice first.** The person is told the six Article 8(1) items before consenting (Article 7(1)). Two letters say the same for this kind of consent: 發法字第1082000769號 of 3 May 2019 on medical data, and 個資籌法字第1130001901號 of 23 October 2024 [T9].
2. **A separate expression of consent.** It comes after the person is told the purpose, the scope and 「同意與否對其權益之影響」 (Article 7(2)). If it sits in one document with other consents, it must be placed so the person can read and confirm it (Rules Article 15 [T3]).
3. **Vela proves it** (Article 7(4)).
4. **Freely given, within the purpose.** It must not go beyond the purpose, and must not be 「違反其意願」 (Article 6(1)(6)).
5. **In writing, which may be electronic** (Rules Article 14). Q4 covers whether a Telegram button qualifies.

**Penalties**
- **Fine.** Breaching Article 6(1) brings a fine of NT$50,000 to 500,000 and an order to correct, repeated until corrected (Article 47).
- **Criminal liability.** This arises only with intent to gain unlawfully or to harm, and resulting damage (Article 41) [T2].

### What the health-words consent should say

The consent is a message of its own, separate from the light consent, in the person's language. It says:
- **Who is responsible.** Timur Aiusheev, who runs Vela, is responsible for the words and can read them during the pilot.
- **Which words it covers.** A fall, pain, not eating, a visit to a doctor, what a doctor said, a test result, a medicine.
- **What happens to them:**
  - they reach the family in the Vela group, as sent;
  - the organisers see the person's own words the same day when they suggest something like a fall or pain;
  - a computer program turns voice into text and notices such words.
- **Who processes them and where.** Anthropic and Deepgram in the United States, the database in Singapore, Cloudflare's worldwide network, and Telegram.
- **How long they are kept.** The words for 30 days. A one-line summary while the family uses Vela. Memory, once it exists, for a stated period.
- **The person's rights.** They can see, get a copy of, correct or delete them, say "stop", and withdraw this consent at any time.
- **What saying no does.** See below.
- **That the tap counts as written agreement,** and that the person can agree on paper instead by telling Timur (Q4).

An example for copy review, in the voice of the pack:

> One more question, about your health. If an answer mentions your health (a fall, pain, not eating, the doctor, a medicine), may Vela carry and keep those words? [Organiser] sees your own words that day when they sound like a fall or pain. Anthropic and Deepgram, in the United States, turn voice into text and notice these words for Vela. The words are deleted after 30 days. Timur Aiusheev runs Vela and is responsible for them. You can ask to see, correct or delete them, or change your mind, at any time. If you say no, Vela still carries your answers, but keeps no health words in its notes. Tapping "Yes" is your agreement in writing; if you'd rather sign on paper, tell Timur.
>
> Buttons: **Yes, that's fine** · **No, thank you**

**What a "no" does.**
- **Vela keeps running.** It keeps no health mentions, leaves health out of summaries, and never stores health memory facts.
- **Some words still reach the family.** The person's own message still reaches the family as sent and is deleted after 30 days.
- **Flags on danger still run.** Words about a fall or pain are ordinary data covered by the light consent (medium confidence).
- **Residual risk.** A diagnosis passed on inside a transcript is still processed for 30 days. That is a question for a lawyer.
- **Outside Taiwan.** For families under the GDPR or Washington State law, a "no" must also switch off health flags (Q6).

### Confidence

- **Medium** that everyday health words are ordinary data. The regulator draws the line at a medical professional's involvement, but no letter addresses chat messages.
- **Low** on relayed diagnoses and prescriptions. No authority exists, and the literal definition points towards Article 6.
- **High** that written consent is the only exception that fits, and on the form that consent must take.

### What Vela should change

- **C1** `packages/db/src/schema.ts` (with a migration), `packages/copy/src/en.ts` and `zh-TW.ts`, `packages/services/src/consent.ts`, `consent-script.en.md` (§4 and §6, with its `.zh-TW` twin), and `infra/runbooks/data-requests.md` (section B):
  - **Record the consent.** Add a consent kind `health_words`.
  - **The message.** Add copy keys for the health-words message and its two buttons.
  - **When to send it.** After the tap on "Yes" to the light, then record it.
  - **The script.** Have the script announce it.
  - **Until the button flow ships:** the founder sends the text from his own Telegram chat after the call and records the reply by hand.
- **C2** `packages/services/src` (the understand and flag handling): without a `health_words` consent, store an empty `mentions.health`, keep health out of the summary, and write no health memory facts.
- **C3** `privacy-notice.en.md` and `.zh-TW`, then regenerate `apps/worker/src/notices.generated.ts`:
  - **"What we do not collect."** Replace "No medical records." with: Vela does not ask for medical records, and words about health in an answer are handled as described under the health-words consent.
  - **Health words.** Add a short paragraph saying what happens to them and that Vela relies on the person's written consent (Article 6(1)(6)).
- **C4** `packages/ai/src/prompts`: add `understand.v4.ts` and `flag.v2.ts`, with eval cases in `packages/ai/evals/cases/`.
  - Summaries and mentions never keep the name of a diagnosis, a test result or a medicine.
  - The flag's quote is the shortest excerpt that shows the danger, and leaves those out where it can.
  - This lowers the risk for everyone, whether or not they consent.
- **C5** `data-map.md` row 29 and gap 9: health memory facts are written only with a `health_words` consent, and `expires_at` gets a defined value before memory ships.

## Q2. May Vela keep proof of consent after deleting someone's data?

### Short answer

**Yes, a minimal record.**
- **Basis.** The exception in Article 11(3) for what is 「因執行職務或業務所必須」, read with Rules Article 21(3), 「其他不能刪除之正當事由」.
- **Why.** Vela carries the burden of proving consent (Article 7(4)), and claims and fines can arrive years after the data is gone.
- **What to keep.** Only what proves the consent, as pseudonymously as possible.
- **Tell people.** The notice must say it is kept.
- **For how long.** Delete it five years after the later of two dates: when consent was withdrawn, and when the data it covered was deleted.
- **No direct authority.** No letter addresses consent records, so both the basis and the period are reasoned.

### Reasoning

**The rules**
- **Burden of proof.** Article 7(4): 「蒐集者就本法所稱經當事人同意之事實，應負舉證責任。」 [T2]
- **Deletion.** Article 11(3): 「個人資料蒐集之特定目的消失或期限屆滿時，應主動或依當事人之請求，刪除、停止處理或利用該個人資料。但因執行職務或業務所必須或經當事人書面同意者，不在此限。」 [T2]
- **What counts as necessary.** Rules Article 21 lists three cases: 「一、有法令規定或契約約定之保存期限。二、有理由足認刪除將侵害當事人值得保護之利益。三、其他不能刪除之正當事由。」 [T3]

**What the authorities have said**
- **After withdrawal.** Ministry of Justice, 法律字第10603512680號 of 10 November 2017 [T19]: once consent is withdrawn, the data must be deleted 「除有該法第 11 條第 3 項但書規定之情形」.
- **Deletion requests.** National Development Council, 發法字第1090000415號 of 20 January 2020 [T11]: a request to delete is exercised under the conditions of Article 11(3). A retention period 「宜注意個資法第5條比例原則之適用」.
- **No indefinite retention.** National Development Council, 發法字第1100016400號 of 1 September 2021 [T11]: keeping data indefinitely whatever the purpose 「似與個資法第5條規定之比例原則不符」.

**The record is still personal data.** Personal Data Protection Commission preparatory office, 個資籌法字第1140000771號 of 15 July 2025 [T9]: data that can still be traced back to a person 「其仍屬個人資料」. The consent record therefore needs a basis, a stated period in the notice (Article 8(1)(4)), and it remains open to access requests.

**Why five years.** No rule sets a period for consent records. These are the nearest time limits:
- **Damages claims** lapse 「自請求權人知有損害及賠償義務人時起，因二年間不行使而消滅；自損害發生時起，逾五年者，亦同」 (Article 30 [T2]).
- **The power to fine** lapses 「因三年期間之經過」, counted from the end of the conduct (Administrative Penalty Act Article 27 [T7]).
- **Records rule, if it applies.** The Ministry of Digital Affairs regulation requires keeping 「個人資料之蒐集、處理或利用紀錄」 and 「落實執行安全維護計畫之證據」 for 「至少五年」, 「應評估其必要性」 (Article 16 [T8]). Whether that regulation applies is discussed in Q5.

Five years after deletion covers the longest civil limit for damage that occurs up to the deletion, and the three-year limit on fines.

**A contact who said no.** Keeping a keyed hash of the number, so that Vela is never used to ask them again, also fits Rules Article 21(2): deleting it would harm an interest of theirs worth protecting. Confidence: low.

**What the pack says today**
- **The notice.** "Records of consent: As long as we keep the information they cover" (`privacy-notice.en.md`, "How long we keep it").
- **The data map.** Consent records cascade with the member or contact row (`data-map.md` row 5 and gap 4).
- **The schema.** `consents.member_id` and `consents.contact_id` are `ON DELETE CASCADE` (`packages/db/src/schema.ts`), and `evidence` holds "the exact words".

**A flaw in the deletion proofs.** When a nearby contact is removed, `removeContact` in `packages/services/src/admin.ts` writes `deletions.content_hash = sha256Hex(contact.phone)`.
- **The hash can be reversed.** A Taiwan mobile number has about 10^8 possible values, so trying them all takes seconds.
- **It is kept for good.** The `deletions` row is kept with no limit (`data-map.md` row 19).
- **The result.** Vela keeps, indefinitely, a recoverable phone number of someone who said no. The notice says their details are deleted, and that a fingerprint keeps nothing of "what it said".

### Confidence

- **Medium** on the basis (Article 11(3) with Rules Article 21(3)).
- **Low** on the five-year period. No authority exists; it is anchored on the limits above.
- **High** that the plain SHA-256 of a phone number is still personal data [T9].

### What Vela should change

- **C6** `packages/services/src/admin.ts` (`removeContact`): stop hashing the phone number with plain SHA-256.
  - **Options.** Hash the row id and the deletion time, or use a keyed HMAC whose key is a Worker secret.
  - **Timing.** Fix this before any contact is removed. Nothing is deployed yet, so no stored rows need repair.
- **C7** `packages/db/src/schema.ts` (with a migration) and `packages/services/src/jobs.ts` (`applyRetention`):
  - **Keep the rows.** Change the two foreign keys on `consents` to `ON DELETE SET NULL`.
  - **Add two columns.** `subject_ref`, a keyed HMAC of the platform user id or phone number, and `subject_deleted_at`.
  - **Strip at deletion.** When the subject is deleted, remove the words from `evidence`.
  - **Delete after five years.** Delete a consent row five years after the later of `withdrawn_at` and `subject_deleted_at`.
  - **Deletion proofs too.** Give `deletions` rows the same five-year limit.
- **C8** `privacy-notice.en.md` and `.zh-TW` ("How long we keep it"), and `data-map.md` rows 5 and 19 and gap 4:
  - **Records of consent.** "5 years after consent is withdrawn or the information it covers is deleted, whichever is later, only to show what was agreed; then deleted."
  - **Deletion fingerprints.** "5 years."

## Q3. Sending data abroad: what Article 21 requires, and what the notice must say

### Short answer

**Nothing needs approval.**
- **No formal steps.** Taiwan law requires no approval, registration, adequacy finding or separate consent before personal data goes abroad.
- **Only a restriction order can stop it.** A transfer is lawful unless an authority has restricted it on one of the four grounds in Article 21. Under the text in force, that authority is the one in charge of the industry.
- **No order reaches Vela.** The known orders concern transfers to mainland China in particular industries.

**What the law does require**
- **The notice.** It must state the places and recipients of use (Article 8(1)(4)).
- **Supervising providers.** The founder must supervise every provider that processes data for Vela (Article 4; Rules Article 8).

**Where the pack stands**
- **The notice** covers today's providers and places.
- **The gaps:**
  - providers arriving in sprint 2;
  - no recorded processing agreements or checks;
  - a personal Google Drive account with no processing terms;
  - a call script that mentions no provider at all (Q4).

### Reasoning

**Definition.** Article 2(6): 「國際傳輸：指將個人資料作跨國（境）之處理或利用。」 [T2]

**The restriction power.** Article 21, in force: 「非公務機關為國際傳輸個人資料，而有下列情形之一者，中央目的事業主管機關得限制之」 [T2]. The four grounds:
- national interest;
- a treaty;
- 「接受國對於個人資料之保護未有完善之法規，致有損當事人權益之虞」;
- circumventing the Act.

The amended text, not yet in force, gives the same power to the Commission (主管機關) [T1].

**Breaching a restriction order**
- a fine (Article 47(4));
- a crime, when done with intent to gain or harm and causing damage (Article 41) [T2].

**What restriction orders look like.** For example, the Ministry of Labor's order 勞動發管字第1120500319A號 of 20 February 2023 restricts labour brokers from transferring data 「至大陸地區」 under Article 21(3) [T22]. No order found covers the United States, Singapore or global cloud providers. There is no central index of orders, so this is limited to what the research found.

**Providers count as Vela.** Article 4: 「受…非公務機關委託蒐集、處理或利用個人資料者，於本法適用範圍內，視同委託機關。」 [T2]

**Supervising providers.** Rules Article 8 [T3] requires supervision covering six things:
- scope, categories, purpose and period;
- security measures;
- sub-processors;
- what a provider must report after a breach, and the remedies;
- instructions the founder reserves;
- return or deletion when the relationship ends.

It also requires 「委託機關應定期確認受託者執行之狀況，並將確認結果記錄之」. National Development Council, 發法字第1100016400號 [T11], says the same.

**If the Ministry of Digital Affairs regulation applies (Q5).** Its Article 10 also requires 「告知當事人其個人資料所欲國際傳輸之區域」 and supervision of each recipient's scope, purpose, period, places, recipients, manner and handling of data subjects' rights [T8].

**What the pack says**
- **The notice.** The provider table and "Where it is stored" name Singapore, the United States, Cloudflare's worldwide network, Sentry in Germany, Telegram and Google Drive. That meets Article 8(1)(4) for those providers.
- **The DPA column.** In `infra/sub-processors.md`, the "DPA accepted" column is empty for Cloudflare, Neon, Deepgram and Sentry. The file's own rule says a DPA is accepted before real family data reaches a provider. No periodic check is recorded.
- **Google Drive.** The founder's personal account runs on Google's consumer terms, with no processing agreement (`data-map.md` gap 10). The founder cannot show the supervision that Rules Article 8 requires.
- **Sprint 2 providers.** OpenAI and Groq (benchmark clips, second-opinion transcription) and Microsoft Azure Speech are listed for sprint 2 but are not in the notice.

### Confidence

- **High** on what Article 21 and Article 8(1)(4) require.
- **Medium** that no restriction order reaches Vela, because no central index of such orders exists.

### What Vela should change

- **C9** `infra/sub-processors.md`:
  - **Before any real family data:** record the date each DPA was accepted for Cloudflare, Neon, Deepgram (whose DPA is on request) and Sentry.
  - **Periodic checks:** add a "Last checked" column where the founder dates each check (Rules Article 8(3)).
- **C10** `privacy-notice.en.md` and `.zh-TW`, `infra/sub-processors.md`, and the per-item benchmark consent text:
  - **Name the sprint 2 providers** (OpenAI, Groq and Microsoft), with where they process, before any of them receives data.
  - **Benchmark consent:** the consent for each benchmark clip names OpenAI and Groq.
- **C11** `consent-script.en.md` ("Before the call" and "After the call"), `README.md` step 1, and `data-map.md` row 22 and gap 10:
  - **Pilot notes in Google Drive hold only** the family code, dates, text versions, yes or no answers and research scores.
  - **Never:** quotes of answers, or health words.
  - **Still open:** whether a personal Drive may hold even that is a question for a lawyer. The alternatives are notes kept on the founder's own encrypted device, with no provider, or a paid account with processing terms.

## Q4. Notice and consent: Articles 7, 8 and 9, and the Telegram button

### Short answer

**Article 8 (data collected from the person).**
- **When:** at collection.
- **What to tell:**
  - the collector's name;
  - the purpose;
  - the categories of data;
  - the period, places, recipients and manner of use;
  - the rights under Article 3 and how to use them;
  - what happens if the person does not provide the data.

**Article 9 (data from someone else).** This applies to what the organiser gives about the person and about nearby contacts.
- **What to tell:** where the data came from, plus the first five of those items.
- **When:** before processing, or at the first use towards the person.

**How notice may be given.** Any way works, spoken or written. But consent needs individual notice: a notice that is only posted or put online is not enough.

**The Telegram button.** A tap can be "written consent" as an electronic document, on three conditions:
- the tapped message shows what is agreed;
- Vela can later retrieve that content and tie it to the person;
- the person had a chance to object to the electronic form.

No authority addresses chat buttons.

**Where the pack stands**
- **Organisers:** covered.
- **The person:** the call script misses several items, contains two sentences that contradict the notice, and the consent message carries no notice at all.
- **Nearby contacts:** text A misses the source, retention, place and rights.
- **Other family members:** they get only a link posted in the group.
- **A "no":** it leaves the person's profile stored, although the script says "Nothing is created".

### Reasoning

**Article 8.** When a non-government agency collects from the person, it 「應明確告知」 the six items. Item 4 is 「個人資料利用之期間、地區、對象及方式」 [T2]. The exemption for 「個人資料之蒐集非基於營利之目的，且對當事人顯無不利之影響」 (8(2)(6)) should not be relied on (Q5).

**Article 9**
- **The duty.** 「應於處理或利用前，向當事人告知個人資料來源及前條第一項第一款至第五款所列事項」, and 「第一項之告知，得於首次對當事人為利用時併同為之」 (Article 9(3)) [T2].
- **Storing counts.** Processing includes 「記錄、輸入、儲存」 (Article 2(4)).

**How notice may be given**
- **Any means.** Rules Article 16 allows 「言詞、書面、電話、簡訊、電子郵件、傳真、電子文件或其他足以使當事人知悉或可得知悉之方式」 [T3].
- **No signature needed.** National Development Council, 發法字第1080018861號 of 11 September 2019: 「告知之方式非以書面為限，且未要求當事人簽署」 [T12].
- **Individual notice for consent.** Preparatory office, 個資籌法字第1140002435號 of 2 January 2026 [T10]. Consent to ordinary data need not be written, but 「蒐集者仍應以個別通知之方式使當事人知悉，不得以單純擺設（張貼）公告或上網公告之概括方式為之」.

**Consent**
- **Informed.** Consent is permission given after the notice (Article 7(1)).
- **Presumed consent** (Article 7(3)) needs three things: explicit notice, no refusal, and the person providing the data themselves.
- **An active choice.** National Development Council, 發法字第1072002136號 [T9]: 「「當事人未表示拒絕」，應係當事人在正面選擇同意與否之模式下進行，否則有「預設同意」之虞」.
- **Not on someone else's behalf.** National Development Council, 發法字第1082001626號 of 9 October 2019 [T12]: 「消費者並非個人資料當事人，無法代其親友為同意」. The organiser cannot consent for the person, a nearby contact or another family member.

**Written consent by a button**
- **Electronic documents allowed.** Rules Article 14: written consent 「依電子簽章法之規定，得以電子文件為之」 [T3].
- **Electronic Signatures Act** [T4]:
  - Article 4: 「不得僅因其電子形式而否認其法律效力」.
  - Article 5(2): 「依法令規定應以書面為之者，其內容可完整呈現，並可於日後取出供查驗者，得以電子文件為之」.
  - Article 5(3): a signature is needed only 「依法令規定應簽名或蓋章者」. Article 6(2) of the Act requires writing (「以書面為之」), not a signature.
  - Article 5(4): unless the other party has agreed to electronic form, they must first be given 「反對之機會」.
- **Civil Code Article 3.** Where the law requires writing, the text 「必須親自簽名」 [T5].
- **The two Ministry of Justice letters.** 法律字第10203502480號 of 21 March 2013 [T17] and 法律決字第10303508040號 of 7 July 2014 [T16] reconcile these rules. An electronic consent that is 「足以確認當事人之意思表示，並有可為證明之方式」 has the effect of written consent. Both letters predate the 2015 amendment of the Act and the 2024 revision of the Electronic Signatures Act, and cite the old article numbers.

**What the tap needs to count as written consent**
- **The message itself shows what is agreed.**
- **Vela can retrieve and tie it to the person.** Vela stores enough to rebuild the exact text and link it to the person: text version, the values filled in, language, chat id, message id and time.
- **The person was offered paper.**
- **The person taps themselves.**

**What the pack covers, item by item**

| Item | Organisers (notice and agreement, sent individually) | The person: call script (`consent-script.en.md`) | The person: `consent.request` | Nearby contact: text A | Other family members: `group.linked` |
|---|---|---|---|---|---|
| Collector's name | Yes | "My name is Timur", with no surname or responsibility | No | Yes (Timur Aiusheev) | Link only |
| Purpose | Yes | Yes | Yes | Yes | Link only |
| Categories | Yes | Partly | No | Name and phone; messaging app missing | Link only |
| Period | Yes | Only "voice messages and photos are deleted after 30 days" | No | No (only deletion after a no) | Link only |
| Places | Yes | No | No | No | Link only |
| Recipients | Yes | Family and founder; no providers, and two lines deny any | No | Organisers and founder | Link only |
| Rights and how | Yes | Stop and delete; not see, copy or correct | Stop | Say no or change one's mind | Link only |
| Effect of not providing | Yes | Yes | No | Yes | Link only |
| Source (Article 9) | n/a | Yes ("[Organiser] gave me your name…") | No | Implied, not stated | n/a |

**Other findings**
- **Two sentences contradict the notice.** Script §4 says "Nobody outside the family and me", and question 1 says a computer program "doesn't show them to anyone". Meanwhile Anthropic, Deepgram, Neon, Cloudflare and Telegram all receive the person's words. Beyond missing an Article 8 item, this raises good faith under Article 5 (「依誠實及信用方法為之」).
- **The consent message links no notice.** `consent.request` has no notice link. The person is never sent the written notice: the only link Vela sends goes to the family group, which the person is not in. Notice to the person rests on the call, and the proof rests on the founder's own note.
- **The consent record is thin.** `consent.ts` stores `text_version` `consent.request@1` and `evidence: {message_id}` only. It records neither the organiser's name filled into the text nor the chat id.
- **Who taps.** Script §6 lets the organiser help the person "straight after the call". For written consent, the tap must be the person's own.
- **A "no" keeps the profile.**
  - After a "no", `declineConsent` leaves the member `invited`, with the profile and channel link the organiser's setup stored.
  - `applyRetention` deletes only `left` members, so that profile stays until the family is deleted.
  - The script says "Nothing is created", and the notice says "nothing else changes".
  - Once the person says no, the purpose is gone, and Article 11(3) requires deletion.
- **Contacts stored without consent.**
  - Nearby contacts' names and numbers are stored at setup, before any notice (`nearby-contact-consent.en.md`, Notes for the founder).
  - **Notice timing.** Article 9(3) lets notice wait until the first use towards the contact, which is text A.
  - **Legal basis.** Storing before the yes has none, because the organiser cannot consent for them. The only candidate is Article 19(1)(8), 「對當事人權益無侵害」, and no authority has applied it to such a case.
- **The lawful-basis sentence is too broad.** The notice says "we rely on your consent and on the pilot arrangement with the organiser (Article 19)". The contract basis (Article 19(1)(2)) covers organisers only.

### Confidence

- **High** on what Articles 8 and 9 require, and on the gaps in the table.
- **Medium** that a link posted in the group is too weak for family members' consent. The 2026 letter concerns notices posted on a website or on site, not a chat message.
- **Medium to low** that a button tap is written consent. The letters support it, but none concerns a chat button, and both predate the current texts.

### What Vela should change

- **C12** `consent-script.en.md` and `.zh-TW`, §1, §4 and question 1:
  - **Who is responsible.** Say "My name is Timur Aiusheev. I run Vela, and I am responsible for your information."
  - **Providers.** Add a line naming them: "Companies that run Vela process your messages: the database is in Singapore, the program that writes down and understands voice messages is in the United States, and Cloudflare's network works worldwide."
  - **How long.** Add: "The words of your answers are deleted after 30 days; a one-line summary stays while the family uses Vela."
  - **Rights.** Add: "You can ask to see what Vela has, get a copy, correct it or delete it."
  - **Remove the contradictions.** Drop "Nobody outside the family and me" and "it doesn't show them to anyone".
- **C13** `consent.request` in `packages/copy/src/en.ts` and `zh-TW.ts`, `CONSENT_TEXT_VERSION` in `packages/services/src/consent.ts`, and script §2 (the two change together, as the README requires):
  - **Add one sentence:** "Vela is run by Timur Aiusheev. How your information is used: {notice}", with the notice link in the person's language.
  - **Version.** Raise the text version.
- **C14** `packages/services/src/consent.ts`: every consent row's `evidence` holds the chat id, the message id, the values filled into the text (the organiser's name) and a SHA-256 of the rendered text, so the exact text can be shown later.
- **C15** `consent-script.en.md` and `.zh-TW`, §6 note: the organiser may show the person where the button is, but the person taps it themselves.
- **C16** A "no" deletes what setup stored. Files: `packages/services/src/consent.ts` (`declineConsent`), `packages/services/src/jobs.ts`, script "After the call", and the notice ("If you do not give us this information"). This depends on C7, so the decline record survives.
  - **On a no:** delete the person's member row and channel link, keeping only the decline in the consent record.
  - **With no answer:** delete an `invited` member 30 days after the invite expires.
  - **The script and notice** then say exactly that.
- **C17** `nearby-contact-consent.en.md` and `.zh-TW`, text A. Add two sentences before the link:
  - "I gave Vela your name and number when I set it up."
  - "Vela keeps them, with the messaging app you use, in its database in Singapore until you or I remove them, and deletes them within 7 days if you say no, or after 14 days without a yes. You can ask Timur to see, correct or delete them."
- **C18** The onboarding step that asks for nearby contacts (`packages/services`), and `record_contact_consent`:
  - **At setup,** store only the contact's name.
  - **The number** is added when their yes is recorded.
  - **If this design stays,** get a lawyer's view on Article 19(1)(8) first.
- **C19** `README.md` step 4, and `organiser-agreement.en.md` §3, point 3 with its `.zh-TW` twin:
  - **Send individually.** Before adding an adult to the family group, the organiser sends them the privacy notice individually.
  - **Record it.** The founder records a `privacy_notice` consent row for each adult (data-requests B).
- **C20** `group.linked` (copy and services): add a button "I've read how Vela handles messages", recorded as a `privacy_notice` consent row for the member who taps. Vela keeps asks only from members who tapped.
- **C3, continued.** In `privacy-notice.en.md` and `.zh-TW`, replace the lawful-basis sentence with one line per group:
  - **Organisers:** the pilot arrangement and consent (Article 19(1)(2) and (5)).
  - **The person:** consent, with written consent for health words (Article 6(1)(6)).
  - **Family members:** consent.
  - **Nearby contacts:** consent once they say yes.

## Q5. A free pilot run by one individual

### Short answer

**The Act applies in full.**
- **An individual is covered.** A private individual is a non-government agency.
- **No threshold.** The Act has no threshold for size, revenue or fees.
- **The household exemption does not fit.** It covers only purely personal or family activity, and the pilot is startup work: outside providers, research, and a planned paid plan. Arguably that holds even for the founder's own family.

**Being free changes little.**
- **The one exemption.** Only the Article 8(2)(6) notice exemption turns on having no profit motive, and it also requires 「顯無不利之影響」. Vela should not rely on it.
- **Light security is allowed.** Security measures need only be proportionate (Rules Article 12).

**Who supervises today.** Probably Taipei City Government, since no industry authority covers Vela. If the Ministry of Digital Affairs regulation applies, that ministry supervises instead, and the regulation adds a written security plan, a 72-hour report for serious incidents, and five-year records.

### Reasoning

**Who the Act covers**
- **Individuals.** Article 2(8): 「非公務機關：指前款以外之自然人、法人或其他團體。」 [T2]
- **No difference by type.** National Development Council, 發法字第1070025093號 of 18 December 2018 [T13]: the term 「未區別自然人、法人或其他團體而有不同規範」. Where 「無明確業別對應之目的事業主管機關，則仍應由直轄市、縣(市)政府負查處之責」.
- **Foreigners in Taiwan.** Preparatory office, 個資籌法字第1140000636號 of 2 June 2025 [T13]: 「依屬地原則，不論我國人或外國人在我國領域內有違反本法之行為，應適用本法規定」. The founder is covered as an individual living in Taiwan, whatever his nationality.

**The household exemption**
- **The text.** Article 51(1)(1) exempts 「自然人為單純個人或家庭活動之目的」.
- **It depends on the activity.** National Development Council, 發法字第1070021284號 of 2 November 2018 [T13]: whether it applies 「應先視行為之屬性(例如執行業務、具有職業性質等)判斷之」.
- **Business activity is not covered.** Preparatory office, 個資籌法字第1140001478號 of 3 October 2025 [T13]: an individual processing data for an online retail business is not within the exemption, 「因與其職業或業務職掌有關」.

**Duties that apply to the founder** (text in force [T2] [T3])

| Duty | Where |
|---|---|
| Good faith, necessity, a lawful basis, and use within the purpose | Articles 5, 19, 20 |
| Special-category data | Article 6 (Q1) |
| Consent and proving it; notice | Articles 7, 8, 9 (Q4) |
| Access, copy, correction, stopping, deletion | Articles 3, 10, 11. Decide within 15 days for access or a copy, and within 30 days for the rest (Article 13); each may be extended by up to the same period, with written reasons |
| Breach notice | Article 12: 「應查明後以適當方式通知當事人」. Rules Article 22: 「即時」, stating the facts and the measures taken |
| Security, in proportion | Article 27(1): 「應採行適當之安全措施」. Rules Article 12: eleven possible measures, 「具有適當比例為原則」 |
| Supervising providers | Article 4; Rules Article 8 (Q3) |
| Transfer restrictions | Article 21 (Q3) |
| Civil liability | Article 29: liable 「但能證明其無故意或過失者，不在此限」. Article 28(3), applied by Article 29(2): NT$500 to 20,000 per person per incident when actual damage is hard to prove. Article 30: time limits (Q2) |
| Fines | Article 47: NT$50,000 to 500,000 for breaching Articles 6, 19 or 20(1). Article 48(1): an order to correct, then NT$20,000 to 200,000 each time, for breaching Articles 8 to 13. Article 48(2): NT$20,000 to 2,000,000 for breaching the security duty, then NT$150,000 to 15,000,000 |
| Crime | Article 41: only with intent to gain unlawfully or to harm, and resulting damage |

**The Ministry of Digital Affairs regulation** (數位經濟相關產業個人資料檔案安全維護管理辦法, 12 October 2023 [T8])

**Who it covers.** Article 2: 「從事附表一所列行業之自然人、私法人或其他團體」. Annex 1 lists:
- 582 software publishing;
- 620 computer programming and consultancy;
- 6312 data processing and hosting;
- 639 other information services.

**Whether it reaches Vela is unclear.** The question is whether an unregistered individual running a free pilot is 「從事」 (engaged in) one of these industries.

**If it applies:**
- **A written security plan** (Article 3).
- **Internal procedures** that include checking Article 6 (Article 9).
- **Notice of transfer regions** (Article 10).
- **Testing without real data where possible** (Article 11(2)(6)).
- **A 72-hour report to the ministry, or to the city government with a copy to the ministry.** This applies when an incident 「將危及其正常營運或大量當事人權益」 (Article 8(2)).
- **Records kept for at least five years** (Article 16).
- **Not the yearly review cycle.** Article 18 needs capital of NT$10 million or 5,000 records, which Vela will not reach.

**After the amendment takes effect.** The Commission supervises businesses that have no clear industry authority directly, and the others through a six-year transition (amended Article 51-1 [T1]; [T15]).

**Why being free does not help.**
- **The only rule that turns on profit.** It is the Article 8(2)(6) notice exemption.
- **Profit motive.** Vela is pre-commercial and measures willingness to pay for Vela Light (README, decision 13).
- **No adverse effect.** Health flags make 「顯無不利之影響」 hard to claim.
- **Vela gives full notice anyway,** so the exemption is not needed.

### Confidence

- **High** that the Act applies to the founder as an individual, and on the duties listed.
- **Medium** that the household exemption does not cover even the founder's own family.
- **Medium** on whether the Ministry of Digital Affairs regulation applies, and on who supervises.

### What Vela should change

- **C21** `infra/security-plan.md` (new, one page). Map each of the eleven measures in Rules Article 12, and Articles 4 to 17 of the ministry regulation, to what already exists or is still missing:
  - the co-founder's access rules;
  - Cloudflare Access and the admin access log;
  - the retention job and the data-requests runbook;
  - the incident runbook and the sub-processor checks.

  This satisfies Article 27(1) in proportion, and Article 3 of the regulation if it applies.
- **C22** `infra/runbooks/incident.md`: correct step 4 (section 0), and add the 72-hour report to the Ministry of Digital Affairs for the case where its regulation applies.
- `organiser-agreement.en.md` §8 is a question for a lawyer, not a change now: the agreement already says nothing limits data protection rights.

## Q6. A family outside Taiwan

**What stays the same.** The Act still applies to the founder, who processes data in Taiwan [T13]. What follows applies on top of it. The pilot starts with the founder's own family, so this is the first thing to settle.

**How the Russia rule differs.** Russia's law follows citizenship, not residence. The other three follow where the person is.

**Russia (Federal Law 152-FZ, as consolidated to 26 July 2026 by ConsultantPlus, an unofficial source [R1]).**
- **Who it reaches.** Article 1 part 1.1 applies it to the processing of Russian citizens' data by 「иностранными физическими лицами」 when based on a contract or 「на основании согласия гражданина Российской Федерации」 [R2]. Any Russian citizen in the family is covered, wherever they live.
- **Data localisation.** Article 18 part 5, as amended by Law 23-FZ of 28 February 2025, forbids recording and storing Russian citizens' data 「с использованием баз данных, находящихся за пределами территории Российской Федерации」 [R6]. The exceptions do not include consent. Vela's database is in Singapore.
- **Consent.**
  - It must be 「оформлено отдельно от иных информации и (или) документов」 (Article 9 part 1, Law 156-FZ of 24 June 2025) [R3].
  - Health data needs 「согласие в письменной форме」 (Article 10 part 2(1)) [R4].
  - Electronic written consent must be 「подписанного в соответствии с федеральным законом электронной подписью」, with the person's identity document details (Article 9 part 4) [R3].
- **Transfers.**
  - Roskomnadzor must be notified before processing and, separately, before any transfer abroad (Article 12 part 3, which refers to the notice under Article 22) [R5].
  - Data may not go to a country outside Roskomnadzor's adequacy list until the review period has passed (Article 12 parts 9 and 11) [R5].
  - That list includes Singapore and Kazakhstan, but not the United States or Taiwan (Order No. 128 of 5 August 2022, read from a secondary copy) [R7].
- **Practical obstacles.** Telegram was reported largely inaccessible in Russia from mid-March 2026 [R8]. Anthropic's list of supported countries does not include Russia [R9].
- **Result.** This **blocks the pilot as built.** Do not onboard a family with a Russian citizen until a lawyer has advised. At the least, that would need a database in Russia, notifications, e-signed consent and another channel.
- **Confidence.** High on the text as ConsultantPlus consolidates it, which is not the official publication. Medium on how Russia would apply it to an individual in Taiwan.

**Kazakhstan (Law No. 94-V of 21 May 2013).**
- **Consent** may be given 「письменно, посредством государственного сервиса, негосударственного сервиса либо иным способом, позволяющим подтвердить получение согласия」 (Article 8(1)) [K1].
- **What the consent must contain** (Article 8(4)):
  - the operator's name and identification number;
  - the person's name;
  - how long the consent lasts;
  - whether data goes to third parties;
  - 「сведения о наличии либо отсутствии трансграничной передачи」;
  - the list of data.
- **Withdrawal.** Processing must stop 「в течение пятнадцати рабочих дней」 after consent is withdrawn (Article 8(7), from 18 January 2026) [K1].
- **Transfers.** Transfers abroad and to third parties need consent (Article 7(6)) [K1].
- **Localisation.** Storage must be 「в базе, находящейся на территории Республики Казахстан」 (Article 12(2)) [K2]. Transfer to a country without adequate protection is allowed with the person's consent (Article 16(3)(1)) [K3].
- **Caveats.**
  - Articles 7 and 8 were read from an unofficial consolidation [K1], and Articles 12 and 16 from an unofficial copy [K2] [K3]. The official text could not be opened without JavaScript [K4], and amendments in 2025 and 2026 may have changed Articles 12 and 16.
  - Whether the law reaches an individual operating from abroad is unclear. A ministry letter of 6 May 2024 speaks of operators, including foreigners, collecting data 「на территории Республики Казахстан」 [K1].
- **Result.** A button with the full consent text can work. The localisation rule **likely blocks** keeping the data in Singapore until a lawyer confirms whether the law reaches Vela.
- **Confidence.** Medium on consent. Low on localisation and reach.

**European Union (GDPR [E1]).**
- **Reach.** The GDPR applies to a controller outside the EU who offers services to people in the EU, 「irrespective of whether a payment of the data subject is required」 (Article 3(2)(a)). The exemption for 「a purely personal or household activity」 (Article 2(2)(c)) does not fit startup work.
- **Health data.** Every health word is health data here, not only what a doctor produced. It needs 「explicit consent」 (Article 9(2)(a)), and Vela must be able to demonstrate it (Article 7(1)). 「It shall be as easy to withdraw as to give consent」 (Article 7(3)).
- **Notice.** It must meet Article 13: the legal basis, transfers and their safeguards, and the right to complain to a supervisory authority.
- **Representative.** Vela must appoint a representative in the EU (Article 27). The exemption covers processing 「which is occasional」 that includes no large-scale special-category data, and daily processing is not occasional.
- **Transfers.** Under the EDPB's criteria, the founder, bound by the GDPR, makes a transfer each time data goes to a provider outside the EU (Guidelines 05/2021 [E2]). The founder collecting directly from the person is not a transfer. Each of these needs a transfer tool:
  - Anthropic and Deepgram (United States): Data Privacy Framework certification, or standard contractual clauses;
  - Neon (Singapore): standard contractual clauses.
- **Retention and risk assessment.** Keeping consent records fits Article 17(3)(e), 「for the establishment, exercise or defence of legal claims」. A data protection impact assessment (Article 35) is likely, since the processing involves health data of older people and AI.
- **Result.** This **changes the pilot but does not block it.** It needs explicit consent (with a "no" that also switches off health flags), a GDPR notice, a paid representative, and transfer paperwork.
- **Confidence.** Medium to high.

**United States.**
- **No general federal privacy law.** The Federal Trade Commission can treat untrue promises in the notice as deceptive practices (FTC Act §5). HIPAA reaches health plans, health care clearinghouses, health care providers that bill electronically, and their business associates, not Vela.
- **The FTC's Health Breach Notification Rule** (16 CFR 318.2 [U4]).
  - Its definition of "health care services or supplies" includes online services that track 「symptoms」.
  - A personal health record must be able to draw information from multiple sources and be 「managed, shared, and controlled by or primarily for the individual」.
  - Whether Vela is such a record is uncertain. If it is, a breach, including a disclosure the person did not authorise, needs notice under that rule.
- **Washington State: My Health My Data Act.** This matters if the person or a family member lives there or their data is collected there.
  - **What it covers.** 「Consumer health data」 includes 「bodily functions, vital signs, symptoms」 [U1].
  - **Collecting** needs consent for a specified purpose, or must be necessary to provide the service the person asked for.
  - **Sharing,** such as a flag sent to organisers, needs consent 「separate and distinct from the consent obtained to collect consumer health data」, unless it is necessary for that service.
  - **The consent request** must disclose the categories, the purpose, the kinds of recipients, and how to withdraw [U3].
  - **A published policy.** A consumer health data privacy policy is required [U2].
  - **Unclear.** The Act applies to a 「legal entity」, and whether an individual founder counts is unclear.
- **Result.** This **does not block the pilot.** A family in Washington needs separate consents to collect and to share health words, and a health data policy page. Similar laws in other states were not researched.
- **Confidence.** Medium.

### What Vela should change

- **C23** `README.md` ("Before first use beyond the founder's own family", which becomes "Before any family") and `consent-script.en.md` ("Before the call", with its `.zh-TW` twin):
  - **Before any family, the founder's own included,** the founder records the country where the person and each family member live, and whether any of them is a Russian citizen.
  - **Onboard only** when everyone lives in Taiwan, or in a US state other than Washington, and no one is a Russian citizen.
  - **Otherwise,** first complete the steps above for that country: EU explicit consent, representative and transfer tools; Washington separate consents; Kazakhstan and Russia a lawyer's advice.

## Changes this memo recommends

Priority:
- **High:** before Vela runs for any family, the founder's own included.
- **Medium:** before the first family beyond the founder's own.
- **Low:** before the named feature ships, or before any public launch.

Every change to an English pilot document applies to its `.zh-TW` twin in the same commit. Every change to a notice regenerates `apps/worker/src/notices.generated.ts`.

| # | File | Change | Priority |
|---|---|---|---|
| C1 | `packages/db/src/schema.ts` (+ migration), `packages/copy/src/en.ts`, `zh-TW.ts`, `packages/services/src/consent.ts`, `consent-script.en.md` §4 §6, `infra/runbooks/data-requests.md` B | A separate written consent for health words: its own message and buttons after the light yes, consent kind `health_words`, the content listed in Q1. Until it ships, the founder sends the text from his own chat and records the reply by hand | High |
| C2 | `packages/services/src` (understand and flag handling) | Without `health_words` consent: no health mentions, health left out of summaries, no health memory facts | High |
| C3 | `privacy-notice.en.md` | Replace "No medical records." with an accurate sentence; add a health-words paragraph citing Article 6(1)(6); replace the lawful-basis sentence with one line per group (Q4) | High |
| C4 | `packages/ai/src/prompts` (`understand.v4.ts`, `flag.v2.ts`), `packages/ai/evals/cases/` | Summaries and mentions never keep a diagnosis, test result or medicine name; the flag quote leaves them out where it can | Medium |
| C5 | `data-map.md` row 29, gap 9 | Health memory facts only with `health_words` consent and a defined `expires_at` | Low |
| C6 | `packages/services/src/admin.ts` (`removeContact`) | Stop storing plain SHA-256 of the phone number in `deletions`; hash the row id and time, or use a keyed HMAC with a Worker secret | High |
| C7 | `packages/db/src/schema.ts` (+ migration), `packages/services/src/jobs.ts` | `consents` survive deletion (`ON DELETE SET NULL`, a keyed `subject_ref`, `subject_deleted_at`); words stripped from `evidence` at deletion; consent and `deletions` rows deleted after 5 years | Medium |
| C8 | `privacy-notice.en.md`, `data-map.md` rows 5, 19, gap 4 | Records of consent and deletion fingerprints kept 5 years, and why | Medium |
| C9 | `infra/sub-processors.md` | Record DPA acceptance for Cloudflare, Neon, Deepgram and Sentry before real family data; add a dated "Last checked" column (Rules Article 8(3)) | High |
| C10 | `privacy-notice.en.md`, `infra/sub-processors.md`, benchmark per-item consent text | Name OpenAI, Groq and Microsoft, and where they process, before they receive data | Low (sprint 2) |
| C11 | `consent-script.en.md`, `README.md` step 1, `data-map.md` row 22, gap 10 | Google Drive notes hold only family code, dates, versions, yes or no answers and scores; no quotes or health words | Medium |
| C12 | `consent-script.en.md` §1, §4, question 1 | Full name and responsibility; providers and places; retention of words and summaries; rights to see, copy, correct and delete; remove "Nobody outside the family and me" and "it doesn't show them to anyone" | High |
| C13 | `packages/copy/src/en.ts`, `zh-TW.ts` (`consent.request`), `packages/services/src/consent.ts` (`CONSENT_TEXT_VERSION`), script §2 | Add who runs Vela and the notice link in the person's language; raise the text version | High |
| C14 | `packages/services/src/consent.ts` | Consent `evidence` holds chat id, message id, the values filled into the text and a hash of the rendered text | High |
| C15 | `consent-script.en.md` §6 | The person taps the button themselves; the organiser only shows where it is | High |
| C16 | `packages/services/src/consent.ts` (`declineConsent`), `packages/services/src/jobs.ts`, script "After the call", notice | A "no" deletes the person's profile and channel link (the decline record stays, with C7); an invited member with no answer is deleted 30 days after the invite expires; script and notice say so | High |
| C17 | `nearby-contact-consent.en.md` text A | State the source, the messaging app, storage in Singapore, how long, and the rights to see, correct and delete | High |
| C18 | `packages/services` (onboarding nearby step, `record_contact_consent`) | Store only the contact's name at setup; add the number when the yes is recorded | Medium |
| C19 | `README.md` step 4, `organiser-agreement.en.md` §3, point 3 | The organiser sends the notice to each adult individually before adding them; the founder records `privacy_notice` per adult | High |
| C20 | `packages/copy/src` (`group.linked`), `packages/services` | A button on the group's first message records each member's `privacy_notice`; Vela keeps asks only from members who tapped | Medium |
| C21 | `infra/security-plan.md` (new) | One-page security plan mapping Rules Article 12 and the Ministry of Digital Affairs regulation to what exists | Medium |
| C22 | `infra/runbooks/incident.md` step 4 | The rule in force (Article 12, Rules Article 22), the 72-hour report to the Ministry of Digital Affairs if its regulation applies, and a check once the amendment takes effect | Medium |
| C23 | `README.md` "Before first use", `consent-script.en.md` "Before the call" | Record where everyone lives and any Russian citizenship; onboard only families in Taiwan or US states other than Washington with no Russian citizen until the Q6 steps are done | High |
| C24 | `README.md` "Review notes" | Record that the 2025 amendment was not in force on 4 September 2026; check again before any public launch | Low |

## Questions for a lawyer

1. **Relayed diagnoses.** When the person repeats in their own words what a doctor diagnosed, found or prescribed, is that 醫療 or 健康檢查 data under Rules Article 4? Does Article 6 then reach the transcript Vela carries to the family?
2. **A "no" to health words.** Is the "no" path in Q1 enough? Or may the health-words consent be a condition of using Vela, without being 「違反其意願」?
3. **The button as written consent.** Does a Telegram tap, stored with the rebuilt text, meet Article 6(2) 「以書面為之」 without an electronic signature, given Civil Code Article 3 and Electronic Signatures Act Article 5(2) to (4)?
4. **Keeping consent records.** Is keeping them for five years after withdrawal or deletion justified under Article 11(3) and Rules Article 21(3), and proportionate under Article 5?
5. **Nearby contacts before their yes.** Is there a lawful basis for storing their names and numbers before they answer, such as Article 19(1)(8)? And is text A, sent from the organiser's phone, the founder's Article 9 notice given at first use?
6. **Family members.** Does a notice link posted in the family group, or a button on that message, give the individual notice that letter 個資籌法字第1140002435號 requires for their consent?
7. **The household exemption.** Does it cover the founder's own family during the pilot?
8. **The Ministry of Digital Affairs regulation.** Does it apply to an unregistered individual running a free pilot? Which authority supervises the founder today?
9. **Google Drive.** May a personal Google Drive account, on consumer terms, hold pilot notes under a family code, given the supervision Rules Article 8 requires?
10. **Liability limits.** Is `organiser-agreement.en.md` §8, limiting financial responsibility "as far as the law allows", valid under the Consumer Protection Act and the Civil Code for a free pilot?
11. **The founder's status in Taiwan.** Does running the pilot affect the founder's immigration or work status, or require business registration? The researchers did not look into this.
12. **Russia.** Does Federal Law 152-FZ reach an individual in Taiwan who processes the data of a Russian citizen living outside Russia? What would onboarding such a family require in practice?
13. **Kazakhstan.** What do Articles 12 and 16 say in the official text as amended in 2025 and 2026? Does the law reach a foreign individual operating from abroad?
14. **The EU.** Is offering the pilot to the founder's own relative in the EU "offering services" under Article 3(2)(a)? Has the GDPR been amended since 2025 in a way that changes the consent, representative or transfer requirements?
15. **The United States.**
    - Is an individual founder a "legal entity" under Washington's My Health My Data Act?
    - Is Vela a vendor of personal health records under the FTC's Health Breach Notification Rule?
    - Which other state health data laws would matter?
16. **When the 2025 amendment takes effect.** What must change, for example breach reporting to the Commission, or the security measures in the final regulation?

## Sources

All sources were opened on 17 September 2026.

| ID | Source | Link |
|---|---|---|
| T1 | Personal Data Protection Act, current page with the 2025 amendment and its status (data to 4 September 2026) | https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021 |
| T2 | Personal Data Protection Act, text in force (amended 31 May 2023) | https://law.moj.gov.tw/LawClass/LawOldVer.aspx?pcode=I0050021 |
| T3 | Enforcement Rules of the Act (amended 2 March 2016) | https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050022 |
| T4 | Electronic Signatures Act (amended 15 May 2024) | https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0080037 |
| T5 | Civil Code, Article 3 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0000001&flno=3 |
| T6 | Medical Care Act, Article 67 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0020021&flno=67 |
| T7 | Administrative Penalty Act, Article 27 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=A0030210&flno=27 |
| T8 | 數位經濟相關產業個人資料檔案安全維護管理辦法 (12 October 2023), with Annex 1 | https://law.moj.gov.tw/LawClass/LawAll.aspx?PCODE=K0010162 |
| T9 | Commission preparatory office, interpretations: 1072002136, 1080010426, 1082000769, 1130001901, 1140000771 | https://www.pdpc.gov.tw/News_Content/101/393/ |
| T10 | Commission preparatory office, interpretations: 1140002435 | https://www.pdpc.gov.tw/News_Content/101/394/ |
| T11 | Commission preparatory office, interpretations: 1090000415, 1100016400 | https://www.pdpc.gov.tw/News_Content/101/398/ |
| T12 | Commission preparatory office, interpretations: 1080018861, 1082001626 | https://www.pdpc.gov.tw/News_Content/101/428/ |
| T13 | Commission preparatory office, interpretations: 1070021284, 1070025093, 1140000636, 1140001478 | https://www.pdpc.gov.tw/News_Content/101/440/ |
| T14 | Commission preparatory office: amendment promulgated 11 November 2025, start date to be set by the Executive Yuan | https://www.pdpc.gov.tw/News_Content/20/1010/ |
| T15 | Commission preparatory office: third reading on 17 October 2025, transition and supervision | https://www.pdpc.gov.tw/News_Content/20/1001/ |
| T16 | Ministry of Justice, 法律決字第10303508040號 (7 July 2014) | https://mojlaw.moj.gov.tw/LawContentExShow.aspx?id=FE270775&type=E |
| T17 | Ministry of Justice, 法律字第10203502480號 (21 March 2013; the Taipei City Government law database copy) | https://laws.gov.taipei/Law/Interpretation/Content/FE257446 |
| T18 | Ministry of Justice, 法律字第10503510230號 (18 July 2016; the Taipei City Government law database copy) | https://laws.gov.taipei/Law/Interpretation/Content/FE287761 |
| T19 | Ministry of Justice, 法律字第10603512680號 (10 November 2017) | https://mojlaw.moj.gov.tw/LawContentExShow.aspx?id=FE304775&type=E&kw=&etype=etype5 |
| T20 | Specific purposes and categories of personal data (codes 〇六九, 〇九〇, 一三五, 一三六, 一五七; C001 to C111) | https://law.pdpc.gov.tw/LawContent.aspx?id=FL010631 |
| T21 | Lee and Li newsletter (secondary), on the drafts of the Rules and three regulations pre-announced on 22 January 2026 | https://www.leeandli.com/TW/NewslettersDetail/7584.htm |
| T22 | Ministry of Labor, 勞動發管字第1120500319A號 (20 February 2023) | https://laws.mol.gov.tw/FLAW/FLAWDOC03.aspx?datatype=etype&ecode=N00000&ecase=%E5%8B%9E%E5%8B%95%E7%99%BC%E7%AE%A1&eno=1120500319A&edate=20230220 |
| R1 | Federal Law 152-FZ, consolidated to 26 July 2026 (ConsultantPlus; unofficial consolidation) | https://www.consultant.ru/document/cons_doc_LAW_61801/ |
| R2 | 152-FZ, Article 1 (ConsultantPlus; unofficial) | https://www.consultant.ru/document/cons_doc_LAW_61801/d44bdb356e6a691d0c72fef05ed16f68af0af9eb/ |
| R3 | 152-FZ, Article 9 (ConsultantPlus; unofficial) | https://www.consultant.ru/document/cons_doc_LAW_61801/6c94959bc017ac80140621762d2ac59f6006b08c/ |
| R4 | 152-FZ, Article 10 (ConsultantPlus; unofficial) | https://www.consultant.ru/document/cons_doc_LAW_61801/26edb2934b899bf9c74c3a8f7e574651c6565e6d/ |
| R5 | 152-FZ, Article 12 (ConsultantPlus; unofficial) | https://www.consultant.ru/document/cons_doc_LAW_61801/e4ebbe1780de623c7cf32a59ca82a7bb523a25dd/ |
| R6 | 152-FZ, Article 18 (ConsultantPlus; unofficial) | https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/ |
| R7 | Roskomnadzor Order No. 128 of 5 August 2022, adequacy list (secondary copy) | https://legalacts.ru/doc/prikaz-roskomnadzora-ot-05082022-n-128-ob-utverzhdenii-perechnja/ |
| R8 | Meduza news report, 17 March 2026, on Telegram becoming largely inaccessible in Russia | https://meduza.io/en/feature/2026/03/17/russia-was-expected-to-block-telegram-in-april-it-appears-to-have-done-it-two-weeks-early |
| R9 | Anthropic, supported countries and regions | https://www.anthropic.com/supported-countries |
| K1 | Kazakhstan Law No. 94-V, consolidated to 14 September 2026 (unofficial; Articles 7 and 8 read here) | https://prg.kz/document/?doc_id=31396226 |
| K2 | Kazakhstan Law No. 94-V, Article 12 (unofficial copy, may predate 2025 and 2026 amendments) | https://kodeksy-kz.com/ka/o_personalnyh_dannyh_i_ih_zawite/12.htm |
| K3 | Kazakhstan Law No. 94-V, Article 16 (unofficial copy, may predate 2025 and 2026 amendments) | https://kodeksy-kz.com/ka/o_personalnyh_dannyh_i_ih_zawite/16.htm |
| K4 | Kazakhstan Law No. 94-V, official text (could not be read without JavaScript) | https://adilet.zan.kz/rus/docs/Z1300000094_ |
| E1 | Regulation (EU) 2016/679 (GDPR) | https://eur-lex.europa.eu/eli/reg/2016/679/oj |
| E2 | EDPB Guidelines 05/2021 on the interplay between Article 3 and Chapter V, version 2.0 | https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf |
| U1 | RCW 19.373.010, definitions | https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.010 |
| U2 | RCW 19.373.020, consumer health data privacy policy | https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.020 |
| U3 | RCW 19.373.030, consent to collect and to share | https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.030 |
| U4 | 16 CFR 318.2, Health Breach Notification Rule definitions (Cornell Legal Information Institute copy) | https://www.law.cornell.edu/cfr/text/16/318.2 |

[T1]: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021
[T2]: https://law.moj.gov.tw/LawClass/LawOldVer.aspx?pcode=I0050021
[T3]: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050022
[T4]: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0080037
[T5]: https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0000001&flno=3
[T6]: https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0020021&flno=67
[T7]: https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=A0030210&flno=27
[T8]: https://law.moj.gov.tw/LawClass/LawAll.aspx?PCODE=K0010162
[T9]: https://www.pdpc.gov.tw/News_Content/101/393/
[T10]: https://www.pdpc.gov.tw/News_Content/101/394/
[T11]: https://www.pdpc.gov.tw/News_Content/101/398/
[T12]: https://www.pdpc.gov.tw/News_Content/101/428/
[T13]: https://www.pdpc.gov.tw/News_Content/101/440/
[T14]: https://www.pdpc.gov.tw/News_Content/20/1010/
[T15]: https://www.pdpc.gov.tw/News_Content/20/1001/
[T16]: https://mojlaw.moj.gov.tw/LawContentExShow.aspx?id=FE270775&type=E
[T17]: https://laws.gov.taipei/Law/Interpretation/Content/FE257446
[T18]: https://laws.gov.taipei/Law/Interpretation/Content/FE287761
[T19]: https://mojlaw.moj.gov.tw/LawContentExShow.aspx?id=FE304775&type=E&kw=&etype=etype5
[T20]: https://law.pdpc.gov.tw/LawContent.aspx?id=FL010631
[T21]: https://www.leeandli.com/TW/NewslettersDetail/7584.htm
[T22]: https://laws.mol.gov.tw/FLAW/FLAWDOC03.aspx?datatype=etype&ecode=N00000&ecase=%E5%8B%9E%E5%8B%95%E7%99%BC%E7%AE%A1&eno=1120500319A&edate=20230220
[R1]: https://www.consultant.ru/document/cons_doc_LAW_61801/
[R2]: https://www.consultant.ru/document/cons_doc_LAW_61801/d44bdb356e6a691d0c72fef05ed16f68af0af9eb/
[R3]: https://www.consultant.ru/document/cons_doc_LAW_61801/6c94959bc017ac80140621762d2ac59f6006b08c/
[R4]: https://www.consultant.ru/document/cons_doc_LAW_61801/26edb2934b899bf9c74c3a8f7e574651c6565e6d/
[R5]: https://www.consultant.ru/document/cons_doc_LAW_61801/e4ebbe1780de623c7cf32a59ca82a7bb523a25dd/
[R6]: https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/
[R7]: https://legalacts.ru/doc/prikaz-roskomnadzora-ot-05082022-n-128-ob-utverzhdenii-perechnja/
[R8]: https://meduza.io/en/feature/2026/03/17/russia-was-expected-to-block-telegram-in-april-it-appears-to-have-done-it-two-weeks-early
[R9]: https://www.anthropic.com/supported-countries
[K1]: https://prg.kz/document/?doc_id=31396226
[K2]: https://kodeksy-kz.com/ka/o_personalnyh_dannyh_i_ih_zawite/12.htm
[K3]: https://kodeksy-kz.com/ka/o_personalnyh_dannyh_i_ih_zawite/16.htm
[K4]: https://adilet.zan.kz/rus/docs/Z1300000094_
[E1]: https://eur-lex.europa.eu/eli/reg/2016/679/oj
[E2]: https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf
[U1]: https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.010
[U2]: https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.020
[U3]: https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.030
[U4]: https://www.law.cornell.edu/cfr/text/16/318.2
