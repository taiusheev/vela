# Modern practical app review — 8 October 2026

Research: [decision report](../../modern-practical-research.md). The implementation makes daily family content more prominent without changing backend consent, delivery, scheduling or retention rules. Research guidance is distinct from measured usability evidence.

## Implemented decisions

| Area | Change | Purpose |
| --- | --- | --- |
| Visual system | Sans-led titles and family words, near-neutral canvas, 20-unit gutters, restrained rounding and sentence-case context | Readable everyday hierarchy and less decorative chrome |
| Today | Filled named Reply immediately after the answer; secondary next-question action; quieter tomorrow surface | Complete today's conversation before planning the next one |
| Exchanges | Named parent/date rows with 2-line question and 3-line answer previews, media and truthful receipts | Scan history quickly; full replies, originals and playback remain in detail |
| Ask | Three compact labeled format tiles, persistent field label, recipient/timing footer, named Send button | Make recipient, content and selected timing understandable together |
| You | Group notifications and language; remove unavailable own-light switch | Practical settings with enabled operations and truthful states |
| Large text | Stack parent states, format choices and settings actions above 1.3 font scale; adaptive tab height | Avoid squeezing names and control meaning |
| Reply recovery | Retry remains primary when a saved attempt exists; new Send becomes secondary | Distinguish recovery of an uncertain request from a new operation |

## Evidence

Synthetic Expo web preview reviewed at 320 × 568 and 390 × 844. Direct walkthroughs covered Today → Ask, explicit Dad targeting, selected timing summary, synthetic send outcome, Today → Reply, synthetic reply visibility, history navigation, settings and language switching. Existing privacy, pause/leave and recovery journeys are retained in the Maestro suite.

Light and dark appearance and Traditional Chinese were visually inspected. Dark review used a temporary local theme override. The 2× typography stress review used temporarily doubled shared text sizes and a matching local font-scale override in the affected layouts; these overrides were restored before final checks. It is a layout stress check, not native Dynamic Type evidence. Images are synthetic fixtures, with no real family content.

Full local `pnpm check` passes: 284 app tests, with one deliberately skipped future translation gate; 46 contrast checks pass. Complete Traditional Chinese catalog checks pass (21 tests, 643 strings; native translation review remains pending). CI and release receipts are recorded in the PR.

## Limits and remaining evidence

This change does not establish measured task-time gains or accessibility certification. Signed iPhone keyboard/safe-area behavior, largest Dynamic Type, VoiceOver focus/announcements, native media permissions and real-family comprehension still require direct checks. No new provider messages were sent during the UI review. The report proposes further optional refinements; this release implements the decisions listed above, not every research suggestion.

## Captures

- [Today](today-390.jpg)
- [History](history-390.jpg)
- [Composer](composer-390.jpg)
- [Narrow timing selection](composer-320.jpg)
- [Chinese Today](today-zh-320.jpg)
- [Dark Chinese Today](today-dark-zh-320.jpg)
- [Enlarged Today](today-2x-type-390.jpg)
- [Enlarged settings](you-2x-type-390.jpg)
- [Reply](reply-390.jpg)
