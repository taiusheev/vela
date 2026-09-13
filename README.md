# Vela

Peace of mind for adult children whose parents live alone.

Super-aged societies (Japan, Korea, Italy, Germany, and soon China and the US) have tens of millions of people over 75 living by themselves. Their children carry a constant low-grade worry: "Is mom okay today?" Vela's mission is to answer that question, quietly and reliably, for every family in the world.

## Repository layout

- [`research/00-SYNTHESIS.md`](research/00-SYNTHESIS.md) — start here: the landscape, ten cross-cutting truths, where Vela wins, risks
- [`research/14-evidence-synthesis.md`](research/14-evidence-synthesis.md) — **evidence instead of surveys** (reports 08–13: daily answer rates, willingness to pay, channels among 70+, acceptance and dignity, ritual retention, worry and reach) and what it changed in the spec
- `research/01`–`06` — the six underlying reports (US medical alerts and wearables; passive home sensing; East Asia; Europe/ANZ/Israel; AI companions and check-in apps; market size and lessons)
- [`product/02-app-plan.md`](product/02-app-plan.md) — **the product**: people, daily loop, features, channels, AI, privacy, pricing, metrics, architecture, roadmap, risks
- [`product/05-product-spec-v2.md`](product/05-product-spec-v2.md) — **the functional contract, v2**: the exchange, arrivals as asks, the reply loop, the light and the quiet ladder, consent, acceptance criteria for every screen, the phase-0 instrument (supersedes 03 and 04)
- [`architecture/01-technical-design.md`](architecture/01-technical-design.md) — **how it's built**: components, scheduler, adapter contract, AI pipeline, security, failure modes, cost at scale
- [`architecture/decisions.md`](architecture/decisions.md) — architecture decision records
- [`plan/execution-plan.md`](plan/execution-plan.md) — **what we do**: phase 0 (prove the loop), MVP, the bridge, the read; deck and site track
- [`plan/pre-build-readiness.md`](plan/pre-build-readiness.md) — **what is still missing before MVP code**: gaps in three tiers, the next ten days, the definition of ready
- `plan/materials/` — surveys (RU, EN, ZH-TW), interview script, recruitment posts, parent explainer
- `product/01-solution-thinking.md` — problem anatomy and solution space (partly superseded)
- [`bot/`](bot/README.md) — the phase-0 prototype: Telegram + Cloudflare Workers + D1 + Claude
- `pitch/` — accelerator application answers
- [`plan/master-plan.html`](plan/master-plan.html) — source of the living master plan page (published at https://claude.ai/code/artifact/b20dcd01-518a-406c-9bca-3b40906bf193)
- [`design/diagrams/master-plan.drawio`](design/diagrams/master-plan.drawio) — **the whole foundation as a 34-page Draw.io map** (open at app.diagrams.net from GitHub)
- [`design/`](design/README.md) — Draw.io diagrams (architecture, database, daily loop) and Figma-ready wireframes of the six key screens
- `plan/tasks-asana.csv` — optional Asana export of the phase-0 checklist (the master plan page is the tracker)
- `tools/gource.ps1` — renders the repo history as a Gource animation

## Status

2026-09-12: research complete (7 reports), product plan and execution plan written, ikigai Launchpad application submitted. Phase 0 starts: survey, interviews, and the prototype loop with 10–20 paying families.
