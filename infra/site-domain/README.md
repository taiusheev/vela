# Website domain deployment

Deployed 10 October 2026, Asia/Taipei, at https://vela-light.com.

`www.vela-light.com` redirects to the bare domain, preserving the path and query.
Both hostnames are Custom Domains of the standalone `vela-website` Worker in
`T.aiusheev@gmail.com's Account` (account `36c483ebea452f45cb3e568f726d044a`).
The dashboard deployed version starts `b64158ef`. There are no bindings or secrets.

The website currently renders on `vela.vela-light-staging.workers.dev`, in a
different Cloudflare account. The domain was registered on 7 October. Cloudflare
Registrar requires a registration older than ten days before an account transfer:
https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/.
This website bridge publishes it now without moving the domain or deploying the
pilot/admin Workers. It depends on the staging website's availability and content;
future staging website releases are visible on the public domain automatically.

Only public website pages, `/site/` assets, robots, sitemap, and the waitlist can
reach the upstream website. App, admin, messaging and media routes return 404.
Cookies and Authorization are not forwarded. The waitlist accepts POST requests
from the website's own two origins; upstream form size/type/email checks remain
in force. The bridge keeps the website's security headers, makes the public pages
indexable, and preserves canonical links to `vela-light.com`.

## Verification

Run `node --test infra/site-domain/worker.test.mjs` (three tests pass).
`verification.json` records live checks: six pages, robots/sitemap, linked assets,
and blocked private routes. HTTPS certificate verification succeeded using the
addresses returned by public resolvers 1.1.1.1 and 8.8.8.8. The `www` redirect
returned 301 with its path/query preserved. Invalid-email form submission returned
303 to the error state; a foreign Origin returned 403. No waitlist signup was
created by these checks. The local resolver retained its earlier NXDOMAIN during
deployment verification; normal browser navigation needs that cache to expire.
`cloudflare-domains.jpg` shows both deployed Custom Domains.

## Updating or removing the bridge

The deployed source is `worker.mjs`; `wrangler.jsonc` describes the standalone
deployment. In the account dashboard, open **Workers & Pages → vela-website →
Edit code**, replace the code, and deploy. This account has no credential in the
repository or development environment. Do not add its credentials to the pilot's
staging `.env` or deployment workflow.

After an account transfer is available and deliberately chosen, connect both
Custom Domains to the intended website Worker in that account, verify HTTPS,
page assets, canonical/indexing behavior and waitlist, then retire this bridge.
Do not re-add cross-account routes to the staging pilot's Wrangler configuration.
