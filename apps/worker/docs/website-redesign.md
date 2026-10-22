# Approved Vela website

## 22 October: approved Afterglow implementation

Release follow-up: the founder requested copyright and public deployment. Homepage and supporting website footers now show the current UTC year, Vela, and localized all-rights-reserved wording. Auxiliary navigation targets the new `why`/`how` sections rather than removed legacy anchors. Regression tests cover copyright on both homepage languages, website privacy, precision, and generated legal pages. Public publication uses the existing domain bridge from `vela-light.com` to staging; no production backend tag or activation is part of this website release.

The founder selected the refined Afterglow concept from five local alternatives and asked to build it. This replaces the previous homepage, not the app or auxiliary legal pages. The approved sequence is: automatic morning promise → busy adult children and aging parents → interactive hello/reply/quiet routine → memories and weekly read → participation choices → FAQ → existing waitlist.

The dark espresso canvas, amber light, Inter headline with italic emphasis, real Today capture with parent photos, and warm-paper routine chapter follow `../prototypes/vela-five-directions-20261022/afterglow.html`. The implementation is bilingual English/Traditional Chinese. All CSS is scoped to `.approved-home.afterglow`; legal, precision and privacy pages keep their existing layout. The optional morning examples use local copy only, not family/provider calls. Unlike the comparison prototype, the production-source CTAs open the existing waitlist dialog and forms submit to the existing protected `/waitlist` endpoint. No new backend, accounts, billing, analytics, schema, consent or runtime activation is introduced.

The three morning selectors are native buttons with visible selected state, keyboard operation, and a polite live preview. Without JavaScript, the full explanatory step copy, first preview and ordinary waitlist forms remain available. The native dialog restores focus on close. Waitlist failures preserve the email and allow retry; successful submissions keep the confirmation and prevent duplicate re-submission. Optional movement respects reduced motion. There is no autoplay gallery in this selected design.

`site/img/story/parent-profile.jpg` is copied from the existing illustrative app onboarding mother portrait, not a customer photo. Existing Today/Week captures and family photographs retain the provenance described below. They are synthetic English app captures on both language routes, labelled through localized alt text and disclosure; no translated app UI is fabricated. Memory discovery and everyday support suggestions remain clearly in development. Replies are never presented as proof that a parent is awake, healthy, alive or safe.

Implementation checks: website route/waitlist tests, root `pnpm check`, rendered English/Traditional Chinese at 320/390/768/1440px, loaded assets, morning selectors, native dialog focus/close, FAQ, and a six-case isolated waitlist client harness (success, network error, invalid email response, rate limit, server error, malformed response). The harness uses fake responses and makes no network requests. Real waitlist signup, native assistive technology, public deployment and real-family delivery are separate evidence; none is implied by local preview success.

The older composition notes below describe the superseded homepage and are retained as history.

## 22 October: morning reassurance revision, proposed

The founder redirected the homepage toward busy adult children and aging parents: an automatic morning hello when the family has not prepared a message, visible answered-today evidence, and Vela Light's repeat/quiet-notice follow-up. Conversation examples explain how the routine creates family value; they are no longer the main problem statement. Memories and the weekly read deepen the value. Conversational memory discovery and everyday support suggestions are labelled in development; personalized mental/physical health advice and guarantees that somebody is safe, awake or alive are not claimed. See the current product contracts in `product/05-product-spec-v2.md` and `product/06-light-memories-wellbeing.md`.

New `app-current/*-current.jpg` and `today-portraits.jpg` images were captured on 22 October from the actual Expo app in this checkout (app source matches main7e1c0ae; subsequent main changes only affect Metro configuration). The demo uses synthetic family data, no configured API or account, and a 390×844 viewport. Both parent photos were installed using the app's own Parent settings photo chooser. The mother uses the bundled illustrative `assets/onboarding/example-mom.jpg`; the father uses the existing illustrative `story/familiar-voice.jpg`. Today renders those local portraits; other current screens retain their actual component behavior. The images were captured directly from the rendered app, with no painted-on controls or photo edits. Web captures are not signed-iPhone or delivery evidence. Existing October20 Ask/Reply images are superseded on this proposed homepage by the new captures.

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
