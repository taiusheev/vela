# Public website production bridge candidate

This source prepares the switch from the existing domain-bridge-v1 staging target to the production pilot. It is not the deployed source until a verified account-owner deployment is recorded. It brings forward the original bridge from proposal66; that proposal is not itself proof of the new target.

The domain belongs to the separate personal Cloudflare account in wrangler.jsonc. There are no database bindings or secrets. Never put this account’s credentials in the staging environment. Deploy only after production has the reviewed website version and SITE_HOST=vela-light.com, using the ordered cutover in ../runbooks/release.md.

Only public pages, site assets, waitlist POST, analytics configuration GET and analytics event POST pass through. Legal routes work on the marketing host. Cookies/Authorization are stripped; write origins are restricted; app/admin/webhook/media routes remain blocked. The optional analytics endpoint remains off unless the upstream reviewed configuration enables it. This bridge does not enable collection.

The deployed version will identify itself with X-Vela-Website: domain-bridge-v3-production. Confirm this header, the HTTP-to-HTTPS redirect, both languages, legal pages, private-route refusals, same-origin signup and the exact disposable production admin row after cutover. Rollback means restoring the previous account-deployed source/target; staging Origin permission is intentionally retained for that rollback. Do not copy or erase existing staging waitlist addresses.

Run node --test infra/site-domain/worker.test.mjs; it is also included in the root pnpm test gate. Publishing from the personal Cloudflare dashboard is a separate protected operational step, not a side effect of main or staging deployment.
