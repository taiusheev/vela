# Vela Light price for Taiwan

Decided 24 October 2026 (founder: "calculate the price based on the business analysis"). The app shows these prices on the Vela Light screen to a phone whose region is Taiwan (`apps/app/src/data/plans.ts`). Once purchases go through the App Store, Apple's own price in the reader's store currency replaces the table.

## The price

| Plan | Price | Per month | Note |
|---|---|---|---|
| Yearly (shown first, marked "Best value") | **NT$2,490** | NT$208 | saves 28% against 12 monthly payments |
| Monthly | **NT$290** | NT$290 | stop any time |
| Each extra parent | +50% | | NT$1,250 a year or NT$150 a month, on Apple's nearest price points |

The 30 days before the first payment stay free and need no card, as they do today.

## Why this number

**What a Taiwan family already pays each month** (public prices, 2025–2026): Spotify NT$168, LINE Premium NT$165, YouTube Premium NT$199, Netflix NT$270–460. A paid alarm-button service for an older parent in Hong Kong costs HK$115–138 a month (about NT$470–560). In the US, Life360 Gold is US$99.99 a year and Snug US$19.99 a month.

**Who pays and what for.** The buyer is the adult child, usually working, often in another city or country. They are paying for a daily sign from a parent who lives alone, not for entertainment. A price a little above a music plan says "care", and stays well under a dedicated alarm service. NT$290 is about US$9, the same as the US$9.99 the pilot asks about on the day-30 call (`plan/execution-plan.md`).

**What Vela keeps** after Apple's 15% (Small Business Program) and Taiwan's 5% VAT, which Apple collects:

| | Monthly NT$290 | Yearly NT$2,490 |
|---|---|---|
| Vela receives | NT$235 a month | NT$2,016 a year (NT$168 a month) |
| Cost to run one parent (estimate) | about NT$30 | about NT$30 |
| Left per month | about NT$205 | about NT$138 (82%) |

The running cost is an estimate per parent per month: about 35 LINE pushes at up to NT$0.2 each (NT$7), the AI that reads answers and writes the weekly read (NT$10–15), and servers and voice (NT$5–8).

**The cheaper option.** NT$1,990 a year / NT$250 a month leaves NT$104 a month on the yearly plan, 25% less. It would need about a third more paying families to earn the same. For a care purchase a 20% lower price rarely moves that many people, and lowering a price later is easy, while raising it is not.

## When to change it

The exit criterion is more than 25% of trial families paying after the 30 days (`plan/execution-plan.md`). After the first 100 Taiwan trial families, if fewer than 25% pay, test NT$1,990 / NT$250 on new families only. If more than 40% pay, test NT$2,990 / NT$350.

## Not done yet

- The App Store products (yearly, monthly, extra parent) must be created in App Store Connect by the account owner.
- The app does not take payment yet: it needs Apple's purchase step, a "Restore purchase" link, and a new iPhone build.
