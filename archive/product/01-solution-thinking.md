# Thinking about the solution, before building anything

> Partly superseded on 2026-09-12 by `02-app-plan.md`: the founder chose an app for all families where the family, not a service, acts on silence. The paid welfare-check partner and the Vela human on the ladder are dropped. Sections 1–3 and 5 still hold.

2026-09-11. Written from the six research reports. The 30-day plan is paused until we agree on this.

## 1. What the problem actually is

"Peace of mind" is vague. Break the adult child's worry into what it is made of:

| Layer | What the child is actually feeling | Evidence |
|---|---|---|
| The spike | "She didn't pick up." Minutes to hours of rehearsing the worst case, then relief, then nothing learned. | Survey design Q7; r/AgingParents is full of these; France: 98% of alarm calls are reassurance, not emergency |
| The catastrophe | A fall or stroke, and nobody knows for a day, a week. | Japan: 21,856 found 8+ days after death in 2024; 1 in 5 falls is a long lie; mortality 12% if found within an hour, 67% after 72 h |
| The slow slide | Is she eating? Is she sadder? Is she forgetting? Will I notice too late? | Korea: 34.8% of solo elders have no one to call when sick; every ambient-sensor company sells "routine drift" |
| The helplessness | Even if I knew something was wrong, what could I do from 8,000 km? | Elders' own objection to sensors: "we don't know what we'd do if an alert fires"; the products that scaled all bolt a human onto the sensor |
| The guilt | I should call more. I'm not a good daughter. | Japanese families buy "after an accident" (34%); the purchase is often penance |

And the parent's side, which decides whether anything survives contact with reality:

| The parent feels | Evidence |
|---|---|
| I am not a patient. A pendant says I am. | 87% of French families see telecare as a "marker of dependency"; adoption flat at 9% of US 65+ for a decade; 3 of 4 falls happen with the pendant off |
| Don't watch me. | Cameras 37% acceptance, sensors 59%, wearables 81%; Yamato picked a light bulb because "sensors make elderly people feel watched" |
| I don't want to be a burden, but I am lonely. | NUGU's top use is companionship; Hyodol cut depression risk 36%; Snug's elders write "flooded with gratitude" |
| Unknown numbers are spam. | Iamfine's own reviews; inTouch's tester mother: "they are not bothered about phoning me" |

The most important single observation: **the spike is caused by silence being ambiguous.** Today, silence means "could be anything." Every product that gives peace of mind does one thing: it makes silence mean "nothing is wrong, because if something were, you would know." That is the entire value. Detection accuracy, hardware, AI are all just ways of earning the right to say "silence means fine."

## 2. The solution space, honestly

Eight shapes a solution can take. None is new on its own; the question is which combination is right and which parts nobody has put together.

