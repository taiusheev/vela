# UI quality audit — 8 October 2026

Reviewed the app on main `f3b2287`, after the 7 October visual and customer-journey releases. The review uses synthetic family content only.

## Findings and corrections

| Finding | Customer effect | Correction |
|---|---|---|
| Dark primary actions used white labels on pale teal (1.98:1) | The main action is difficult to read | Semantic `onAction` ink, with contrast checks for both appearances |
| Muted dark captions missed 4.5:1 on cards; light captions missed it on secondary fills | Small receipts and helper text lose clarity | Stronger caption inks on all five app text surfaces |
| Nearby names and two actions shared one row | Petro's name broke into one letter per line at 320 px | Full-width identity followed by wrapping actions with 44 px minimum targets |
| The seven-day row wrapped into five days and two stretched days | Calendar columns became hard to follow | Aligned seven/four/two/one-column layouts based on measured width and font scale |
| An unanswered day relied on the light graphic | Assistive technology could not hear the answer state | Localised day/answer-time/no-answer/late descriptions; a visible dash for no time |
| Decorative Sunday artwork squeezed a doubled-size heading | Sunday broke in the middle of the word | Omit decorative heading artwork above 1.3 font scale |
| Quiet-notice actions sat outside the scrolling facts | Large text could push recovery actions beyond the sheet | One scrollable sheet, an explicit 44 px close control, and wrapping contact/feedback actions |
| History promised every older exchange lived in a book | Pilot families could expect unavailable story retention | Explain the thirty-day list; offer the book only when its capability is enabled |
| Input focus changed border width | Text moved when a field received focus | Keep a 2 px border and change its colour |

Shared primary/secondary labels centre and wrap, chips expose selected/disabled states with pressed feedback, page/empty-state titles expose heading roles, and native confirmation containers identify themselves as modal content.

## Verification

- Full `pnpm check` passed across all nine packages. App: 284 tests passed, one intentionally skipped future localisation gate.
- All 46 colour checks passed: normal text is at least 4.5:1 across bg/surface/surface2/lightSoft/actionSoft, primary labels at least 4.5:1, and interactive borders at least 3:1 on page/card grounds. These follow the [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), and do not constitute a whole-app accessibility certification.
- `test:i18n:future` passed all 21 catalogue checks; all four new Traditional Chinese messages are draft translations pending native review.
- Browser review at 320×740 and 390×844: nearby identities/actions and cancellation, weekly alignment and parent switching, history capability copy, quiet wait/confirmation/dismissal, heading/day semantics, and visible keyboard focus.
- Dark appearance was rendered through a temporary local theme override. Double-size text was reviewed through temporary doubling of typography tokens and font-scale layout inputs. All overrides were removed before final source checks. These are visual stress tests, not native system-preference or Dynamic Type evidence.
- The ordinary browser keyboard focus indicator remained visible. Native VoiceOver focus/order, Dynamic Type, iPhone keyboard behaviour and signed-device permissions remain unverified here. Live messenger delivery and a complete real-family week remain distinct product gates.

## Captures

| Capture | Conditions |
|---|---|
| [Nearby](nearby-320.jpg) | Final 320 px contact presentation |
| [Sunday, narrow](sunday-320.jpg) | Aligned four-column reflow |
| [Sunday, ordinary](sunday-390.jpg) | Seven columns |
| [Sunday, Chinese](sunday-zh-TW-320.jpg) | Narrow Traditional Chinese presentation |
| [Today, dark](today-dark-390.jpg) | Temporary dark review override; actual dark palette and controls |
| [Sunday, large text](sunday-large-text-390.jpg) | Temporary 2× text/font-scale stress review |
| [Nearby, large text](nearby-large-text-390.jpg) | Temporary 2× text stress review |

The Expo development preview is `http://localhost:8085/` while its local process is running. It sends no family messages. A signed iPhone build must carry these source changes before native acceptance can be claimed.
