# Improve the original Vela website

## Design brief

Use the original public site as the foundation. Keep “A little closer, every day”, Literata/Inter typography, warm paper, amber, teal, the arched window, family photographs, the phone demonstrations, the morning story and the illustrated light. Improve the composition and usability without replacing its visual identity or restructuring the whole page.

Refine the header and make the waitlist action visible on a narrow phone. Improve headline spacing, body reading measures, section rhythm and the balance between the hero photograph and phone. Keep the parent's face visible. Reduce heavy shadows, floating decoration and unnecessary perpetual movement. Preserve the existing images and their illustration disclosures.

Keep the rich product walkthrough, while reducing excessive gaps between its moments. Retain the mobile examples. Improve the interactive demo with keyboard-accessible reset, announced messages, clearly labelled simulated content, cancellation during transitions and an honest answered-day state. Show conversation examples before scripts load. The hero plays one morning, with explicit pause/continue/replay, rather than looping forever. Respect reduced motion.

Retain the English/Traditional Chinese pages, legal/precision links, plan information and no published price. Keep the protected same-origin waitlist backend and no-script submission. Failure must preserve the email and permit retry. Keep the first-family invitation consistent with the planned Vietnam Telegram pilot. Do not invent testimonials or claim completed pilot results.

The stack remains TypeScript-generated HTML, local CSS and progressive JavaScript on the existing Cloudflare Worker. Keep the original favicon and sharing image.

## Verification

Run the existing root `pnpm check` and browser checks at 320, 390, 768 and 1440 pixels in both languages. Inspect the photo composition and mobile header. Cover all demo branches, next-morning read-back, cancellation/reset, hero pause/replay, no-script examples, FAQ and waitlist failure/validation/retry. Successful waitlist responses are intercepted locally: no real signup is created.

The local preview at `http://localhost:8773` renders the real page source without connecting to a provider. Its waitlist endpoint intentionally rejects saves. Review artifacts live outside the repository under `../verification-2026-10-14/website/`.

Main merge/deployment remains held by the existing production release reservation in `../AGENT-CLAIMS.md`.
