# Pilot consent pack

13 September 2026 · build plan sprint 1, task 1.1 (spec §9, §17, Appendix A) · owner: the founder uses it, the co-founder keeps it true to the code

Everything the founder needs to bring a family into the pilot with each person's agreement recorded. English is the source. The Traditional Chinese files say the same thing and await native review (build plan 2.4); do not use them with a Taiwanese family until a native reviewer has signed them off.

> The privacy notice, consent script, nearby-contact consent, organiser agreement and data map are **drafts for the pilot, not legal advice**, and must be reviewed by counsel before any public launch.

## The documents

| File | For whom | What it is for | When the founder uses it | What gets recorded |
|---|---|---|---|---|
| [`privacy-notice.en.md`](privacy-notice.en.md) · [`.zh-TW`](privacy-notice.zh-TW.md) | Everyone in the pilot | Who runs Vela, what is collected, why, where, how long, who sees it, rights; Taiwan PDPA Article 8 items | Sent to the organiser with the agreement; summarised to the person on the call; shared by the organiser in the family group when they create it (step 4; Vela's own first group message carries no link); linked from the bot profile and the nearby-contact message | `consents` kind `privacy_notice`, text version `privacy-notice.v1`, per adult who received it |
| [`consent-script.en.md`](consent-script.en.md) · [`.zh-TW`](consent-script.zh-TW.md) | The person the light is for | What the founder says on the onboarding call, with the five questions people ask most | On the call, before Vela sends its consent message | Call note; then `consents` kind `light` when the person taps yes in the chat |
| [`nearby-contact-consent.en.md`](nearby-contact-consent.en.md) · [`.zh-TW`](nearby-contact-consent.zh-TW.md) | Nearby contacts | The message sent in the organiser's name, and what saying yes means | After the call, for each contact the organiser names | `consents` kind `nearby`, text version `nearby-consent.v1` |
| [`organiser-agreement.en.md`](organiser-agreement.en.md) · [`.zh-TW`](organiser-agreement.zh-TW.md) | Organisers | What the organiser and the founder each agree to; the refundable US$15 fee | Before the call, with the privacy notice | `consents` kind `pilot`, text version `organiser-agreement.v1` |
| [`data-map.md`](data-map.md) | Founder, co-founder, counsel | Every data category, source, table, purpose, retention, who sees it, sub-processors, and the gaps | When a feature changes what data is used; when someone asks for a copy or deletion; for counsel's review | Nothing |

Related: [`infra/sub-processors.md`](../../../infra/sub-processors.md) (the providers named in the notice), [`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md) (every change the founder makes by hand: consent rows, nearby contacts, away, a death, someone leaving, copies and deletions) and [`infra/runbooks/incident.md`](../../../infra/runbooks/incident.md) (what happens if personal data is exposed).

## Onboarding a family, in order

The order matters: Vela links a group only when the bot is added by an organiser whose setup is finished (flows §3.3), and it sends its consent message only when the person opens the invite link that setup produces (flows §3.2).

1. **Organiser says yes to the pilot.** Send the organiser agreement and the privacy notice in their language. They reply "I agree". Note the date, channel and their words under the family code; the `pilot` and `privacy_notice` rows are written in step 3, once their member row exists. Take the fee (and note it in the ledger).
2. **Organiser talks to the person first.** The founder's call is never the first they hear of Vela.
3. **Organiser sets Vela up in a private chat with the bot.** They send `/start` and answer the questions (name, greeting, language, country, time zone, wake time), and tap **Skip** at the nearby-contact question (step 7). The last message holds the invite link for the person; it works for 7 days and the organiser keeps it until the call. The founder then runs sections A and B of `infra/runbooks/data-requests.md` (checks, and the organiser's consent rows).
4. **Organiser creates the family group** after step 3: a new Telegram group with family members only and without the person, children under 13 not added, the privacy notice shared, and the Vela bot added by the organiser. Making the bot an administrator with every permission switched off is optional and lets reactions count (Telegram only sends reactions to administrator bots). If the bot was added before step 3 was finished, Vela answers "Only the family organiser can connect Vela to a group": remove the bot and add it again.
5. **Onboarding call** with the person, using the consent script in their language, within 7 days of step 3. Record the call note and the `privacy_notice` row for the person (data-requests B).
6. **Invite link and consent message.** At the end of the call the organiser sends the person the invite link; the person opens it and taps **Start**. Only then does Vela send `consent.request` in the person's language with the buttons "Yes, that's fine" and "No, thank you". Only the tap on yes switches the light on and writes the `light` consent row. If there is no tap in 24 hours, the organiser mentions it once; Vela never reminds.
7. **Nearby contacts.** The organiser sends text A of the nearby-contact message; the founder adds a contact only after their yes (data-requests C).
8. **Research questions** (UCLA-3 at week 0) only after a separate yes on the call.

While the family takes part, the organiser tells the founder about travel, a death, or someone leaving the group; Vela has no button for these in the pilot, and the founder makes the change the same day (data-requests E, F, G).

## Before first use beyond the founder's own family

- `applyRetention` implements every pilot rule in `data-map.md` (gap 1), with retention tests. Flows §3.15 and build plan 2.8 do not list them yet; until they are built, the 30-day promise in the notice is not kept automatically.
- Either flows §3.1 and §3.12 keep nearby contacts out of Vela and out of quiet notices until they say yes and create every pilot family in `apac` (`data-map.md` gaps 11 and 12), or the founder runs the checks in data-requests A on the day of every setup.
- Every placeholder below is filled, and the Traditional Chinese files are signed off by a native reviewer before any Taiwanese family.

## Placeholders to fill before first use

| Placeholder | Where | What to put |
|---|---|---|
| `[FOUNDER FULL NAME]` | Notice, agreement, nearby message | The founder's legal name |
| `[CONTACT ADDRESS]` | Notice, agreement, nearby page | A contact address the founder reads daily (a Vela address once the domain exists) |
| `[PRIVACY NOTICE LINK]` | Nearby message, bot profile | A public URL for the notice in each language (Telegram also requires a privacy policy link in the bot's settings) |
| `[NOTES TOOL]`, `[NOTES TOOL LOCATION]` | Notice, data map, script | The tool holding call notes, research answers and the fee ledger, and where its data is stored |
| `[BENCHMARK STORAGE]` | Data map | Where consented STT clips live during sprint 2, outside git |
| `[local emergency number]` | Script, section 4 | The emergency number where the person lives (119 in Taiwan, 911 in the United States, 999 or 112 in the United Kingdom, 112 in the European Union), noted with the family's details before the call |
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

1. **Retention** for data with no rule in the schema (text of asks, replies and translations, chips, suggestions, `outbound.payload`, `ai_calls.output`): 30 days. Summaries, answer times, quiet-day records and weekly reads: while the family uses Vela. End of pilot without continuing: the family's information deleted within 30 days; kept longer only what already has a longer period (content-free events and daily counts, the AI call log without names or output, error reports, the admin access log, deletion proofs, research notes under a family code, the fee record). See `data-map.md`.
2. **Research notes and UCLA-3 answers** are filed under a family code and deleted at most 12 months after the pilot ends.
3. **Nearby contacts** enter Vela only after their yes in the pilot: the organiser skips the setup question and the founder adds them; in the app, a decline or 14 days without an answer deletes them.
4. **Group messages** not meant for Vela are dropped without being stored or logged. Group privacy mode stays on; an administrator bot still receives every group message, and the notice says so.
5. **Real answers in evals or benchmarks** only with a separate yes per item; golden-set text anonymised before commit; voice clips outside git, deleted within 30 days after the benchmark.
6. **The co-founder (an AI coding agent) never receives production message content**; production content is read only by the founder. Reads on the admin page are logged automatically and reads in the Neon console by hand; flag quotes and weekly-read drafts also reach the founder's own Telegram chat with the bot, where reading is not logged and the founder deletes them within 30 days.
7. **Response times:** stop immediately; other requests within 7 days (legal ceilings 15 and 30 days); a withdrawn nearby contact removed within 7 days.
8. **Breach notice** to affected people within 72 hours; the founder tells organisers the same day about a late, missing or wrong message.
9. **New providers** receiving family messages are announced to organisers 14 days ahead.
10. **The fee:** US$15 for the first month, fully refundable on request during the month or 14 days after, returned within 7 days; no further charge without a new yes.
11. **Error reports** kept at most 90 days in Sentry's EU region; admin access log and daily metrics 24 months.
12. **Manual changes** (consent rows the founder records, nearby contacts, away dates, a death, someone leaving, copies, corrections and deletions) are made by the founder in the Neon console following `infra/runbooks/data-requests.md`, because the instrument has no admin write path.
13. **Every pilot family is stored in `apac`**, whatever its country, until the region router exists.
