# Vela design system

v3, 2026-09-12. Decided from `research-identity.md` (colour vision after 65, cultural meaning across our six markets, legibility research, script coverage, logo trends, name check) and `research-best-apps.md` (interaction and accessibility patterns). Supersedes v1 (sage/amber flame, rejected) and v2 (navy/blue from the radar-concept logo, withdrawn). Figma: "Vela · Design", https://www.figma.com/design/eJxG0c9ZHNSlY794RA9nrL.

## The identity in one paragraph

Warm cream, deep warm charcoal, one amber light, and a cool teal for the things you tap. A window with a light on is the mark. Literata carries people's own words; Inter carries the interface. Nothing pulses, nothing is red, nothing is a bulb, a candle, a shield, or a radar. It should feel like a well-made book left open on a kitchen table at dusk, and still look sharp to a 20-year-old.

## Why these, in five lines

1. Older eyes lose blue and contrast first; they prefer warm, high-lightness grounds. So the base is cream, not white or navy, and the ink is a warm charcoal at 16:1.
2. Amber is the only accent that is positive in Russia, Taiwan, Japan, India, the Philippines, and Germany. So the light is amber, but amber alone is 2:1 on cream, so a lit state always carries an ink glyph or a #C27612 ring; never amber text.
3. Blue reads institutional and fades for seniors; red alarms; so actions are deep teal, which reads "button" against the warm light without the fintech or medical tone.
4. Literata and Inter both carry Cyrillic and Greek, are free (OFL), and are in Figma; Figtree, Fraunces, and Newsreader are Latin-only, which would have failed the Russian market on day one.
5. The mark must survive as a one-colour silhouette (Android 16 tints icons; Apple Tinted and Clear); a lit window does, a glowing gradient blob does not.

## Colour

| Token | Light | Dark | Use | Contrast (light) |
|---|---|---|---|---|
| `color/bg` | #FBF7F0 | #1B1714 | page background | — |
| `color/surface` | #FFFFFF | #26211D | cards, sheets; separate from bg with `rule`, not colour alone | — |
| `color/surface-2` | #F3EDE4 | #302A25 | secondary fills | — |
| `color/ink` | #1E1A16 | #F3EDE4 | primary text | 16.2:1 on bg |
| `color/ink-2` | #5A534B | #B9B0A5 | secondary text | 7.1:1 on bg |
| `color/ink-3` | #7A7267 | #8F867B | captions and labels, 13 pt and up only | 4.6:1 on bg |
| `color/rule` | #E8E1D6 | #3A332C | hairlines, borders | — |
| `color/light` | #E9A23B | #E9A23B | the light when lit (fill), halo, chips | 2.0:1 on bg: never text, never the only signal |
| `color/light-deep` | #C27612 | #F0B65A | the light's ring, small icons, amber text when unavoidable | 3.3:1 on bg |
| `color/light-soft` | #FBEBCF | #3B2E19 | halo, selected states, amber cards | — |
| `color/action` | #1F5C66 | #7FC3CC | primary buttons, links, focus rings | 7.1:1 as text; white on it 7.6:1 |
| `color/action-soft` | #E1EEF0 | #17383E | selected controls, soft teal cards | — |
| `color/error` | #B3261E | #F28B82 | true errors only | 6.1:1 |

Rules: light mode is the default and the only mode on the parent surface and kitchen-table mode; dark mode exists for the 20-year-old. No pure white as a page ground (mourning association in East Asia and the clinical default); no pure black. Meaning is never carried by hue alone.

## Type

| Role | Face | Size / line | Where |
|---|---|---|---|
| Display | Literata SemiBold | 34/40 | Greetings on the parent surface, the wordmark |
| Title | Literata SemiBold | 26/32 | Screen titles, the weekly read heading |
| Voice | Literata Regular | 19/27 (parent: 24/32) | People's own words: her answer, a story, Mia's question |
| Heading | Inter SemiBold | 17/24 | Section headings, card titles |
| Body | Inter Regular | 17/24 (parent: 22/30) | Everything else |
| Body medium | Inter Medium | 17/24 | Emphasis inside body |
| Button | Inter SemiBold | 16/20 (parent: 26/32) | Buttons |
| Caption | Inter Regular | 13/18, ink-3 | Times, meta |
| Label | Inter SemiBold | 12/16, +6% tracking | Eyebrows; sentence case in Cyrillic and CJK, never all caps there |

Fallbacks: Noto Serif TC for Voice and Titles in Traditional Chinese, Noto Sans TC or system PingFang TC for UI; on device, SF Pro and Roboto for UI where Inter isn't bundled. Inter with the disambiguation stylistic set on (I/l/1). Body scales with Dynamic Type; the parent surface starts one step larger and never below 17 pt. One serif moment per screen at most; never a serif on a control.

