# ikigai Launchpad Fall 2026 application: paste-ready answers

Written 2026-09-11 in the last half hour before the deadline. Everything factual comes from `research/`. Sections marked [YOU] need your real details; do not submit placeholders.

---

## 1b. Company name and one-liner

**Vela.** Vela keeps a light on for parents who live alone: a daily touch from their family abroad, and a real person who knocks on the door when it goes quiet.

## 1c. Website or app

Pre-launch. Research, product spec, and a working Telegram prototype are in our repository (github.com/taiusheev/vela). [YOU: make the repo public before submitting, or write "available on request".]

## 2a. Problem and solution

**Problem.** Around 50 million people over 65 live alone in the ten richest ageing societies, and 300 million people live outside the country they were born in. Where those two groups overlap is a daily, unspoken anxiety: a daughter in Taipei whose mother in Irkutsk didn't pick up the phone. In Japan, 76,020 people died alone at home in 2024; 21,856 were found more than a week later. One in five falls becomes a "long lie" of over an hour, which roughly doubles mortality.

Every existing answer fails one side of the family. Medical-alert pendants say "you are a patient" and stay in the drawer: three of four falls happen with the pendant off, adoption has sat at 9% of US seniors for a decade. Cameras and sensors say "we are watching you" and are refused. AI check-in calls read as spam and every scaled deployment is paid by a government, not a family.

**Solution.** Vela flips monitoring into presence. Every morning the parent receives something worth opening from her family, on the Telegram or WhatsApp she already uses: a voice note from her son, a grandchild's photo, a question from her daughter. Vela carries the rhythm so the family never goes quiet, and on days the child sends nothing, Vela sends a warm morning on the family's behalf. The parent's tap or reply is the sign of life. Silence therefore means something, and when it happens a human acts: a nudge, then a person at Vela, then the circle the child named at signup (the neighbour, the cousin in the same city), then a paid local welfare check. Over weeks, how she replies tells the family how she really is: later replies, shorter voice notes, the knee mentioned three days running. Nothing is installed, worn, or charged.

## 2b. How you arrived at the idea

[YOU: adjust to your real situation.] I live in Taipei; my parents live alone thousands of kilometres away, in a place where no elder-care technology exists. Every unanswered call starts the same spiral. I went looking for what other families use and found an industry built for the parent as a patient, not for the child who worries and pays. The insight that became Vela came from reading hundreds of reviews and studies: the only products elders love are the ones that arrive as attention, not as a check. A French company sends grandparents a printed newspaper of their grandchildren; a Japanese kettle emails the children when it's used. Nobody had combined "love as the daily touch" with "silence as the signal" and "a human on the ladder." So I designed it.

## 2c. Target audience

Adult children, 30–50, living abroad, with a parent aged 65–85 who lives alone back home. First segment: the million-plus Russian speakers who emigrated since 2022 (Georgia, Serbia, Kazakhstan, Turkey, Cyprus, Thailand, Taiwan, Germany, Israel), whose parents stayed and who pay in hard currency. I am this customer. Second segment: the same shape in the Philippines (2 million overseas workers), India (18 million emigrants), Ukraine, Latin America, and Taiwan itself, which became super-aged in 2025. The buyer is the child; the parent is the beneficiary and never pays or installs anything.

## 2d. Competitors

Medical alert (Life Alert, Medical Guardian, Lively/Best Buy, Tunstall, Careium): $25–50/month, 24/7 call centres, 16 million users across Europe and North America, but a stigmatised pendant with 18% all-day wear, flat adoption, and no cross-border reach. Passive sensors (Aloe Care, Envoy, Vayyar, Nobi): solve non-wear but cost $40–100/month plus hardware; a dozen consumer brands have died, the survivors sell to care facilities. AI check-in calls (Naver CareCall, ElliQ, inTouch, AloneAssist): cheap and scalable, but parents screen unknown numbers, families call it "dystopian," and no B2C player has published retention. Family-presence products (Famileo, GrandPad, Skylight): parents love them, but they are hardware or print, cost $10–60/month, and have no idea whether grandma opened anything. Free incumbent: the WhatsApp family group, which goes quiet and has no ladder. Vela is the only one that makes the daily touch something the parent wants, reads silence as the signal, and puts humans on the escalation ladder, across borders, with nothing to install.

## 3a. Current development stage

