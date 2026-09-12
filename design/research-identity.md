# Vela identity research: colour, type, mark, name, voice

2026-09-12. ~50 searches and fetches. Hex values marked "(aggregator)" come from third-party colour sites, not official brand books. Contrast ratios computed with the WCAG 2.x formula.

---

## 1. Colour

### 1a. Palettes of adjacent, well-loved apps

| App | Palette | Read-out | Source |
|---|---|---|---|
| Headspace | Orange family #FF7300 / #FFA500 / #FFCE00; pink #FFA1CC, purple #3B197F, teal-navy #27455C; "Headspace Blue" #0061EF reserved for primary actions; warm tinted surface #F9F4F2 instead of white; no shadows (aggregator) | Warm tinted background + one hot accent + a separate cool action colour. The 2024 rebrand kept orange explicitly against the mental-health industry's "dreary sea of blues and greys" | [oh-my-design](https://oh-my-design.kr/design-systems/headspace), [Kimp](https://www.kimp.io/headspace-brand/), [It's Nice That](https://www.itsnicethat.com/articles/italic-studio-headspace-graphic-design-project-250424) |
| Calm | Blue #60B0E7, purple #6463E0, white (aggregator) | Cool, "editorial composure"; reads sleep/therapy, not family | [brandcolorcode](https://www.brandcolorcode.com/calm) |
| Finch | Pastels #A6C4D9, #F2B5A1, #F7C5A6, #F4CF3E, #CDAB7E (aggregator) | Cozy daily ritual, skews juvenile | [colormagic](https://colormagic.app/palette/6746f1eb4911990c6e06f6f2) |
| Retro | No published palette; "craft means optimizing for people, not business"; private likes; opening and closing the app should both feel satisfying | Closest behavioural peer; restraint over colour | [Apptisan](https://apptisan.substack.com/p/apptisan-013-retro) |
| BeReal | Black, white, gold #FFCC4D | Stark; poor hierarchy from pure black/white | [Mobbin](https://mobbin.com/colors/brand/bereal) |
| Locket | Warm yellow icon with a cutout heart | Single-object icon; "made as a gift" story | [Fueled](https://fueled.com/blog/locket-photo-sharing-widget/) |
| Famileo | Blue wordmark, the "i" in orange as a small figure | Blue + orange "family" cliché; institutional | [Demain Design](https://demain.design/portfolio/famileo/) |
| Storyworth | "Warm, bookish"; identity from bookmaking and editorial layout | Serif-led warmth is a proven route for a memory product | [Goodside](https://www.goodside.studio/work/storyworth) |
| Snug | Big green check-in button | The look Vela must avoid (utility/safety) | [Snug](https://www.snugsafe.com/) |
| Aura Frames | Hardware neutrals, charcoal | Quiet premium; grandparents are core buyers | [Aura](https://auraframes.com/news/our-design-language-evolves-but-our-mission-stays-the-same) |
| Notion | Black, white, warm grey #E3E2DE | Near-monochrome; warmth via off-grey | [Mobbin](https://mobbin.com/colors/brand/notion) |
| Linear | Indigo #5E6AD2, #8299FF, ink #222326; themes generated in LCH from three variables | Model for a token-light system that stays consistent in dark mode | [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) |
| Airbnb | Rausch #FF5A5F, Babu #00A699 | One warm hero hue + neutral UI | [Mobbin](https://mobbin.com/colors/brand/airbnb) |
| Duolingo (counter-example) | Feather Green #58CC02, Mask Green #89E219 | High-saturation gamification; the energy Vela should not have | [design.duolingo.com](https://design.duolingo.com/identity/color) |

Pattern: the warm, trusted apps in this space use a tinted off-white base, charcoal or navy ink, one warm hero hue, and a cooler colour reserved for actions. Nobody serious uses pure white plus saturated everything.

### 1b. Colour vision and ageing

- Sensitivity to light drops with age, especially in the blue and green regions; older adults confuse blue vs purple and yellow vs green; most age-related colour defects are blue–yellow (tritan), from lens yellowing ([Sci Rep 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7721812/), [ScienceDaily 2014](https://www.sciencedaily.com/releases/2014/02/140220102614.htm)).
- Contrast sensitivity declines from about age 30 onward ([arXiv 2407.21767](https://arxiv.org/pdf/2407.21767)); after 50 many struggle with subtle hue differences ([Salesforce UX](https://medium.com/salesforce-ux/what-you-can-learn-from-older-adults-about-accessible-design-63181b450863)).
- WCAG: 4.5:1 body (AA), 3:1 large text and non-text, 7:1 AAA; 3:1 is the floor for 20/40 vision, common in older adults ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)).
- NN/g: mobile text is "often too small and lightly colored for older adults"; usability declines ~0.8% per year between 25 and 60 ([NN/g](https://www.nngroup.com/articles/usability-for-senior-citizens/)).
- "Elderly-Centric Chromatics" (IJHCI 2024): older users prefer warm hue, high lightness, medium saturation; aversion to low lightness and specific cool hues; warm hues work best as backgrounds ([tandfonline](https://www.tandfonline.com/doi/full/10.1080/10447318.2024.2338659)).
- Simplified warm-coloured graphics with labels in a contrasting non-warm colour improve visibility for elderly users ([Springer](https://link.springer.com/chapter/10.1007/978-3-319-58466-9_17)); "shades of blue can appear faded to seniors" ([Toptal](https://www.toptal.com/designers/ui/ui-design-for-older-adults)).

Implications: light-mode default with a warm, high-lightness ground; ink text at 7:1 or better; never encode meaning in blue-vs-purple or yellow-vs-green; the "lit" state must be carried by shape plus contrast, not by amber hue alone; dark theme optional, never default for the grandmother.

### 1c. Cultural meaning of candidate accents by market

| Hue | Russia/CIS | Taiwan/China | Japan | India | Philippines | Germany |
|---|---|---|---|---|---|---|
| Warm amber/gold ("light") | Gold = divine light in Orthodox icons; strongly positive | Gold/yellow = wealth, prestige, temple decoration | Gold = divine radiance; amber = autumn warmth | Saffron/gold sacred, festive | Yellow = hope, "the light that guides the nation"; gold = prosperity | Gold/amber in UI reads premium |
| Blue (trust) | Corporate default | "Use blue for technology, trust, finance, healthcare", i.e. institutional | Cool, clean | Neutral | Trust | Corporate |
| Green (calm) | Neutral | Positive, except the "green hat" idiom | Natural | Prosperous | Growth | Eco |
| Terracotta/coral | Warm; "krasny" = beautiful | Red-adjacent = luck | Red = sun, joy | Red = marriage | Red = joy | Warning if saturated |
| White | Purity | Mourning: white envelopes and flowers at funerals | Mourning association | Widowhood | Neutral | Purity |
| Black | Mourning | Avoided in festive settings | Formal | Inauspicious in some contexts | Mourning | Premium/mourning |

Colours to avoid as dominant surfaces: pure white (East Asian mourning, and the cold clinical default), pure black (mourning, plus older adults' aversion to low lightness), saturated red. Warm amber/gold is the only candidate positive in all six markets, which makes it the right "light" hue.

### 1d. 2025–26 palette trends

- "Elevated neutrals" replacing bright white: sand, stone, oatmeal; base neutrals like #F8F5F1; Pantone 2026 Cloud Dancer signals the same; "bone and sand replace pure white, charcoal replaces black" ([Envato](https://elements.envato.com/learn/color-scheme-trends-in-mobile-app-design), [UpDivision](https://updivision.com/blog/post/ui-color-trends-to-watch-in-2026)). Warm neutral + deep ink is cited as the "high-contrast premium" pairing.
- Counter-trend: "sad beige" fatigue ([The Tartan](https://the-tartan.org/2026/02/23/are-we-destined-for-a-sad-beige-world/)). So: a warm off-white base plus a deep ink and one confident accent, to avoid the beige trap and stay cool for a 20-year-old.
- Light mode remains the consumer default.

### 1e. Three candidate palettes (contrast computed)

**A. Candle & Ink (recommended)**

| Role | Hex | Contrast |
|---|---|---|
| Background | #FBF7F0 | — |
| Surface | #FFFFFF | 1.07 vs bg (separate with a hairline #E8E1D6 or shadow, not colour alone) |
| Ink | #1E1A16 | 16.2:1 on bg (AAA) |
| Secondary text | #5A534B | 7.1:1 on bg (AAA) |
| Light, fill | #E9A23B | 2.0:1 on bg; fails 3:1 as non-text, so never the sole carrier of "lit" |
| Light, ring/icon/text | #C27612 | 3.3:1 on bg; ink on a #E9A23B chip 8.0:1 |
| Action | #1F5C66 (deep teal) | 7.1:1 as text on bg; white label on it 7.6:1 |
| Error | #B3261E | 6.1:1 on bg; white on it 6.5:1 |
| Dark theme | bg #1B1714, surface #26211D, text #F3EDE4 (15.3:1), secondary #B9B0A5 (8.3:1), amber #E9A23B (8.2:1), action #7FC3CC (9.0:1), error #F28B82 (7.5:1) | The light reads best at night |

**B. Linen & Navy**: bg #F6F4EF, ink #16213E, secondary #4B5468, light #F2B544 (ring #B37A12), action #245C8C, error #B42318. Premium and "trust", but navy + blue tips toward fintech/security and blue fades for older eyes.

**C. Clay & Cream**: bg #F8F2EA, ink #2B231D, secondary #6B5F55, light #F0A54A (ring #B26A18), action terracotta #B5502F (AA only), error #A8321F. Warmest, but action and light sit in the same hue family so "do this" and "she's here" blur; drifts toward lifestyle/bakery.

Recommendation: A. Ink and secondary text both clear AAA; the action colour is cool enough to read as "a button" against the warm light, yet teal, not blue, avoids the security/medical read; amber is the one hue positive in every launch market. Rule: lit = amber fill plus an ink glyph or a #C27612 ring; unlit = outline only. This also survives Android 16 monochrome theming.

---

## 2. Typography

### 2a. Legibility for older adults

- Humanist sans faces read faster than geometric ones at body sizes: varying stroke, open apertures, more cues; geometric faces suffer "imposter letters" (I/l/1, O/0) ([Fontfabric](https://www.fontfabric.com/blog/typography-knowledge-humanist-fonts/), [Vision Australia](https://www.visionaustralia.org/business-consulting/digital-access/blog/typography-in-inclusive-design-part-2)).
- Atkinson Hyperlegible: designed with low-vision readers; but the Google Fonts build is Latin-only, no Cyrillic ([Braille Institute](https://www.brailleinstitute.org/freefont/)).
- Lexend: evidence is with child readers, not older adults; Latin-only ([Google Design](https://design.google/library/lexend-readability)).
- Serif vs sans on screens: on high-DPI displays the historic sans advantage has largely disappeared; readers rate sans as less tiring at 10–12 pt; familiarity, size, and line spacing matter more ([ResearchGate](https://www.researchgate.net/publication/232915903_Keeping_Your_Readers'_Eyes_on_the_Screen_An_Eye-Tracking_Study_Comparing_Sans_Serif_and_Serif_Typefaces)).
- Sizes: ≥ 16 px body for older users; respect Dynamic Type; avoid light weights.

### 2b. What warm consumer apps use

Headspace: custom Aperçu; Airbnb: Cereal; Duolingo: Feather (display only) + DIN Round; Notion: Inter-style grotesque; Storyworth: serif/editorial. Takeaway: humanist sans for UI; serif where the product is about memory and story.

### 2c. Serif for warmth

Fraunces, Newsreader, Instrument Serif, Source Serif 4, Literata (Google Play Books' reading serif, variable). Use serifs for the one daily arrival text and the wordmark, never for buttons or labels.

### 2d. Availability, licensing, script coverage (all OFL, in Figma)

| Face | Cyrillic | CJK | Italic | Variable | Note |
|---|---|---|---|---|---|
| Inter | yes | no | yes | yes | neutral, tall x-height, Dynamic-Type friendly |
| Manrope | yes | no | no | yes | no italic |
| Onest | yes | no | no | yes | humanist, Cyrillic-native |
| Nunito | yes | no | yes | yes | rounded; risks "childish" |
| Plus Jakarta Sans | partial | no | yes | yes | test Russian |
| Figtree | **no** | no | yes | yes | Latin-only |
| Public Sans | **no** | no | yes | yes | Latin-only |
| Literata | yes | no | yes | yes | reading serif, 200–900 |
| Source Serif 4 | yes | no | yes | yes | optical sizes |
| Fraunces | **no** | no | yes | yes | Latin-only |
| Newsreader | **no** | no | yes | yes | Latin-only |
| Noto Sans TC / Noto Serif TC | yes | **TC** | no | yes | list the Latin face before Noto in the stack ([Noto docs](https://notofonts.github.io/noto-docs/website/use/)) |

System faces (SF Pro, Roboto, PingFang TC, Noto Sans CJK) give Dynamic Type and CJK for free.

### 2e. Three pairings

1. **Literata (arrival text, wordmark) + Inter (UI)**, recommended. Both cover Cyrillic and Greek, both variable with italics. CJK: Noto Serif TC for the arrival text, Noto Sans TC or system PingFang TC for UI. Literata is a reading serif built for Play Books, legible at 18–22 px on a phone, bookish warmth (Storyworth's proof), grown-up to a 20-year-old. Inter gives a neutral, high-x-height UI with unambiguous I/l/1 when its disambiguation set is on.
2. Onest + Inter or system sans: all-sans, humanist, Cyrillic-native; safest; less distinctive.
3. Fraunces + Figtree: the most fashionable Latin pairing, but both Latin-only; three typographic personalities to maintain with fallbacks. Not worth it for a two-person team.

Rules: body ≥ 17 px on iOS scaled with Dynamic Type, weight ≥ 400, line-height ≥ 1.4, no all-caps labels in Cyrillic or CJK, one serif moment per screen at most.

---

## 3. Logo and mark

### 3a. Trends 2025–26
Motion designed in from day one; responsive logo systems (full mark → simplified → icon → monogram); single confident shapes with negative space rising, blob marks fading ([Creative Bloq](https://www.creativebloq.com/design/logos-icons/these-logo-design-trends-will-define-2026), [Logomaker](https://www.logomaker.com/blog/logo-design-trends/)).

### 3b. Marks built on light, presence, home that avoided security or medical
- Airbnb Bélo: one shape = person + place + heart + A; "a brand anyone can draw" ([Dezeen](https://www.dezeen.com/2014/07/16/airbnb-rebrand-designstudio-logo-belo/)). Lesson: a drawable single shape with a plural reading.
- Headspace: an imperfect orange dot, "not perfect, but whole" ([Fabrik](https://fabrikbrands.com/branding-matters/logofile/headspace-logo-history-symbol-and-meaning/)). Lesson: one primitive carries a whole system.
- Nest, Philips Hue: "human and unfussy, blends calmly into a home"; the light category signals warmth with soft edges, never with rays or bulbs ([madegooddesigns](https://madegooddesigns.com/nest-brand-guidelines/), [Hueblog](https://hueblog.com/2025/06/23/new-logo-more-hue-less-philips/)).
- Signal: a speech bubble, not a padlock. Lesson: a privacy product avoiding the security icon.

### 3c. App-icon rules and findability for older users
- Apple iOS 26: a single element in a simple unique shape; identifiable in silhouette; must work in Default, Dark, Clear, and Tinted; seen at ≤ 60 px, so no text, no photos, no micro-detail ([Median](https://median.co/blog/what-are-apples-ui-guidelines-for-app-icons)).
- Android 16 auto-tints icons to monochrome and apps cannot opt out; supply a monochrome layer ([9to5Google](https://9to5google.com/2025/09/16/android-16-auto-themed-icons-apps-cant-opt-out/)). A mark that only works in colour breaks on half of Android home screens.
- Older adults: simpler icons on clear backgrounds; bright multi-colour icons overwhelm; a simplified warm-coloured graphic with a contrasting label helps search ([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9026834/)).

### 3d. Name check: "Vela"

| Language | Reading | Risk |
|---|---|---|
| Spanish / Portuguese / Italian | candle; sail; "estar en vela" = lie awake; velar = keep watch; velorio = wake | Positive, but candle + vigil + wake is a funeral cluster in Hispanic culture; keep candle imagery abstract |
| Russian | "вела" = "she led" (past tense of вести); as a brand it reads as a verb; use Latin "Vela" or Вела with final stress | Mild oddity, nothing negative |
| Chinese (Taiwan) | the Vela constellation 船帆座; phonetic 薇拉/維拉 reads as a feminine given name | Neutral; keep the Latin wordmark |
| Japanese | ベラ (bera) is the wrasse fish; ヴェラ is the safer katakana | Use ヴェラ |
| Hindi / Punjabi | vella/vela (वेल्ला) = idle, jobless, "doing nothing", used jokingly ([Wiktionary](https://en.wiktionary.org/wiki/%E0%A4%B5%E0%A5%87%E0%A4%B2%E0%A5%8D%E0%A4%B2%E0%A4%BE)) | **Real meme risk in India**; own the joke or use a local sub-brand |
| Filipino | no standard meaning | Neutral |
| German | no meaning | Neutral |

Conflicts, crowded in our categories:
- **vela.family**: "Vela, a quieter way to run the family week", Vela Technologies Inc., Vancouver, voice-first family calendar in private beta ([vela.family](https://vela.family/)). Same name, same word-family, same audience, same "quieter" positioning. The serious one.
- **Careforth, formerly "Vela for Caregivers"** (Seniorlink; Android package still `com.velaapp`) ([App Store](https://apps.apple.com/us/app/vela-for-caregivers/id1137714096)). Prior use in eldercare.
- "Vela Journal: Mood tracker"; "VELA: Own Your Education"; "Vela: Manifest Your Vision"; hellovela.app (period tracker); getvela.com (e-commerce).
- Marks: Vela Software Group, Vela Bikes (USPTO 97925362), Vela Diagnostics, Vela Trading Systems (USPTO 88589784/87, class 9/42), and a Feb 2026 "SAIL FOR GOODS" filing ([Trademarkia](https://www.trademarkia.com/vela-79449378)).
- Domains (signals, verify with a registrar): getvela.com taken; vela.family taken; vela.app registered but idle (404, possibly purchasable); hellovela.com may be unregistered but hellovela.app is a live brand.

Assessment: "Vela" is not clearable as a bare word mark in class 9/42 in the US, and it collides with a live family-coordination app. Options: (1) keep the name but always as a compound in stores and domains ("Vela Light"), with a distinctive mark and a compound domain; (2) run formal clearance in EUIPO, WIPO, Rospatent, and Taiwan TIPO before spending on the mark; (3) prepare a second candidate name in case Apple's App Store name check fails.

### 3e. Three logo directions (no existing logo referenced)

1. **The Kept Light** (recommended): a soft-cornered upright rectangle, a window seen from the street at dusk, with one small warm ellipse of light high inside it, slightly off-centre. Home without a house icon, light without a bulb, candle, or rays, presence without a pulse, radar, or shield. Single shape, drawable by a child, pure-silhouette-safe for Android monochrome and Apple Tinted/Clear; the light itself is the motion: it fades on when the day's answer arrives, never blinks. The rectangle is also the app's own arrival card.
2. **The Wick**: one vertical stroke (the l of Vela, a wick, a person) capped by a soft teardrop of light leaning toward it. Encodes candle and vigil literally; strong ligature with the wordmark. Risk: candle imagery drifts toward memorials; a flame competes with fitness "streak" icons.
3. **Three Around One**: three petal shapes around one warm dot, leaving a V of negative space: three generations around one light. Risk: concentric execution becomes a target, radar, or Wi-Fi mark, the exact reading to avoid.

---

## 4. Voice and motion

- Headspace: calm, clear, measured, slightly quirky; its emails are the cautionary tale of drift into cute ([The Way With Words](https://www.thewaywithwords.co.uk/tone-of-voice-blog/headspace-tone-of-voice)). Finch: patient, validating; too soft for a 45-year-old organiser. Retro: "if you're opening an app to see friends and family, it should be easy to see family and friends first"; the closest voice to aim for. Apple HIG Writing: plain language; decide voice by who you're talking to and how you want people to feel; write for localisation ([Apple HIG](https://developers.apple.com/design/human-interface-guidelines/foundations/writing)).
- Vela voice: state facts, not feelings ("Nana answered at 9:12", "No word from Nana yet today"); name people; no exclamation marks, no streaks, no "great job"; one sentence per screen; the silence notice is calm and specific with the next action visible; every sentence must translate cleanly into Russian and Traditional Chinese.
- Motion: Material 200 ms standard, 300 ms between screens; ease-out entering, ease-in leaving; Apple: keep people oriented, never overwhelm; Reduce Motion = gentler, not off. Vela: exactly one signature animation, the light coming on (600–900 ms ease-out bloom, once, with a soft haptic); no loops, no pulsing (pulse = monitor), no confetti; the app closes with a 300 ms fade to the light.

---

## Decision

1. Palette: A, Candle & Ink: bg #FBF7F0, surface #FFFFFF, ink #1E1A16, secondary #5A534B, light #E9A23B (fill) + #C27612 (ring/text), action #1F5C66, error #B3261E; dark theme bg #1B1714, text #F3EDE4, action #7FC3CC.
2. Every text role clears AAA; the action colour is cool but not blue, so it reads as a button against the amber light without the fintech/security tone.
3. Amber is the only accent positive in Russia, Taiwan, Japan, India, the Philippines, and Germany; lit = fill plus an ink glyph, because amber alone is 2:1 on cream.
4. Type: Literata (arrival text, wordmark) + Inter (UI); fallbacks Noto Serif TC / Noto Sans TC; both primaries carry Cyrillic and Greek, both OFL and in Figma.
5. Body ≥ 17 px scaled with Dynamic Type, weight ≥ 400; the serif appears once per screen, never on controls.
6. Logo: The Kept Light, a soft window with one warm light; silhouette-safe for Android 16 monochrome and Apple Tinted/Clear; its only animation is the light coming on.
7. It says home and presence without a candle (funeral drift), a bulb (utility), a pulse or ring (monitor), or a shield (security).
8. Name: keep "Vela" for now but treat it as unclearable as a bare mark; ship as "Vela Light", secure a compound domain, run EUIPO/WIPO/Rospatent/TIPO clearance before the mark is final; prepare one backup name.
9. India: "vela/vella" means idle; own the joke or use a local sub-brand.
10. Voice: factual, named, unhurried; motion: one bloom, no loops; the app leaves the screen quietly.

---

## Prompts (from the recommended direction; no reference to any existing logo)

**Prompt 1, mark only**
"Minimal app logo mark: a single upright rounded rectangle with softly rounded corners, like a window seen from outside at dusk, drawn as one smooth ink shape; inside it, high and slightly off-centre, one small warm amber ellipse of light with a soft glow. Flat vector, two colours only: deep warm charcoal #1E1A16 and amber #E9A23B, on a cream background #FBF7F0. Generous negative space, perfectly balanced, calm, premium, quiet. Centered, no text."

**Prompt 2, icon in context**
"iOS app icon, 1024×1024, flat vector: cream #FBF7F0 field; centered soft-cornered window silhouette in warm charcoal #1E1A16 occupying about 55% of the height; a single small amber #E9A23B light sits in the upper third of the window with a faint radial glow bleeding softly onto the cream. No gradients elsewhere, no strokes, no shadows, no text. It should still read as a lit window at 60 pixels."

**Prompt 3, monochrome and wordmark**
"Logo system sheet: the same lit-window mark in three states side by side: full colour (charcoal window, amber light on cream), pure single-colour silhouette (charcoal only, the light as a cut-out hole), and reversed (cream on charcoal #1B1714 with the amber light glowing). Beside it the wordmark 'Vela' set in a warm, humanist old-style serif, lowercase after the capital V, letterspacing relaxed, same charcoal. Flat, editorial, calm, lots of white space."

**Negative prompt (all three)**
"no candle, no flame, no lightbulb, no sun rays, no sparkles, no house with roof, no heart, no shield, no padlock, no radar rings, no concentric circles, no wifi arcs, no pulse line, no medical cross, no people figures, no faces, no gradients on the background, no 3D, no bevels, no drop shadows, no glossy glass, no neon, no blue, no red, no text inside the icon, no stock-logo look, no clip art, no multiple icons, no watermark."
