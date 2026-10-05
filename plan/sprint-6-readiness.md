# Ready to start Sprint 6

5 October 2026. The founder clarified “finish 6.0” as **get Vela ready to start Sprint 6**, rather than finish Sprint 6's results review and launch decision. This checkpoint tracks the existing [build plan](build-plan.md); it does not replace any task or definition of done.

**Status: not ready.** Working code, prepared launchers, and metadata checks do not establish a live product or completed pilot. Engineering owns implementation, preparation, troubleshooting, and coordination. The founders supply private account credentials, business decisions, reviewer sign-offs, and participation by real families.

## Engineering work being closed

| Build task | Required result | Current evidence and remaining work |
|---|---|---|
| 5.7 | Content sealing; restore drill #2; continuous 10× load report | Staging setup and Telegram repair completed. The saved key opened one current and one restored value. The first restored copy matched all ten counts, migration and index metadata, and both sampled file references; both files existed with matching recorded sizes. Recovery took 8h 58m, missing the under-hour target. A second attempt stopped before comparison. Both temporary copies have been deleted. The reduced-input helper is statically checked; a timely live restore, isolated API fixture, continuous load report, and production pre-family drill remain. See [content sealing](../infra/runbooks/content-sealing.md) and [restore log](../infra/runbooks/restore-drill.md). |
| 5.2; spec §18 | Record an organiser opening the weekly read that was actually shown | Implemented through a separate authorised mutation, recording identifiers only and excluding demo, locked, loading and background reads. Package typechecks and static review pass; no tests ran, and deployment/phone evidence remain pending. |
| 5.5 | WhatsApp adapter; sandbox loop; approved utility template | Adapter library implementation in progress. No WhatsApp account, template approval, opt-in, or sandbox message loop is verified. Library code alone will not complete this task. |
| 5.1 | Story question bank, family voting, keep/don't keep, book reading, Light-gated PDF export | Book and story-selection code exist. The bank selection now avoids already-listed questions in either language and does not recycle an exhausted list; a custom question remains available. Complete historical no-repeat enforcement, voting, and PDF export still need work. A live Sunday story appearing in the book remains unrecorded. |
| 2.2 | Country-based APAC/EU/US routing | The EU and US database/binding setup and a Germany-family routing proof remain unverified. |
| 2.4 | Complete Traditional Chinese copy approved by a native reviewer | Catalogues exist; reviewer sign-off is still required. |
| 2.5 | Default STT chosen from 30 consented pilot clips, WER table in admin | Real consented clips, measured results, and ADR-14's resulting default decision remain unrecorded. Synthetic fixtures cannot establish this result. |
| 2.6; 4.3; 5.6 | Azure English/Traditional Chinese read-back files, offline device fallback, Japanese playback | Device speech fallback code exists. Server-rendered Azure files and the required real playback proofs remain unverified. |
| 3.7 | Native widget shows the light and updates after an answer | A14 widget is not implemented. |
| 3.8; 3.9 | Push budget shown on an EAS phone build; founder installs from TestFlight | Push code exists but is disabled. EAS, Apple/Firebase account configuration and actual phone evidence remain required; a web demo does not prove these. |
| 4.1–4.4 | Parent surface, audio/read-back, accessibility and 24-hour kitchen-table reliability | Parent and kitchen-table code exist. Two-parent week evidence, offline playback, tablet reliability and signed accessibility review remain required. |
| 4.5 | Voice-line design reviewed, US first | Design exists with founder decisions still pending. Implementation or provider purchase is not required by this task's definition of done. |
| 5.3 | A dated fact becomes a suggested reminder; recipe-card keep flow | Code exists behind the memory setting. Live evidence and production privacy/counsel prerequisites remain pending. |
| 5.4 | Precision page live in app and admin; monthly website publication | App/admin code exists. Live authorised viewing and website publication remain unrecorded. |

## Existing sprint gates

All of these remain part of readiness; they cannot be replaced with generated examples or local code checks.

| Sprint | Evidence needed before it is done |
|---|---|
| 0 | Both environments' accounts and schema; successful deployments and CI; linked runbooks. Production schema/deployment is not verified. |
| 1 | The dogfooding week completes consent, ask → answer → replies → read-back, quiet notice, stop/start, weekly read, admin and watchdog; then three to five eligible Taiwanese families use production. AI-off exceptions are only those already allowed in the plan. |
| 2 | Instrument families migrate with no missed arrival, a LINE family is live, and real-audio evidence selects STT. LINE remains disabled pending account setup and the recorded founder decisions. |
| 3 | Ten families compose asks in the app, answer rate is at least 75%, and push budget is demonstrated on a phone. Production API remains deliberately off under ADR-29 pending its production sign-in prerequisites. |
| 4 | Two parents use the parent surface for a week and each answers at least five of seven days; accessibility is signed off; the specified tablet runs for 24 hours. |
| 5 | Family book and weekly read are live, WhatsApp sandbox sends, precision page is available in the app, and ten Taiwanese LINE families answer. The NT$ pricing test and pricing-page copy are prepared. |

## Order of work

1. Finish the remaining implementation in distinct agent scopes and review each change.
2. Close the staging sealing/recovery/load evidence using the reduced-input private flow.
3. Prepare the provider and device steps with clear founder instructions; complete production setup and its pre-family recovery checks before onboarding.
4. Complete the real device, reviewer and family evidence required by the existing plan.
5. Audit every Sprints 0–5 task and gate against current evidence before claiming Sprint 6 readiness.

Sprint 6's week-12 report, research answers, billing-provider decision, store-readiness checklist and launch decision remain Sprint 6 work. They are not fabricated or pre-emptively marked complete by this checkpoint.
