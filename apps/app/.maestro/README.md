# The app's Maestro flows

Each flow is a list of steps a person would take, written the way the screen says them. Maestro
(maestro.dev) taps and reads the app as a person would, and fails at the first step whose words are
not on the screen. Build plan 3.9.

## `demo/`: the example family, no account

`today`, `ask`, `reply`, `quiet-notice`, `sunday`, `nearby` and `parent` walk the app built with no API and no sign-in, the demo
that shows an example family's day. The quiet notice is reached through `/?example=quiet`,
which only the demo answers. They run in Chrome on every push (CI job `app-flows`) and need nothing
secret. On this machine, with the demo served on port 8082 (`vela-app-demo` in the launch
configuration, or `pnpm --filter @vela/app e2e:serve`):

```bash
pnpm --filter @vela/app e2e:demo
```

## `signed-in/`: a real account against staging

`onboarding` signs up a new account with one of Clerk's test addresses (`…+clerk_test@example.com`,
answered with the code 424242 by Clerk's development instance, which never sends an email), sets up
a kept-light member called Grandma Test, and reaches Today. It needs a phone build of the app, the
`e2e` profile in `eas.json` (an iPhone simulator build, or the Android APK), installed on a
simulator or emulator:

```bash
maestro test apps/app/.maestro/signed-in
```

Each run leaves one test account and one test family on staging, whose invite nobody answers, so
nothing is ever sent to anyone. Asking, replying and the quiet notice need a kept-light member who
has said yes on Telegram, which no flow can do; the demo flows walk their screens and the services'
tests hold what they do.

## Words, not ids

The flows find things by their English words, so a change of copy in `src/i18n/locales/en.po` can
break a flow: `pnpm --filter @vela/app e2e:demo` says which step.
