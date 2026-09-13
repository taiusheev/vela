# Pilot consent pack

13 September 2026 · build plan sprint 1, task 1.1 (spec §9, §17, Appendix A) · owner: the founder uses it, the co-founder keeps it true to the code

Everything the founder needs to bring a family into the pilot with each person's agreement recorded. English is the source. The Traditional Chinese files say the same thing and await native review (build plan 2.4); do not use them with a Taiwanese family until a native reviewer has signed them off.

> The privacy notice, consent script, nearby-contact consent, organiser agreement and data map are **drafts for the pilot, not legal advice**, and must be reviewed by counsel before any public launch.

## The documents

| File | For whom | What it is for | When the founder uses it | What gets recorded |
|---|---|---|---|---|
| [`privacy-notice.en.md`](privacy-notice.en.md) · [`.zh-TW`](privacy-notice.zh-TW.md) | Everyone in the pilot | Who runs Vela, what is collected, why, where, how long, who sees it, rights; Taiwan PDPA Article 8 items | Sent to the organiser with the agreement; summarised to the person on the call; linked from the bot profile, the family group's first message and the nearby-contact message | `consents` kind `privacy_notice`, text version `privacy-notice.v1`, per adult who received it |
| [`consent-script.en.md`](consent-script.en.md) · [`.zh-TW`](consent-script.zh-TW.md) | The person the light is for | What the founder says on the onboarding call, with the five questions people ask most | On the call, before Vela sends its consent message | Call note; then `consents` kind `light` when the person taps yes in the chat |
| [`nearby-contact-consent.en.md`](nearby-contact-consent.en.md) · [`.zh-TW`](nearby-contact-consent.zh-TW.md) | Nearby contacts | The message sent in the organiser's name, and what saying yes means | After the call, for each contact the organiser names | `consents` kind `nearby`, text version `nearby-consent.v1` |
| [`organiser-agreement.en.md`](organiser-agreement.en.md) | Organisers | What the organiser and the founder each agree to; the refundable US$15 fee | Before the call, with the privacy notice | `consents` kind `pilot`, text version `organiser-agreement.v1` |
| [`data-map.md`](data-map.md) | Founder, co-founder, counsel | Every data category, source, table, purpose, retention, who sees it, sub-processors, and the gaps | When a feature changes what data is used; when someone asks for a copy or deletion; for counsel's review | Nothing |

Related: [`infra/sub-processors.md`](../../../infra/sub-processors.md) (the providers named in the notice) and [`infra/runbooks/incident.md`](../../../infra/runbooks/incident.md) (what happens if personal data is exposed).

## Onboarding a family, in order

1. **Organiser says yes to the pilot.** Send the organiser agreement and the privacy notice in their language. They reply "I agree". Record `pilot` and `privacy_notice` for them. Take the fee (and note it in the ledger).
2. **Organiser talks to the person first.** The founder's call is never the first they hear of Vela.
3. **Organiser sets up the family group:** a new Telegram group with family members only, children under 13 not added, the privacy notice shared, the Vela bot added and made an administrator with every permission switched off (Telegram only sends reactions to administrator bots).
4. **Onboarding call** with the person, using the consent script in their language. Record the call note.
5. **Consent message.** Vela sends `consent.request` in the person's language with the buttons "Yes, that's fine" and "No, thank you". Only the tap on yes switches the light on and writes the `light` consent row. If there is no tap in 24 hours, the organiser mentions it once; Vela never reminds.
6. **Nearby contacts.** The organiser sends text A of the nearby-contact message; the founder adds a contact only after their yes.
7. **Research questions** (UCLA-3 at week 0) only after a separate yes on the call.

## Placeholders to fill before first use

| Placeholder | Where | What to put |
|---|---|---|
| `[FOUNDER FULL NAME]` | Notice, agreement, nearby message | The founder's legal name |
| `[CONTACT ADDRESS]` | Notice, agreement, nearby page | A contact address the founder reads daily (a Vela address once the domain exists) |
| `[PRIVACY NOTICE LINK]` | Nearby message, bot profile | A public URL for the notice in each language (Telegram also requires a privacy policy link in the bot's settings) |
| `[NOTES TOOL]`, `[NOTES TOOL LOCATION]` | Notice, data map, script | The tool holding call notes, research answers and the fee ledger, and where its data is stored |
| `[BENCHMARK STORAGE]` | Data map | Where consented STT clips live during sprint 2, outside git |
| `[family code]`, names, dates, times | Script, agreement, messages | Per family |

## Versions: when to ask again

- Every document carries a version (`privacy-notice.v1`, `consent-script.v1`, `nearby-consent.v1`, `organiser-agreement.v1`, `data-map.v1`). The version is what goes into `consents.text_version`.
- A wording change that keeps the meaning keeps the version. A change of meaning (new data, new purpose, new recipient, longer retention, a new provider that receives family messages) needs a new version, and everyone affected is told before it applies, and asked again where consent covers it.
- English and Traditional Chinese change together and share version numbers.
- The in-chat consent text (`consent.request` in `@vela/copy`) and the script's section 2 must keep the same meaning; change them together.

## Words

From spec §9, §20 and research/11: never "monitor", "track", "check on", "keep an eye" (nor "watch over" or "for your safety"); lead with the family; say who acts (the family asks, the organiser calls, Vela carries); use names, never "the parent" or "the user"; no gendered pronoun for the person the light is for; never promise safety; always say Vela is not an emergency service.

## Decisions this draft takes where the sources are silent

The founder should confirm these; each is also listed as an open question in the hand-off.

1. **Retention** for data with no rule in the schema (text of asks, replies and translations, chips, suggestions, `outbound.payload`, `ai_calls.output`): 30 days. Summaries, answer times, quiet-day records and weekly reads: while the family uses Vela. End of pilot without continuing: everything deleted within 30 days except content-free events. See `data-map.md`.
2. **Research notes and UCLA-3 answers** are filed under a family code and deleted at most 12 months after the pilot ends.
3. **Nearby contacts** enter Vela only after their yes in the pilot; in the app, a decline or 14 days without an answer deletes them.
4. **Group messages** not meant for Vela are dropped without being stored or logged.
5. **Real answers in evals or benchmarks** only with a separate yes per item; golden-set text anonymised before commit; voice clips outside git, deleted within 30 days after the benchmark.
6. **The co-founder (an AI coding agent) never receives production message content**; production content is read only by the founder, and every read is logged.
7. **Response times:** stop immediately; other requests within 7 days (legal ceilings 15 and 30 days); a withdrawn nearby contact removed within 7 days.
8. **Breach notice** to affected people within 72 hours; the founder tells organisers the same day about a late, missing or wrong message.
9. **New providers** receiving family messages are announced to organisers 14 days ahead.
10. **The fee:** US$15 for the first month, fully refundable on request during the month or 14 days after, returned within 7 days; no further charge without a new yes.
11. **Error reports** kept at most 90 days in Sentry's EU region; admin access log and daily metrics 24 months.
