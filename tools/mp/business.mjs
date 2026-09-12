import { Page, S, h, li } from "./lib.mjs";

export function business() {
  const pages = [];

  // 5.1 Model and pricing
  {
    const p = new Page("5.1 · Business model and pricing");
    let y = p.title("Business model", "The free layer spreads; the light pays. Priced at the bottom of the $10–35 band because the payer is often young and the eldest's life is finite.");
    p.box(40, y, 640, 190, h("Vela · free · for everyone", li([
      "The daily moment, thread, turns, prompts, contributors, translation, story day",
      "Why free: contributors are the growth engine; ~8 relatives per paying family at Famileo; half of Aura's sales come from family invites",
      "Risk: becoming a free messenger with 1% conversion → the free layer is one moment a day, not chat",
    ])), S.card);
    p.box(720, y, 640, 190, h("Vela Light · $9.99/month or $79/year per kept-light member · +50% for a second", li([
      "The light, quiet notices, nearby contacts, away mode, weekly read, memory, archive export, drift",
      "Why paid: people pay for the meaning of silence; Snug's $19.99 tier sells exactly this",
      "Trial: 30 days of Light after the first answer, so a family sees one weekly read or one quiet notice before paying",
      "To test in 90 days: $9.99 vs $14.99 vs annual-only; move the line if conversion < 25%",
    ])), S.cardAmber);
    y += 210;
    y = p.h2(y, "Comparables and price anchors");
    y = p.table(40, y, [{ w: 240, title: "Product" }, { w: 220, title: "Price" }, { w: 400, title: "Signal" }, { w: 460, title: "What it tells us" }], [
      ["Famileo (printed family gazette)", "£5.99–17.99/mo", "260k families; €14M revenue 2024; profitable", "Families pay this much to deliver love to a grandparent, with no safety layer at all"],
      ["Snug Dispatch (alert tier)", "$19.99/mo or $199.99/yr", "The free tap is free; the alert sells", "The top of our range; the ladder is what people pay for"],
      ["Docomo Chikaku (TV box for parents)", "¥1,980/mo (~$13)", "Sold in every Docomo shop; Aflac invested", "Warm content + presence at ~$13 works through a telco channel"],
      ["ViewClix (family frame)", "$9.95/mo per family", "One fee for the whole family", "A per-family fee at $9.95 is accepted"],
      ["Germany Hausnotruf", "€25.50/mo reimbursed", "1.2M users; the market price by law", "The public anchor for this outcome in Europe"],
      ["Japan Post / Yamato / Zojirushi", "¥1,070–3,300/mo", "Families say they want ¥1,000–2,000", "Japan's wanted price sits at our Light price"],
      ["Marco Polo · Locket", "$4–10/mo", "~1% of users pay for messaging", "Never charge for messaging"],
    ]);
    y += 20;
    p.box(40, y, 1320, 110, h("Unit economics", li([
      "No hardware; no staff on the ladder; AI ≈ $0.30–0.60 per kept-light member per month; infrastructure under 2% of revenue at every scale",
      "LTV capped at 2–4 years per kept-light member by her trajectory → acquisition must stay under $60 per family; the relationship must outlive one person (siblings, the second parent, the next generation)",
      "Acquisition plan: word of mouth inside families and communities; the under-30 member recruits; no paid ads before the referral loop works",
      "Payments: Stripe web checkout first; in-app purchases (RevenueCat) in phase 2 when store rules require it",
    ])), S.cardGreen);
    pages.push(p);
  }

  // 5.2 Revenue scenarios
  {
    const p = new Page("5.2 · Revenue scenarios");
    let y = p.title("Revenue scenarios (not forecasts)", "Three paths with explicit assumptions. The point is to know which assumption we are testing at each phase.");
    y = p.table(40, y, [{ w: 160, title: "Month" }, { w: 300, title: "Downside" }, { w: 300, title: "Base" }, { w: 300, title: "Upside" }, { w: 260, title: "The assumption being tested" }], [
      ["3 (end of phase 1)", "60 families · 15% Light · $9.99 → ~$90 MRR", "100 · 25% · $9.99 → ~$250 MRR", "150 · 35% · $9.99 → ~$520 MRR", "Do families pay after the trial?"],
      ["6 (end of phase 2)", "500 · 20% → ~$1.0k MRR", "1,000 · 30% → ~$3.0k MRR", "2,000 · 35% → ~$7.0k MRR", "Does the referral loop carry growth without ads?"],
      ["12 (end of phase 3)", "4,000 · 25% → ~$10k MRR", "10,000 · 35% → ~$35k MRR", "20,000 · 40% → ~$80k MRR", "Does the read (drift) get trusted and paid? Does a channel partner sign?"],
      ["24", "15,000 · 30% → ~$45k MRR", "50,000 · 40% · +10% second member → ~$220k MRR", "120,000 · 45% → ~$540k MRR", "Does a second market (Taiwan, Philippines) repeat the first?"],
    ]);
    y += 20;
    y = p.h2(y, "What moves the numbers");
    y = p.table(40, y, [{ w: 300, title: "Lever" }, { w: 500, title: "Effect" }, { w: 520, title: "Evidence or guess" }], [
      ["Light conversion after trial", "The single most important number; 25% base", "Snug and Famileo suggest families pay when the paid thing is the alert or the artefact; guess until phase 1"],
      ["Members per family", "More contributors → more content days → higher answer rate → higher conversion and retention", "Famileo ~8 MAU per paying family"],
      ["Second kept-light member", "+50% ARPU on families with two parents or a parent and a student abroad", "Guess; the three-generation shape makes it common"],
      ["Annual plan share", "Cash up front; lower churn", "Careline365 and LiveLife use annual prepay to blunt the 2–4 year tenure"],
      ["Channel partner (telco, remittance app)", "Lower CAC, bulk distribution, price pressure", "Docomo/Chikaku; Western Union × AXA; Korea's municipal SaaS model"],
      ["Reimbursement (DE, UK, JP)", "€25/mo per member paid by an insurer or council, if precision is published", "Germany's code is exactly €25.50; UK re-tenders in 2027"],
    ]);
    y += 20;
    p.box(40, y, 1320, 90, h("Runway logic", ["Costs are under $50/month until 1,000 families and under $500/month until 10,000; the founder's time is the only real cost. With $100k (ikigai) the plan funds a human technical co-founder and the first customer-facing hire through phase 2. Without it, phases 0–1 are still fully fundable on revenue and free tiers."]), S.cardGrey);
    pages.push(p);
  }

  return pages;
}
