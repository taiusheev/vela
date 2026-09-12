# Design and planning tools

Free tools, as agreed, and how each one is used for Vela.

| Tool | What it holds | Files here | How to open |
|---|---|---|---|
| **Draw.io (diagrams.net)** | System architecture, database schema, the daily loop | `design/diagrams/*.drawio` | Go to app.diagrams.net → Open Existing Diagram → GitHub → `taiusheev/vela` → `design/diagrams/`. Edits save straight back to the repo as commits. Or install the "Draw.io Integration" extension in VS Code and open the files locally. |
| **Figma** | App wireframes and, later, the real UI | `design/wireframes/*.svg` | Create a Figma file "Vela · wireframes". Drag each SVG from this folder onto the canvas; Figma imports it as editable vectors. Screens are 390×844 (iPhone). The onboarding sheet is three screens side by side. |
| **Asana** | Phase-0 tasks with owners and dates | `plan/tasks-asana.csv` | New project → Import → CSV → choose the file. Sections become the four weeks; assignee `t.aiusheev@gmail.com` is you, blank rows are the co-founder's. |
| **Trello** | Same tasks, if you prefer a board | `plan/tasks-trello.md` | Create the four lists, paste each block into "Add a card", one card per line. |
| **Gource** | An animated tree of the repository's history | `tools/gource.ps1` | Install gource and ffmpeg, then run the script from the repo root. `-Record` writes an MP4 for a demo or the deck. |

The living master plan (mission, research, product, roadmap, checklist) is the published page linked from the root README. These files are its working material.

## Wireframes

| # | Screen | What it shows |
|---|---|---|
| 01 | Home | Flames row (Мама lit, Саша away), today's moment from her, the family thread, one primary action |
| 02 | Send | A prompt drawn from her words, voice / photo / question, "tomorrow morning" or "whenever", the week's turns |
| 03 | Parent surface | One screen: the greeting, a big photo, one big "Всё хорошо" button, voice reply, one-tap call. Also kitchen-table mode |
| 04 | Quiet notice | Why we're telling you, what she said yesterday, the two nearby contacts with call and ask, "she's away", "wait 2 h" |
| 05 | Weekly read | Seven flames, four neutral lines, one suggestion, the story of the week |
| 06 | Onboarding | Who to keep a light on for, who is nearby, how she receives the morning (messenger or the app), the invite text |

Colours in the wireframes follow the plan's palette: sage green for actions, amber for the flame and the paid layer, blue-grey neutrals.

## Diagrams

- `architecture.drawio`: family side (app, parent surface, web), the platform (API, scheduler, AI service, Postgres, event log, media, channel interface, admin, billing), the channel adapters (Telegram, MAX, WhatsApp, LINE, Viber, voice/SMS, in-app), external services.
- `database.drawio`: the MVP schema. Green = the daily loop; amber = the paid Light layer; grey = supporting. Retention rules in the legend.
- `daily-loop.drawio`: swimlanes for the family, Vela, the kept-light member, and the organiser, from queueing content to the quiet notice.
