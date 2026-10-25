# Draft: privacy-notice lines for paying for Vela Light

Status: **draft for the founder and counsel**, 25 October 2026. Not in the live notice. Purchases stay off in production (the server's `REVENUECAT_WEBHOOK_AUTH` is unset, and the pilot server never sells) until a notice version with these lines is approved and published.

What the code sends and keeps, so the wording can be checked against it:

| Who | Receives | Never receives |
|---|---|---|
| Apple (App Store) | The purchase, the payer's Apple account, payment card and billing details (Apple's own records, under Apple's privacy policy) | Anything a family wrote or said |
| RevenueCat (United States) | A random account identifier for the payer (the sign-in id, not a name or email); the parent's internal member number; what was bought, when, the price, currency and renewal state; device and app version details its software reports | Names, emails, phone numbers, answers, voice, photos, health words |
| Vela's database (Singapore) | On the parent's plan row: paid / cancelled / payment problem / ended, the period end, monthly or yearly, price and currency, Apple's transaction number, and which organiser paid | Card details (Vela never sees them) |

## 1. New row in "Who sees it" (the providers table)

| Provider | What for | What it receives | Where |
|---|---|---|---|
| RevenueCat | Records App Store purchases of Vela Light and tells Vela whether a plan is paid | A random account identifier, the parent's internal member number, what was bought and when, price, currency and renewal state, device and app version. No names, emails or family content | United States |

## 2. New section, after "The thirty days"

### Paying for Vela Light

Vela Light is bought in the app, through Apple. Apple takes the payment and keeps your card and billing details under its own privacy policy; Vela never sees them. RevenueCat, a company in the United States, records the purchase for us and tells our server whether the plan for your parent is paid, cancelled, has a payment problem or has ended. It knows you only by a random account number and your parent only by an internal number: never your names, your email, or anything your family has written or said.

We keep the plan's state, its end date, the price and currency you paid, Apple's transaction number and who paid, for as long as the plan runs and then **[as long as tax and accounting law requires — counsel to set the period]**. Deleting your account does not delete these records while the law requires them; it removes your name from them.

You cancel through your Apple account settings; Vela cannot cancel or refund an Apple purchase for you.

## 3. Change to "Your data is used in…"

Add after the AI providers sentence: "Purchase records are handled by RevenueCat in the United States."

## Questions for counsel

1. Retention period for purchase records under Taiwan tax law (and Singapore, where the database is).
2. Whether the seller of record must be the company (ADR-20), or the founder as an individual Apple developer may sell during an interim period.
3. Whether the consent script needs a line, or the notice alone covers the organiser who pays.
