# Market order, v2

2026-09-18 (written 2026-09-13; the first pilot families and the state of Telegram in Russia revised 2026-09-18). Founder's decision: **Russia is deferred.** We focus on markets without strong platform or legal restrictions: Taiwan, the United States, Japan, Europe (Germany and the UK first), and India. This document sets the order, the channel and language per market, and what it changes in the build. Numbers come from `research/08–14`.

## Why Russia waits

WhatsApp lost 56% of its Russian daily users to the 2026 block; Telegram has been largely inaccessible in Russia since mid-March 2026 (`plan/materials/pilot/legal-memo.md` Q6); the state messenger MAX opens its bot platform only to Russian legal entities and stores chats in plaintext under the Yarovaya law; Western remittance apps do not serve Russia; the data-localisation law would need a Russian entity and Russian hosting. Every one of these is outside our control. Russian-speaking families outside Russia (Israel, Germany, Cyprus, Serbia, the Baltics, the US) remain reachable through the ordinary channels and are served by the Russian localisation when it ships; the Russian market itself is revisited when a channel is stable and an entity exists. [research/10, /13]

## How markets were ranked

Five criteria, each sourced: (1) elders living alone, (2) a reachable channel among the 65+, (3) willingness and ability to pay, (4) language and regulation cost, (5) the founder's reach today.

| Market | 65+ living alone | Parent channel | 70+ online | Language | Pay anchor | Regulation | Founder reach | Wave |
|---|---|---|---|---|---|---|---|---|
| **Taiwan** | 23% of 4.7M ≈ 1M (MOI 2023 rate on 2025 base) | LINE, 99.4% of adults; LINE check-in bot 93% response | 54% | zh-TW | Long-term care 3.0 device subsidies; no consumer app anchor; price to test in NT$ | PDPA; LINE paid plan from day one (free tier 200 pushes/mo) | Lives there; university and local networks | **1** |
| **United States** | 28% ≈ 16.2M | No dominant messenger among seniors: texting 83%, calls 57% of Boomers; the parent surface app, SMS, and the voice line | ~75% (Pew, 65+) | en | Life360 $143/yr per paying circle; caregivers spend $7,242/yr; Snug $19.99/mo | State privacy laws; 10DLC registration for SMS; app stores need the entity | English communities, ikigai network, caregiver forums | **1** (app-only path), **3** at scale (voice line) |
| **Japan** | 19.4% of 65+; 10.8M by 2050 | LINE, 69% of people in their 60s | 61% (65+) | ja | Yamato HelloLight ¥980/mo; Chikaku; FamilyAlbum used by 65% of parents | APPI; LINE Japan terms | Low | **2** (LINE adapter reused; Japanese localisation) |
| **Europe: Germany, UK** | Germany 34% of 65+, 56% of 85+; UK 4.3M people 65+ | WhatsApp: "more than half" of German 60+, 92% of UK adults | UK 65+ 3h20m online/day; 97% of offline 65+ will stay offline | de, en | Famileo £5.99–17.99/mo; Hausnotruf €25.50/mo reimbursed | GDPR; WhatsApp Business needs Meta verification and an entity; utility templates $0.004–0.046/msg | Russian-speaking and international families in Germany; English communities | **2** (WhatsApp adapter after the entity) |
| **India** | 23% of elderly; 36% of older parents have a migrant child (LASI) | WhatsApp, fastest-growing band is 55+ | low outside cities | hi, en | Price-sensitive; remittance apps live; ₹ pricing to test | DPDP Act 2023 | Diaspora communities abroad | **3** |

## What changes in the build

| Area | Before | Now |
|---|---|---|
| Adapter order | Telegram → LINE → WhatsApp → MAX | **Telegram (instrument only) → LINE → WhatsApp → voice/SMS**; MAX dropped |
| MVP languages | en, ru, zh-TW | **en, zh-TW**; phase 2: ja, de, hi; ru as a localisation when Russian-speaking families abroad justify it |
| First pilot families | Russian-speaking diaspora with a parent in Russia | **A dogfooding week on staging, then families living in Taiwan on Telegram once production is deployed, then English- and Chinese-speaking families on the app, then Taiwan on LINE.** The founder's parent waits: Russia's 152-FZ forbids storing Russian citizens' data in databases outside Russia, and Telegram has been largely inaccessible in Russia since mid-March 2026 (`plan/materials/pilot/legal-memo.md` Q6) |
| The parent surface | Phase 2 | Sprint 3–4: it is the only channel that works in every market, and the US path depends on it |
| The voice line | Phase 3 | Phase 2: the offline half of Taiwan's 70+, the US landline parent, Japan's 80+ |
| Entity | Deferred | Still deferred, but it now gates two things: WhatsApp Business (Meta verification) and the app stores. Week 6 is the latest sensible date |
| Data residency | eu · apac · us regions | Unchanged; India's DPDP and Japan's APPI reviewed before those launches |
| Pricing | $9.99/mo or $79/yr | US and Europe as planned; Taiwan, Japan, and India priced locally after a test (NT$, ¥, ₹); annual pre-selected everywhere |

## Reach plan by wave

- **Wave 1, Taiwan and the English-speaking app path.** Taiwan: university networks, LINE communities for adult children, the ikigai cohort, one LINE official account. English: caregiver forums and subreddits for adult children of ageing parents, the ikigai network, families of international students in Taiwan. Both need nothing more than the app and the LINE adapter.
- **Wave 2, Japan and Germany/UK.** Japan through the same LINE adapter with Japanese copy and a local partner conversation (Chikaku-style TV services show the appetite). Germany and the UK through WhatsApp once the entity exists, with GDPR paperwork done first.
- **Wave 3, the US at scale and India.** The voice line and SMS for the US landline parent; WhatsApp and Hindi for India, with remittance-app partnerships (GCash-style rails exist there, unlike Russia).

## Open items this creates

1. Traditional Chinese copy for the parent surface and the LINE bot, reviewed by a native speaker (the founder's network).
2. LINE Messaging API account on the paid plan, in the founder's name until the entity exists.
3. A Taiwan price test design (three price points in NT$).
4. Japanese localisation scoped as a phase-2 task with a native reviewer.
5. The WhatsApp Business verification checklist, ready for the day the entity exists.
