# Public sign-in preparation

Families can continue with Google, Apple, or the existing email code. All methods use Clerk;
Vela does not accept a Google/Apple token directly or create family membership from an email.
An incomplete provider attempt cannot open a session. Cancelling returns to the form.
Logout retains the existing notification removal and session/cache cleanup, then opens sign-in.

## Implementation

- Clerk Expo **2.20.0**, using its installed `useSSO` and `useSignInWithApple` APIs.
  Current online examples often use Clerk Expo 3; do not copy those APIs into this version.
- Google uses the system authentication browser, not an embedded WebView.
- Apple uses the native system sheet and official Apple button on supported iOS devices;
  web and Android use Clerk's browser Apple connection.
- Return destination is fixed: `velalight://sign-in` on a native build, or the app origin's
  `/sign-in` on web. The web popup completes there using `maybeCompleteAuthSession`.
  The signed-out guard already allows this route. No arbitrary return URL is accepted.
- Both methods preserve the existing onboarding destination and explicit privacy acceptance.
- One in-flight lock covers email and social attempts. Leaving the screen prevents a late
  provider result from activating a session. MFA/missing signup requirements show recovery
  guidance rather than treating a partially verified user as signed in.
- `EXPO_PUBLIC_GOOGLE_SIGN_IN=on` and `EXPO_PUBLIC_APPLE_SIGN_IN=on` expose the buttons.
  They default off. Configure and test each environment before enabling it.

## Account-owner setup

Use the Vela application in [Clerk Dashboard](https://dashboard.clerk.com/), first its development
instance, then repeat the configuration in production. Public build variables never contain secrets.

1. **Google:** User & authentication → SSO connections (or Social connections) → Add connection →
   Google. Enable sign-up/sign-in. For production, create a Web application OAuth client in
   [Google Cloud Console](https://console.cloud.google.com/auth/clients), with External audience,
   Vela branding, support contact, homepage and privacy link. Copy the authorized redirect URI
   shown by Clerk exactly into Google's client. Paste its client ID and secret directly into
   Clerk; never into chat, a repo file or an `EXPO_PUBLIC_` variable. Publish the consent screen
   for the intended public audience; a testing-only audience is not public readiness.
2. **Apple native:** In [Apple Developer](https://developer.apple.com/account/resources/identifiers/list),
   select App IDs → `family.vela.light` → Sign in with Apple, enable and save. In Clerk's Native
   applications section, enable the Native API and register that bundle ID and the Apple Team ID.
   Enable the Apple connection for sign-up/sign-in in the matching Clerk instance.
3. **Apple web/Android:** Follow the Apple connection's setup for a Services ID, primary App ID,
   domains/return URL, Team ID and signing key. Paste the private key directly into Clerk.
   Register Clerk's email sender in Apple's private email relay, so email fallback works with
   Hide My Email. Keep the key in the company password manager and track any rotation requirement.
4. **Redirects:** Clerk → Native applications → Redirect URLs: allowlist `velalight://sign-in`.
   For a web deployment, register the exact app origin and `/sign-in` return location using
   Clerk's redirect/origin settings. The marketing website is not automatically an app deployment.
5. Engineering enables the two public build variables for the verified environment, builds a
   **new signed iOS binary**, and confirms the `com.apple.developer.applesignin` entitlement
   and installed redirect scheme. This change adds native dependencies and must not be shipped
   solely as an OTA to an old binary.

Clerk links accounts according to its verified identity policy. Do not merge Vela accounts by
matching email in application code. Apple's hidden relay address can create a different identity;
existing users must verify the same account/family after adding another method. Do not manually
move family membership to compensate for a different identity.

## Release evidence required

Local automated checks do not prove provider credentials, public Google consent eligibility,
Apple signing, provider email delivery, or real-device accessibility.

Before either public switch is enabled, record results with synthetic accounts:

- New and returning Google users; cancelled/denied consent; popup blocked; offline and retry.
- Native Apple sign-in and cancellation on a signed iPhone; Share My Email and Hide My Email;
  returning sign-in when Apple no longer supplies a name/email; browser Apple flow if shipped.
- Existing email account → Google → same Clerk user and Vela family; no second family appears.
- Missing signup requirements/MFA: recovery is visible, no unverified session enters Vela.
- Email code, resend cooldown, wrong/expired code and onboarding-draft recovery still work.
- Logout, restart, then login as another synthetic account: old family content/drafts/photos/audio
  are unavailable and notifications no longer target the signed-out phone. Exercise provider
  sign-out failure and retry as well.
- Light/dark, narrow screens, keyboard, large text and VoiceOver on the signed app.
- Review new Traditional Chinese entries with a native Taiwanese reader; they are draft translations.

## Primary references

- [Clerk Google connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [Clerk Apple connection and email relay](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple)
- [Clerk production redirects](https://clerk.com/docs/guides/development/deployment/production)
- [Expo Apple Authentication and build configuration](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)

Implementation checks and live-provider evidence are reported separately in the pull request.
