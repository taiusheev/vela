# Vela: the landscape, the gaps, and how we win

Tech co-founder memo. 2026-09-11. Synthesised from six deep-dive reports in this folder (US medical alerts and wearables, passive home sensing, East Asia, Europe/ANZ/Israel, AI companions and check-in apps, market sizing and lessons). Roughly 500 sources; ~600 tool calls. Every number below is cited in the underlying report.

---

## 1. The problem, in numbers that matter

| Fact | Number | Report |
|---|---|---|
| People 65+ living alone across the 10 richest ageing markets | ~45–50M (excl. China's ~25–30M) | 06 |
| Japan 65+ solo households, 2040 | 8.96M (from 6.7M in 2020) | 03 |
| Japan: died alone at home, 2024 | 76,020; 21,856 found after 8+ days | 06 |
| Korea: senior solo households with "no one to call when sick" | 34.8% | 06 |
| Falls: share of 65+ who fall each year | ~1 in 4 | 06 |
| Falls that become a "long lie" (>1h on the floor) | ~1 in 5; mortality 12% if found <1h vs 67% after 72h | 06 |
| PERS pendant wearers: falls that happen with pendant OFF | ~3 in 4 | 01 |
| France: alarm-centre calls that are true emergencies | ~2% (98% reassurance/social) | 04 |
| Seoul smart-plug program: signals per real intervention | 46,974 signals → 154 interventions (0.3%) | 03 |
| US family caregivers, 2025 | 63M; nearly 1 in 3 long-distance | 06 |
| Global emigrant stock (children abroad, parents at home) | ~300M | 06 |

The value we sell is **minutes-to-discovery**, not "wellness." Everything else is decoration.

---

## 2. How the world solves it today (and what's wrong with each)

### A. Emergency pendants (PERS / telecare / Hausnotruf / 緊急通報)
The incumbent category worldwide. ~16M users in Europe + North America, ~1.2M Germany, ~2M UK, ~900k Spain, 600k+ Medical Guardian, 900k+ Lifeline. Sold via councils, insurers (Germany pays exactly €25.50/mo), Medicaid waivers, and DTC at $25–50/mo.

- **Pros:** proven 24/7 human response (14–60s), reimbursement codes exist, oligopoly incumbents (Tunstall, Careium, Legrand, Connect America) are slow and hardware-bound.
- **Cons:** adoption flat at 9% of US 65+ for a decade; only 18% wear it at all times; 3 of 4 falls happen with the pendant off; ~50% have had a false alarm; 87% of French families see it as a "marker of dependency"; billing/cancellation is the top complaint category; adult children choose the device in just 11% of purchases.
- **Verdict:** owns the 2% emergency job, fails the 98% reassurance job, and is stigmatised for anyone under 80.

### B. Consumer wearables (Apple Watch, Pixel, Galaxy)
Apple Watch is now the "most popular medical alert brand" in US surveys and the single most-praised item on r/AgingParents.

- **Pros:** no stigma ("high-tech, not old"), no monthly fee, fall detection auto-on at 65+, Check In feature.
- **Cons:** 18-hour battery charged exactly during night-time bathroom falls; 911-first flow (families beg for "call my daughter, not 911"); ~35% of Apple-initiated 911 calls unfounded in one county; remote setup impossible (Family Setup needs the organiser within 33 ft); useless for cognitive impairment ("ends up in a drawer").
- **Verdict:** great for the 65–75 tech-comfortable parent; no caregiver layer; Apple will not build the family product.

### C. Passive home sensors (PIR kits, radar, smart lamps, cameras, audio)
Dozens of near-identical PIR kits at $40–100/mo (Envoy $99, Aloe $40–80, People Power $40, Canary, Sensara); radar (Vayyar, Essence); optical (Nobi, Inspiren, Teton); audio (Sensi); cameras (Kami, Ring).

- **Pros:** solves non-wear; elder acceptance of ambient sensors ~59% vs 37% for cameras; investors love it **in facilities** (Inspiren $155M, Nobi €35M, Sensi $98M).
- **Cons:** the B2C graveyard is long: Lively (orig.), BeClose, WellAWARE, Evermind, Sen.se Mother, Cherry Home, Hex Home, EchoCare, Tellus, Canary (administration), Vayyar B2C (died with Alexa Together). PIR can't see a fall; radar costs $240+/room; cameras are reputationally toxic (Kami forced to withdraw accuracy claims); Wi-Fi dependency; alert fatigue; nobody publishes precision/recall.
- **Verdict:** technology is fine; standalone consumer hardware + subscription with no distribution partner has never worked.

### D. Zero-install utility signals (Japan's genius)
Kettle (Zojirushi, since 2001), light bulb + delivery driver visit (Yamato, ¥1,078/mo), postman visit (Japan Post, ¥2,500), smart-meter usage (Kansai Electric **free**, Chubu ¥550), water meter (Shanghai, 9,113 homes in a year), smart plugs (Seoul, 4,000+ homes), UK Howz on smart meters.

- **Pros:** zero install, no Wi-Fi, no smartphone for the parent, culturally accepted ("a bulb doesn't feel like being watched"), near-zero cost, distribution by a trusted utility/logistics brand.
- **Cons:** 30-minute resolution, "no activity for 24h" is the only alert (too late for a fall), country-locked, no child-facing intelligence layer, fragmented across ~45 Japanese services that 31% of families "don't understand." Zojirushi has 14k subscribers after 24 years.
- **Verdict:** the right philosophy (piggyback on what exists), the wrong ceiling (single low-fidelity signal, no fusion, no escalation design).

### E. AI voice check-in and companions (the 2023–26 wave)
Naver CLOVA CareCall (Korea, ~50k users, 128+ municipalities, 96% answer rate, 44% fewer solitary deaths in served areas), SKT NUGU (17k), ElliQ ($85M raised, ~3k units, state-funded), Meela, Hyodol doll (12k), and a dozen B2C clones: inTouch €29.90, Nonni A$40, Helfi-Ruf €15–40, AloneAssist $14.99, JoyCalls, ElderVoice, Callie, Call Knut.

- **Pros:** cheapest thing that has ever scaled (CareCall replaced manual welfare calls, no hardware); companionship framing measurably reduces depression; voice-AI cost collapsed 2024–25; multilingual now trivial.
- **Cons:** **every deployment with real numbers is paid by a government or operator, none by families**; parent screens unknown numbers ("feels like spam"); a journalist's mother: "I would feel terrible… they are not bothered about phoning me"; CareCall missed "maybe I should just die"; Jeongeup cohort completed only ~3 calls in 4 months; price compressing to $15; B2C retention never published by anyone.
- **Verdict:** the call is a *signal source and a relationship*, not a product. Alone it is a commodity with a dignity problem.

### F. Check-in apps and family coordination
Snug ("I'm OK" tap, ~5–10k daily actives, $12.50/mo dispatcher tier), Iamfine, Life360, CareZone (dead), Grayce (dead), Wellthy/Cariloop (employer-paid), Carefull (financial monitoring, $29/mo → pivoted to banks).

- **Pros:** elders self-enrol and *love* Snug ("flooded with gratitude"); the paid tier that includes a human welfare check is what people praise.
- **Cons:** tiny; nagging; free clones; coordination-only has never been paid for; Alexa Together at $19.99 with Amazon's distribution was still cancelled.
- **Verdict:** proof that (1) elders accept a self-controlled daily ritual and (2) human escalation is worth paying for.

---

## 3. The ten cross-cutting truths

1. **The buyer is not the user.** The child pays; the parent tolerates. Products designed for the parent (pendants) fail on compliance; products designed for the child (cameras) fail on dignity. Nobody has designed for both at once.
2. **Two jobs, not one.** Emergency (2%) and daily reassurance (98%) are different products. Alexa Together died bundling them; PERS only sells the first; the second has no owner at scale.
3. **Zero-install wins, hardware-first dies.** Every product that scaled piggybacks on something already in the home (meter, kettle, bulb, phone, postman). Every consumer sensor kit died or is marginal.
4. **Detection plus a human hand.** Sensors without a response layer stall ("we don't know what we'd do if an alert fires"). Yamato drivers, Seoul welfare planners, Snug dispatchers, CareCall social workers are the actual product.
5. **Precision is the unsolved engineering problem.** 0.3% true-positive rate in Seoul; ~80% of bed alarms false; nobody publishes numbers. The first company to publish and win on precision owns trust.
6. **Willingness to pay is $10–35/month, everywhere.** Germany's €25.50 code, Japan's desired ¥1–2k, US $14.99–$40. Above that needs a payer.
7. **LTV is capped at 2–4 years** by the parent's trajectory (move, facility, death). CAC must be low; the relationship should survive the parent's status changes (siblings, second parent, in-laws).
8. **The 70–80 "pre-dependency" segment is unserved in every country.** Telecare is for frail 80+ women; the 72-year-old who is fine but lives alone has nothing that doesn't insult her.
9. **Distribution is the moat, not the sensor.** Winners ride utilities, telcos, post, councils, Medicare Advantage flex cards, ISPs. A family-paid subscription with no channel has a bad track record. But payer channels are fragile (Papa lost ~36 contracts after one article).
10. **Capital is leaving consumer AgeTech** (−48% Jan–Aug 2026); the money is in B2B facilities. That is a threat to fundraising and an opportunity: the consumer peace-of-mind category is open, and LLM economics changed the cost structure since the last attempts.

---

## 4. Where Vela wins

### The thesis
**Vela is not a device. It is a presence: a multilingual AI that knows a parent's normal day from signals already in their life, tells the child "she's fine" every morning, and puts a real human at the door when something is wrong.**

Concretely, what we build that does not exist:

**1. Signal fusion instead of a single sensor.** No one fuses the cheap signals already available: the parent's own phone (screen unlocks, steps, charging rhythm, last-seen on WhatsApp/LINE), smart-meter data where APIs are open (UK, Japan B-route, parts of EU), one $15 plug on the kettle or TV, the door of the fridge, and an optional short daily voice call. Each alone is low-fidelity and noisy (that is why Seoul gets 0.3% precision). Together, with a per-person learned baseline, they produce a *confidence*, not an alert. This is a data problem, not a hardware problem, and it is exactly what LLM-era tooling is good at.

**2. Silence as the product.** The daily output for the child is a green dot and a two-line note ("Mom was up at 7:10, kettle at 7:30, walked 1,400 steps, quiet evening"). No push notifications unless multi-signal anomaly. Weekly narrative of trends (sleep drift, less movement, missed calls) that a child can act on before a crisis. We publish our precision and false-alarm rate. Nobody else does.

**3. Elder sovereignty, by design.** The parent sees exactly what the child sees. The parent can pause it. The parent enrols themselves via a call from a known, branded number saved in their contacts (kills the "spam" problem). It is framed as *her* safety net, not his surveillance (the Snug and Zojirushi "appropriate distance" lesson). Voice is warm, slow, in her language and dialect, remembers yesterday.

**4. A human at the end of the ladder.** Escalation is configurable: family → named neighbour/friend → local welfare-check partner → emergency services. The welfare-check layer is partnered per country (delivery fleets, postal services, security companies, home-care agencies, gig networks), not built. This is what people pay for (Snug's $12.50 tier, Yamato's driver visit).

**5. Global by construction, diaspora first.** 300M emigrants; tens of millions have a parent living alone in a country with weak or no state telecare (India, Philippines, Georgia, Ukraine, Mexico, Vietnam, Nigeria). These children carry the highest anxiety, pay in hard currency, cannot fly home, and have *no product at all* today. A multilingual LLM presence that works over a basic Android phone and WhatsApp/Viber/LINE is buildable now and was not in 2021. No incumbent can follow: PERS companies are country-bound by call centres and reimbursement codes. This is our beachhead; domestic super-aged markets (Japan, Korea, Germany, Italy) are the second wave via their payer codes.

### Positioning against the field

| | Pendant/PERS | Sensor kit | AI call app | Camera | Utility bundle | **Vela** |
|---|---|---|---|---|---|---|
| Works if parent won't wear anything | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Zero hardware to start | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ |
| Sees a bad day, not just a fall | ✗ | partial | partial | ✓ | ✗ | ✓ (fusion) |
| Dignity / no stigma | ✗ | ✓ | ✗ (spam) | ✗✗ | ✓ | ✓ (elder-controlled) |
| Human escalation included | ✓ | some | rare | ✗ | some | ✓ (partnered) |
| Precision published | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Cross-border / multilingual | ✗ | ✗ | some | ✓ | ✗ | ✓ core |
| Price to family | $25–50 | $40–100 | $15–40 | $0–45 | $0–25 | **$19–29** |

### Business model
- **Family plan $19–29/month** (inside the global willingness-to-pay band), human escalation included, siblings share one plan, second parent free. Annual prepay to blunt the 2–4-year LTV ceiling.
- **Optional hardware** ($15–40 plug/beacon) sold at cost; never the wedge.
- **Second engine: payer codes.** Once precision is proven, fit Germany's €25.50 Hausnotruf code, UK council re-tenders during the 2027 PSTN switch-off, Korean municipal CareCall-style budgets, Japanese municipal 緊急通報 replacement, Australian AT-HM registered-provider list, US Medicare Advantage flex cards. Software-only entrants in these tenders: none today.
- **Third engine: channel partners** who want retention products for older customers: telcos, utilities, postal services, banks (Carefull's pivot shows banks will distribute for free).

---

## 5. What could kill us (be honest)

1. **Phone-as-sensor limits.** iOS restricts background sensing; many 80+ parents have no smartphone (Japan 80+: 19%). Mitigation: Android-first for diaspora markets, plug/bulb fallback, the call as a universal fallback.
2. **False alarms and the one missed death.** Liability and press risk cut both ways. Mitigation: publish metrics, human-in-the-loop for every escalation, never claim "fall detection" (regulatory line).
3. **"Dystopian" framing.** The inTouch backlash is real. Mitigation: parent-first enrolment, parent-visible data, the call is a relationship not an audit.
4. **CAC in a category with rising DTC costs.** Mitigation: diaspora communities are dense, word-of-mouth, and reachable through community media; channel partners for domestic markets.
5. **Platform death** (Alexa Together killed Vayyar). Mitigation: own the relationship and the phone number; never depend on one OS feature.
6. **Data regulation** (GDPR, Japan APPI, Korea PIPA, health-data adjacency). Mitigation: data minimisation, on-device where possible, parent as data owner.
7. **Funding winter for consumer AgeTech.** Mitigation: revenue from day one; the story is "AI presence with proven precision" not "another elder app."

---

## 6. Next 30 days (validate before we build)

1. **30 interviews** with adult children: 15 diaspora (Indian, Filipino, Russian-speaking, LatAm), 15 domestic (Japan/Korea/Germany/US). What do they do today? (Daily call? WhatsApp last-seen? Nothing?) What would $25/month have to do?
2. **Concierge MVP, 20 families, $20/month, 8 weeks.** We manually fuse WhatsApp last-seen + one plug + a scripted call, send a daily green dot, escalate by hand. Measure: retention, false alarms, what the daily note must say. This generates the data nobody else has (hard truth #9 in report 06).
3. **Technical spikes:** (a) Android background signal feasibility and battery cost; (b) smart-meter API access in UK/Japan/EU; (c) branded outbound calling with saved caller-ID in 5 countries; (d) LLM baseline model for per-person "normal day" from sparse signals.
4. **Partner conversations:** two delivery/postal/security companies about a welfare-check pilot; one telco.
5. **Decide the beachhead country pair** (child's country × parent's country) from interview signal.

Curious about everyone, believing in ours. Let's go.