| Shape | The idea | Who does it | Where it breaks |
|---|---|---|---|
| **A. The ritual** | Parent does one small thing daily; missing it is the signal | Snug, Iamfine, Zojirushi kettle, Lions Befrienders IM-OK | Burden on the parent; nagging; a thin signal; free clones |
| **B. The shadow** | Parent does nothing; the home reports (meter, plug, phone, radar) | Kansai Electric, Seoul plugs, Envoy, Vayyar | Hardware dies in B2C; privacy; precision (0.3% true positives in Seoul); Wi-Fi |
| **C. The circle** | Productise the people near the parent: neighbour, cousin, courier, social worker, plus a paid check | Yamato driver visit, Japan Post, Seoul welfare planners, Papa (failed) | Ops-heavy; trust and safety (Papa's 1,200 complaints); needs local partners per country |
| **D. The companion** | An AI the parent talks to daily; the child gets the by-product | CareCall, ElliQ, Meela, Hyodol | "Dystopian" press; parents who won't talk to a machine; all paid deployments are government, none by families |
| **E. The bridge** | The product delivers the family's presence to the parent daily; her response to love is the signal | Famileo (printed family gazette), ViewClix, Chikaku (Docomo TV box), GrandPad | Exists only as hardware or print; WhatsApp does a free, chaotic version; nobody attaches signal semantics or a ladder to it |
| **F. The readiness** | Sold like insurance: a plan, a keyholder, medical notes, one guaranteed welfare check anywhere | Yad Sarah, PERS operators domestically | Nobody offers it cross-border; needs the circle (C) to exist |
| **G. The drift** | Weekly narrative of change: sleep later, replies shorter, voice sadder, fewer steps | Cera (sold to NHS), Envoy insight reports, Howz | Needs a signal stream from A/B/D/E first; medical-adjacent claims; slow to show value |
| **H. The elder's own** | The elder buys "so my kids stop worrying"; dignity as the product | Snug's self-enrolled users | Elders don't pay; no distribution |

The research verdict on each in one line: A works but is thin. B works only with a distribution partner and never for families. C is what actually scales in Asia, always with a government or logistics company behind it. D is accepted by elders when framed as company, rejected when framed as a check. E is the one shape where the parent *wants* the daily touch. F and G are what the child would pay more for, once A or E exists. H is the framing every other shape should borrow.

## 3. What nobody has built

Put E at the centre and hang the others off it:

**The parent receives something worth opening every morning: a voice note from her son, a photo of the grandchild, a question from her daughter. Opening it, or tapping back, is the sign of life. Silence is therefore meaningful, and when it happens a human, not a notification, acts on it. Over weeks, the way she replies tells the family how she is really doing.**

Why this is different from what exists:

1. **The daily thing is love, not a check.** Snug asks the parent to prove she is alive. Famileo sends her a newspaper of her grandchildren. Only one of those gets opened with joy. But Famileo has no idea whether she opened it. We do, and we make that the signal without ever calling it monitoring.
2. **It solves the child's guilt, which no monitoring product touches.** The child does something for the parent daily (20 seconds, prompted, effortless). The relief is not only "she's fine" but "I was there today."
3. **The parent's status is never "detected", it is "expressed".** She taps a heart, sends a voice note, says "хорошо". Dignity intact. No sensor, no camera, no pendant, nothing installed, nothing charged.
4. **Silence gets a ladder with humans on it.** The child assembles the circle at signup: the neighbour, the cousin in the same city, the friend from church. When the morning goes unanswered, the ladder runs: second nudge, then a human at Vela decides, then the circle is asked to knock, then, where we have a partner, a paid welfare check. This is the part people pay for (Snug's paid tier, Yamato's driver), and it is the part that turns "she didn't pick up" from a spike into a procedure.
5. **Drift is read from expression, not sensors.** Reply time creeping later, voice notes getting shorter, "хорошо" replacing sentences, a mention of the knee three days running. That is a richer stream than a motion sensor, and it arrives for free.

The old name fits: *vela* is a candle, and *velar* is to keep vigil. A light left on in the window. The child keeps it lit; the parent's answer is the glow.

## 4. What this is not

- Not a device. The parent needs the phone she has, or a landline (a voice version can come later: she calls a number and hears the family's notes).
- Not a replacement for WhatsApp or Telegram. It rides on them. The family group already exists; we add rhythm, meaning, and a ladder to it.
- Not fall detection. We never claim it. We claim minutes-to-discovery, and we measure it.
- Not a chatbot for the parent. The AI drafts nothing to the parent that pretends to be the child. It may greet, thank, ask one question, and pass things on. The relationship is the family's.
- Not a coordination app. Coordination-only has never been paid for.

## 5. The assumptions this rests on, ranked by how much they would hurt if wrong

1. **A child abroad will do a 20-second daily act for a parent, for months, if it is made effortless.** If not, the signal dies with the child's attention. Counter-evidence: every family group goes quiet. Mitigation: the product carries the rhythm (prompts, queued content, grandchildren as contributors), and the ritual is symmetric: even on a day the child sends nothing, the parent gets a warm morning from Vela on the family's behalf.
2. **A parent will respond to love daily, and will not feel watched.** Snug and Famileo say yes; the inTouch backlash says framing decides it.
3. **A child will pay $10–20/month for meaningful silence plus a ladder.** Alexa Together at $20 died; Snug's $12.50 with a dispatcher survives; Carefull's $29 moved to banks. We are in the band, but only with the human ladder included.
4. **We can assemble a circle around a parent in Russia/CIS from abroad.** Neighbours and relatives, yes. A paid welfare check partner, unknown. This is the thing to find out early, because it is the moat if it works.
5. **Drift is readable from replies.** Plausible, unproven, not needed for the first version.
6. **Telegram (or WhatsApp) reach among 65–80 parents in our segment is high enough.** We count it in the survey.

## 6. What this changes about the next step

The survey and interviews stay, but they now test these assumptions instead of a generic "would you pay." Specifically the interviews must find out:

- What the child already sends the parent, how often, and why it stops.
- What the parent does with what she receives (opens it? replies? shows the neighbour?).
- Who is physically near the parent that the child would trust to knock on the door. Names, not categories.
- What the last unanswered call felt like and what would have ended it sooner.
- Whether "a morning message from us on your behalf, on days you can't" feels like help or like a lie.

And the probe, when we run one, is not the bot as built. It is a manual version of the bridge: for five families, for two weeks, the founder personally makes sure the parent receives something every morning and the child gets one line back. If that produces relief on one side and warmth on the other, we build the real thing. If it produces awkwardness, we learned it for free.

## 7. Open questions worth arguing about

- Should the parent ever know Vela exists, or should everything appear to come from the family? (Honesty says she knows; the research says framing must be "her kids", not "a service".)
- Is the family group the onboarding surface? Adding a bot to an existing Telegram family group needs no link, no explainer, no new habit. It is the cheapest install imaginable, and nobody does it.
- Grandchildren as the content engine. Famileo's insight is that grandchildren post more than children. A teenager's photo does more than a daughter's text.
- The 80+ parent with no smartphone. A voice line she can call, and a scheduled call she expects, from a number she has saved. Later, but it is the same product.
- What we say when it goes wrong. The first time a parent is found late despite Vela, what is true and what did we promise? Write this before the first customer, not after.
