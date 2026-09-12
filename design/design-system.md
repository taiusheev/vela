# Vela design system

v2, 2026-09-12. Rebuilt from the Vela logo (navy house, glowing dot with arcs, sky arc, geometric wordmark) and the design research in `research-best-apps.md`. Supersedes v1 (sage/amber/flame), which the founder rejected. Built in Figma: "Vela · Design" (file key eJxG0c9ZHNSlY794RA9nrL).

## Identity, from the light story

The mark is a light left on in a window (direction A). Navy frame, one blue glow. So:

- **The light** is the product's mark for a person: a glowing dot. Lit = filled blue dot with a soft halo (she answered). Resting = outlined dot. Quiet = outlined dot with a small blue dot at the corner. Away = dashed outline. No flames, no eggs, no arcs.
- **The window** (the rounded frame) appears in the logo, the app icon, and the empty state only.

## Principles

1. **Quiet is the design.** One moment a day, then the app closes. No feed, no badges, no streaks, no red.
2. **Interaction, not inspection.** Every arrival asks for something real: an answer to a question, a choice, a voice reply, a word taught. "I'm fine" is the fallback, never the hero.
3. **Everyone by name.** Never "the parent", "the user".
4. **Big, legible, forgiving.** Parent surface: 22–24 pt body, 64 pt targets (88 pt primary), 7:1 contrast, tap only, visible Back, light mode only.
5. **Say what happens next.** Every notice ends with the one thing the reader can do.
6. **Blue is the light and the action; navy is the voice; nothing is red** except a true error.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `color/bg` | #F5F7FB | #0E1530 | page background (cool, from the logo's blue family) |
| `color/surface` | #FFFFFF | #16204A | cards, sheets |
| `color/paper` | #FBF8F3 | #1B2450 | family content cards: her answer, stories, the weekly read (warm, so people's words feel like paper) |
| `color/surface-2` | #EAF0FA | #1F2A5C | secondary fills |
| `color/ink` | #0B1B4A | #EEF2FF | primary text (the logo navy) |
| `color/ink-2` | #4A5678 | #B8C2E0 | secondary text |
| `color/ink-3` | #7A8499 | #8A94B3 | captions and labels (≥ 13 pt only) |
| `color/rule` | #DCE3F0 | #2B3768 | borders |
| `color/light` | #2E6BE8 | #6C9BFF | the light when lit, primary actions, links |
| `color/light-soft` | #E6EEFF | #22306A | halo, selected states, soft blue cards |
| `color/sky` | #7FA6FF | #8FB2FF | the sky arc |
| `color/error` | #C4453D | #F08A83 | true errors only |

Contrast: ink on bg 15:1; light (#2E6BE8) on white 4.9:1, so white text on light buttons passes at 16 pt semibold and above; light is never used as small text on white. Amber is gone.

## Type

| Role | Face | Size / line | Where |
|---|---|---|---|
| Display | Fraunces SemiBold | 34/40 | Greetings on the parent surface |
| Title | Fraunces SemiBold | 26/32 | Screen titles, the weekly read |
| Voice | Fraunces Regular | 19/27 (parent: 24/32) | People's own words: her answer, a story, a question from Mia |
| Heading | Figtree SemiBold | 17/24 | Section headings, card titles |
| Body | Figtree Regular | 16/24 (parent: 22/30) | Everything else |
| Caption | Figtree Regular | 13/18, ink-3 | Times, meta |
| Label | Figtree SemiBold | 12/16, +0.08 em, uppercase, ink-3 | Eyebrows |
| Numbers | Figtree with tabular figures | — | Times, counts |

Why: the wordmark is a geometric sans; Figtree matches its rounded, open forms and reads well small. Fraunces carries the human voice with an optical-size axis so it stays legible at 19 pt. Serif never below 19 pt on the parent surface. The app honours Dynamic Type; the parent surface starts one step larger.

## Spacing and shape

- 4 pt grid; scale 4, 8, 12, 16, 20, 24, 32, 40, 56.
- Margins 20 pt (app), 24 pt (parent surface).
- Radius: cards 16, sheets 24, buttons 14, the big parent button 22, chips 999. Rounded like the logo's corners.
- Elevation: none by default; one soft navy shadow (0 12 32 rgba(11,27,74,.14)) only on the sheet that floats (the quiet notice).

## Components

| Component | Notes |
|---|---|
| **Light** | The dot with two arcs. Sizes 24, 40, 120. States lit / resting / quiet / away / paused. Lighting animates once: the arcs draw outward over 500 ms; respects reduce-motion. |
| **Arrival card** | The day's moment with what it asks for: a question (answer by voice or chips), a photo ("which one?" or a heart), a voice note (reply), a word to teach. One card, one ask. |
| **Answer bar** (parent surface) | Contextual: for a question, a 96 pt mic and two or three answer chips; for a photo, a heart and a mic; for a voice note, a mic. "Just say hi" as the small fallback. |
| **Reply thread** | Under her answer: the family's reactions and replies; she hears them in her next morning ("Sam laughed at your story"). |
| **Receipt chip** | "Mom saw it · 8:12" to the sender; light-soft fill, navy text. |
| **Voice row** | Play (44 pt, 64 pt on the parent surface), 24-bar waveform in light, duration, transcript below in ink-2, "original" toggle for translations. |
| **Prompt card** | Light-soft card with the label "PROMPT · FROM HER OWN WORDS" and one sentence; one action "Use this". |
| **Quiet notice sheet** | Label, Fraunces title ("It's been quiet at Mom's today"), calm one-liner, facts, nearby contacts with Call / Ask to check, primary "Call Mom", secondary "She's fine, I know why" / "Wait 2 hours". |
| **Weekly read** | Seven lights in a row, 3–5 Fraunces lines on paper, one suggestion in light, story of the week. |
| **Buttons** | Primary: light fill, white Figtree SemiBold 16, 56 pt (app) / 88 pt (parent). Secondary: surface with rule border. Tertiary: text in light. |
| **Inputs** | 56 pt, rule border, 2 pt light focus ring; helper text always visible. |
| **Empty states** | Never empty: the home shows lights and "Tomorrow is Anna's turn"; a new family sees the first arrival composed as an example. |

## Motion and sound

- One motion per event, 200–500 ms, ease-out; the light's arcs drawing outward is the only celebration.
- Reduce Motion: static light with the halo.
- Sound: one soft two-note chime at the arrival hour on the parent surface and kitchen-table mode, opt-in; silence otherwise.

## Notifications

Exactly one per member per day, at their hour, with the arrival's first line as the copy. The turn prompt the evening before. Quiet notices to organisers only.

## Copy

English first; names, not roles; neutral, not alarming; say what happens next; never "monitor", "track", "detect", "alert"; "answered", "hasn't answered yet", "quiet", "we'll tell you".

## Figma structure

File "Vela · Design": Cover · Foundations (variables: Primitives, Color with Light/Dark, Spacing, Radius; text styles; the light component) · Components · App · Parent surface · Flows.
