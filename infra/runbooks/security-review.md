# Weekly repository security review

Engineering reviews the [repository security dashboard](https://github.com/taiusheev/vela/security) every Monday after the 08:15 Taipei security workflow. The checks also run on main and pull requests. A failed scanner or unavailable advisory registry needs investigation; it is not evidence of a clean scan.

## Coverage

- CodeQL scans JavaScript/TypeScript, GitHub Actions and Python using the extended security queries. It requires no application credentials or dependency installation. Native Swift/C codec code is outside this workflow's coverage and still needs the native review/build checks owned by engineering in technical plan 5.2 and 6.5.
- `pnpm audit --audit-level high` checks the committed workspace lockfile, including development dependencies. High/critical advisories and registry errors fail the job. Review lower-severity findings too; a passing job does not mean there are no advisories.
- Dependabot proposes weekly npm/workspace and Actions updates. Compatible npm version updates are grouped; major upgrades remain separate. No update is automatically merged. Preserve the pnpm catalog, supply-chain delay and install-script allowlist; run the existing CI and native checks where an upgrade affects the app.
- GitHub repository secret scanning and push protection are enabled in repository settings, separately from these files. They detect supported secret formats; they do not prove that every credential format is covered. GitHub did not enable non-provider pattern scanning in the 8 October 2026 [settings read-back](../load-tests/repository-security-2026-10-08.json).
- GitHub vulnerability alerts and automated security fixes are enabled. GitHub currently [documents pnpm support through v10](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories), while this repository uses v11 and catalog references. Treat npm Dependabot version and security updates as unverified until its update job successfully resolves this workspace and opens a usable PR; the pnpm audit is the independent advisory check. Do not downgrade the package manager just to make an updater pass.

## Review and response

1. Check the latest security workflow on the current main commit and the Dependabot update job. Fix scanner failures before claiming coverage. Review all open CodeQL, dependency and secret alerts; assign each actionable finding an owner and next action in a content-free repository issue.
2. For any secret alert, never paste the value into an issue, chat, screenshot or evidence file. Follow [secret rotation](secrets-rotation.md) and [incident response](incident.md). Record only the alert identifier, affected provider, rotation status and verification. Never bypass push protection to unblock an ordinary release.
3. Assess dependency and CodeQL findings against reachable production paths, plus build/CI access. Prioritise exploitable high/critical findings before release; preserve the advisory identifier and rationale for any false-positive dismissal. Green tests do not dismiss a vulnerability.
4. Review update PRs and their changed catalogs, lockfiles and action permissions. Require the normal current-head CI, relevant security scans and sequential staging release observation. Recheck advisories after the fix merges.
5. Record the review date, main SHA, scanner run links, counts by severity and outstanding work. Keep these receipts in `infra/load-tests/repository-security-YYYY-MM-DD.json`. Store no source excerpts from secret alerts or family data. The first scan establishes the baseline; enabling a scanner alone does not close technical plan 6.3.

## First baseline: 8 October 2026

The [content-free receipt](../load-tests/repository-security-2026-10-08.json) records 1 critical, 7 high, 11 moderate and 3 low advisories in the active lockfile. The audit fails as intended; an unavailable local registry also exits 1. `braces` and `node-forge` have no patched version in that audit response. Do not suppress these findings or declare 6.3 done. Remediation needs dependency-path assessment, compatible fixes and validation. GitHub dependency alerts currently identify an archived npm lockfile, so they do not establish coverage of the active pnpm workspace.

Secret alerts 1 and 2 were traced to an explicit fake Telegram fixture and a public Svix known-answer test vector and resolved as `used_in_tests`. No operational credential was shown or rotated. No open secret alerts remained at this read-back; that does not establish exhaustive credential coverage.

## Compatible dependency fixes

[PR #45](https://github.com/taiusheev/vela/pull/45) merged affected-range overrides for shell-quote 1.11.0 (GHSA-pqg4-j6r4-53mv), Sharp 0.35.5 (GHSA-rgj7-g3m4-5g8c and GHSA-wq5f-xc86-pv6w), source-map-js 1.2.2 (GHSA-68fv-2mgg-jv7q), and Undici 7.29.1 (including GHSA-rfgv-xxqx-mfg5 and GHSA-w293-vg96-wgc3). Sharp is restricted to the existing Miniflare 0.35 dependency line. Remove an override once all active parent-tool resolutions naturally use a non-vulnerable version and a fresh audit confirms it. Framework versions remain the same.

The post-fix audit is 0 critical, 2 high, 6 moderate and 0 low. The [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) high findings have no published patched version as of 8 October 2026. No exceptions or ignore lists were added; the audit continues to fail on these findings. This preserves the unresolved work and does not close 6.3 or the launch security review.

The first CodeQL PR scan uploaded all three language analyses successfully with zero findings and no upload errors. This is one scan at the recorded merge-ref commit; future integrated commits need their own scan.
