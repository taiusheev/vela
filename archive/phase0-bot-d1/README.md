# Vela pilot bot

A Telegram bot that says good morning to a parent, and tells the child "she's fine". Runs on Cloudflare Workers (free tier), stores data in Cloudflare D1 (free tier), talks through Claude. Behaviour is specified in [`../product/bot-spec.md`](../product/bot-spec.md).

## What you (the founder) need to do once

Four accounts, about 20 minutes. None of them cost money at pilot scale.

1. **Telegram bot.** Open Telegram, talk to `@BotFather`, send `/newbot`, pick a display name ("Vela") and a username ending in `bot` (e.g. `VelaCareBot`). Copy the token it gives you. Then send `/setdescription` and paste: "Каждое утро желаю доброго утра вашим родителям и сообщаю вам, что всё хорошо." Also `/setuserpic` with a warm, simple image.
2. **Cloudflare account** at dash.cloudflare.com (free). No card needed for Workers and D1 free tiers.
3. **Anthropic API key** at console.anthropic.com. Add $10 of credit; the pilot will use less than that.
4. **Your Telegram chat id.** After the bot is deployed, send it `/whoami`. It replies with a number. That is `ADMIN_CHAT_ID`.

Hand me the bot token, the API key, and the chat id through a secure channel (not in the repo, not in chat history if you can avoid it; `wrangler secret put` reads them from your terminal). I do the rest.

## Deploy (I run these; listed for transparency)

```bash
cd bot
npm install
npx wrangler login                      # opens the browser once
npm run db:create                       # prints a database_id; paste it into wrangler.toml
npm run db:migrate                      # creates the tables
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_CHAT_ID
npm run deploy                          # prints the worker URL
```

Then open `https://<worker-url>/register?secret=<TELEGRAM_WEBHOOK_SECRET>` once in a browser. Telegram now sends every message to the worker. The scheduler runs every 15 minutes on its own.

## How a family gets started

1. The child opens the bot, taps Start, answers five questions (their name, the parent's name, how to address the parent, where the parent lives, wake-up time, and where the child lives).
2. The bot gives the child a link. The child forwards it to the parent with the [parent explainer](../plan/materials/parent-explainer-ru.md).
3. The parent taps the link and then "Понятно". From the next morning, the loop runs.

## Commands

| Who | Command | Effect |
|---|---|---|
| Child | any text | Passed to the parent with tomorrow's greeting |
| Child | `/status` | Where things stand today, plus the parent link if not yet joined |
| Child | `/pause`, `/resume` | Stop and restart the mornings |
| Child | `/delete` | Erase the family entirely |
| Parent | «Всё хорошо» button, or any text or voice note | Counts as today's sign of life |
| Parent | "не надо" / "stop" | Pauses; the child and the founder are told |
| Founder | `/families` | One line per family with today's status |
| Founder | `/digest` | Today's counts |
| Founder | card buttons | Decide what reaches the child when a parent is quiet |

## The daily ladder (parent's local time)

| When | What |
|---|---|
| wake + 0:30 | Morning greeting with the button, plus any message from the child |
| parent replies | Sign of life recorded; child gets the green note (never between 23:00 and 07:00 child time) |
| wake + 2:30, silent | Gentle nudge |
| wake + 5:30, silent | Founder card: "Написать дочери / Подождать 2 ч / Всё в порядке" |
| founder taps notify | Child gets the yellow note |

The AI reply has a hard cap of four turns per day, then a fixed sign-off. Anything a caring adult child would want to know now (pain, a fall, hopelessness, a "bank" call) puts a 🚩 card in the founder chat immediately, with the parent's words.

## Costs

Cloudflare Workers free tier: 100k requests/day. D1 free tier: 5M reads/day. Both are far above pilot scale. Claude: a typical parent day is under 3k tokens; 15 families for 30 days is a few dollars. The model is `claude-opus-5`; refusal fallbacks are enabled so a declined message is retried on a fallback model automatically rather than leaving the parent unanswered.

## Not yet

Voice notes are acknowledged but not transcribed. WhatsApp is not supported. There is no payment inside the bot. The optional smart plug from the spec is not wired in for v1.
