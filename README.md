# Vela

One real exchange a day between generations, and a light kept on for the parent who lives alone.

Each morning the parent receives one ask from a person in the family (a question, two photos to choose from, a voice note), answers with a tap or her voice, and hears the family's replies the next morning. Her answer is also the sign the family needs: when a morning goes unanswered, the organiser gets a calm note with the people nearby. Nothing to install for her, nothing to wear, no one watching.

## Where things are

| Start here | What it is |
|---|---|
| [`product/05-product-spec-v2.md`](product/05-product-spec-v2.md) | **The product.** The exchange, the reply loop, the light and the quiet ladder, consent, every screen, the Telegram pilot (Appendix A) |
| [`architecture/02-technical-architecture-v2.md`](architecture/02-technical-architecture-v2.md) | **The system.** Constraints, platform, scheduling, gateway, channels, AI and speech, mobile, residency, security, operations, cost |
| [`architecture/03-code-design.md`](architecture/03-code-design.md) | **The code.** Package map, rules for all code, each package's API, decisions taken during the build |
| [`architecture/04-instrument-flows.md`](architecture/04-instrument-flows.md) | **The pilot flows.** Every Telegram flow with its database effects, messages, and events |
| [`plan/build-plan.md`](plan/build-plan.md) | **The build.** Six sprints, task by task, with definitions of done |
| [`plan/market-order.md`](plan/market-order.md) | **The markets.** Taiwan and the English app path, then Japan and Germany/UK, then the US at scale and India |

| Folder | Contents |
|---|---|
| `apps/worker` | The Cloudflare Worker: routes, webhooks, the member scheduler, queues, cron |
| `packages/contracts` | The shared vocabulary, the channel adapter contract, event names |
| `packages/core` | Pure domain logic: local time, the daily schedule, the exchange state machine, rendering |
| `packages/db` | The Drizzle schema (source of truth for the data model), migrations, clients |
| `packages/copy` | Every messenger string in English and Traditional Chinese |
| `packages/adapters` | Channel adapters (Telegram first) |
| `packages/ai` | Claude calls with versioned prompts, speech-to-text, the evaluation set |
| `packages/services` | Application services behind ports: scheduling, the gateway, the pilot flows |
| `architecture/` | Design documents, decision records (`decisions.md`), the generated `schema.sql`, the API contract, tool research |
| `product/` | The app plan and the spec |
| `research/` | Fourteen reports; start with `00-SYNTHESIS.md` and `14-evidence-synthesis.md` |
| `plan/` | Build plan, market order, readiness, the living master plan page (`master-plan.html`), pilot materials (`materials/pilot/`) |
| `infra/` | Environments, the founder's account checklist, sub-processors, runbooks |
| `design/` | Design system, brand files, the clickable prototype, diagrams |
| `pitch/` | Accelerator applications |
| `archive/` | Superseded documents and the first prototype, kept for history |
| `tools/` | Generators for the Draw.io map and the brand files |

## Working on the code

Requirements: Node 24 or later and pnpm 11.

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` runs Biome, TypeScript, and every test; it must pass before any commit, locally and in CI. Other commands: `pnpm format` fixes formatting, `pnpm db:generate` creates a migration after a schema change, `pnpm dev` runs the Worker locally against a local Postgres (`pnpm --filter @vela/db dev-db`).

Rules every change follows are in `architecture/03-code-design.md` §2. Secrets never enter the repository or a chat: see `infra/README.md`.

## Status

**2026-09-13.** Sprint 0 done: the monorepo, CI, and the foundation packages (contracts, copy, core, db, adapters, ai) with their tests. Sprint 1 in progress: the services layer and the Worker for the Telegram pilot. The living plan is published at https://claude.ai/code/artifact/b20dcd01-518a-406c-9bca-3b40906bf193.
