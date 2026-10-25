# What waits for the next iPhone build

Written 25 October 2026, after the launch design review (PRs #192 and the follow-up). Everything else from the review reached phones as over-the-air updates. These items change the native app, so they ship together in one new build. EAS's free iOS builds reset on 1 November.

Order is by value to a Taiwan family at launch.

| # | What families get | What it needs | Who |
|---|---|---|---|
| 1 | **Paying in the app.** The Vela Light screen sells the yearly and monthly plans (NT$2,490 / NT$290, `plan/pricing-taiwan.md`) through Apple, with "Restore purchase" under the plans. | App Store Connect: a subscription group "Vela Light" with three products (yearly, monthly, extra parent), prices on Apple's nearest NT$ points, and the paid-apps agreement signed. In the app: a purchase library (RevenueCat or `expo-iap`; decision below), purchase and restore on `app/vela-light.tsx`, and the server told of the purchase. | Founder: App Store Connect. Claude: app and server. |
| 2 | **A gentle tap when a heart lands, a question is saved, or a message is sent.** | `expo-haptics`; calls on the heart, Send and Save. | Claude |
| 3 | **Mom's window on the home screen and lock screen.** Lit or dark at a glance, without opening the app. | An iOS widget extension (`@bacons/apple-targets` or Expo's widget support), an App Group so the app can hand the widget each parent's state, and a refresh when Today loads. | Claude |
| 4 | **A heart from the notification.** Pressing on "Mom answered" shows her sentence with a Heart button. | A notification category with a Heart action, and the server adding that category to "she answered" pushes. Showing her words on the lock screen must fit the privacy notice first. | Claude; founder confirms the notice |
| 5 | **The phone's own tab bar** (optional). The glass bar of iOS 26 with large-text support built in. Kept flat for now by founder choice, 24 October. | Expo Router native tabs. | Founder decides |

## Before the build

- A device pass in the iPhone simulator at the largest text size and with VoiceOver on: Today, Ask, the chat, Memories, You, the Vela Light screen. This can run now, from the `audit-simulator` profile, without a paid build.
- The privacy consent text still says "The founder can read exchanges to run this private test". The public wording needs the founder and counsel.

## Decision for the founder

**Purchases through RevenueCat or Apple directly?** Recommended: RevenueCat. It is free until US$2,500 a month in revenue, handles receipts, renewals and restore, and shows trial-to-paid conversion, which the pricing plan uses to decide the next price test. Apple directly (`expo-iap`) costs nothing ever, but Claude builds and keeps the receipt checking on the server.
