# ikigai Launchpad Fall 2026 application: paste-ready answers

v3, 2026-09-11. Direction: Vela is an app for any family with a parent who lives alone. It makes the daily interaction richer and effortless; the parent's response is the sign of life; the family, not a service, acts when it goes quiet. No Vela staff on the ladder, no partners, no hardware. Sections marked [YOU] need your real details.

---

## 1b. Company name and one-liner

**Vela.** Vela keeps a light on for parents who live alone: one daily touch from their family, and the family knows the moment it goes quiet.

## 1c. Website or app

Pre-launch. Research, product spec, and a working Telegram prototype are in our repository (github.com/taiusheev/vela). [YOU: make the repo public before submitting, or write "available on request".]

## 2a. Problem and solution

**Problem.** Around 50 million people over 65 live alone in the ten richest ageing societies, and the number grows every year: Japan will have 9 million solo elderly households by 2040, a quarter of Korean seniors already live alone, Taiwan became super-aged in 2025. Behind each of them is an adult child, across town or across the world, who carries the same daily, unspoken anxiety: "she didn't pick up." In Japan, 76,020 people died alone at home in 2024; 21,856 were found more than a week later. One in five falls becomes a "long lie" of over an hour, which roughly doubles mortality.

Every existing answer fails one side of the family. Medical-alert pendants say "you are a patient" and stay in the drawer: three of four falls happen with the pendant off, and adoption has sat at 9% of US seniors for a decade. Cameras and sensors say "we are watching you" and are refused. AI check-in calls read as spam, and Korean elders call them "mechanical care." The free alternative, the family chat group, goes quiet within weeks and tells you nothing when it does.

**Solution.** Vela turns monitoring into presence. Every morning the parent receives one thing worth opening from her family, inside the messenger she already uses: a voice note from her son, a grandchild's photo, a question from her daughter. Vela carries the rhythm: it prompts the right relative at the right time, lets grandchildren contribute in seconds, and turns the family's scattered moments into one daily arrival. The parent installs nothing; she replies with a tap, a heart, or a voice note. That reply is the sign of life. Silence therefore means something, and when it happens, the family knows within hours, not days, and sees the two people they named at signup, the neighbour and the relative nearby, one tap away. Over weeks, how she replies tells the family how she really is: later replies, shorter voice notes, the knee mentioned three days running.

## 2b. How you arrived at the idea

[YOU: adjust to your real situation.] I live in Taipei; my parents live alone thousands of kilometres away. Every unanswered call starts the same spiral, and I learned that the friend two streets away from her own mother feels exactly the same thing. I went looking for what families use and found an industry built for the parent as a patient, not for the child who worries and pays. The insight came from reading hundreds of reviews and studies: the only products elders love are the ones that arrive as attention, not as a check. A French company mails grandparents a printed newspaper of their grandchildren and has 260,000 paying families; a Japanese kettle emails the children when it's used. Nobody had combined "love as the daily touch" with "silence as the signal." So I designed it.

## 2c. Target audience

Adult children, 30–55, with a parent aged 65–85 who lives alone. Distance doesn't matter; the worry is the same across town and across the world. Where we start: Russian-speaking families, because I am one and can reach them, with the sharpest pain among the 600,000-plus who emigrated since 2022 and whose parents stayed. Then Taiwan, where I live and which became super-aged in 2025, and the large diasporas with the same family shape: the Philippines (2.2 million overseas workers), India (18.5 million abroad), Ukraine, Latin America. The buyer is the child; siblings and grandchildren contribute; the parent never pays or installs anything.

## 2d. Competitors

Medical alert (Life Alert, Medical Guardian, Lively/Best Buy, Tunstall, Careium): $25–50/month, 24/7 call centres, 16 million users across Europe and North America, but a stigmatised pendant with 18% all-day wear and flat adoption. Passive sensors (Aloe Care, Envoy, Vayyar, Nobi): solve non-wear but cost $40–100/month plus hardware; a dozen consumer brands have died, the survivors sell to care facilities. AI check-in calls (Naver CareCall, ElliQ, inTouch, AloneAssist): cheap and scalable, but parents screen unknown numbers, families call it "dystopian," and no B2C player has published retention. Family-presence products (Famileo, GrandPad, Skylight, Aura): parents love them and families pay $10–60/month, but they are print or hardware and have no idea whether grandma opened anything. Free incumbent: the family messenger group, which goes quiet and means nothing when it does. Vela is the only one that makes the daily touch something the parent wants, reads her reply as the signal, and tells the family the moment it stops, with nothing to install.

## 3a. Current development stage

