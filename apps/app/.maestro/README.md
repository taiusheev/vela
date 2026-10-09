# The app's Maestro flows

Each flow is a list of steps a person would take, written the way the screen says them. Maestro
(maestro.dev) taps and reads the app as a person would, and fails at the first step whose words are
not on the screen. Build plan 3.9.

## `demo/`: the example family, no account

The twelve flows `today`, `ask`, `reply`, `recipient-and-reply`, `quiet-notice`, `sunday`, `story-day`, `nearby` and
`privacy-and-help`, `customer-recovery`, `weekly-recipient` and `morning-settings` walk the app built with explicit `EXPO_PUBLIC_DEMO_MODE=true`, no API and no
sign-in. A development build alone does not activate fixtures. The quiet notice is reached through
`/?example=quiet`, which only the demo answers. They run in Chrome on every push (CI job
`app-flows`) and need nothing secret. On this machine, with the demo served on port 8082 (`vela-app-demo` in the launch
configuration, or `pnpm --filter @vela/app e2e:serve`):

```bash
pnpm --filter @vela/app e2e:demo
```

The ask checks that English words are sent as written, with no fabricated translation preview.
The recipient flow switches between parents without losing the written draft, resets vote state,
and opens a reply straight from Today.
The recovery flow confirms and cancels pause/leave, rejects unknown parent links and explains demo sign-in.
The weekly recipient flow chooses Dad, then Mom, without keeping the former parent's story draft.
Story questions can be chosen and edited without promising long-term saving or offering an
unavailable book. The quiet sheet offers ordinary contact guidance without a saved permitted calling
number, while fine/wait resolutions still work. `privacy-and-help` checks consent/help copy and the
absence of unavailable parent-phone setup; it replaces the former `parent` demo flow. These twelve
flows prove synthetic web interactions only, not Telegram delivery, account linking, signed-device
audio or parent-app functionality. If local environment flags change, restart with a cleared Metro
cache before interpreting a result.

The runner targets a 430×2400 window so the longer You page reaches Pause/Leave without relying
on Maestro's outer-window scrolling. The morning-settings flow targets the input by its
accessibility id, so the visible label is not mistaken for the editable field. Headless Chrome
can enforce a minimum width and subtract
browser chrome from that requested size; CI screenshot dimensions are not phone-size proof.
Review normal 320/390 pt phone viewports independently; the app's own scroll view works there.

## `signed-in/`: a real account against staging

The trial flows use an already signed-in **synthetic** staging account and a native build made with
`trial-staging` (signed iPhone) or `trial-simulator` (iOS simulator). Both are fixed English,
iPhone-only builds against staging development authentication; `trial` remains production-only.
Check the backend declares pilot/Telegram-first/English capabilities before running them:

```bash
maestro test apps/app/.maestro/signed-in/trial-link-entry.yaml
maestro test -e TEST_PARENT_NAME="Synthetic parent" apps/app/.maestro/signed-in/trial-current-family.yaml
```

`trial-link-entry` requires an unlinked account; it checks the real challenge UI and resets its unused
challenge. `trial-current-family` requires an already linked approved family; its label must match the
synthetic fixture. These are separate account states, not a directory-wide batch. No private proof
code, bearer token or participant name goes in test arguments. Complete linking privately and run
the full exchange/media/device script in `plan/staging-test-script.md`. These native flows are prepared;
they have not been run on a signed iPhone and are not CI's twelve web demo flows.

`onboarding` remains the older **non-pilot** app-first flow: it signs up a new account with one of Clerk's test addresses (`…+clerk_test@example.com`,
answered with the code 424242 by Clerk's development instance, which never sends an email), sets up
a kept-light member called Grandma Test, and reaches Today. It needs a phone build of the app, the
`e2e` profile in `eas.json` (an iPhone simulator build, or the Android APK), installed on a
simulator or emulator:

```bash
maestro test apps/app/.maestro/signed-in/onboarding.yaml
```

It is not the English trial's acceptance flow: pilot admission denies app-first family creation.
The trial requires an approved existing Telegram family, session-bound organiser/contributor
linking and the full signed-iPhone/Telegram exchange in `plan/english-trial-readiness.md`.

Each run leaves one test account and one test family on staging, whose invite nobody answers, so
nothing is ever sent to anyone. Asking, replying and the quiet notice need a kept-light member who
has said yes on Telegram, which no flow can do; the demo flows walk their screens and the services'
tests hold what they do.

## Deferred parent and tablet verification

The parent app and kitchen-table/tablet mode remain future-release gates. Before enabling them,
replace the retired parent demo with dedicated native flows and device evidence for device-bound
authorisation, large readable mornings, answer buttons and thanks, voice/photo permissions and
failures, background/resume and landscape/tablet accessibility. The English pilot's
`privacy-and-help` absence checks do not close any of those gates.

## Words, not ids

The flows find things by their English words, so a change of copy in `src/i18n/locales/en.po` can
break a flow: `pnpm --filter @vela/app e2e:demo` says which step.


## Product-week iPhone audit

See `../docs/product-week-audit.md` for the screen inventory, measured-tap template and current setup limits.
Run `pnpm --filter @vela/app audit:doctor`, then `pnpm --filter @vela/app audit:ios` for the explicit no-account Expo Go demo. The separate `audit-simulator` EAS profile prepares a custom native demo build on the `audit` update channel. Neither reuses staging credentials. These commands/profile are prepared; no native journey has passed yet. Web demo receipts do not close X1 or X8.
