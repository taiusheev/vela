import { Page, S, C, h, li } from "./lib.mjs";

export function plan() {
  const pages = [];

  // 7.1 Roadmap
  {
    const p = new Page("7.1 · Roadmap");
    let y = p.title("Twelve months, four phases, each with an exit test", "Dates assume phase 0 starts 14 September 2026. Each phase ends with a decision, not a date.");
    const x0 = 200, monthW = 90;
    ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"].forEach((m, i) => p.box(x0 + i * monthW, y, monthW, 24, m, `text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=${C.ink3};`));
    const rows = [
      ["Phase 0 · prove the loop", 0, 1, S.bar, "Survey + 20 interviews · pilot 10–20 families, no app", "Decision 12 Oct"],
      ["Phase 1 · MVP", 1, 3, S.bar, "App + Telegram/WhatsApp/LINE · 100 families · pricing test · Stripe", "Exit: conversion > 25%, D30 > 85%"],
      ["Phase 2 · the bridge", 3, 6, S.bar, "Parent surface, kitchen-table mode, grandchildren tools, translation, story day, memory, MAX, Viber · Taiwan on LINE · 1,000 families", "Exit: contributors ≥ 3, family-content > 60%"],
      ["Phase 3 · the read", 6, 12, S.barAmber, "Drift with published precision, voice line, second-member plans · first channel partner · 10,000 families · seed on evidence", "Exit: read trusted and paid"],
    ];
    rows.forEach(([name, m0, m1, st, note, exit], i) => {
      const yy = y + 40 + i * 90;
      p.box(40, yy, 150, 40, "<b>" + name + "</b>", S.small);
      p.box(x0 + m0 * monthW, yy, (m1 - m0) * monthW, 44, note, st);
      p.box(x0 + m1 * monthW - 12, yy + 10, 24, 24, "", S.milestone);
      p.box(x0 + m1 * monthW + 16, yy + 8, 220, 30, exit, S.small);
    });
    y += 410;
    p.table(40, y, [{ w: 170, title: "Phase" }, { w: 560, title: "Ships" }, { w: 130, title: "Families" }, { w: 460, title: "Exit test" }], [
      [{ label: "0 · Prove the loop", style: S.tdGreen }, "No app. Eldest via the Telegram prototype; family in a Telegram group with Vela; each family with an under-30 member; weekly read written by hand", "10–20 paying $15", "Answer rate > 85%; family-content days > 30% by week two; ≥ 4 families paying; parents not refusing"],
      ["1 · MVP", "The app: setup, flames, thread, queue, turns, prompts, quiet notice, away mode, weekly read, Light subscription; Telegram + WhatsApp + LINE adapters; admin view", "100", "Light conversion > 25%; D30 > 85%; answer rate > 85%; members per family ≥ 5"],
      ["2 · The bridge", "Parent surface and kitchen-table mode; grandchildren tools; translation both ways; story day and archive; memory; MAX and Viber; referral loop; Taiwan on LINE; first customer-facing hire", "1,000", "Contributors ≥ 3; family-content days > 60%; 2–4 minutes per day; Sean Ellis > 40%"],
      ["3 · The read", "Drift with published precision; voice/SMS line; second kept-light member plans; first channel partner (telco or remittance app); insurer conversation with precision numbers", "10,000", "The read is trusted and paid; a partner signed or rejected with reasons; a seed round on evidence"],
    ]);
    pages.push(p);
  }

  // 7.2 Phase 0
  {
    const p = new Page("7.2 · Phase 0 · four weeks");
    let y = p.title("Phase 0: prove the loop before building the app", "Founder: interviews, recruiting, ops. Co-founder: materials, prototype, metrics. Ticks live on the master plan page; this is the map.");
    ["Week 1 · survey out, first interviews", "Week 2 · interviews, close pilot families", "Week 3 · pilot live", "Week 4 · measure and decide"].forEach((w, i) => p.box(200 + i * 290, y, 270, 30, "<b>" + w + "</b>", S.sub));
    p.box(40, y + 40, 1320, 300, "FOUNDER", S.lane);
    p.box(40, y + 360, 1320, 300, "CO-FOUNDER (AI)", S.laneAmber);
    const founder = [
      ["Create the Telegram bot, Cloudflare account, Anthropic key (20 min)", "Decide repo visibility", "Post the survey in three places today", "Book 8 interviews", "Show your parent a mock of the arrival; write down her words"],
      ["Interviews 9–16, each ending with the pilot offer ($15, refundable)", "10 families confirmed: eldest + organiser + one under-30", "Collect messengers, wake times, two nearby contacts each"],
      ["Onboard 10–15 families; parent call yourself for the first five", "Daily 15-minute check; log false notices and complaints", "Write the weekly read by hand on Sunday", "Interview anyone who declined or dropped"],
      ["Day-14 check-in: “If Vela stopped tomorrow…”", "Ask each parent: do you like getting this in the morning?", "Two introductions from each paying family", "Decision: build the MVP or change one variable"],
    ];
    const cof = [
      ["Survey intro and posts for the all-families framing", "Prototype: family content in the arrival, quiet notice to the child, away mode", "Landing page with waitlist and two price points", "Weekly review template, decisions log"],
      ["Deploy the prototype; 3-day test with the founder's parent", "Onboarding script (5 min child, 5 min parent)", "Interview synthesis: objections, yes-reasons, prices, wish/worry"],
      ["Run the loop daily; tune quiet times", "Daily metrics: answer rate, latency, family-content days, notices and whether true, opt-outs"],
      ["Phase-0 report and MVP scope cut to what was proven", "Pitch deck v1 from evidence"],
    ];
    founder.forEach((items, i) => p.box(200 + i * 290, y + 70, 270, 260, li(items), S.card));
    cof.forEach((items, i) => p.box(200 + i * 290, y + 390, 270, 260, li(items), S.cardAmber));
    y += 680;
    p.box(40, y, 640, 90, "<b>Kill signals:</b> fewer than 4 families paying after 20 interviews · more than 30% of parents refusing or going silent in week one for reasons other than being away · family-content days under 30% by week two despite prompts", S.cardRed);
    p.box(720, y, 640, 90, h("What the interviews must answer", li(["Who do you wish you heard from more? Who do you worry about when quiet?", "What do you send today, and why does it stop?", "Who near her would you trust to knock? Names, not categories.", "Does “a morning from us on your behalf” feel like help or a lie?"])), S.card);
    pages.push(p);
  }

  // 7.3 Phase 1–3 scope
  {
    const p = new Page("7.3 · Phases 1–3 in detail");
    let y = p.title("What each phase builds, and what it must prove", "Scope is cut from what phase 0 proved; nothing here is sacred except the exit tests.");
    y = p.table(40, y, [{ w: 130, title: "Phase" }, { w: 420, title: "Build (co-founder)" }, { w: 420, title: "Do (founder)" }, { w: 350, title: "Prove" }], [
      [{ label: "1 · MVP · months 2–3", style: S.tdGreen }, "Expo app: setup, flames, thread, queue, turns, prompts, quiet notice with nearby contacts, away mode, weekly read, Light via Stripe · adapters: Telegram (from the prototype), WhatsApp, LINE · AI service with versioned prompts and logging · admin view · migrations, CI, staging", "Convert phase-0 families to the app; recruit toward 100 through referrals (two introductions per paying family); pricing test $9.99 vs $79/yr vs $14.99; ten more interviews with families who declined; Taiwan groundwork (five conversations); if ikigai says yes, the batch; if not, two more programmes with phase-0 data", "Conversion > 25%; D30 > 85%; answer rate > 85%; members per family ≥ 5"],
      ["2 · The bridge · months 4–6", "Parent surface and kitchen-table mode; grandchildren tools (draw, record with a parent's phone); translation both ways; story day and archive (PDF export); memory and reminders; MAX and Viber adapters; referral loop in the app; Traditional Chinese app; feature flags", "Taiwan launch on LINE; first hire: a customer-facing person who speaks the languages of the first 1,000 families; community; onboarding calls", "1,000 families; contributors ≥ 3; family-content days > 60%; 2–4 min/day; Sean Ellis > 40%"],
      [{ label: "3 · The read · months 7–12", style: S.tdAmber }, "Drift with published precision; voice/SMS line for parents without smartphones; second kept-light member plans; in-app purchases (RevenueCat); data-residency review for a Russian launch; eval set at scale", "First B2B2C conversation with a telco or remittance app; insurer conversation in Germany or Japan with precision numbers; seed round on evidence; second engineer", "10,000 families; the read trusted and paid; a partner signed or rejected with reasons"],
    ]);
    y += 20;
    p.box(40, y, 1320, 90, h("Cadence", ["Monday: 30 minutes, three priorities each, in plan/weekly/. Daily in pilot weeks: a 15-minute check on the loop. Friday: written review with the metrics table; decisions appended to plan/decisions.md and to this file. Every phase exit is a written decision: continue, pivot one variable, or stop."]), S.cardGrey);
    pages.push(p);
  }

  // 7.4 Metrics
  {
    const p = new Page("7.4 · Metrics");
    let y = p.title("What we measure, and the 90-day targets", "The precision number is the one nobody else publishes.");
    y = p.table(40, y, [{ w: 340, title: "Metric" }, { w: 420, title: "Why" }, { w: 200, title: "90-day target" }, { w: 360, title: "How it's computed" }], [
      ["Kept-light answer rate", "Is she opening it with joy?", { label: "> 85%", style: S.tdGreen }, "days with any answer ÷ days with an arrival, per member, from events"],
      ["Median answer latency", "Habit; feeds quiet tuning", { label: "< 60 min", style: S.tdGreen }, "first answer − arrival sent_at"],
      ["Family-content days", "Is the family present, or is Vela carrying it?", { label: "> 60%", style: S.tdGreen }, "arrivals with source=family ÷ all arrivals"],
      ["Members / active contributors per family", "Growth engine", { label: "≥ 5 / ≥ 3", style: S.tdGreen }, "members with status active; members with ≥1 item in 30 days"],
      ["Under-30 member in family", "Is “closer” landing with the young?", { label: "60% of families", style: S.tdGreen }, "birth_year where given; else asked at onboarding"],
      ["Quiet notices per member per month; share true", "Precision, published monthly", { label: "< 2; > 50%", style: S.tdAmber }, "quiet_events count; outcome = true_concern ÷ notices"],
      ["Light conversion after trial; D90 retention", "The business", { label: "> 25%; > 80%", style: S.tdAmber }, "subscriptions; cohort by trial start"],
      ["“Stop” rate among kept-light members", "Dignity", { label: "< 5%", style: S.tdGreen }, "flame off by refusal ÷ flames on"],
      ["Minutes in app per member per day", "The anti-addiction promise", { label: "2–4", style: S.tdGreen }, "app sessions; we want this low and steady"],
      ["“If Vela stopped tomorrow…” very disappointed", "Product-market fit (Sean Ellis)", { label: "> 40%", style: S.tdAmber }, "asked at day 14 and day 60 to organisers and to under-30 members"],
    ]);
    y += 20;
    p.box(40, y, 1320, 70, h("Reporting", ["A nightly KPI job reads the append-only events table and writes metrics_daily. Weekly on the master plan page; monthly precision published on the site once we have 100 kept-light members."]), S.cardGrey);
    pages.push(p);
  }

  // 7.5 Risks
  {
    const p = new Page("7.5 · Risks");
    let y = p.title("Risks, with triggers and owners", "Reviewed at every phase exit.");
    p.table(40, y, [{ w: 340, title: "Risk" }, { w: 520, title: "Mitigation" }, { w: 300, title: "Trigger to act" }, { w: 160, title: "Owner" }], [
      ["The family goes quiet after week three, like every group chat", "Turns, prompts from their own words, the under-30 contributor, the Vela fallback; family-content days reviewed weekly as a bug when they drop", "Family-content days < 40% two weeks running", "Co-founder"],
      ["The eldest feels watched", "Symmetry, “stop”, story day, everything arrives from people; ask her directly at week two", "“Stop” rate > 5%, or any interview says “surveillance”", "Founder"],
      ["The young see it as their parents' app", "The closeness promise is theirs; own flame on their terms; tested with under-30s in phase 0", "Under-30 contribution rate < 30%", "Founder"],
      ["We become a free messenger with 1% conversion", "Free layer is one moment a day, not chat; paid layer is silence semantics; move the line if conversion < 25% at 90 days", "Conversion < 25% at day 90", "Both"],
      ["False quiet notices erode trust", "Per-person tuning, away mode, never before +4 h, published precision, notice as information not alarm", "Precision < 30% or > 3 notices per member per month", "Co-founder"],
      ["Messenger platform risk (blocks, throttling, API changes)", "Adapters; never single-channel in a market; the app and the voice line as floors", "Delivery failure > 5% on any channel for a week", "Co-founder"],
      ["A kept-light member is found late despite Vela", "Honest promise from day one; the language written before the first customer; no “emergency” claims anywhere", "Before the first paying customer: the language exists", "Founder"],
      ["Data law (Russia localisation, GDPR, PDPA)", "Minimum data, per-region storage, legal review per market", "Before any Russian launch; before 1,000 families in the EU", "Founder"],
      ["Solo non-technical founder; consumer AgeTech funding down 48% in 2026", "AI co-founder builds; the prototype exists; revenue from day one; a human technical co-founder from the batch or network", "No human technical co-founder by the end of phase 1", "Founder"],
      ["The AI says something wrong to a lonely parent", "One acknowledgement a day, two sentences, scoped; hard rules; all conversations read by the founder in the pilot; eval set", "Any flagged incident", "Both"],
    ]);
    pages.push(p);
  }

  // 7.6 Decisions and open questions
  {
    const p = new Page("7.6 · Decisions and open questions");
    let y = p.title("Decisions log and what is still open", "Append, never rewrite. Architecture decisions are on page 4.6.");
    const d = [
      ["2026-09-11", "Research before anything. Six reports across US, Europe, East Asia, sensing, AI apps, market size; a seventh on family-bridge apps."],
      ["2026-09-11", "Repo on GitHub, near-zero budget. Free tiers only."],
      ["2026-09-11", "Don't deploy the bot before talking to customers. Built as a probe, parked until interviews say what the probe should be."],
      ["2026-09-11", "No human welfare-check ladder, no partners. The family acts on silence; Vela informs and shows who is nearby."],
      ["2026-09-11", "All families, not diaspora only. Diaspora remains the first wedge."],
      ["2026-09-11", "ikigai Launchpad application submitted ($100k for 8% SAFE, Taipei, 12 weeks)."],
      ["2026-09-12", "One app for three generations. Free daily thread for everyone; paid Light for any kept-light member; the eldest joins by messenger and may graduate to a parent surface."],
      ["2026-09-12", "Pricing to test: free + Light at $9.99/mo or $79/yr per kept-light member."],
      ["2026-09-12", "Phase 0 before the app. Prove the loop with the prototype and 10–20 paying three-generation families."],
      ["2026-09-12", "English first. All copy, wireframes, bot defaults, and documents authored in English; Russian and Chinese are localisations."],
      ["2026-09-12", "The master plan page's checklist is the one task tracker. Asana CSV as optional export; Trello dropped. Draw.io for diagrams, Figma for wireframes, Gource for the repo history."],
      ["2026-09-12", "Architecture: Cloudflare Workers + Postgres per region + adapters; flame lights before AI; gateway enforces the budget; Stripe first, IAP in phase 2; Russia = legal review before launch."],
    ].map(([date, text]) => `<span style="color:${C.ink3};font-family:monospace">${date}</span> · ${text}`);
    const g = p.grid(d, { cols: 2, x: 40, y, w: 650, h: 66, gx: 20, gy: 10, style: S.cardGrey });
    y = g.bottom + 10;
    p.box(40, y, 640, 170, h("Open for the founder's decision", li([
      "Company jurisdiction: Delaware if ikigai says yes, otherwise Estonia for cost; affects Stripe, store accounts, data residency",
      "Payments: confirm Stripe web checkout first, in-app purchases in phase 2",
      "Data residency: EU default, APAC for Taiwan; Russian localisation law reviewed by a lawyer before any Russian launch",
      "Brand: check vela.app and close domains; trademark conflicts in the first markets",
    ])), S.cardAmber);
    p.box(720, y, 640, 170, h("Open product questions", li([
      "Should the eldest know Vela exists, or does everything appear to come from family? Honesty says she knows; phase 0 tells us how it lands",
      "Is the existing family group the whole onboarding? A bot added to an existing Telegram family group needs no link; test with two families",
      "Grandchildren as the content engine: does Famileo's finding hold with a 20-year-old on Telegram?",
      "Free tier or trial only? Conversion at 90 days decides",
    ])), S.card);
    pages.push(p);
  }

  // 7.7 Team, legal, brand
  {
    const p = new Page("7.7 · Team, legal, brand");
    let y = p.title("Team and hiring, legal and compliance, brand", "The parts of the foundation that are not product or code.");
    y = p.h2(y, "Team and hiring");
    y = p.table(40, y, [{ w: 220, title: "Role" }, { w: 500, title: "Owns" }, { w: 600, title: "When" }], [
      ["Founder (business, Taipei, RU + EN)", "Customers: interviews, recruiting, onboarding, community, partners, fundraising; daily ops in the pilot; every decision on this page", "Now, full-time"],
      ["AI co-founder (Claude)", "Research, product spec, architecture, code, data, materials, this document; runs the loop and the metrics", "Now, always on"],
      ["Human technical co-founder", "Owns the codebase with the AI co-founder; on-call; the person investors ask for", "Target: by the end of phase 1 (from the ikigai batch or network)"],
      ["Customer-facing multilingual hire", "Support, onboarding calls, community, native review of translations", "Phase 2 (first 1,000 families)"],
      ["Second engineer · growth lead", "Adapters and the voice line · channel partnerships and the referral loop", "Phase 3, on revenue or seed"],
      ["Advisors", "Ageing and eldercare; telecom or messaging platforms; the Russian-speaking diaspora; a lawyer for data law", "Three conversations in phase 0 week 4, not fundraising"],
    ]);
    y += 20;
    y = p.h2(y, "Legal and compliance matrix");
    y = p.table(40, y, [{ w: 220, title: "Topic" }, { w: 560, title: "Requirement" }, { w: 540, title: "Our position" }], [
      ["GDPR (EU default region)", "Lawful basis, minimisation, consent records, deletion, data residency, DPA with processors", "Minimum data; consent events; deletion with hash; Neon and Cloudflare EU regions; DPAs signed before 1,000 EU families"],
      ["Taiwan PDPA", "Notice and consent; cross-border transfer rules", "APAC region for Taiwanese families; Chinese-language notice"],
      ["Russia 152-FZ (localisation)", "Personal data of Russian citizens processed in Russia", "Pilot stores minimal data in the EU with consent; lawyer's review before any Russian launch (ADR-7)"],
      ["App store rules", "Digital subscriptions offered in-app must use in-app purchase; no health claims without substantiation", "Stripe web first; IAP in phase 2; never claim fall detection or emergency response"],
      ["Children", "Grandchildren under 13 contribute only through a parent's account", "No child accounts; contributions attributed to the child but owned by the parent"],
      ["Consumer protection", "Clear cancellation, refunds, no dark patterns", "Cancel in one tap; 14-day grace; the research shows billing complaints are the industry's top failure"],
      ["Accessibility", "WCAG-level contrast and text size for the parent surface", "18 pt, 64 pt buttons, 7:1 contrast, everything read aloud"],
      ["Company jurisdiction", "Where Vela is incorporated affects all of the above", "Open: Delaware (if ikigai), Estonia (cost), Taiwan, Singapore"],
    ]);
    y += 20;
    y = p.h2(y, "Brand");
    p.table(40, y, [{ w: 220, title: "Element" }, { w: 1100, title: "Decision" }], [
      ["Name", "Vela: a candle (vela), to keep vigil (velar), and a sail. A light left on in the window. Domain and trademark check pending"],
      ["Line", "“Keep a light on.” · “One family. Three generations. A light kept on.”"],
      ["Mark", "A small flame; lit is amber, unlit is an outline. The flame is the product's only icon that matters"],
      ["Palette", "Sage green #2f7d5b for actions · amber #e0a23a for the flame and the paid layer · ink #1b2430 · blue-grey neutrals. No red except for risks and true errors"],
      ["Type", "Newsreader for headings · Public Sans for body · IBM Plex Mono for numbers"],
      ["Voice", "By name, neutral over alarming, say what happens next, never “monitor”; English first, native-reviewed localisations"],
    ]);
    pages.push(p);
  }

  // 7.8 Pitch deck and glossary
  {
    const p = new Page("7.8 · Pitch deck and glossary");
    let y = p.title("Pitch deck outline and glossary", "Ten slides, drafted from this file and finished with phase-0 evidence.");
    const slides = [
      "1 · The unanswered call: the problem in one story",
      "2 · 50 million parents alone, a worried child behind each: the market",
      "3 · Everything built so far treats her as a patient: why incumbents fail (adoption, non-wear, stigma)",
      "4 · Vela: the family's daily thread, one moment a day, and a light kept on for whoever the family worries about",
      "5 · The daily loop: arrival, answer, flame, quiet notice",
      "6 · Closer and calmer: what makes it more than a group chat, and what makes silence mean something",
      "7 · Why now: messengers everywhere, multilingual AI, the super-aged crossover in Taiwan, Korea, Japan",
      "8 · Business model: the free layer spreads, Light pays; Famileo, Snug, Docomo as comparables",
      "9 · Phase-0 evidence: answer rate, family-content days, what parents said, what children paid",
      "10 · The founder, the ask, the plan to 1,000 families",
    ];
    const g = p.grid(slides, { cols: 2, x: 40, y, w: 650, h: 44, gx: 20, gy: 8, style: S.card });
    y = g.bottom + 16;
    y = p.h2(y, "Glossary");
    p.table(40, y, [{ w: 200, title: "Term" }, { w: 1120, title: "Meaning" }], [
      ["Family", "The unit Vela serves: members across generations around one thread"],
      ["Member · organiser · kept-light member · nearby contact", "Anyone in the family · the one who set it up and usually pays · a member with a flame · a neighbour or relative called only when the light stays dark"],
      ["Arrival", "The one daily message a member receives at their hour"],
      ["Answer", "Anything the member sends back that day: tap, heart, voice, text, photo"],
      ["Flame", "The daily sign that a kept-light member answered; lit, unlit, quiet, away, paused"],
      ["Quiet notice", "The message to the organiser when a kept-light member hasn't answered past her tuned window"],
      ["T_quiet", "The per-person threshold: median answer latency over 14 days + 2 h, floor 4 h, cap 8 h"],
      ["Away mode", "A declared or learned period when repeats and notices pause but arrivals continue"],
      ["Weekly read", "Sunday's three-to-five-line narrative of how a kept-light member is, from her own answers"],
      ["Story day", "The weekly arrival that asks her a question about her life; answers become the archive"],
      ["Turn", "The member whose day it is to send something; prompted the evening before"],
      ["Vela Light", "The paid layer, per kept-light member: flame, quiet notices, nearby contacts, away mode, weekly read, memory, archive, drift"],
      ["Precision", "True concerns ÷ quiet notices; recorded by the organiser, published monthly"],
      ["Adapter", "A channel module (Telegram, MAX, WhatsApp, LINE, Viber, voice) behind one interface"],
      ["Gateway", "The one function that sends anything to a person and enforces the notification budget"],
    ]);
    pages.push(p);
  }

  return pages;
}
