# Where this skill came from

- **Source:** https://github.com/mattpocock/skills/tree/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/tdd
- **Commit:** `5beb35b040e3de97e54fa9e386d7e42d15c295c2`
- **Licence:** MIT, copyright 2026 Matt Pocock (see `LICENSE` in this folder)
- **Copied:** 2026-10-20 by Claude, after reading every file. It has no scripts, hooks or network calls; it is instructions only.
- **Why Vela keeps it:** A short red → green loop with clear anti-patterns. Chosen over Superpowers' TDD skill, whose rule to delete code written before its test is unsafe in a checkout another agent shares.
- **Changes from the source:** seams are chosen by the agent and written in the plan or PR, not confirmed with the user (the founder is not technical); points at Vela's ADRs and code-design rules instead of GLOSSARY.md; references to the `codebase-design` and `code-review` skills replaced with the built-in `/code-review` and `/simplify`; added a "Vela specifics" section (Vitest, PGlite, PostgreSQL race tests) and the rule never to delete work you did not write.
- **Updating:** at the monthly skill check, read the diff between this commit and the source's newest, then copy the new version in a PR.
