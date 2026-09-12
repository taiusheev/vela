import { Page, S, h, li } from "./lib.mjs";

export function gtm() {
  const pages = [];

  // 6.1 Waves and growth loop
  {
    const p = new Page("6.1 · Markets and the growth loop");
    let y = p.title("Go to market: four waves, one loop", "Where we start, why, and how a family spreads. Channel caution: WhatsApp blocked in Russia since Feb 2026, Telegram throttled, MAX leads reach.");
    y = p.table(40, y, [{ w: 90, title: "Wave" }, { w: 330, title: "Who" }, { w: 400, title: "Why them" }, { w: 500, title: "Channel and size" }], [
      [{ label: "1", style: S.tdGreen }, "Russian-speaking families; sharpest pain among the ~600k who emigrated since 2022 and whose parents stayed", "The founder is one of them and can reach them; hard-currency payers; no product exists; Russian parents already use Telegram and MAX daily", "Telegram relocation communities (Georgia, Serbia, Kazakhstan, Turkey, Cyprus, Thailand, Taiwan, Germany, Israel); personal network; parents via Telegram and MAX"],
      ["2", "Taiwan", "Super-aged since 2025; the founder lives there; LINE is one adapter away", "LINE; Taiwanese friends; university networks; Traditional Chinese app"],
      ["3", "Philippines, India, Ukraine, Latin America", "Same family shape at scale; remittance apps already bill this customer monthly", "WhatsApp; 2.19M OFWs and $35.6B remittances; 18.5M Indians abroad and $135.5B; Remitly (9.3M active), Wise (15.5M), Paysend (10M), KoronaPay (26M transactions/yr)"],
      ["4", "Germany, UK, Japan", "Insurers and councils reimburse ~€25/mo for this outcome; no software-only entrant exists in those tenders", "Germany's €25.50 code; UK council re-tenders around the Jan 2027 PSTN switch-off; Japanese municipal emergency-call replacement; Australia's AT-HM provider list"],
    ]);
    y += 30;
    y = p.h2(y, "The growth loop");
    const g1 = p.box(60, y + 10, 260, 80, h("A 20-year-old installs Vela", ["for his grandmother"]), S.card);
    const g2 = p.box(380, y + 10, 260, 80, h("Invites his mother and aunt", ["contributors, free"]), S.card);
    const g3 = p.box(700, y + 10, 260, 80, h("The mother switches on the light", ["and pays"]), S.cardAmber);
    const g4 = p.box(1020, y + 10, 260, 80, h("The aunt tells her own family", ["a new organiser"]), S.cardGreen);
    p.edge(g1, g2); p.edge(g2, g3); p.edge(g3, g4); p.edge(g4, g1, S.edgeSoft, [[1150, y + 120], [190, y + 120]]);
    y += 150;
    p.box(40, y, 640, 150, h("Later channels", li([
      "Telcos and remittance apps that already bill this exact customer monthly (precedents: AXA × Western Union insurance inside transfers; Aflac invested in Chikaku)",
      "Employers of relocants (IT firms in Yerevan, Tbilisi, Almaty) as a benefit",
      "Insurers in Germany, the UK, Japan once precision is published",
      "Universities with international students (the student abroad keeps a light for his mother)",
    ])), S.card);
    p.box(720, y, 640, 150, h("What we don't do", li([
      "Paid ads before the referral loop works",
      "A single messenger in any market",
      "Care homes as a channel in CIS (no Famileo-style network exists there)",
      "Payer-only distribution (Papa lost ~36 contracts after one article); direct revenue always stays",
    ])), S.cardGrey);
    pages.push(p);
  }

  // 6.2 Channel landscape
  {
    const p = new Page("6.2 · Channel landscape");
    let y = p.title("Messengers and rails, by market", "research/07 §4–5. The parent side is adapters, never one messenger.");
    y = p.h2(y, "Russia (Mediascope, 12+)");
    y = p.table(40, y, [{ w: 200, title: "Date" }, { w: 280, title: "Telegram" }, { w: 280, title: "MAX" }, { w: 280, title: "WhatsApp" }, { w: 280, title: "Note" }], [
      ["Jan 2026 monthly", "96.0M", "73.7M", "89.4M", "Before the WhatsApp block (11 Feb 2026)"],
      ["Mar 2026 monthly / daily", "94.3M / 72.2M", "83.2M / 61.5M", "76.5M / 30.3M", "Telegram leads daily habit; WhatsApp collapsing"],
      ["Jun 2026 monthly", "75.7M", "86.2M (#1)", "63.5M", "MAX leads reach; Telegram throttled; MAX removed from app stores in June and sanctioned in July"],
      ["65+ segment (unverified)", "74%", "39%", "78%", "Older users prefer WhatsApp as main messenger, read Telegram channels; re-check at Mediascope before a slide"],
    ]);
    y += 20;
    y = p.h2(y, "Costs and rules");
    y = p.table(40, y, [{ w: 200, title: "Channel" }, { w: 400, title: "Cost" }, { w: 720, title: "Rules that affect the arrival" }], [
      ["Telegram Bot API", "$0 per message (~30 msg/s)", "Buttons, voice both ways; bot can be added to a family group (privacy mode off); best fit for the prototype"],
      ["WhatsApp Business API", "Utility $0.0014 (India) / $0.0034 (US) / $0.0077 (RoW) per template; marketing 3–8× more; ≈ $0.04–0.23 per family per month", "Template approval; the parent must have messaged the business first for free-form replies; a daily arrival risks the marketing category; unusable in Russia"],
      ["MAX", "$0 (official bot API)", "State-run; assume readable; digital ID via Gosuslugi; required for Russian parents"],
      ["LINE Messaging API", "Free tier then per-message", "Rich messages; Taiwan and Japan"],
      ["Voice / SMS (Twilio-class)", "Cents per minute or message", "Branded caller ID where available; carrier coverage in Russia to verify"],
    ]);
    y += 20;
    y = p.h2(y, "Remittance and diaspora rails");
    p.table(40, y, [{ w: 240, title: "Rail" }, { w: 400, title: "Scale" }, { w: 680, title: "Why it matters" }], [
      ["Remitly", "9.3M quarterly active customers (Q4 2025), first profitable year", "Owns the “adult child abroad paying for a parent at home” relationship"],
      ["Wise", "15.5M active customers (FY25)", "Same"],
      ["Paysend", "10M consumer customers, 190 countries", "Strong in CIS corridors"],
      ["Zolotaya Korona / KoronaPay", "26M transactions (2025), ~50% of Russia's cross-border transfer market; EU sanctions in 2026", "The CIS corridor rail; sanctions risk"],
      ["Precedent", "AXA × Western Union: insurance sold inside transfers", "Vela as the “care add-on” line item on the transfer receipt"],
    ]);
    pages.push(p);
  }

  return pages;
}
