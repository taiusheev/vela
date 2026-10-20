# Where this skill came from

- **Source:** https://github.com/cloudflare/skills/tree/b052c32bab7dd493513260228a36c88294f343f1/skills/workers-best-practices
- **Commit:** `b052c32bab7dd493513260228a36c88294f343f1`
- **Licence:** Apache-2.0 (see `LICENSE` in this folder)
- **Copied:** 2026-10-20 by Claude, after reading every file. It has no scripts, hooks or network calls; it is instructions only.
- **Why Vela keeps it:** Cloudflare's own review list for Workers code (streaming, `ctx.waitUntil`, bindings, secrets, observability). This is the commit Anthropic's plugin directory pins for the Cloudflare plugin. Copied instead of installing the plugin, which would add 19 skills and an MCP server that can change the Cloudflare account.
- **Changes from the source:** none.
- **Updating:** at the monthly skill check, read the diff between this commit and the source's newest, then copy the new version in a PR.
