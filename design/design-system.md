# Vela design system

v1 draft, 2026-09-12. The tokens and rules every screen follows. To be refined with the design research (design/research-best-apps.md) and rebuilt in Figma as variables and components.

## Principles

1. **Quiet is the design.** One moment a day, then the app closes. No feed, no badges, no streaks, no red. The home screen is the flames and today's moment; that is the whole dashboard.
2. **Warm, not clinical.** Serif for the human words (names, her answer, the weekly read); a clean sans for the interface; generous whitespace; photographs and voice over icons and charts.
3. **Everyone by name.** Never "the parent", "the user", "member". Mom, Mrs Ivanova, Mia.
4. **Big, legible, forgiving.** The parent surface is designed for a 78-year-old with reading glasses: 18 pt minimum, 64 pt buttons, 7:1 contrast, no gestures, nothing that disappears.
5. **Say what happens next.** Every notice ends with the one thing the reader can do.
6. **No alarm colours.** Amber is the flame and attention; green is action and "fine"; red is reserved for true errors and is never used for the quiet state.

## Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | #F6F7F9 | #131920 | page background |
| `surface` | #FFFFFF | #1A222C | cards, sheets |
| `surface-2` | #EEF1F5 | #232C37 | secondary fills, dividers' ground |
| `ink` | #1B2430 | #E6EAF0 | primary text |
| `ink-2` | #4A5566 | #AEB7C4 | secondary text |
| `ink-3` | #7D8794 | #7F8A99 | captions, labels |
| `rule` | #D9DEE6 | #2C3643 | borders |
| `action` | #2F7D5B | #5CB88F | primary buttons, links, "fine" |
| `action-soft` | #E3F1EA | #1C3129 | selected states, positive chips |
| `flame` | #E0A23A | #E8B04F | the flame, the paid layer, attention |
| `flame-soft` | #FBF0D8 | #3A2F18 | flame halo, amber cards |
| `quiet` | #7D8794 outline | same | the unlit flame; never red |
| `error` | #B1413A | #D9736B | true errors only (payment failed, link broken) |

The parent surface uses the light palette only, with `ink` on `surface` at 7:1 and `action` buttons with white text (4.6:1, large text) or `ink` text on `action-soft` where 7:1 is required.

## Type

| Role | Face | Size / weight | Where |
|---|---|---|---|
| Display | Newsreader (opsz 36+) | 34/40 500 | Greetings on the parent surface ("Good morning, Mrs Ivanova") |
| Title | Newsreader | 26/32 500 | Screen titles, her answer quoted, the weekly read |
| Heading | Public Sans | 17/24 600 | Section headings, card titles |
| Body | Public Sans | 16/24 400 | Everything else |
| Body large (parent surface) | Public Sans | 20/28 400 | All body text on the parent surface |
| Caption | Public Sans | 13/18 400, ink-3 | Times, meta |
| Label | Public Sans | 12/16 600, letter-spacing 0.08em, uppercase, ink-3 | Eyebrows ("TODAY · HER MORNING") |
| Numbers | IBM Plex Mono | tabular | Times, counts |

Dynamic Type: the app honours the OS text size; the parent surface starts one step larger than the OS setting and never below 18 pt.

## Spacing and shape

- Base unit 4 pt; spacing scale 4, 8, 12, 16, 20, 24, 32, 40, 56.
- Screen margins 20 pt (app), 24 pt (parent surface).
- Corner radius: cards 12, sheets 20, buttons 14, the big parent button 20, chips 999.
- Elevation: none by default; one soft shadow only on the one sheet that floats (the quiet notice).

## Components

| Component | Notes |
|---|---|
| **Flame** | 40 pt on home, 28 pt in lists, 120 pt on the parent surface confirmation. States: lit (amber fill, soft halo), unlit (ink-3 outline), quiet (outline + dot), away (dashed outline), paused (grey). Lighting animates once: 400 ms ease-out scale 0.8→1 with the halo fading in; respects reduce-motion. |
| **Moment card** | Today's arrival or her answer: media left or top, one or two serif lines, meta caption, one action. |
| **Answer bar** (parent surface) | One 84 pt primary button "☀️ I'm fine", two 70 pt secondary: "🎤 Reply", "📞 Call Anna". |
| **Voice note** | Record: hold or tap-to-toggle, both; 10-second guide ring; playback: play button, duration, waveform of 24 bars, transcript below in `ink-2`, "original" toggle for translations. |
| **Thread item** | Avatar 28, name + relative time caption, one line, media thumbnail; no like counts; a single "answered" flame glyph when the kept-light member responded to it. |
| **Prompt chip** | Amber-soft card with the eyebrow "PROMPT · FROM HER OWN WORDS" and one sentence; one action "Use this". |
| **Quiet notice sheet** | Eyebrow, serif title ("Mom hasn't answered yet today"), calm one-liner, facts list, nearby contacts with Call / Ask to check, primary "Call Mom", secondary "She's away" / "Wait 2 hours", footer line about what closes it. |
| **Weekly read** | Seven flames row, 3–5 serif lines, one suggestion in `action`, story of the week card. |
| **Buttons** | Primary: `action` fill, white 16/600, 56 pt (app) or 84 pt (parent). Secondary: `surface` with `rule` border. Tertiary: text only. Destructive: `ink` text, confirms twice, never red until the confirm. |
| **Inputs** | 56 pt, `rule` border, `action` focus ring 2 pt; helper text always visible. |
| **Empty states** | Never empty: the home shows the flames and "Tomorrow is Anna's turn"; a new family sees the first arrival composed as an example. |

## Motion and sound

- One motion per event, 200–400 ms, ease-out; the flame lighting is the only "celebration".
- No confetti, no streak animations, no pull-to-refresh spinner theatre.
- Sound: one gentle chime at the arrival hour on the parent surface and kitchen-table mode; optional, off by default in the app.

## Notifications

- Exactly one per member per day at their hour; the copy is the arrival's first line ("Mia sent you a drawing"), never "You have 1 new notification".
- Turn prompt the evening before: "Tomorrow is your day. She mentioned the tomatoes…".
- Quiet notices to organisers only, with the calm title.

## Voice and copy

- English first, every string keyed, native review per market.
- Names, not roles. Neutral, not alarming. Say what happens next. Never "monitor", "track", "detect", "alert" in any user-facing text; use "answered", "hasn't answered yet", "we'll tell you", "quiet".
- The parent surface speaks in full sentences and the polite form of address in languages that have one.

## Figma structure (to build)

- File "Vela · Design system": pages Foundations (colour variables light/dark, type styles, spacing, radius), Components (flame, cards, buttons, inputs, voice note, thread item, sheets), Icons.
- File "Vela · App": pages Onboarding, Home, Send, Thread, Weekly read, Quiet notice, Story day, Settings, Parent surface, Kitchen-table.
- Import path: the HTML prototype in `design/prototype/` imported with the html.to.design plugin as editable layers; SVG wireframes in `design/wireframes/` as the low-fidelity reference.
