# Hosted synthetic families

This separate Worker drives Vela's actual HTTP app, service implementation, Cloudflare queue consumers, MemberScheduler Durable Objects and sealed PostgreSQL writes. It exists only in the **Vela staging** account. The normal pilot/admin Workers and production configs never import this entrypoint.

The isolated schema `vela_swarm_20261018a101` shares staging's Neon compute and Hyperdrive connection pool. A generated alternate Drizzle schema explicitly qualifies all 42 tables. Migrations rewrite foreign keys to that schema; `SET LOCAL search_path` is used only inside the schema initialization transaction. Runtime queries do not change connection search paths. No real-family table or destination is read or changed. Separate queues and Durable Objects keep jobs out of the normal staging deployment. There is no cron. The recording channel refuses destinations outside `swarm-parent-N` and `swarm-child-N` and records every adapter invocation, allowing duplicate sends to be detected.

The control capability and content sealing key are derived privately from the staging deployment credential, installed as Worker secrets, and kept out of logs and receipts. HTTP users receive short-lived synthetic signed sessions. This exercises routing, validation, idempotency and family authorization, while replacing Clerk's external session verification. The channel records delivery; it never contacts Telegram or LINE. AI is off. These runs cannot judge real AI wording, real provider reliability, native UI usability, production capacity or family engagement.

## Run

The existing staging deployment environment supplies `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` privately. The orchestrator refuses any account other than Vela staging. From `apps/worker`:

```sh
node swarm/scripts/generate.mjs
VELA_HOSTED_FAMILIES=100 VELA_HOSTED_DAYS=3 VELA_HOSTED_MIXED=1 \
  node --env-file=/absolute/path/to/private/staging.env \
  swarm/scripts/run.mjs --deploy --reset
```

`--deploy` creates/reuses this experiment's named queues and deploys its separate Worker. `--reset` drops **only the fixed synthetic schema** before initializing it again. A previous run must have stopped its alarms and drained its outbound work first. The runner stops all seeded members' scheduler objects in its completion path and records whether that cleanup succeeded. It keeps content-free receipts under `infra/load-tests/hosted-swarm-*`. Requests and bearer tokens are never printed. Keep the deployment credential out of command arguments, chat, source files and screenshots.

The basic profile is 10 families and two days. The mixed profile uses 100 families and three days: twenty families are away on day two and return on day three; ten organisers turn signing off; ten parents send a second message each day; both inbound delivery and reply writes are repeated with the same keys. Every active day checks Today, Memories, the exact answer texts and signing choice, and denied cross-family reads. It also checks denied cross-family replies and reconciles persisted deliveries, answers, replies, read-backs, quiet events, dead jobs and duplicate adapter calls. Virtual dates advance between phases; Cloudflare processes real requests and queue waits in wall time.

To compare the same ten-family preflight cohort before and after an implementation change, run `swarm/scripts/benchmark.mjs before`, deploy the change with `run.mjs --deploy --provision-only`, then run `benchmark.mjs after`. Use the same private environment loading as above. It repeats thirty Memories HTTP reads and stores timings plus hashes of normalized synthetic responses. It must run before resetting or advancing that cohort. The comparison checks response equivalence, not a latency SLA.

`pnpm check` generates and typechecks the isolated entrypoint and runs its table-isolation test. The service tests also ensure that a ten-card page needs the same number of select calls as a one-card page. No migrations or API contract changes are needed for the Memories batching improvement.
