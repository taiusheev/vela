# Privacy, security and public launch review

19 October 2026. Owner: Timur Aiusheev. Engineering worktree: `vela-privacy-security`.

The founder requested a review of the app and website, deployment with See It First onboarding, and preparation for a wider public launch. The founder subsequently clarified: Taiwan first, continued testing/preparation, no full public deployment. Keep the existing personal-operator/free-trial facts until an explicit business change. Existing pilot admission controls remain in effect until the wider launch is approved and implemented. Publishing legal pages does not establish compliance in every country.

## Implemented in this change

- English and Traditional Chinese `/terms`, `/security`, `/data-rights`, with website footer navigation and canonical/alternate links. Legal links use the production Worker origin so the existing personal-account domain bridge can reach them without a dashboard change. All are public without a sign-in or database. security.txt now points to the vulnerability-reporting policy.
- App Settings links to service terms, security and deletion instructions on the API origin. English matches the current trial language.
- Notice v6 describes setup relationship/interests/reply preferences, local portraits versus uploaded message photos, OpenAI default abuse-monitoring retention, actual Sentry inactivity and app update delivery. Both existing notice URLs remain English as required by the current cohort.
- Clerk moved from future work into the active provider register; no provider acceptance dates fabricated. Store deletion instructions now reflect You → Settings → Delete account.

## Requirements for the combined onboarding release

The founder explicitly authorised takeover and copying the onboarding snapshot into this separate integration branch, finishing privacy fixes and uploading the combined build. The original Claude checkout remains untouched. Migrations 0017 (setup answers) and 0018 (app permission evidence) must reach the target server before distributing the app.

1. Before sign-in/profile submission, show who operates Vela, privacy and terms links, the categories saved and why; give a clear decline/leave path.
2. Before family content reaches OpenAI or Deepgram, explain the data shared and purpose and obtain explicit permission, with version/time/evidence recorded server-side. A generic Continue button or a privacy-policy link alone is not evidence of AI permission. Organiser permission cannot replace the parent’s own permission. Parent and health choices stay independent. Audit pre-consent AI calls and queued work, including first-week suggestions and recipes.
3. Test decline, withdrawal, account change, restart, partial save/retry and duplicate acceptance. The onboarding draft currently lives outside React in module memory: prove it is cleared on account changes and does not attach one person’s answers to another account. Prove replaced/abandoned native portrait files are removed after cancellation, failure and restart.
4. The active production profile is English Telegram-first and uses its existing linking path. Do not claim the new onboarding is visible in TestFlight merely because non-trial/demo tests pass. Verify which path the exact distributed build uses.
5. Any changed health/AI purposes need the appropriate fresh consent before activation. Existing consent records must not be relabelled as v6 acceptance.
6. Root `pnpm check`, PostgreSQL contention and all hosted app journeys; browser narrow/dark/text-scaling checks and native picker/cleanup. Production preflight and arrival-window guard; protected production workflow; public smoke and 30-minute observation. New signed app build from the exact tested tree; check Apple processing/internal beta status. Real OTP, physical iPhone, VoiceOver and messenger/provider proof remain separate.

## Dependency audit: observed, unresolved

`pnpm audit --prod --json` on the lockfile at main `46c31bf` returned 7 advisories: 2 high, 5 moderate, 0 critical. Audit labels include Expo's build tools because Expo is a production dependency; this alone does not establish exploitability in the iPhone app or Worker.

| Dependency | Locked version | Advisory | Next action |
|---|---|---|---|
| node-forge | 1.4.0 | GHSA-86w9-cpqp-85rv, high; no patched release reported | Expo CLI/code-signing dependency. Inspect signature-verification reachability in EAS Update; do not disable signature validation or silence the advisory. Review upstream patch when available. |
| braces | 3.0.3 | GHSA-vfj7-8cjw-p6xm, high; no patched release reported | Metro/micromatch tooling. Keep development servers local and untrusted patterns out; confirm no untrusted pattern path in public runtimes. |
| uuid | 7.0.3, 8.3.2 | GHSA-w5hq-g745-h8pq, moderate | Transitive Clerk/Solana/Jayson dependency; patch via compatible parent upgrade. Do not force a breaking ESM major into CommonJS callers. |
| decode-uri-component | 0.2.2 | GHSA-vcc3-ghjq-m6fr, moderate | Expo query-string path. Review parent compatibility before upgrading to >=0.5.0. |
| stream-json | 1.9.1 | GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x, GHSA-mjw6-4jj6-33hc, moderate | Clerk/Solana/Jayson path. Assess actual shipped bundle and compatible parent upgrade to the patched parser; v3 is a breaking change. |

No dependency versions were changed by this legal-pages patch. No clean vulnerability audit or independent penetration test is claimed.

## Public launch decisions and evidence

