import { Page, S, h, li } from "./lib.mjs";

export function research() {
  const pages = [];

  // 2.1 Landscape
  {
    const p = new Page("2.1 · How the world solves it today");
    let y = p.title("Eight approaches, and where each stalls", "Condensed from research/00-SYNTHESIS.md. Full player tables in research/01–07.");
    y = p.table(40, y, [{ w: 170, title: "Approach" }, { w: 330, title: "Who, and scale" }, { w: 330, title: "What works" }, { w: 330, title: "Where it fails" }, { w: 160, title: "Verdict" }], [
      ["Emergency pendants (PERS, telecare, Hausnotruf)", "Life Alert, Medical Guardian (600k+), Lifeline (900k+), Tunstall, Careium (500k); 16.2M users EU+NA; €3.9B Europe", "24/7 human response in 14–60 s; reimbursement codes (Germany €25.50/mo; UK councils; Spain 934k public users)", "Stigma; 18% wear all day; 3 of 4 falls with it off; US adoption 9% for a decade; billing and cancellation the top complaint; no cross-border reach", "Owns the 2% emergency job, fails the 98% reassurance job"],
      ["Consumer wearables", "Apple Watch (most-cited “medical alert” in US surveys), Pixel Watch, Galaxy Watch", "No stigma, no fee, fall detection auto-on at 65+, Check In", "18-h battery charged during night-time falls; 911-first (“call my daughter, not 911”); ~35% of Apple 911 calls unfounded in one county; no remote setup; useless with dementia", "Great for the tech-comfortable 65–75; no caregiver layer"],
      ["Passive home sensors", "Aloe Care, Envoy ($99/mo), People Power, Vayyar (radar), Nobi (€35M), Inspiren ($155M), Sensi ($98M)", "Solves non-wear; elder acceptance 59% for ambient sensors; investors fund it for facilities", "Ten dead consumer brands (Lively, BeClose, Cherry Home, Hex, EchoCare, Tellus…); $40–100/mo + hardware; cameras toxic; nobody publishes precision", "Technology is fine; standalone consumer hardware never worked"],
      ["Zero-install utility signals", "Zojirushi kettle (14k contracts since 2001), Yamato bulb + driver (~9k, ¥1,078), Japan Post visit, Kansai Electric meter (free), Shanghai water meters (9,113 homes), Seoul plugs (4k+)", "Zero install, no Wi-Fi, no smartphone, culturally accepted, distributed by a trusted utility", "30-minute resolution; “no activity for 24 h” is the only alert; country-locked; no child-facing layer; ~45 fragmented Japanese services", "Right philosophy, wrong ceiling"],
      ["AI voice check-in calls", "Naver CareCall (30–50k users, 128+ municipalities, 96% answer rate, 44% fewer solitary deaths in served areas), SKT NUGU (17k), ElliQ ($85M, ~3k units), inTouch €29.90, AloneAssist $14.99, Nonni A$40", "Cheapest thing that ever scaled; companionship framing reduces depression; voice AI cost collapsed", "Every deployment with numbers is paid by a government or operator; parents screen unknown numbers; “dystopian” press; CareCall missed “maybe I should just die”; no B2C retention published", "The call is a signal and a relationship, not a product"],
      ["Check-in apps", "Snug (30M check-ins, ~5–10k daily actives, $12.50–19.99 dispatch tier), Iamfine ($14.99), Enrich LINE bot (8.9k users, only 26% over 65)", "Elders self-enrol and love it; the paid tier with a human check is what people praise", "Tiny; nagging; free clones; bare pings attract the young; Alexa Together at $19.99 with Amazon's distribution was cancelled", "Proof that elders accept a self-controlled daily ritual"],
      [{ label: "Family-presence products", style: S.tdGreen }, "Famileo (260k paying families, €14M 2024, ~8 relatives per family), GrandPad ($299 + $40–59/mo), Aura (half of sales from family invites), Docomo Chikaku (¥1,980/mo), Storyworth (1M+ books)", "Parents love them; grandchildren post most; buyer ≠ user works; institutional channels (care homes, telco shops)", "Print or hardware; no idea whether grandma opened it; no signal semantics; no ladder", "The one shape where the parent wants the daily touch"],
      ["Family social networks", "Path, Cocoon, 23snaps (dead); Marco Polo (~$10M/yr after 9 iterations), Locket (80M downloads, 100k payers), BeReal (68% open within 3 min of the push)", "Small circles; one synchronous daily prompt gets extraordinary open rates", "Die against the family group chat; messaging converts ~1% to paid; novelty decays without a reason", "Borrow the one-moment mechanic; never be a messenger"],
    ]);
    pages.push(p);
  }

  // 2.2 Regional findings
  {
    const p = new Page("2.2 · Findings by region");
    let y = p.title("What each market taught us", "From research/01 (US), 04 (Europe, ANZ, Israel), 03 (East Asia).");
    y = p.table(40, y, [{ w: 150, title: "Market" }, { w: 380, title: "Who pays, how it's sold" }, { w: 400, title: "Numbers that matter" }, { w: 390, title: "Lesson for Vela" }], [
      ["United States", "DTC PERS at $25–50/mo; Medicaid waivers; Medicare Advantage supplemental (fragile: plans cutting benefits); retail (Best Buy/Lively, $800M acquisition, $475M impairment)", "9% adoption flat; buyer intent 22% (children) vs 9% (seniors); children choose the device in only 11% of purchases; ~$700M of PERS M&A in 18 months", "The child has the intent and no product; consolidation means incumbents won't innovate"],
      ["Germany", "Pflegekasse reimburses exactly €25.50/mo for anyone with Pflegegrad 1+ living alone; ~95% via five welfare associations", "~1.2M users; ~15% of 75+; startups (Patronus, Helfi-Ruf, Gisela) are private-pay outside the code", "A software-only product with published precision could enter the reimbursement code"],
      ["United Kingdom", "Councils tender to Tunstall/Careium/Appello; 30–50% already private-pay; “private-pay pathways” as austerity bites", "1.7–2M users; ~36% of 75+ (highest in Europe); PSTN switch-off Jan 2027 forces re-tendering; two deaths in 2023 from analogue failure", "A forced replacement cycle in 2027; councils are rethinking"],
      ["Spain · France · Nordics", "ES: 934k publicly funded, user pays €0–12/mo; FR: >900k, 50% tax credit, 10–12% of 75+; SE: municipal entitlement, ~215k alarms, 97% stationary", "Median user: a woman 80+; annual attrition ~15–25% (death, care home); FR growth 2–3%/yr", "Pre-dependency 70–80 is unserved everywhere; the 80+ woman is the incumbents' only customer"],
      ["Japan", "Adult child buys; ~45 services; utilities bundle for retention (Kansai free, Chubu ¥550, au ¥539); Secom ¥3,300–5,170 + ¥48–195k setup", "Home watch-over market ¥26.2bn (2020) → ¥38.1bn (2030), consumer segment only ¥5.2bn; usage ~4% of households with a separately-living elder; 34% adopt after an accident; 31% “don't understand the offerings”; wanted price ¥1–2k/mo", "Awareness and a family-facing layer are the gaps, not sensors; framing as “appropriate distance”"],
      ["Korea", "The state pays; welfare-targeted (300k households on 응급안전안심); telco CSR (SKT, KT); Naver CareCall as municipal SaaS", "CareCall 96% answer, ~90% satisfaction; Seoul plugs: 46,974 signals → 154 interventions (0.3%); Hyodol 12k dolls, −35.7% depression risk", "Companionship framing works; municipal staff absorb alert noise; precision is the unsolved problem"],
      ["China · Singapore · HK · Taiwan", "Community (社区) is the response layer; Shanghai water meters 9,113 homes in a year; HDB alert system 26.8k seniors; SCHSA Safety Bell 30 years; Taipei free systems for registered solitary elders", "9073 model (90% home); consent forms explicitly collected; middle-income elders underserved everywhere", "Piggyback on infrastructure; pair detection with a human response; the family is the emergency contact"],
      ["Israel · Australia · NZ", "IL: welfare-funded floor (Yad Sarah ~20k) + B2B hardware exporters (Essence, Vayyar); AU: Support at Home AT-HM scheme from Nov 2025; NZ: accredited suppliers price-capped NZ$13–15/wk", "Israeli tech sells to operators, not families; AU ring-fences alarm funding; NZ consolidated to 5 firms", "Registered-provider lists are a channel once precision is proven"],
    ]);
    pages.push(p);
  }

  // 2.3 Family-bridge benchmarks
  {
    const p = new Page("2.3 · Family-bridge benchmarks");
    let y = p.title("Products where a family sends presence to a grandparent", "From research/07. These are our closest relatives; the lessons are direct.");
    y = p.table(40, y, [{ w: 140, title: "Product" }, { w: 230, title: "What it is" }, { w: 180, title: "Price" }, { w: 330, title: "Traction" }, { w: 440, title: "Lesson" }], [
      [{ label: "Famileo (FR)", style: S.tdGreen }, "App → printed family gazette mailed to the grandparent; B2B via care homes", "£5.99–17.99/mo", "260k subscribed families; ~2M MAU (~8 per family); €14M revenue 2024, profitable; 2,700 partner care homes", "Buyer ≠ user design; physical proof of love beats a feed; founding insight: grandma was excluded from the family WhatsApp"],
      ["GrandPad (US)", "Locked-down LTE tablet with a curated family circle", "$299 + $40–59/mo", "Long-running; reviewers: “too darn expensive”", "Price ceiling for hardware + service ~$40–60; closed circle blocks scams"],
      ["Aura (US)", "Premium frame, invite-only family network", "$229, no subscription", "6M app users; 784M photos in 2024; half of sales from family-invite networks", "Virality runs through the contributors, not the recipient"],
      ["Docomo Chikaku (JP)", "Box that puts the family's videos on the parent's TV; presence sensor; “assurance mode”", "¥1,980/mo incl. data", "Sold in every Docomo shop since 2024; ¥1.5B raised incl. Aflac Ventures; “3× in a year”", "Warm content + passive presence is our thesis at ~$13/mo; telco and insurer channel"],
      ["Storyworth (US)", "Weekly email question → hardcover memoir; child buys, parent answers by email reply", "$59–199/yr", "1M+ books, 35M stories, bootstrapped since 2013", "Gift-purchase model; one prompt a week via a channel the parent already uses; the parent is the author"],
      ["Marco Polo (US)", "Async video messaging for small circles", "$5–10/mo", "56M installs; profitable only in 2024 after 9 iterations; ~$10M/yr", "Pure family messaging has a low ceiling; sell peace of mind, not messaging"],
      ["Locket (US)", "Photo straight to friends' home-screen widget", "Gold ~$4/mo", "80M downloads, 9M DAU, 100k paying (~1%)", "Zero-effort receive; tiny circle; ~1% pay"],
      ["BeReal", "One daily notification, two-minute window", "free", "Core users: 68% open within 3 min; 72% daily engagement", "One fixed daily moment gets extraordinary open rates; decays without a reason"],
      ["Snug Safety (US)", "Daily “I'm OK” tap; misses alert contacts", "free; Dispatch $19.99/mo", "20–30M check-ins; elders self-enrol", "The paid tier is exactly the ladder; validates the top of our price range"],
      ["Enrich (JP)", "LINE bot sends “OK?” every 1–3 days", "free", "8,918 users; only 26% are 65+", "A bare ping attracts the young; the sign of life must ride on content the elder wants"],
      ["Kinsome (US)", "Kids ↔ grandparent via email/SMS, AI conversation starters", "free; $4.99 planned", "early", "Recipient needs no app; AI prompts are reusable"],
    ]);
    y += 20;
    p.box(40, y, 640, 150, h("Five things to borrow", li([
      "Buyer ≠ user, and the recipient needs no app (Storyworth, Kinsome, Enrich, Famileo)",
      "One fixed daily moment, not a feed (BeReal, Storyworth)",
      "Contributor virality as the growth engine (Aura, Famileo)",
      "Price the escalation and the read, not the messaging (Snug, Chikaku)",
      "Institutional and channel distribution over ads (Famileo care homes, Docomo shops, remittance apps)",
    ])), S.cardGreen);
    p.box(720, y, 640, 150, h("Five things to avoid", li([
      "Hardware (GrandPad, Skylight, Konnekt, Zojirushi: 14k in 23 years)",
      "Bare check-in pings (Enrich)",
      "A mechanical care voice (Korean elders' “기계적 돌봄”)",
      "Freemium messaging hoping for conversion (Marco Polo, Locket)",
      "Single-channel dependence in Russia (WhatsApp blocked, Telegram throttled, MAX state-run)",
    ])), S.cardRed);
    pages.push(p);
  }

  // 2.4 Ten truths + competitive matrix
  {
    const p = new Page("2.4 · Ten truths and positioning");
    let y = p.title("Ten truths that hold in every country, and where Vela sits", "The truths decide the design; the matrix is the pitch slide.");
    const truths = [
      "01 The buyer is not the user. The child pays; the parent tolerates. Products for the parent fail on compliance; products for the child fail on dignity.",
      "02 Two jobs, not one. Emergency (2%) and daily reassurance (98%). Amazon bundled them at $20 and cancelled; PERS sells only the first; the second has no owner.",
      "03 Zero-install wins; hardware-first dies. Every scaled product rode something already in the home.",
      "04 Silence needs a plan, not a notification. “We don't know what we'd do if an alert fires.”",
      "05 Precision is unsolved. 0.3% true positives in Seoul; ~80% of bed alarms false; nobody publishes. We will.",
      "06 Willingness to pay is $10–35/month everywhere: Germany €25.50, Japan ¥1–2k wanted, US $14.99–40.",
      "07 LTV is capped at 2–4 years by the eldest's trajectory; the relationship must outlive one person.",
      "08 The 70–80 pre-dependency segment is unserved and insulted by everything on offer.",
      "09 Distribution is the moat: utilities, telcos, post, councils, remittance apps. Payer channels are fragile (Papa lost ~36 contracts after one article).",
      "10 Content from family gets opened with joy; pings get ignored. Famileo and Storyworth vs Enrich and Iamfine.",
    ];
    const g = p.grid(truths, { cols: 2, x: 40, y, w: 650, h: 52, gx: 20, gy: 8, style: S.cardGrey });
    y = g.bottom + 12;
    y = p.h2(y, "Positioning matrix");
    const Y = { label: "✓", style: S.tdGreen }, N = { label: "✗", style: S.tdAmber }, P = "partial";
    p.table(40, y, [{ w: 300, title: "Capability" }, { w: 150, title: "Pendant" }, { w: 150, title: "Sensor kit" }, { w: 150, title: "AI call" }, { w: 150, title: "Camera" }, { w: 150, title: "Utility" }, { w: 270, title: "Vela" }], [
      ["Works if the parent won't wear anything", N, Y, Y, Y, Y, { label: "✓", style: S.tdGreen }],
      ["Zero hardware to start", N, N, Y, N, Y, { label: "✓", style: S.tdGreen }],
      ["Sees a bad day, not just a fall", N, P, P, Y, N, { label: "✓ from her own words", style: S.tdGreen }],
      ["Dignity, no stigma", N, Y, { label: "✗ spam", style: S.tdAmber }, { label: "✗✗", style: S.tdAmber }, Y, { label: "✓ elder-controlled; she sees what the family sees", style: S.tdGreen }],
      ["Silence has a plan", Y, P, "rare", N, P, { label: "✓ family acts; nearby contacts one tap away", style: S.tdGreen }],
      ["Precision published", N, N, N, N, N, { label: "✓ monthly", style: S.tdGreen }],
      ["Cross-border, multilingual", N, N, P, Y, N, { label: "✓ core", style: S.tdGreen }],
      ["Makes the family closer, not just informed", N, N, N, N, N, { label: "✓ turns, grandchildren, translation, story day", style: S.tdGreen }],
      ["Price to family, per month", "$25–50", "$40–100", "$15–40", "$0–45", "$0–25", { label: "free + $9.99 Light", style: S.tdGreen }],
    ]);
    pages.push(p);
  }

  return pages;
}
