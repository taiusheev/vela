# Design and planning tools

Free tools, as agreed, and how each one is used for Vela. Everything is authored in English first; Russian and Chinese are localisations.

| Tool | What it holds | Files here | How to open |
|---|---|---|---|
| **Draw.io (diagrams.net)** | System architecture, database schema, the daily loop | `design/diagrams/*.drawio` | Go to app.diagrams.net → Open Existing Diagram → GitHub → `taiusheev/vela` → `design/diagrams/`. Edits save straight back to the repo as commits. Or install the "Draw.io Integration" extension in VS Code and open the files locally. |
| **Figma** | The UI in identity v3 | Figma file "Vela · Design" (link in `figma-state.json`); `prototype/vela-app.html` is the full 20-screen reference | Open the file in Figma; the v1 wireframes are in `archive/design/wireframes/` for history only. |
| **Gource** | An animated tree of the repository's history | `tools/gource.ps1` | Install gource and ffmpeg, then run the script from the repo root. `-Record` writes an MP4 for a demo or the deck. |

The living master plan (mission, research, product, roadmap, checklist) is the published page linked from the root README. These files are its working material.

## Wireframes (v1, archived)

The six v1 wireframes moved to `archive/design/wireframes/`. They used the superseded sage/amber palette and the "I'm fine" model; the prototype and the Figma file replace them.

<details><summary>What the v1 wireframes showed</summary>

| # | Screen | What it shows |
|---|---|---|
| 01 | Home | Lights row (Мама lit, Саша away), today's moment from her, the family thread, one primary action |
| 02 | Send | A prompt drawn from her words, voice / photo / question, "tomorrow morning" or "whenever", the week's turns |
| 03 | Parent surface | One screen: the greeting, a big photo, one big "Всё хорошо" button, voice reply, one-tap call. Also kitchen-table mode |
| 04 | Quiet notice | Why we're telling you, what she said yesterday, the two nearby contacts with call and ask, "she's away", "wait 2 h" |
| 05 | Weekly read | Seven lights, four neutral lines, one suggestion, the story of the week |
| 06 | Onboarding | Who to keep a light on for, who is nearby, how she receives the morning (messenger or the app), the invite text |

</details>

The prototype `prototype/vela-app.html` and the Figma file carry identity v3 (Candle & Ink: cream #FBF7F0, ink #1E1A16, light #E9A23B, teal #1F5C66; Literata + Inter). See `design-system.md`.

## Diagrams

- `master-plan.drawio`: **the whole foundation as a 34-page visual map** in seven sections: foundation (mission, problem in numbers, the worry decomposed), research (landscape, findings by region, family-bridge benchmarks, ten truths and positioning), product (family and promises, daily loop, states and consent, the free layer, Vela Light, surfaces and channels, AI layer, edge cases), architecture (components, data flow, data model, security and failure modes, delivery and cost, decisions), business (model and pricing, revenue scenarios), go to market (waves and growth loop, channel landscape), plan (roadmap, phase 0, phases 1–3, metrics, risks, decisions and open questions, team/legal/brand, deck and glossary). Generated from `tools/build-master-plan-drawio.mjs` with the page data in `tools/mp/*.mjs`; edit there and run `node tools/build-master-plan-drawio.mjs`, or edit the file directly in Draw.io (then tell the co-founder to stop regenerating).
- `architecture.drawio`: family side (app, parent surface, web), the platform (API, scheduler, AI service, Postgres, event log, media, channel interface, admin, billing), the channel adapters (Telegram, MAX, WhatsApp, LINE, Viber, voice/SMS, in-app), external services.
- `database.drawio`: the MVP schema. Green = the daily loop; amber = the paid Light layer; grey = supporting. Retention rules in the legend.
- `daily-loop.drawio`: swimlanes for the family, Vela, the kept-light member, and the organiser, from queueing content to the quiet notice.
