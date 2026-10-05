# Over-the-air update policy

Architecture §10, §16 ("EAS Update for JS-only fixes under a written OTA policy: bug fixes, copy, layout; never features or entitlements outside review") · applies from sprint 3, when the Expo app exists; sprints 1 and 2 have no app

## When to use it

Shipping a JavaScript-only change to installed copies of the Vela app with EAS Update, without a new store build.

## What may ship over the air

An update may ship over the air only if **every** answer is yes. Copy this table into the pull request and answer it.

| Question | Must be |
|---|---|
| Does it fix a bug, a crash, copy, a translation, or layout? | Yes |
| Does it leave features and screens as they are (nothing new, nothing removed)? | Yes |
| Does it leave what data is collected, where it is sent and who sees it unchanged (store privacy labels, the privacy notice, the data map)? | Yes |
| Does it leave permissions, entitlements, native modules and the runtime version unchanged? | Yes |
| Does it leave the meaning of consent text unchanged (P1, the nearby-contact flow)? | Yes |
| Does it leave notifications unchanged: one a day, the time-sensitive quiet notice, no badges? | Yes |
| Does it leave Vela Light gating, trials and payments unchanged? | Yes |
| On the parent surface, does it keep 22 pt body, 64 pt targets (88 pt primary) and 7:1 contrast? | Yes |

Anything else needs a store build and review: new features, permission prompts (including the microphone text), SDK upgrades, widget changes (native targets), payments, and any change of consent meaning, which also needs a new consent version (`plan/materials/pilot/README.md`).

## Setup (once, in sprint 3)

- `runtimeVersion` uses the **fingerprint** policy, so an update can only reach builds with identical native code.
- Channels: `development`, `preview` (TestFlight and Play internal testing), `production`.
- Updates are checked on launch with a fallback timeout of 0, so a slow network never holds up a screen; the update applies at the next launch.

## Steps

1. **Classify** with the table above, in the pull request. Any "no" stops here: use a store build.
2. **Pull request green,** including the Maestro flows (onboarding, ask, reply, quiet notice) and, if parent-surface screens changed, the accessibility checklist at the largest font size.
3. **Publish to preview:** `eas update --channel preview --message "<pull request title>"`. On the founder's preview build, open the app twice (updates apply on the next launch) and walk through family mode and the parent surface, in English and Traditional Chinese.
4. **Choose the moment.** The parent surface may pick up an update when it is opened in the morning, so publish to production only when no family's arrival hour falls in the next 2 hours; during the pilot, the Taiwan afternoon is usually safe.
5. **Publish to production:** `eas update --channel production --message "<pull request title>"`. Once more than about 20 families use the app, use EAS Update's gradual rollout, starting at 10%.
6. **Watch for 24 hours:** adoption in the EAS dashboard; Sentry release health, with crash-free sessions no lower than the previous release; the next morning's answers from parent-surface devices arriving in the admin page.

## Rollback

Republish the previous update group to the `production` channel (`eas update:republish`), or roll back to the update embedded in the store build. Then fix forward through the steps above, and note the rollback in the log.

## How to know it worked

The pull request records the classification; adoption rises in the EAS dashboard; crash-free sessions hold; the next morning's parent-surface answers arrive on time.

## Update log

| Date | Update group | Channel | Classified by | Rollout | Rolled back | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
