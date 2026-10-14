# Vela website direction — 14 October 2026

## The brief, adapted to Vela

Rebuild Vela's existing bilingual public website. Vela helps a family keep a small daily exchange going with a parent who lives elsewhere: a question, an answer by tap, voice or photo, family replies, and a read-back the following morning. An answered-day window is a signal of that exchange. An unanswered morning has a calm, human-led next step. The website's job is to explain that experience and invite families to the waitlist.

Make it feel like a thoughtful editorial publication, with the restraint of Scandinavian design. Use warm off-white `#FBF9F5`, charcoal `#121212`, and burnt orange `#D95D39`. A darker orange may be used for small text where contrast requires it. Keep the original arched-window identity, using the new accent. Avoid gradients, neon colors, purple, and generic dark-mode styling.

Use **Instrument Serif** for expressive headlines and **Public Sans** for body copy and controls. Both come from Google Fonts and are hosted locally with their SIL Open Font Licenses. Use tight headline tracking, a clear reading measure, and enough space between ideas. Do not use Inter, Roboto or system-ui. Use Chinese serif/sans glyph fallbacks where the Latin fonts do not contain Traditional Chinese characters.

Start with the human hook **“More than ‘I’m fine.’ A little closer.”** Give the hero one high-contrast primary action: **Join the waitlist**. Ground the opposite side in an illustrative family conversation, composed around Vela's own window mark. Keep the example labelled as an illustration, readable immediately, and visually distinct from a real customer story.

Follow with a recognizable moment: you mean to call your parent, but work runs late and time zones never quite line up. When you finally speak, “Everything okay?” leaves out the little details that make you feel close.

Explain the experience in three numbered, editorial steps, rather than a feature-card grid:

1. Someone in the family writes a small question for the parent's morning. Vela can offer a topic when the family is stuck.
2. The parent answers with a tap, voice note or photo in their messenger.
3. Family replies come back to the parent the following morning, before the next question.

Let visitors try an illustrative exchange: choose a question, choose a simulated answer, see the answered-day window, and see tomorrow's read-back. Never request a microphone or send a real message. Make the demo usable by keyboard, announce its result, allow a reset during a transition, and respect reduced motion. Don't move the page away from answer choices when a visitor picks a question.

Explain the light with a restrained window illustration and factual next steps. Keep the distinction between answered today and an unanswered morning; consent, stop, away mode, nearby contacts and human-controlled outreach remain clear. Keep plan information and the promise that the free exchange continues, without introducing a price before the founder chooses it.

Use honest proof: Vela is preparing its first pilot with the founder's own family in Vietnam on Telegram. Attribute the founder note to Timur. Do not fabricate testimonials, customer counts, ratings, results, or quotes. Do not imply that the pilot is already complete. The existing public precision page remains linked. Explain Telegram as the first pilot surface rather than advertising an already-launched Taiwan LINE experience.

End with a clear waitlist invitation, a few practical questions, and a minimal typographic footer. Preserve the English/Traditional Chinese routes, legal notices, contact link, same-origin waitlist endpoint, optional role, honeypot, server validation, rate limiting, and no-script submission. Failure should keep the email in place and make retry easy.

Use asymmetric columns, precise rules, and expressive type. Avoid generated portraits, corporate stock photography, rounded feature-card stacks, decorative icon grids, floating rotated mockups, marquees, particles, parallax and long scroll reveals. The only animation needed is a short transition for a simulated message and crisp button feedback.

Keep the existing stack: TypeScript-generated semantic HTML, a local CSS file and progressive JavaScript on the Cloudflare Worker. A new framework or hosting service is unnecessary. Test 320, 390, 768 and 1440 pixel widths in both languages, including the privacy and precision pages. Check loaded fonts, all demo branches, keyboard reset, a reset during an unfinished answer, waitlist validation/retry, FAQ expansion, no-script reading, and the existing root checks.

## Implementation

- Landing page: `apps/worker/src/site.ts`.
- Shared document and font preload: `apps/worker/src/html.ts`.
- Presentation and progressive interactions: `apps/worker/site-assets/site/site.css` and `site.js`.
- New fonts and licenses: `apps/worker/site-assets/site/fonts/`.
- Existing backend, waitlist protections, canonical routes and domain bridge retained.
- Founder-pilot wording is based on `plan/materials/trial/vietnam-week.md` and `plan/why-vela.md`, which describe a planned first family week, not completed results.

## Verification and release boundary

The local preview renders the production page functions, scripts, CSS and fonts. Its waitlist endpoint deliberately returns an error; browser tests intercept successful responses without creating real signups. The preview does not connect to a provider or load family content.

Verification receipts and screenshots are kept outside the repository in `../verification-2026-10-14/website/`. Root check and final browser results are recorded with the pull request.

Main merges and deployments remain held by the existing 14 October production release reservation. The redesign can be reviewed locally and in its separate PR without changing that release.