Idea validated on paper, prototype built, pre-launch. In the first day we completed a 500-source study of how every super-aged country handles this (US, Japan, Korea, China, Europe, Israel, Australia), wrote the product spec, and built a working Telegram prototype (Cloudflare Workers, Claude) that onboards a child, greets the parent each morning, reads replies, and escalates to a human. Next: 30 customer interviews and a two-week manual pilot with five families before deploying anything.

## 3b. Traction

None yet, and I won't dress it up. What exists: the research, the spec, the prototype, survey and interview materials in Russian, English, and Chinese, and a 30-day validation plan with kill criteria (fewer than 4 paying families after 20 interviews, or more than 30% of parents refusing, and we change the idea). Target for the next 30 days: 100 survey responses, 20 interviews, 10 families paying $15 for the pilot month.

## 3c. Business model

Family plan paid by the child abroad: $12–19 per month (the global willingness-to-pay band is $10–35; Germany's insurers reimburse exactly €25.50, Japanese families want ¥1–2k, US apps sit at $14.99). Siblings share one plan; grandchildren contribute free; the second parent is free. Human escalation is included because that is what people pay for. Add-on: paid local welfare checks through partners (delivery, postal, security, home-care agencies), the model Yamato and Japan Post run domestically in Japan. Channels: diaspora communities first, then remittance apps and telcos who already bill this exact customer monthly, then reimbursement codes in Germany, UK, Australia, and Japan where Vela's proven precision lets it enter public tenders as the first software-only provider. Unit economics: no hardware, near-zero marginal cost, a 2–4 year customer life, so acquisition must be under $60 per family; word of mouth inside diaspora communities is the plan.

## 3d. How we use AI

AI is the product's nervous system, not its face. A language model reads each parent's replies in her own language and dialect to summarise how she is for the child, to flag anything a caring child would want to know now (pain, a fall, hopelessness, a "bank" call), and, over weeks, to notice drift in tone, length, and timing that no sensor can see. It drafts the family's morning message on days the child is silent, and it keeps the escalation ladder honest by presenting a human with the facts before anything reaches the child. Multilingual voice AI makes the same product work for a Filipino nurse in Taipei and a Russian engineer in Tbilisi. And the company itself is built with AI: my technical co-founder is Claude, which produced the market study, the spec, and the prototype in one day, and will run the daily operations of the pilot with me.

## 4a. Team

Solo founder, business background, based in Taipei, fluent in Russian and English, learning Chinese, full-time on Vela. I am the customer: a child abroad with a parent alone at home. Technical work is done with Claude as an AI co-founder (research, product, code, operations), which is how a one-person team shipped a working prototype and a 500-source study in a day. I intend to add a human technical co-founder from the batch or the network, and I need mentors who have built daily-habit consumer products, which is why ikigai.

## 4b. Intro video (60 seconds, record on your phone, one take, look at the lens)

"Hi, I'm [name], founder of Vela. I live in Taipei. My parents live alone, [distance] away. When they don't pick up, I go through the same spiral every child abroad knows. There are 300 million of us, and 50 million parents living alone in the richest ageing countries. Every product for this treats the parent as a patient: a pendant, a camera, a robot call. They refuse it, and I don't blame them. Vela does the opposite. Every morning my mother gets something from us worth opening: a voice note, a photo of her grandson. Her reply is the sign that she's fine. If she goes quiet, a real person acts: first us, then the neighbour we named, then a paid check. Nothing to install, nothing to wear. I've done the research, built the prototype, and I'm starting interviews this week. I'm applying because I need people who've built products people open every day. Thank you."

## 5a. How you discovered ikigai Launchpad

[YOU]

## 5b. Why you want to join

Three reasons. Taipei: I'm here, and Taiwan became a super-aged society in 2025, so my second market is outside the office door. The mentors: Vela lives or dies on whether a busy child does a 20-second thing every day for months and a parent opens it with joy; that is a consumer-habit problem, and the founders behind Twitch and Guitar Hero have solved it at scale. The money: $100k covers the 30-day validation, the first 200 families, and the first local welfare-check partnership in one CIS city, which is the moat.

## 5c. If this idea fails, what else

If the daily touch doesn't hold, I'd build the ladder alone: a cross-border welfare-check network for diaspora families, sold like insurance. The research is unambiguous that the scarcest thing for a child abroad is not information but hands near the parent, and no one offers that across borders. It's the same customer, the same partners, and the same phone number in the parent's contacts.
