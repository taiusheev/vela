# Settings and registration follow-up — 18 October 2026

Founder feedback on build 6: share a parent's link again after setup, move photo controls out of Today, and improve registration. Follow-up: Settings belongs inside **You**.

## Navigation and appearance

- Keep the You tab. It shows the selected family and a Settings entry.
- You → Settings contains the existing family, morning preferences, nearby contacts, notification, language, privacy, pause/leave, sign-out and account-deletion controls.
- Each parent's photo-and-link entry opens Parent settings. Add/change/remove portrait controls are only here; Today keeps the portrait and the answer-driven window light.
- Recovery links open Settings directly; morning/away/nearby and calling-number help name the new location. Unknown parents remain blocked instead of falling back to another person.
- Portrait files remain private, local to this device/session and scoped to family/member. The existing sign-out cleanup and late-picker rejection remain in force. No upload service or permission was added.

## Sharing a parent link

`POST /v1/families/:familyId/members/:memberId/parent-link` accepts `{}` with the existing authenticated session, idempotency key, session-activity check, write limits and no-store response policy.

The service checks current organiser access and locks/rechecks the target parent before preparing or replaying a response. A valid unused invite is reused. An expired invite is replaced for the same member, without another family or parent. An already-used invitation or active/paused parent returns their existing messenger's chat URL. Declined/deleted or departed parents cannot be recreated by this route. LINE uses the configured bot when applicable.

Preparing a link makes no outbound job, gives no consent, and does not activate a light. The organiser previews the link and explicitly opens the platform share sheet. Cancellation is not reported as delivery. Selectable link text is a sharing fallback. Retry retains the same request key; Refresh uses a new key and immediately prepares the current link. An expired displayed invitation must be refreshed before sharing.

## Registration

Email sign-in/registration shares a two-step presentation, clear verification progress, keyboard-aware scrolling and local email validation. No new account is created for a failed existing-account login unless Clerk explicitly reports an unknown identifier. Code failures distinguish expiry, rate limiting and connectivity from an incorrect code; support diagnostics contain bounded machine codes, never provider messages or identifiers. Resend cooldown and change-email recovery remain.

The English pilot still connects an approved existing Telegram family; this change does not open unrestricted self-service family creation. The setup screen waits for the account read before deciding whether provisioning is needed, explains which Telegram account to use, and presents a clear handoff/code step. A whole Telegram message can be pasted; exactly one complete case-sensitive code is extracted. Failed completion keeps the input for retry, and editing clears an obsolete refusal. Expired challenges can be replaced. Your parent uses their own chat and does not register in the organiser app.

Existing PR #107's diagnostic and pasted-message fixes are incorporated with original commit attribution.

## Verification and release boundary

Local root `pnpm check` passes all nine tasks, including the full app, service and Worker suites. New service tests cover invite reuse/expiry, idempotent retries, consent preservation, existing chats, role/family isolation and authorization after target deletion. Worker tests cover the private route and refused requests. Input/recovery tests cover malformed email, copied codes and bounded diagnostics.

The new Maestro demo flow covers You → Settings → Parent settings and absence of photo controls on Today. Running browser checks cover photo selection/removal and light/dark layouts at 320/390/430; a separate actual setup UI run uses synthetic API responses for start failure, retry, pasted-message normalization, rejected completion and success. These do not establish Clerk OTP delivery, Telegram delivery, physical signed-iPhone operation, VoiceOver or real-family consent.

The new API must be deployed before distributing an app that depends on repeat sharing. Staging/CI and production approval/soak are separate gates. A signed trial build uses the production target only after the matching production API is available; no OTA feature release to older binaries.
