# Kept Light family inbox

The founder approved the revised identity prototype on 14 October 2026 after asking for a stronger Vela signature and a less formal interface. Family inbox was the selected visible direction. This implementation uses that entry model, with the same identity rules across the existing app; the five exploration layouts are not five new app modes.

Today keeps each parent’s name, local-day window and current exchange together. It retains parents without an exchange and every exchange returned by the API. A pending arrival has no link to the delivered-exchange reader. Parent ordering follows the API, and an ordinary family exchange without a light is retained without inventing an answer state.

The approved outlined lockup is large enough for the divided window. Amber records an answer on the parent’s local day. Resting, quiet, away and paused remain different shapes with factual text. An answer can coexist with an away or paused choice; an invitation cannot acquire an answered window from stale metadata. The window makes no statement about health or safety.

Inter now carries everyday headings and controls, while Literata carries family words. Answer panels use a restrained amber edge. The Today reply and heart actions have visible labels, accessible recipient names and stable test identifiers. Large text stacks the actions, allows full answer previews and removes the redundant morning subheading; the heart control can use the available width.

The exchange reader keeps the question, original words, media, family replies, and latest-day read-back rules. A reply or heart receipt says accepted rather than claiming provider delivery or that the parent heard it. Draft storage, saved retry bodies, request identities, recipient selection, consent, away recovery, lost-channel guidance and quiet-notice actions retain their existing implementations. Full ask photos, answer photos and family replies remain in exchange detail; Today previews the answer and exposes original-voice playback where available.

## Verification

- `pnpm check`: lint, type checking and all nine package test tasks pass. The app has 314 passing tests and one pre-existing future native-review gate skipped; the new inbox cases cover missing exchanges, multiple recipients, late/current exchange association, pending-resource routing and answer/consent state.
- Exported synthetic app: complete heart, reply, saved draft, parent-switch and ask journeys pass at 320, 390 and 430 pixels in light and dark browser contexts, with no script errors or external requests. Traditional Chinese Today was also rendered; new translations remain drafts pending native-language review.
- Native presentation: the updated synthetic JavaScript runs in a copied, previously audited iOS simulator host. Native dependencies and module sources match that host. The audit has no API or Clerk configuration and automatic updates are disabled. Light, dark and largest-text Today were inspected on an isolated iPhone 17 simulator. This is native presentation evidence, not a new native compilation, touch-journey, VoiceOver, signed-device or provider test. A native deep-link attempt presented an OS confirmation dialog and was excluded from exchange-layout evidence.
- Maestro expectations retain the core journeys, with stable `today-heart-x1` and `today-reply-x1` selectors. CI remains the authoritative run for those journeys and PostgreSQL contention.

The source has not been distributed to a signed iPhone, submitted to a store or tested with a live family. Main merges and deployment follow the active production release reservation in the shared claims file. Captures are in `design/audit/identity-inbox/`; detailed local receipts are outside the repository under `verification-2026-10-14/identity-inbox/`.