Idea validated on paper, prototype built, pre-launch. In the first day we completed a 500-source study of how every super-aged country handles this (US, Japan, Korea, China, Europe, Israel, Australia), wrote the product spec, and built a working Telegram prototype (Cloudflare Workers, Claude) that onboards a child, delivers the morning message to the parent, reads her replies, and alerts the family on silence. Next: 30 customer interviews and a two-week manual pilot with five families before deploying anything.

## 3b. Traction

None yet, and I won't dress it up. What exists: the research, the spec, the prototype, survey and interview materials in Russian, English, and Chinese, and a 30-day validation plan with kill criteria (fewer than 4 paying families after 20 interviews, or more than 30% of parents refusing, and we change the idea). Target for the next 30 days: 100 survey responses, 20 interviews, 10 families paying $15 for the pilot month.

## 3c. Business model

Family plan paid by the child: $10–15 per month, inside the band families already pay for this feeling (Famileo £6–18, ViewClix $9.95, Snug's alert tier $19.99, Docomo's parent-TV service ¥1,980). One subscription covers the whole family: siblings and grandchildren contribute free, the second parent is free. The paid reason is not messaging, which converts at 1% in apps like Marco Polo and Locket, but meaningful silence and the weekly "how mom really is" read. Growth: about 8 relatives per family become contributors and each is a referral (Aura gets half its sales from family invites), so the product spreads inside families and communities before we spend on ads. Channels after that: telcos and remittance apps that already bill this customer monthly and have precedent for care add-ons, and, later, insurers in Germany, the UK, and Japan who reimburse about €25/month for exactly this outcome, where Vela's published precision lets a software-only product in. Unit economics: no hardware, no staff on the ladder, near-zero marginal cost, so acquisition must stay under $60 per family.

## 3d. How we use AI

AI is the product's nervous system, not its face. A language model reads each parent's replies in her own language and dialect to summarise how she is for the family, flags anything a caring child would want to know now (pain, a fall, hopelessness, a "bank" call), and, over weeks, notices drift in tone, length, and timing that no sensor can see. It prompts the right relative at the right moment ("your niece hasn't sent anything in a week, and grandma asked about her"), drafts a warm morning on the family's behalf on days nobody sends anything, and keeps the family's messages authentic by never pretending to be them. Multilingual models make the same product work in Russian, Mandarin, Tagalog, or Hindi from day one. And the company itself is built with AI: my technical co-founder is Claude, which produced the market study, the spec, and the prototype in one day.

## 4a. Team

Solo founder, business background, based in Taipei, fluent in Russian and English, learning Chinese, full-time on Vela. I am the customer: a child with a parent alone at home. Technical work is done with Claude as an AI co-founder (research, product, code), which is how a one-person team shipped a working prototype and a 500-source study in a day. I intend to add a human technical co-founder from the batch or the network, and I need mentors who have built daily-habit consumer products, which is why ikigai.

## 4b. Intro video (60 seconds, one take, look at the lens)

"Hi, I'm [name], founder of Vela. I live in Taipei. My parents live alone, [distance] away. When they don't pick up, I go through the same spiral every child of a parent who lives alone knows. There are 50 million such parents in the richest ageing countries, and a worried child behind each one. Every product for this treats the parent as a patient: a pendant, a camera, a robot call. They refuse it, and I don't blame them. Vela does the opposite. Every morning my mother gets one thing from us worth opening: a voice note, a photo of her grandson. Her reply is the sign that she's fine. If she goes quiet, we know within hours, not days, and we know exactly who to call. Nothing to install, nothing to wear, nothing to charge. I've done the research, built the prototype, and I'm starting interviews this week. I'm applying because I need people who've built things people open every day. Thank you."

## 5a. How you discovered ikigai Launchpad

[YOU]

## 5b. Why you want to join

Three reasons. Taipei: I'm here, and Taiwan became a super-aged society in 2025, so my second market is outside the office door. The mentors: Vela lives or dies on whether a busy child does a 20-second thing every day for months and a parent opens it with joy; that is a consumer-habit problem, and the founders behind Twitch and Guitar Hero have solved it at scale. The money: $100k covers the 30-day validation, the first 500 families, and a human technical co-founder.

## 5c. If this idea fails, what else

If the daily touch doesn't hold, I'd keep the customer and change the product: the same child, the same parent, but the job becomes "help me understand how my parent is really doing," a weekly read of her voice, mood, and routine from the conversations the family already has, sold to the child and, in Germany, the UK, and Japan, to the insurers who already reimburse this outcome. Same family, different promise.