## Spacing and shape

- 4 pt grid; scale 4, 8, 12, 16, 20, 24, 32, 40, 56.
- Margins 20 pt (app), 24 pt (parent surface).
- Radius: cards 16, sheets 24, buttons 14, the big parent button 22, chips 999. The window mark's corners set the family: soft, not pill.
- Elevation: none by default; one soft warm shadow (0 12 32 rgba(30,26,22,.14)) only on the sheet that floats (the quiet notice).

## The light (component)

The in-app glyph for a person's day, derived from the mark: a small rounded window (28, 40, or 120 pt tall) with a light inside.

| State | Drawing |
|---|---|
| Lit | window outline in ink, amber ellipse inside with a light-soft halo |
| Resting | window outline in ink-3, no light |
| Quiet | resting, plus a small light-deep dot at the top-right corner |
| Away | window outline dashed in ink-3 |
| Paused | window outline in rule |

Lighting animates once: the light blooms in over 600–900 ms, ease-out, with a soft haptic. Reduce Motion: it appears. Nothing ever pulses.

## Components

| Component | Notes |
|---|---|
| **Arrival card** | Surface, 16 radius, one hairline. The day's ask from a person: who asks (avatar 28 + name), the ask in Voice type, the media, and one answer affordance. One card, one ask. |
| **Answer bar** (parent surface) | Contextual: question → 96 pt mic in action colour plus two or three answer chips; photo choice → two big tappable photos; voice note → 64 pt play then a mic; word → a mic with "say it once". "Just say hi" as a small text link at the bottom. |
| **Reply thread** | Under her answer: reactions (heart, laugh, hug) and short replies; no counts shown to her; she hears the substance tomorrow. |
| **Receipt chip** | "Mom saw it · 8:12" in light-soft with ink text; "Grandma answered you" to the asker. |
| **Voice row** | Play 44 pt (64 on the parent surface), 24-bar waveform in action colour, duration, transcript below in ink-2, "original" toggle for translations. |
| **Prompt card** | Light-soft card, label "PROMPT · FROM HER OWN WORDS", one sentence, one action "Use this". |
| **Quiet notice sheet** | Label, Literata title ("It's been quiet at Mom's today"), one calm line, facts, nearby contacts with Call and Ask to check, primary "Call Mom", secondary "She's fine, I know why" and "Wait 2 hours". Ink on surface, never a red banner. |
| **Weekly read** | Seven small lights in a row, 3–5 Literata lines on surface, one suggestion in action colour, story of the week. |
| **Buttons** | Primary: action fill, white Inter SemiBold, 56 pt (app) / 88 pt (parent). Secondary: surface with rule border. Tertiary: text in action. At most one primary per screen. |
| **Inputs** | 56 pt, rule border, 2 pt action focus ring; helper text always visible. |
| **Empty states** | Never empty: the home shows lights and "Tomorrow is Anna's turn"; a new family sees the first arrival composed as an example. The window mark, unlit, is the only illustration. |

## Motion and sound

One signature animation: the light coming on. Card fades 240 ms; screen transitions 300 ms; ease-out entering, ease-in leaving; no parallax, no bounce, no loops, no confetti. The app closes with a 300 ms fade to the light. Sound: one soft two-note chime at the arrival hour on the parent surface and kitchen-table mode, opt-in.

## Notifications

Exactly one per member per day at their hour, worded as the arrival's first line ("Mia asked you something"). The turn prompt the evening before. Quiet notices to organisers only.

## Voice

Facts, not feelings: "Nana answered at 9:12", "No word from Nana yet today". Names, never "users" or "seniors". No exclamation marks, no streaks, no "great job". One sentence per screen. The silence notice is calm and specific, with the next action visible. Every sentence must translate cleanly into Russian and Traditional Chinese: no idioms, no emoji as tone.

## Name and mark

The mark is The Kept Light: a window seen from the street at dusk with one warm light on. Prompts in `brand/logo-prompt.md`; working drawing in `brand/kept-light-sheet.svg`. The name "Vela" is kept for now but is not clearable as a bare mark (vela.family, a family-calendar app in beta; "Vela for Caregivers", a former eldercare app; several Vela trademarks in class 9/42), so the product ships as "Vela Light" with a compound domain, formal clearance runs in EUIPO, WIPO, Rospatent, and TIPO before the mark is final, and one backup name is prepared. In India "vela" means idle; own the joke or use a local sub-brand.

## Figma structure

Foundations (variables: Primitives and Color in one mode each on the Starter plan; text styles; the Light and Button components) · App · Parent surface.
