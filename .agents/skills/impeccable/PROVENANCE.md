# Where this skill came from

- **Source:** https://github.com/pbakaus/impeccable/tree/374a0e179bb36725283a612462131705ba4780ae/.claude/skills/impeccable (v4.7.0)
- **Commit:** `374a0e179bb36725283a612462131705ba4780ae` (2026-10-20)
- **Licence:** Apache-2.0 (see `LICENSE`)
- **Copied:** 2026-10-20 by Claude. Only the instruction files were copied, after scanning them for downloads, shell commands, secrets and prompt-injection text (none found).
- **Why Vela keeps it:** the strongest free design skill found in the October 2026 research: critique, audit, polish, harden (translated text, errors, edge cases), clarify (UX copy), onboard (first-run and empty states), typeset and layout. It reads Vela's design context from `PRODUCT.md` and `DESIGN.md` at the repo root.
- **Left out on purpose:** the `scripts/` folder (a launcher that downloads a self-contained binary, a 550 KB browser script and a 1.1 MB font index), the plugin's hooks and agents, and the playbooks that depend on them: `new-work`, `live`, `live-setup`, `generate`, `hooks`, `doctor`, `region-map`, `component-review`, `visualize`, `craft`, `overdrive`, `degraded/*`. Vela's policy does not run downloaded binaries from community repos.
- **Changes:** `SKILL.md` Setup step 1 replaced with a note on doing the launcher's checks by hand; the command rows and the pin/hooks/doctor paragraphs for the left-out parts replaced with one "Not in Vela's copy" note that also records the founder's direction (refine Kept Light, no new visual world unless asked). A few copied playbooks still link to left-out files; those links are dead on purpose.
- **Updating:** at the monthly skill check, diff `.claude/skills/impeccable/` (SKILL.md and reference/) between this commit and the newest, read the changes, copy them in a PR.
