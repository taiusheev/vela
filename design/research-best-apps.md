# Design research: how the best apps do it, and what Vela takes from them

2026-09-12. 31 searches, ~20 page fetches. Sections: calm one-moment apps, family and grandparent apps, design for 75+, trust and dignity UI, voice-first patterns, visual identity, the Figma workflow. Ends with the fifteen rules Vela follows.

## 1. "Calm" and one-moment-a-day apps

1. **One card per person, regardless of volume.** Retro (ex-Instagram Stories lead) puts the whole week behind a single card; no public feed, no counts, no viral mechanics ([TechCrunch 2023](https://techcrunch.com/2023/07/07/retro-is-a-deeply-personal-photo-journaling-app-for-close-friends/), [Series A 2026](https://techcrunch.com/2026/08/28/friend-focused-photo-sharing-app-retro-snags-21m/)). Vela: the daily arrival is one card; a grandchild who sends five things and one who sends a heart occupy identical space.
2. **Don't copy BeReal's timer.** The random-time, two-minute window creates dread; Locket copied daily prompts without a time constraint and caps friends at 20 ([Locket](https://apps.apple.com/us/app/locket-widget/id1600525061)). Vela: member-chosen arrival time, no countdown, no "you missed it" state.
3. **Home-screen widget as the arrival surface.** Locket's value is a photo that appears on the home screen without opening the app. Vela ships a widget showing today's arrival and the flame; the app is for answering, not browsing.
4. **Onboarding starts with the relationship, not features.** Finch hatches the pet first; Headspace opens with a 30-second breathing exercise before any dashboard ([Raw.Studio](https://raw.studio/blog/how-headspace-designs-for-mindfulness/)). Vela: step 1 "Who is this for?", step 2 send her first arrival, step 3 invite one more person. Paywall never in onboarding.
5. **Suggestions are the prompt.** Apple Journal surfaces prompts as cards, separates activity prompts from reflection prompts, and its empty state is one imperative ([Apple Newsroom](https://www.apple.com/newsroom/2023/12/apple-launches-journal-app-a-new-app-for-reflecting-on-everyday-moments/)). Vela: two prompt classes, about you and about the family.
6. **Friction fatigue is real.** One Sec's gentle check-in decays into "intervention fatigue" by week four ([Blok](https://www.blok.so/resources/one-sec-app-review-does-adding-friction-actually-reduce-screen-time)). Vela: keep the ritual fixed, rotate the content type (photo, voice, question, story day).
7. **Warm palette rules from Headspace:** no pure black or white, coloured shadows, rounded forms.
8. **Forgiving streaks:** never reset progress; delay the next nudge ([Smashing](https://www.smashingmagazine.com/2026/02/building-empathy-centred-ux-framework-mental-health-apps/)). Vela: the flame is today's state, never a streak counter.
9. **Marco Polo's bar:** ten seconds to learn, two taps to the first video. Vela: two taps from notification to a sent answer.
10. **Close the app.** After an answer, one confirmation and a large Done. No "while you're here" upsell.

## 2. Family and grandparent apps

1. **Grandma doesn't need an app.** Kinsome sends grandparents an email/SMS link with transcript and audio, reply by voice through the link, no password ([TechCrunch](https://techcrunch.com/2024/09/05/kinsome-new-communication-app-for-kids-and-grandparents)); Remento: weekly prompt by email/SMS, two clicks to record, no login ([Remento](https://www.remento.co/remento-vs-storyworth)). Vela's messenger channel is the primary surface; the app is optional.
2. **"Grandma saw it" is the retention loop.** Aura's heart on the frame notifies the uploader that the photo "received some love" ([Aura](https://help.auraframes.com/hc/en-us/articles/360049412354-Why-have-my-photos-received-some-love)); Skylight's heart emails the sender. Vela: the grandmother's tap produces a named receipt to the sender ("Mom saw your photo ♥ 9:12"). This is the visible face of the paid layer.
3. **Kitchen-table mode = gift mode + heart.** Aura and Skylight ship "gift mode" with pre-loaded photos. Vela: today's arrival full-bleed, one heart, one mic, nothing else; the organiser pre-loads seven days before handing it over.
4. **Bounded contribution and a cutoff create rhythm.** Famileo caps messages per gazette and cuts off Sunday midnight; joins by family code ([Famileo](https://www.famileo.com/famileo/en-US/)). Vela: a visible cutoff ("Mom's morning goes at 8:00, 3 hours left") and a family code.
5. **Family votes on prompts, reacts on every story.** Remento lets relatives vote on next week's prompt and react per story; Storyworth has 500+ prompts. Vela: the family picks the story question.
6. **Kids' contributions: audio first, drawings second.** Kinsome elicits stories with emoji games. Vela: a "draw for Grandma" canvas with six colours and one brush.
7. **Positioning copy that converts:** Famileo, "the ultimate gift for grandparents", 4.8/5 from 42k reviews. Vela is bought by the 45-year-old for the 78-year-old; the store page leads with the gift frame.
8. **Cocoon (2019–22) tried ambient presence cards and shut down**: ambient presence alone didn't sustain payment (prior knowledge, flagged). Vela's paid layer is an action (the notice, the contacts), not a status widget.

## 3. Design for 75+

| Spec | Standard | Vela default | Vela parent surface |
|---|---|---|---|
| Touch target | Apple 44 pt, Material 48 dp, WCAG AAA 44 px | 48 pt | 64 pt min, primary 88 pt |
| Spacing between targets | Material 8 dp | 12 pt | 16 pt |
| Body text | iOS Body 17 pt, Material 16 sp | 17 pt | 22–24 pt |
| Headline | iOS Title1 28 pt, Large Title 34 pt | 28 pt | 34 pt |
| Text contrast | WCAG 4.5:1; AAA 7:1 | 4.5:1 | 7:1 |
| Non-text contrast | 3:1 | 3:1 | 4.5:1 |
| Font weight | — | Regular | Medium/Semibold |

Sources: [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Android](https://support.google.com/accessibility/android/answer/7101858?hl=en), [NN/g seniors](https://www.nngroup.com/articles/usability-for-senior-citizens/), [PMC systematic review 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12350549/).

Contrast check: sage #2f7d5b on white ≈ 5.3:1 (AA), fine for buttons with white text at large sizes; **amber #e0a23a on white ≈ 2.2:1: never text, never the only signal**; ink #1b2430 on off-white ≈ 15:1.

Do: one column, one action per screen (Jitterbug, BIG Launcher, GrandPad); icon + label always; linear navigation ≤ 2 levels with a visible Back; accept any input, don't punish errors; audio feedback and text-to-speech; test with iOS accessibility sizes and Bold Text on.
Don't: swipe, long-press, pinch, hidden menus, pull-to-refresh, hold-to-record; startling sounds; auto-playing motion; timeouts; light grey text; passwords (use SMS or magic links).

## 4. Trust and dignity UI

1. **Staged escalation, information only when needed.** Apple Check In: the partner sees a card; only after the expected time passes do they get details ([MacRumors](https://www.macrumors.com/guide/ios-17-safety-features/)). Vela: the family sees the flame; the organiser alone gets the quiet notice; nearby contacts appear inside the notice, never in the thread.
2. **Snug's flow is the reference for the notice**, including the reassurance auto-message when a late check-in arrives ([Snug](https://www.snugsafe.com/how-snug-works-for-people-who-live-alone)). Vela: "Mom answered at 11:40. Everything's lit again."
3. **What to avoid: Life360.** Arrive/leave alerts, location history, and the knowledge that someone can check create anxiety and resentment ([Michigan Daily](https://www.michigandaily.com/arts/digital-culture/safety-or-independence-life360-offers-neither/)). Vela shows answered / not yet, never where or when-last-seen.
4. **Semantic colour, no red.** WHOOP's strict colour vocabulary, no warning icons or urgent language ([925 Studios](https://www.925studios.co/blog/whoop-design-breakdown)). Vela: two flame states; the notice uses ink on a sage-tinted card, never a red banner.
5. **Name the state in words.** "Mom's flame is lit, she answered at 9:14." "Mom hasn't answered yet today." Never "missed", "inactive", "offline". Notice: "It's been quiet at Mom's today. She usually answers by 10. Want to call, or ask Aunt Val to look in?" Buttons: Call Mom · Ask Val · She's fine, I know why.
6. **Give the kept-light member the same view.** Show her own flame and who saw her answer, so it reads as reciprocity, not surveillance.
7. **No streaks, no scores.** The flame is binary and today-only.
8. **Consent screen for the grandmother, in plain words:** "When you tap, your family sees your light. If you don't tap by evening, Anna gets a quiet note. You can turn this off any time." One toggle.

## 5. Voice-first patterns

1. **Waveform is the universal grammar** (WhatsApp, Telegram, iMessage): thin bars with a colour sweep; always show duration ([WhatsApp](https://blog.whatsapp.com/making-voice-messages-better)).
2. **Tap to record, not hold.** Parent surface: one 88 pt round mic; tap starts (3-2-1 count-in with a soft tone); the same button becomes Stop; auto-stop at 60 s; preview with Send and Record again; no red delete.
3. **Transcript with word-level highlight** (iOS 18 Voice Memos, Google Recorder). Vela: every voice arrival ships with transcript and translation; on the parent surface the transcript is the default view at 22 pt.
4. **Big play control, no scrubber on the parent surface.** One 64 pt play/pause.
5. **Speak the reply option** after playback: "Reply with your voice?" read aloud, mic shown.
6. **Levels for confidence:** "Speak a little closer" if input is low for 3 s; never "Recording failed".

## 6. Visual identity: warm, quiet, premium

1. **Type pairing.** Fraunces or Newsreader (optical size axis) for tone; system fonts for body and UI (free Dynamic Type, best hinting for older eyes). Never a serif under 20 pt on the parent surface. Vela keeps Newsreader for the human voice (names, her answer, the weekly read) and uses the system sans in the app; Public Sans stands in for it in web prototypes.
2. **Serif for the human voice, sans for the machine.** This split keeps the quiet notice from reading like a poem.
3. **Light mode is the default for older adults** ([NN/g](https://www.nngroup.com/articles/dark-mode/)). Parent surface and kitchen-table mode: light only, optional warm night dim. Standard app: dark mode for the 20-year-old.
4. **No pure black or white; warm neutrals.** Background off-white, cards white, ink #1b2430, blue-grey secondary text at sizes that keep 4.5:1.
5. **Motion:** flame breathing glow 3–4 s at ≤ 4% amplitude; card fades 240 ms; no parallax, no bounce; Reduce Motion → static glow; never animate while a voice note plays.
6. **Sound:** one soft two-note chime when the flame lights (opt-in), silence otherwise.
7. **Illustration vs photography:** family photos are the content; flat two-tone illustration only in empty states and onboarding; no stock photos of seniors anywhere.
8. **Premium = restraint.** No badges, no red dots, one notification a day, store screenshots showing one calm screen each.

## 7. The Figma workflow

1. **html.to.design free tier: 10 imports per 30 days**; PRO $12/mo annual ([docs](https://html.to.design/docs/pro-plan/)). Build each screen as its own page and import one at a time. Alternatives: htmltofigma.com, html2design.
2. **What survives import:** auto-layout frames, editable text, fills, radii, shadows. Not: CSS animations, canvas, complex filters. Google Fonts import as text with the right family.
3. **SVG import:** gradients and clip paths survive; text is outlined; masks, filters, patterns flatten or drop ([Vellum](https://getvellum.design/blog/svg-to-figma)). Draw the flame and icons natively in Figma.
4. **Base kits:** Apple's [iOS and iPadOS 26](https://www.figma.com/community/file/1527721578857867021/ios-and-ipados-26); [Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit).
5. **Variables architecture:** Primitives (no modes) · Semantic/Color (Light, Dark) · Semantic/Scale (**Standard, Parent**: font size, target height, spacing, so one mode switch turns any screen into the parent surface) ([zeroheight](https://zeroheight.com/blog/figma-variables-and-design-tokens-part-one-variable-architecture/)). Name tokens as in code (`color.action.primary`, `size.target.min`).
6. **File structure:** one design-system library (tokens, components, flame, labelled icons); product files per surface (App, Parent surface, Kitchen table, Widgets, Messenger cards); a Flows page per journey.
7. **Components first:** ArrivalCard (photo/voice/question), Flame (lit/resting × standard/parent × reduce-motion), BigButton (48/64/88), VoiceRow (recording/preview/playback), NoticeCard, ReceiptChip ("Mom saw it ♥").
8. **Text styles** bound to the Scale variables: Body 17/22, Title 28/34, Display 34/44 for Standard/Parent.

## The fifteen rules Vela follows

1. One card, one action, then close.
2. Grandma needs no app; the app and tablet are upgrades.
3. The receipt is the product: every tap becomes a named, timestamped "Mom saw it ♥" to the sender.
4. Two flame states, no red, no numbers; state named in words; never a streak.
5. Staged escalation: family sees the flame; the organiser gets the notice; contacts live inside the notice; a late answer auto-sends "all good".
6. Never show where or when-last-seen.
7. Parent surface: 64 pt targets (88 pt primary), 22–24 pt body, 7:1 contrast, medium weight, one column, tap only, visible Back, light mode only.
8. Amber is never text and never the only signal.
9. Voice: tap to start, tap to stop, preview, send; transcript and translation under every note.
10. Serif for the human voice, system sans for the machine; serif only ≥ 20 pt.
11. Member-chosen arrival time, no countdown; one notification a day.
12. Onboarding = add the person, send the first arrival, invite one more; under 90 seconds; no paywall.
13. Rotate content, keep the ritual.
14. Motion is a breath, not a bounce; one optional soft chime.
15. Build the design system with a Standard/Parent scale mode; import screens one at a time; draw the flame natively.

Caveats: Apple's HIG page did not fetch (JS-rendered); Dynamic Type sizes and WCAG ratios are from published specs; Aura's help page returned 403 (wording from the snippet); Tinybeans/Cocoon notes are prior knowledge.