| Item | Current state | What closes it |
|---|---|---|
| Markets and participants | Taiwan-first preparation; continued testing, no public launch | Both organiser and parent residence, supported language/age; jurisdiction review, especially cross-border and health/inferred data |
| Controller and business model | Personal founder/free pilot in current published facts | Current personal-operator/free-pilot facts retained; confirm any new company or paid offer before changing terms |
| Data processing agreements | Register contains missing dates and Deepgram DPA open task | Account owner confirms actual agreements/settings; counsel resolves gaps. No signatures or acceptances made by engineering |
| AI/health inference | Founder-only weekly readings may infer emotions and health; family sharing is sensitive | Purpose/necessity review, explicit consent and withdrawal enforcement, minimise or disable in public mode where unsupported |
| User content and safety | Private-family model, support email and account removal | Review report/block and child-safety requirements against target storefronts; source terms cannot replace working abuse controls |
| Store disclosures | Existing manifest and store worksheet; health classification unresolved | Review final shipped data flows, required-reason declarations and archive; submit accurate App Privacy/Data Safety answers |
| Brand/IP | Vela name used; no trademark clearance recorded | Trademark/domain/store search and counsel decision in actual launch markets |
| Website domain | Personal-account bridge currently proxies staging; legal paths absent from its allowlist | New footer links and security policy use the production Worker’s public legal URLs, avoiding an account transfer or bridge update. Direct /terms on the marketing host remains outside its old bridge allowlist. Prefer a production website source for a future public launch; do not move domains implicitly |
| Incident/data requests | Existing runbooks, public request route, founder email | Rehearse identity verification, access/correction/deletion, incident notification, recovery and evidence retention with synthetic data |

## Primary references checked

- Taiwan PDPA, Articles 3, 6–9, 19–20, 27 and transitional effective-date notes: https://law.pdpc.gov.tw/EngLawContent.aspx?id=5&lan=E (reviewed 19 October 2026). Target-market review remains necessary.
- Apple App Review Guidelines 5.1.1, 5.1.2(i), 1.2: https://developer.apple.com/app-store/review/guidelines/ (reviewed 19 October 2026). Explicit third-party AI permission, accessible policy, deletion and applicable user-content safeguards.
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data (reviewed 19 October 2026). `store:false` is not approved Zero Data Retention.
- Clerk DPA: https://clerk.com/legal/dpa (reviewed 19 October 2026). Reading does not establish the account owner's acceptance.
- High advisories: https://github.com/advisories/GHSA-86w9-cpqp-85rv and https://github.com/advisories/GHSA-vfj7-8cjw-p6xm (reviewed 19 October 2026).

## Evidence boundaries

Local tests prove route behaviour and static integration. They do not prove provider contracts, country legality, a clean security audit, an enabled public onboarding, physical-device behaviour or deployment. Record CI, staging, production, bridge and native build results here only after observing them.

## Local verification, 19 October 2026

Root `pnpm check` passed all 9 packages after updating the existing sitemap-count contract for six new legal URLs and wrapping new app labels in Lingui. Worker: 33 test files / 1,222 tests passed. Focused public-host and legal-route tests: 17 passed. Legal pages require no database/session and retain CSP/no-cookie protections. Final source is rerun before commit below.

Live public requests from this session returned network/proxy 403 responses, and the web reader could not access the same public hosts. These are inconclusive network observations, not evidence of a Vela outage or a successful deployment. GitHub reports the previous production run39185429552 succeeded; this change has not deployed. The website bridge has no callable browser tool or personal-account credential in this session.

New app labels have draft Traditional Chinese translations; no native-language or counsel review is claimed. Consent UI and stored evidence still need the onboarding integration above.

## Combined testing candidate

The approved integration includes the full See It First introduction/questions/first-week preview, explicit app privacy permission, account-bound setup drafts and portrait cleanup. New users can see the preview before sign-in. The production pilot still connects an existing approved Telegram family; preview answers do not overwrite that family. Existing signed-in testers can open You → Settings → Preview family setup. No public admission, parent-app, billing or provider switch is enabled.

App permission is fingerprinted from the canonical shared English text and recorded with a server timestamp in the account row; current-version status is returned as a boolean only. Older clients remain compatible in the closed pilot. This is an organiser’s own permission and does not invent parent or health consent. Account deletion clears the app permission. Full public enforcement/withdrawal and provider agreement/counsel gates remain outside this testing release.

Local root check passed all nine packages, including new permission/replay/deletion and draft/account/portrait lifecycle tests. The complete demo wizard, explicit permission and completion passed a browser journey with six 320/390/430 light/dark layout cases and no runtime errors. The hosted Maestro onboarding flow is an introduction/private-setup smoke; its unsupported Tab action was removed. Full wizard evidence is the separate browser journey, not a claim that Maestro walked every question.

The production preflight is run through the protected environment with the founder’s explicit upload authorisation recorded in the review comment. Do not change protection rules. Publish/submission waits for the final CI, migration/deploy checks and exact source identity.
