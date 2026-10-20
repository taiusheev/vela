# Approved Vela website

The founder approved the Kept Light prototype on 20 October 2026 and requested implementation. The homepage now leads with “Stay close to your parent. Even from far away.” It explains the organiser-to-parent exchange immediately, shows everyday family moments, then walks through a garden question, a parent's answer, and a personal follow-up.

The approved flow replaces the previous homepage. It uses the existing Worker, TypeScript HTML renderer, local assets, strict content security policy, bilingual routes, privacy and legal pages, precision page, and protected `/waitlist` endpoint. No family, provider, account, database schema, or app behavior changes are included.

## Composition and interaction

Join waitlist appears in the header, hero, FAQ, and closing section. Enhanced links open an accessible native dialog. Without JavaScript they reach the closing form. Both forms submit URL-encoded email, language, and the existing `website` honeypot. Failures preserve input and allow retry; successful submissions display confirmation. Existing same-origin, input validation, rate limits, and Neon storage stay authoritative.

Four distinct photographs move through the opening gallery. Visitors can pause, select a neighboring photograph, swipe, or navigate with the keyboard. Motion pauses outside the viewport, on hover/focus, when the tab is hidden, and with reduced motion. Without JavaScript the gallery remains scrollable. The product walkthrough supports keyboard tabs, a transcript, replay, and an enlarged screenshot dialog.

Marketing is messenger-neutral. The FAQ describes the broader direction without asserting that every messenger is already supported. There are no customer testimonials or pilot outcome claims.

The layout follows the approved cream, charcoal, amber, and teal design. The complete approved vector lockup replaces a separately typed name. The closing window uses the transparent cream/amber version. Accessibility titles were added to SVG files without changing their geometry.

## Asset provenance

- `site-assets/site/img/story/*.jpg`: four newly generated illustrative candid family scenes, optimized from the approved prototype. They depict a city voice note, balcony tomatoes, breakfast listening, and a family recipe. These are not customer photographs.
- `site-assets/site/img/app-current/*.png`: compiled Expo web captures at 390 × 844 CSS pixels and scale 2, using a synthetic family. The capture source matched main commit `47d872e68a47afc4b4970cc74bd7d551f3b79f80`. The homepage displays Ask and Reply. These demonstrate app UI, not signed-device or messenger delivery evidence.
- `vela-logo.svg`, `vela-logo-white.svg`, `vela-mark-small.svg`, `vela-mark-white.svg`: approved assets from `Brand/2026-10-brand-system/01-logo`, with SVG accessibility metadata only.

The private prototype source and original generation/capture provenance remain outside the repository in `../prototypes/vela-kept-light-2026-10-20`. Existing auxiliary assets remain available for existing pages.

## Verification

Run `pnpm check` and the required PR checks. Local browser checks render the actual Worker page wrapper and CSP at widths 320, 390, 768, and 1440 in both languages. They cover loaded assets, horizontal overflow, photo motion/pause/manual navigation, reduced motion, screen viewer, keyboard tabs, transcript/replay, waitlist validation/failure/retry/success, and native no-script navigation/forms. Successful signup responses are intercepted locally; no real signup is created by browser checks.

Local evidence is saved outside the repo under `../verification-2026-10-20/approved-website/`. Deployment and public-domain checks must be recorded after merge. Main merges deploy staging; production backend tags require separate release approval under the shipping skill.
