# Japanese localisation: scope (build plan 5.6)

3 October 2026. Japan is wave 2 (market order): the same LINE adapter as Taiwan, with Japanese copy and a local partner conversation. This page says what "Japanese" means in Vela, how much text there is, what needs a person rather than a model, and the order of work. Nothing here is built yet except an empty `ja` catalog for the app (below).

## What already speaks Japanese

- **The data model.** `ja` is already one of `LANGS` (`packages/contracts/src/domain.ts`). Members, families, translations and transcripts can be stored as Japanese today.
- **The models.** Understanding, the flag check, translation, the read-back and the weekly read take a language, and Claude writes Japanese. The prompts are in English and ask for output "in summaryLang", so they need no Japanese version. They do need **evals in Japanese** before launch (below).
- **Speech to text.** Deepgram `nova-3` transcribes Japanese (`packages/ai/src/stt.ts`).
- **The bot's copy falls back to English.** `t()` gives English for a language without a catalog (`packages/copy/src/index.ts`), so a Japanese member would see English, never an error.

## What has to be written

| Surface | Where | Size | Notes |
|---|---|---|---|
| App strings | `apps/app/src/i18n/locales/ja.po` | 495 messages | Lingui catalog. Named placeholders only, as for zh-TW |
| Bot and notification copy | `packages/copy/src/ja.ts` | 133 keys | Typed: adding `ja` to `MVP_LANGS` makes every missing key a type error, which is the checklist |
| Ask bank | `packages/copy/src/ask-bank.ts` | 52 items | Needs adapting, not just translating (below) |
| Story prompts | the `story` items of the bank | part of the 52 | Same |
| Privacy notice | `plan/materials/pilot/privacy-notice.ja.md` | about 4,100 English words | Rewritten for APPI by counsel, not translated (below) |
| Consent script, organiser agreement, nearby-contact consent | `plan/materials/pilot/*.ja.md` | about 6,000 English words | The same |
| Store listing | App Store and Google Play | about 600 words | With the health disclaimer (build plan 6.4) |
| Read-aloud voice | Azure `ja-JP` neural voice | — | Build plan 2.6 and 4.3; `expo-speech` covers the gap |

Roughly 9,000 words of legal text and 4,000 words of product text. At a professional rate that is about two weeks of a translator's time plus a native reviewer's pass; the legal text needs counsel either way.

## What needs a person, not a model

1. **How Vela addresses her.** Japanese has no neutral "you" for a parent. The ask bank and the bot copy must pick a register: polite です/ます with the family's own address form (お母さん, 母さん, おばあちゃん) in place of "you", rather than あなた, which can sound cold to an older person. This is the Japanese version of the zh-TW 您/你 question, and a native reviewer decides it before anything is written.
2. **No gendered pronouns.** The copy rules already ban them (`packages/copy/src/rules.ts`). In Japanese that means no 彼 or 彼女 for her. The rules file gains a `ja` list, as zh-TW bans 他 and 她.
3. **The ask bank's topics.** Some items are about Taiwan or English-speaking lives (foods, festivals). A Japanese bank swaps them for Japanese ones (おせち, お盆, 銭湯), keeping the same ids where the topic carries over.
4. **Words that must not be used.** The ban on surveillance words ("monitor", "check on", "track") needs its Japanese list: 見守り is the word Japanese competitors use for exactly this, and Vela's position (spec §1) is that it is not a monitoring product. The reviewer and the founder decide whether 見守り is banned or reclaimed.
5. **APPI.** Japan's privacy law differs from Taiwan's PDPA on sensitive data (要配慮個人情報, which includes medical history), on cross-border transfer (consent or equivalent safeguards for sending data to the US and Singapore) and on the person in charge. The privacy notice, the consent script and the health-words consent (ADR-27) are rewritten by Japanese counsel, and the data map gains a Japan column.

## The order of work

1. **Decide the register and the 見守り question** with a native reviewer: one page of examples, signed off.
2. **Copy rules for `ja`** in `rules.ts`: the banned pronouns and surveillance words, so every later string is checked as it is written.
3. **Bot copy and ask bank** (`ja.ts`, bank adaptations), with `ja` added to `MVP_LANGS` so the type checker lists every missing key.
4. **App catalog** (`ja.po`), then `ja` added to `AppLocale` and to `pnpm test`'s `lingui check missing`.
5. **Evals in Japanese** for understanding and the flag check: the same cases as the English and Chinese evals, including health words without consent, a scam call, and an injected instruction.
6. **Legal texts** by Japanese counsel, then the store listing.
7. **Voice:** the Azure `ja-JP` voice tested on a read-back; `expo-speech` as the fallback.
8. **LINE Japan:** a Japanese LINE Official Account (the adapter is the same as Taiwan's, ADR-32).

Steps 1–2 take days; 3–4 about two weeks with a translator; 5 a few days; 6 depends on counsel. Nothing here blocks the Taiwan or English-speaking pilot.

## Built now

`ja` is a locale in `apps/app/lingui.config.ts`, so `pnpm --filter @vela/app i18n:extract` keeps `src/i18n/locales/ja.po` in step with the app: every message, with empty translations. The app does not load it yet (`AppLocale` is still `en` and `zh-TW`), so nobody sees a half-translated screen. A translator works directly in that file.

## For the founder

- Find a native Japanese reviewer, ideally someone with a parent in their 70s, for step 1.
- When Japan comes closer, find Japanese counsel for APPI (step 6).
- Decide whether 見守り is a word Vela uses.
