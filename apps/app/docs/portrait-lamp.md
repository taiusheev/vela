# Portrait Lamp — approved family home

Founder approved the Portrait Lamp prototype, combining Open House / The Courtyard / Quiet Hours, on 18 October 2026. The final correction keeps both window crossbars visible when the light is off.

Today now selects a parent before showing their portrait, factual answer state, current answer and direct conversation. Each parent's exchanges and tomorrow remain reachable through their selector; quiet notices, away/unreachable notices, delivery status, reply media and retry paths are retained. Stale reads say last confirmed update; a failed initial read never invents an unlit parent. Reading does not affect the light. Its only positive evidence is the existing parent-local-day lit state or an answer received during away/pause. Crossbars remain in every light size and state.

Photos are optional. Initials identify a parent until the organiser selects a photo. The system image picker offers a crop, then re-encodes a 480-pixel JPEG. No portrait endpoint, upload, provider, tracking or new photo-library permission request exists. Native portraits use the app's private cache (excluded from device backups); the operating system can evict cache files, in which case initials remain. They survive ordinary app restarts for the same signed-in session. Web portraits are session-memory only. Keys isolate account/session, family and parent. Remove photo deletes the selected portrait; sign-out and ended-session cleanup delete the session directory. A picker returning after an ended session is rejected. No generated sample people ship in real family profiles.

## Release classification

Use a new native build, not EAS Update. Although the presentation is layout, optional local portrait selection is a new feature, and the photo purpose string now names local portraits. Existing permissions, modules, consent, notifications, gating, payments and server data collection remain unchanged. A new fingerprint runtime prevents accidental delivery to older binaries. TestFlight upload is separate from public App Store review.

## Validation

Root pnpm check; focused tests cover all window states/sizes, local-day answer evidence, initials, parent/account/family isolation, restart, sign-out, late picker rejection, replacement failure and removal. Native-permission introspection checks the new photo purpose text with camera still disabled. Demo web browser checks photo selection, parent switching, two visible unlit crossbars, retained light after reading, send, independent removal and narrow light/dark layout. The new Maestro portrait-lamp flow joins the existing consumer journeys. Real iPhone photo cropping and VoiceOver remain separate device checks, not claims from browser evidence.
