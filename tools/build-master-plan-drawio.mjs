// Builds design/diagrams/master-plan.drawio: a multi-page, editable Draw.io map of the whole Vela plan.
// Run: node tools/build-master-plan-drawio.mjs
// Content mirrors plan/master-plan.html, product/02-app-plan.md, product/03-product-spec.md,
// architecture/01-technical-design.md and plan/execution-plan.md. Edit the data below, re-run, commit.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "design", "diagrams", "master-plan.drawio");

// ---------- palette and styles ----------
const C = {
  ink: "#1b2430", ink2: "#4a5566", ink3: "#7d8794",
  rule: "#d9dee6", soft: "#f6f7f9", white: "#ffffff",
  green: "#2f7d5b", greenSoft: "#e3f1ea",
  amber: "#e0a23a", amberSoft: "#fbf0d8",
  red: "#b1413a", redSoft: "#f6e3e1",
};
const S = {
  card: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingRight=8;spacingTop=6;fillColor=${C.white};strokeColor=${C.rule};fontColor=${C.ink};fontSize=11;`,
  cardGreen: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingRight=8;spacingTop=6;fillColor=${C.greenSoft};strokeColor=${C.green};strokeWidth=2;fontColor=${C.ink};fontSize=11;`,
  cardAmber: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingRight=8;spacingTop=6;fillColor=${C.amberSoft};strokeColor=${C.amber};strokeWidth=2;fontColor=${C.ink};fontSize=11;`,
  cardRed: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingRight=8;spacingTop=6;fillColor=${C.redSoft};strokeColor=${C.red};fontColor=${C.ink};fontSize=11;`,
  cardGrey: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingRight=8;spacingTop=6;fillColor=${C.soft};strokeColor=${C.rule};fontColor=${C.ink};fontSize=11;`,
  hub: `ellipse;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=${C.amberSoft};strokeColor=${C.amber};strokeWidth=3;fontColor=${C.ink};fontSize=16;fontStyle=1;`,
  title: `text;html=1;align=left;verticalAlign=top;fontSize=22;fontStyle=1;fontColor=${C.ink};whiteSpace=wrap;`,
  sub: `text;html=1;align=left;verticalAlign=top;fontSize=11;fontColor=${C.ink3};whiteSpace=wrap;`,
  lane: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;fillColor=${C.soft};strokeColor=${C.rule};fontColor=${C.ink3};fontStyle=1;fontSize=11;`,
  laneAmber: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;fillColor=${C.amberSoft};strokeColor=${C.amber};fontColor=${C.ink3};fontStyle=1;fontSize=11;`,
  edge: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=${C.ink2};`,
  edgeSoft: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=${C.ink3};dashed=1;`,
  edgeAmber: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=${C.amber};strokeWidth=2;`,
  line: `endArrow=none;html=1;strokeColor=${C.rule};`,
  bar: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=8;fillColor=${C.greenSoft};strokeColor=${C.green};fontColor=${C.ink};fontSize=11;`,
  barAmber: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=8;fillColor=${C.amberSoft};strokeColor=${C.amber};fontColor=${C.ink};fontSize=11;`,
  milestone: `rhombus;whiteSpace=wrap;html=1;fillColor=${C.amber};strokeColor=${C.amber};fontColor=${C.ink};fontSize=10;`,
  small: `text;html=1;align=left;verticalAlign=top;fontSize=10;fontColor=${C.ink3};whiteSpace=wrap;`,
};

// ---------- tiny XML/HTML helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const h = (title, lines = []) => `<b>${title}</b>` + (Array.isArray(lines) ? (lines.length ? "<br>" + lines.join("<br>") : "") : "<br>" + lines);
const li = (items) => items.map((i) => "• " + i).join("<br>");

class Page {
  constructor(name) { this.name = name; this.cells = []; this.n = 0; }
  id() { return `c${++this.n}`; }
  box(x, y, w, h, label, style = S.card, id = this.id()) {
    this.cells.push(`<mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
    return id;
  }
  edge(src, dst, style = S.edge, points = []) {
    const id = this.id();
    const pts = points.length ? `<Array as="points">${points.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>` : "";
    this.cells.push(`<mxCell id="${id}" style="${style}" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
    return id;
  }
  title(t, sub) {
    this.box(40, 30, 1000, 36, t, S.title);
    if (sub) this.box(40, 68, 1100, 30, sub, S.sub);
  }
  // Lay out cards in a grid; returns ids.
  grid(items, { cols, x = 40, y = 120, w = 260, h = 120, gx = 20, gy = 20, style = S.card }) {
    return items.map((it, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const st = typeof it === "object" && it.style ? it.style : style;
      const label = typeof it === "object" ? it.label : it;
      const hh = typeof it === "object" && it.h ? it.h : h;
      return this.box(x + col * (w + gx), y + row * (h + gy), w, hh, label, st);
    });
  }
  xml(pageW = 1400, pageH = 1000) {
    return `<diagram id="${this.name.replace(/\W+/g, "_")}" name="${esc(this.name)}"><mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" background="#ffffff"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${this.cells.join("")}</root></mxGraphModel></diagram>`;
  }
}

const pages = [];

// ===================== 1. OVERVIEW MAP =====================
{
  const p = new Page("1 · Overview map");
  p.title("Vela · master plan, at a glance", "Each box is a page in this file. Start here; double-click the tab names below to go deeper. Updated 2026-09-12.");
  const hub = p.box(520, 380, 360, 120, "Vela<br><span style=\"font-size:11px;font-weight:normal\">One family, three generations, and a light kept on</span>", S.hub);
  const branches = [
    [60, 140, h("Mission and problem", ["50M people 65+ live alone in the ten richest ageing countries", "the worry is that silence is ambiguous", "→ page 2"]), S.cardAmber],
    [400, 140, h("What we learned", ["7 research reports, ~550 sources", "8 approaches, 10 truths", "→ page 3"]), S.card],
    [740, 140, h("The product", ["closer (free) + calmer (paid)", "arrival · answer · flame · quiet notice", "→ pages 4–7"]), S.cardGreen],
    [1080, 140, h("Architecture", ["one Worker, Postgres per region, adapters", "flame lights before any AI", "→ page 8"]), S.card],
    [60, 620, h("Business model", ["free layer spreads; Light $9.99/mo pays", "AI ≈ $0.30–0.60 per kept-light member/month", "→ page 9"]), S.card],
    [400, 620, h("Go to market", ["Russian-speaking families → Taiwan → PH/IN/UA/LatAm → DE/UK/JP", "growth through contributors", "→ page 10"]), S.card],
    [740, 620, h("Roadmap and phase 0", ["prove the loop → MVP → the bridge → the read", "4-week checklist with owners", "→ pages 11–12"]), S.cardGreen],
    [1080, 620, h("Metrics, risks, decisions", ["10 metrics with 90-day targets", "9 risks with mitigations · 12 decisions", "→ pages 13–15"]), S.card],
  ];
  const ids = branches.map(([x, y, label, st]) => p.box(x, y, 280, 110, label, st));
  ids.forEach((id) => p.edge(hub, id, S.edgeSoft));
  pages.push(p);
}

// ===================== 2. MISSION & PROBLEM =====================
{
  const p = new Page("2 · Mission and problem");
  p.title("Mission and the problem", "Why this company exists, and the numbers that justify it. Sources are in research/06 and research/03.");
  p.box(40, 110, 1320, 70, "<b>Vela keeps a light on for the people we love who live alone or far away:</b> one daily touch from their family, and the family knows the moment it goes quiet.", S.cardAmber);
  const facts = [
    h("45–50M", ["people 65+ living alone in the ten richest ageing markets (+25–30M in China)"]),
    h("8.96M", ["Japanese 65+ solo households by 2040 (6.7M in 2020)"]),
    h("23.6%", ["of Korean seniors live alone (2025, record)"]),
    h("2025", ["the year Taiwan became super-aged"]),
    h("76,020 · 21,856", ["died alone at home in Japan in 2024 · found after 8+ days"]),
    h("1 in 5", ["falls become a long lie of over an hour"]),
    h("12% vs 67%", ["mortality if found within 1 h vs helpless over 72 h"]),
    h("3 in 4", ["falls among pendant wearers happen with the pendant off"]),
    h("~2%", ["of French alarm-centre calls are true emergencies; 98% are reassurance"]),
    h("63M · 1 in 3", ["US family caregivers in 2025 · long-distance"]),
    h("~300M", ["people living outside their birth country"]),
    h("$10–35", ["monthly willingness to pay for this feeling, in every market studied"]),
  ];
  p.grid(facts, { cols: 4, x: 40, y: 200, w: 315, h: 80, gx: 20, gy: 16 });
  p.box(40, 500, 640, 150, h("The insight that organises everything", [
    "The worry happens because <b>silence is ambiguous</b>.",
    "Every product that ever delivered peace of mind did one thing: it made silence mean “nothing is wrong, because if it were, you'd know.”",
    "Sensors, AI, pendants are just different ways of earning the right to say that.",
  ]), S.cardGreen);
  p.box(720, 500, 640, 150, h("The five layers of the worry", [
    "<b>The spike</b>: “she didn't pick up.” Frequent, unlearned-from.",
    "<b>The catastrophe</b>: a fall nobody discovers.",
    "<b>The slow slide</b>: is she eating, is she sadder, is she forgetting.",
    "<b>The helplessness</b>: what could I do from 8,000 km?",
    "<b>The guilt</b>: I should call more.",
  ]), S.card);
  p.box(40, 680, 1320, 110, h("And the parent's side, which decides whether anything survives contact with reality", [
    "“I am not a patient. A pendant says I am.” · “Don't watch me.” (cameras 37% acceptance, sensors 59%, wearables 81%) · “I don't want to be a burden, but I am lonely.” · “Unknown numbers are spam.”",
  ]), S.cardGrey);
  pages.push(p);
}

// ===================== 3. RESEARCH LANDSCAPE =====================
{
  const p = new Page("3 · What we learned");
  p.title("How the world solves it today, and the ten truths", "Condensed from research/00-SYNTHESIS.md and research/07-family-bridge-apps.md.");
  const approaches = [
    [h("Emergency pendants", ["Life Alert, Medical Guardian, Tunstall, Careium · 16M users EU+NA", "<b>Works:</b> 24/7 human response; reimbursement codes (DE €25.50)", "<b>Fails:</b> stigma; 18% all-day wear; 9% adoption for a decade"]), S.card],
    [h("Consumer wearables", ["Apple Watch, Pixel, Galaxy", "<b>Works:</b> no stigma, no fee, fall detection", "<b>Fails:</b> 18-h battery; 911-first; no remote setup; useless with dementia"]), S.card],
    [h("Home sensors", ["Aloe, Envoy, Vayyar, Nobi, Sensi", "<b>Works:</b> solves non-wear; funded for facilities", "<b>Fails:</b> ten dead consumer brands; $40–100/mo + hardware; privacy"]), S.card],
    [h("Utility signals", ["Zojirushi kettle, Yamato bulb, Kansai meter, Shanghai water", "<b>Works:</b> zero install, accepted, near-free", "<b>Fails:</b> one low-fidelity signal; no family layer; 14k subs in 23 yrs"]), S.card],
    [h("AI check-in calls", ["Naver CareCall (50k), ElliQ, inTouch, AloneAssist", "<b>Works:</b> cheapest thing that scaled; multilingual", "<b>Fails:</b> all government-paid; parents screen unknown numbers; “mechanical care”"]), S.card],
    [h("Check-in apps", ["Snug ($19.99 alert tier), Iamfine, Enrich (LINE)", "<b>Works:</b> elders self-enrol; the paid tier sells the alert", "<b>Fails:</b> bare pings attract the young, not the old; tiny"]), S.card],
    [h("Family-presence products", ["Famileo (260k paying families), GrandPad, Aura, Chikaku, Storyworth", "<b>Works:</b> parents love them; half of Aura's sales from family invites", "<b>Fails:</b> print or hardware; no idea if grandma opened it"]), S.cardGreen],
    [h("Family social networks", ["Path, Cocoon, 23snaps (dead); Marco Polo, Locket, BeReal", "<b>Works:</b> small circles; one daily prompt (BeReal 68% open in 3 min)", "<b>Fails:</b> die against the group chat; messaging converts ~1%"]), S.card],
  ];
  p.grid(approaches.map(([label, style]) => ({ label, style })), { cols: 4, x: 40, y: 110, w: 315, h: 150, gx: 20, gy: 16 });
  const truths = [
    "01 The buyer is not the user. The child pays; the parent tolerates.",
    "02 Two jobs, not one: emergency (2%) and daily reassurance (98%). Amazon bundled them at $20 and cancelled.",
    "03 Zero-install wins; hardware-first dies.",
    "04 Silence needs a plan, not a notification.",
    "05 Precision is unsolved: 0.3% true positives in Seoul; nobody publishes numbers. We will.",
    "06 Willingness to pay is $10–35/month, everywhere.",
    "07 LTV is capped at 2–4 years by the eldest's trajectory.",
    "08 The 70–80 “pre-dependency” segment is unserved and insulted by everything on offer.",
    "09 Distribution is the moat: utilities, telcos, post, councils, remittance apps.",
    "10 Content from family gets opened with joy; pings get ignored.",
  ];
  p.box(40, 460, 1320, 40, "<b>Ten truths that hold in every country</b>", S.sub);
  p.grid(truths, { cols: 2, x: 40, y: 500, w: 650, h: 46, gx: 20, gy: 10, style: S.cardGrey });
  pages.push(p);
}

// ===================== 4. PRODUCT: FAMILY & PROMISES =====================
{
  const p = new Page("4 · Product · the family");
  p.title("The product: one family, three generations, two promises", "The unit is the family, not a pair. Anyone the family worries about can carry a flame; it is opt-in and visible to them.");
  const thread = p.box(470, 330, 460, 110, h("The family's daily thread", ["one moment a day · no feed · no strangers · no ads · free", "turns · prompts · grandchildren · translation · story day · memory"]), S.cardGreen);
  const gm = p.box(60, 140, 300, 130, h("Grandmother · 78 · lives alone", ["joins through her messenger, installs nothing", "<b>flame on</b>: her answer is the sign of life", "story day makes her the author, not the patient"]), S.cardAmber);
  const parent = p.box(550, 560, 300, 130, h("Parent · 45 · organiser · pays", ["both a child (of the 78-year-old) and a parent (of the 20-year-old)", "sets up the family, names the nearby contacts", "gets the flame, the weekly read, the quiet notice"]), S.card);
  const student = p.box(1040, 140, 300, 130, h("Student · 20 · abroad", ["best contributor: a 10-second voice note gets the strongest reply", "best recruiter: invites the family", "<b>own flame, opt-in</b>, on his terms, while abroad"]), S.cardAmber);
  const neighbour = p.box(60, 560, 300, 110, h("Nearby contact · neighbour, cousin", ["consents once", "called only when the light stays dark", "never receives anything else"]), S.cardGrey);
  p.edge(gm, thread); p.edge(student, thread); p.edge(parent, thread); p.edge(neighbour, thread, S.edgeSoft);
  p.box(60, 740, 640, 140, h("Closer · free · for everyone", li([
    "One moment a day, then the app closes",
    "Turns: each member gets a day; a prompt arrives the evening before",
    "Prompts that know the family, drawn from what people actually said",
    "Grandchildren first-class: voice, drawing, photo without writing",
    "Translation both ways, keeping her form of address",
    "Story day: one question a week; her answers become a book",
    "Memory: the Thursday appointment, the exam, the neighbour's name",
  ])), S.card);
  p.box(720, 740, 640, 140, h("Calmer · Vela Light · paid", li([
    "The flame: her daily answer lights it on the family's home screen",
    "Quiet notice to the organiser after her usual window (never before +4 h), nearby contacts one tap away",
    "Away mode: “going to my sister's until Sunday” pauses everything",
    "Weekly read: how she really is, in neutral words, from her own replies",
    "Memory and reminders, story archive export, later drift with published precision",
    "Nothing to install, wear, or charge. The family acts; Vela never knocks",
  ])), S.cardAmber);
  pages.push(p, );
}

// ===================== 5. PRODUCT: DAILY LOOP =====================
{
  const p = new Page("5 · Product · daily loop");
  p.title("The daily loop and the quiet ladder", "From product/03-product-spec.md §3–5. Silence only matters for members with a flame.");
  const lanes = [["THE FAMILY (any member, any time)", 110, S.lane], ["VELA (scheduler + AI)", 260, S.lane], ["THE KEPT-LIGHT MEMBER", 470, S.lane], ["THE ORGANISER (when the light stays dark)", 620, S.laneAmber]];
  lanes.forEach(([t, y, st]) => p.box(40, y, 1320, 130, t, st));
  const q = p.box(60, 140, 260, 80, h("Queue something", ["voice · photo · drawing · question", "for today or “whenever”"]), S.card);
  const turn = p.box(340, 140, 300, 80, h("Evening before: turn prompt", ["“Tomorrow is Sam's day. She mentioned the tomatoes; ask for a photo.”"]), S.card);
  const thread = p.box(1060, 140, 280, 80, h("Thread updates", ["her answer, transcribed and translated;", "whoever's content she answered is told"]), S.cardGreen);
  const compose = p.box(60, 290, 360, 90, h("Compose the arrival (her hour)", ["1 queued for today · 2 queued “whenever” (max 2)", "3 story question (story day) · 4 Vela fallback, signed as Vela", "one photo visible · voice as voice · her language and address form"]), S.card);
  const read = p.box(680, 290, 340, 90, h("Read the answer (after the flame lit)", ["transcribe · one neutral line · mood words · mentions", "flag: none | escalate → organiser with her words", "away detected? confirm back"]), S.card);
  const flame = p.box(1060, 290, 280, 60, h("Flame lights", ["on the raw answer, before any AI", "repeat and quiet cancelled"]), S.cardAmber);
  const repeat = p.box(440, 350, 220, 40, "<b>+2.5 h, no answer:</b> repeat once", S.cardGrey);
  const arrive = p.box(60, 500, 360, 90, h("One message", ["“Good morning, Mrs Ivanova…” + Mia's photo", "[ ☀️ I'm fine ]  🎤   (or: reply with anything, even a heart)"]), S.card);
  const answer = p.box(680, 500, 340, 90, h("One easy answer", ["tap · heart · voice · text · photo · anything counts", "“stop” turns the flame off; the organiser is told"]), S.cardGreen);
  const notice = p.box(680, 650, 340, 90, h("Quiet notice · arrival + T_quiet", ["T_quiet = median latency (14 d) + 2 h, floor 4 h, cap 8 h", "last contact · usual time · yesterday's words", "[Call] [Ask to check] [She's away] [Wait 2 h]"]), S.cardAmber);
  const acts = p.box(1060, 650, 280, 90, h("The family acts", ["a call, a neighbour's knock", "Vela never knocks", "auto-ask a contact only if opted in"]), S.card);
  p.box(60, 650, 360, 90, h("Precision accounting", ["every notice records an outcome:", "answered late · away · true concern · unknown", "precision = true concern ÷ notices, published monthly"]), S.cardGrey);
  p.edge(q, compose); p.edge(turn, q); p.edge(compose, arrive); p.edge(arrive, answer); p.edge(answer, flame); p.edge(flame, read); p.edge(read, thread);
  p.edge(arrive, repeat, S.edgeSoft); p.edge(repeat, notice, S.edgeAmber); p.edge(notice, acts);
  pages.push(p);
}

// ===================== 6. SURFACES & CHANNELS =====================
{
  const p = new Page("6 · Product · surfaces and channels");
  p.title("Surfaces and channels", "The eldest never learns anything new. No family is told “your grandmother's messenger isn't supported”; no adapter, no launch in that market.");
  const surfaces = [
    { label: h("The app (iOS, Android, web)", ["for every member who can install", "home: flames and today's moment · thread · queue · turns and prompts · story archive · own flame settings", "<b>must not:</b> a feed, badge counts, anything that rewards frequent opening"]), style: S.cardGreen },
    { label: h("Parent surface (same app, simplified mode)", ["for the eldest, when a child installs it on a visit", "one screen: the arrival · big “I'm fine” · voice reply · call the organiser · “what the family sees” · “stop”", "18 pt text, 64 pt buttons, 7:1 contrast, everything read aloud"]), style: S.cardAmber },
    { label: h("Kitchen-table mode", ["an old phone or tablet on her table", "cycles family photos when idle; wakes to the arrival; tap anywhere to answer; large clock", "no notifications beyond a gentle chime at her hour"]), style: S.cardAmber },
    { label: h("Messenger (Telegram, MAX, WhatsApp, LINE, Viber)", ["for the eldest who won't install; for casual members", "arrival as one message; button where supported; any reply counts", "commands in her language: stop · start · what does the family see"]), style: S.card },
    { label: h("Voice line and SMS (later)", ["for a parent with a landline", "a call at her hour from a saved number plays the family's voice notes; “press 1 if you're fine, or just say something”", "last in the roadmap, first in importance for 80+"]), style: S.card },
    { label: h("Nearby contact", ["installs nothing", "one message, only when the light stays dark and the organiser asks", "consents once"]), style: S.cardGrey },
  ];
  p.grid(surfaces, { cols: 3, x: 40, y: 110, w: 425, h: 150, gx: 22, gy: 18 });
  const channels = [
    h("Telegram", ["Russia daily leader, CIS, Ukraine", "free bot API, buttons, voice", "throttled in Russia, may be blocked"]),
    h("MAX", ["Russia monthly-reach leader since mid-2026", "official bot API", "state-run: assume everything is readable"]),
    h("WhatsApp Business API", ["Philippines, India, LatAm, Europe, US", "template messages outside 24 h; small per-message cost", "blocked in Russia since Feb 2026"]),
    h("LINE", ["Taiwan, Japan, Thailand", "rich messages", "the Taiwan launch channel"]),
    h("Viber", ["Ukraine, parts of CIS", "bot API"]),
    h("Voice / SMS", ["landline parents", "Twilio-class provider", "TTS + DTMF or speech"]),
    h("In-app", ["members and parents who installed the app", "push: exactly one per member per day"]),
  ];
  p.box(40, 470, 600, 30, "<b>Channel adapters</b> · one contract: send(link, message) · parseWebhook(req) · capabilities{buttons, voiceOut, voiceIn, readReceipts, media}", S.sub);
  p.grid(channels, { cols: 4, x: 40, y: 505, w: 315, h: 90, gx: 20, gy: 14, style: S.card });
  pages.push(p);
}

// ===================== 7. AI LAYER =====================
{
  const p = new Page("7 · Product · AI layer");
  p.title("The AI layer, and the line it never crosses", "Every call uses a versioned prompt and a JSON schema; every output is logged with its input. Strongest model for understanding; cheaper paths for transcription.");
  const calls = [
    { label: h("understand", ["in: answer text/transcript, last 3 summaries, profile", "out: summary · mood words · mentions · flag + reason · away{until}", "guardrail: never quote her to the family; never infer diagnoses"]), style: S.cardGreen },
    { label: h("flag what matters now", ["pain, fall, dizziness, chest or breathing, not eating, hopelessness, a stranger, a “bank” call, money", "to the organiser with her words; calm warm reply to her", "never medical advice"]), style: S.cardAmber },
    { label: h("acknowledge", ["one warm reply to a kept-light member, once a day", "≤ 2 sentences, ≤ 1 question, her language and address form", "never continues into a conversation"]), style: S.card },
    { label: h("prompt the family", ["evening-before suggestion from recent mentions and family dates", "one sentence, one concrete ask", "suggestions only; nothing auto-sent as a person"]), style: S.card },
    { label: h("fallback morning", ["two lines when nobody sent anything", "references yesterday and her weather", "always signed “Vela, from your family”"]), style: S.card },
    { label: h("translate", ["both directions, register-preserving", "the model is told who is speaking to whom", "original shown alongside"]), style: S.card },
    { label: h("weekly read", ["3–5 lines from 7 days of summaries and timing", "“later than usual”, never “concerning”", "one suggestion at most"]), style: S.card },
    { label: h("drift (phase 3)", ["per-person baseline: latency, length, sentiment, vocabulary, topics", "sustained change over 2–3 weeks", "framed as “worth a call”; precision published"]), style: S.cardGrey },
    { label: h("transcribe", ["speech-to-text provider, Claude for cleanup", "member's language, auto-detect fallback", "cached by media id"]), style: S.cardGrey },
  ];
  p.grid(calls, { cols: 3, x: 40, y: 110, w: 425, h: 120, gx: 22, gy: 16 });
  p.box(40, 540, 640, 150, h("Evaluation and cost", [
    "Held-out set of real answers (consented, anonymised), hand-labelled for summary quality, flag correctness, away detection; runs on every prompt change; flag recall must not drop.",
    "Quiet-notice precision comes from quiet_events.outcome, not from the model.",
    "Cost per kept-light member: about $0.01–0.02 per day, $0.30–0.60 per month; under 10% of a $9.99 subscription.",
  ]), S.card);
  p.box(720, 540, 640, 150, h("Hard rules in every prompt", li([
    "No medical, legal, or financial advice",
    "Never pretend to be a family member; if asked, “a helper Anna asked to say good morning”",
    "Never mention monitoring, data, sensors, or that the family receives notes",
    "Reply in the member's language and address form; two sentences",
    "Escalate on the defined signals; a human decides what reaches the family",
  ])), S.cardAmber);
  pages.push(p);
}

// ===================== 8. ARCHITECTURE =====================
{
  const p = new Page("8 · Architecture");
  p.title("Architecture", "One deployable, one database per region, one queue. Detail in architecture/01-technical-design.md; decisions in architecture/decisions.md; drawings in architecture.drawio and database.drawio.");
  p.box(40, 110, 340, 300, "FAMILY SIDE", S.lane);
  p.box(420, 110, 580, 480, "VELA PLATFORM · one Cloudflare Worker", S.lane);
  p.box(1040, 110, 320, 480, "PARENT CHANNELS · adapters", S.lane);
  const app = p.box(60, 140, 300, 100, h("Vela app", ["React Native (Expo) · iOS, Android, web", "parent surface and kitchen-table mode are display modes", "push: one per member per day"]), S.cardGreen);
  const web = p.box(60, 260, 300, 60, h("Web", ["setup · story archive · account · Stripe checkout"]), S.card);
  const api = p.box(440, 140, 260, 90, h("API + webhooks", ["Hono router · Supabase Auth JWT", "answers light the flame synchronously"]), S.cardGreen);
  const sch = p.box(720, 140, 260, 90, h("Scheduler", ["cron every 5 min → due query → queue", "arrivals unique per member per day"]), S.card);
  const gw = p.box(440, 250, 260, 90, h("Outbound gateway", ["the only thing that sends to a person", "budget by kind · idempotency · retries"]), S.cardAmber);
  const ai = p.box(720, 250, 260, 90, h("AI service", ["Claude · structured outputs", "prompt registry · every call logged"]), S.card);
  const db = p.box(440, 360, 260, 90, h("Postgres (Neon) per region", ["eu · apac · us", "answers 30 days rolling · events append-only"]), S.card);
  const r2 = p.box(720, 360, 260, 90, h("Media (R2) + event log", ["voice, photos, drawings; signed URLs", "events partitioned monthly; KPI job reads them"]), S.card);
  const admin = p.box(440, 470, 260, 90, h("Admin view + billing", ["who's quiet, what got flagged, what the model said", "Stripe now; RevenueCat/IAP in phase 2"]), S.cardGrey);
  const ifc = p.box(720, 470, 260, 90, h("Channel interface", ["send(link, msg) · parseWebhook(req)", "capabilities per channel"]), S.card);
  const ch = ["Telegram (prototype = first adapter)", "MAX", "WhatsApp Business API", "LINE", "Viber", "Voice / SMS (later)", "In-app push"].map((t, i) => p.box(1060, 140 + i * 60, 280, 46, "<b>" + t + "</b>", i === 0 ? S.cardGreen : S.card));
  p.edge(app, api); p.edge(web, api); p.edge(sch, gw); p.edge(api, ai); p.edge(api, db); p.edge(api, r2); p.edge(gw, ifc); p.edge(api, admin, S.edgeSoft);
  ch.forEach((c) => p.edge(ifc, c, S.edgeSoft));
  p.box(40, 620, 640, 160, h("Principles that shape the code", li([
    "The flame lights on the raw answer, before any AI runs (nothing on the safety path depends on a model)",
    "One outbound gateway enforces the notification budget: the anti-addiction promise is code",
    "Arrivals are UNIQUE(member_id, day): double sends are impossible even if two crons overlap",
    "Adapters are pure translation layers; a new messenger is a new file",
    "Every AI output is logged with its prompt version; an eval set runs on every prompt change",
  ])), S.cardGreen);
  p.box(720, 620, 640, 160, h("Failure modes, decided", li([
    "Messenger down: retry 30 min, tell the organiser once; the ladder does not fire from our own outage",
    "Worker down at the arrival minute: next tick catches up; late arrivals say “sorry this is late”",
    "AI down: the flame still lights; understanding runs when the queue drains",
    "Wrong time zone: confirmed by the first three answer times; 3-h mismatch triggers a check",
    "A kept-light member dies: schedules stop within the hour; no automated message ever again",
  ])), S.cardRed);
  pages.push(p);
}

// ===================== 9. BUSINESS MODEL =====================
{
  const p = new Page("9 · Business model");
  p.title("Business model", "The free layer spreads; the light pays. Priced at the bottom of the $10–35 band because the payer is often young and the eldest's life is finite.");
  p.box(40, 110, 640, 190, h("Vela · free · for everyone", li([
    "The daily moment, thread, turns, prompts, contributors, translation, story day",
    "Why free: contributors are the growth engine; ~8 relatives per paying family at Famileo; half of Aura's sales come from family invites",
    "Risk: becoming a free messenger with 1% conversion → the free layer is one moment a day, not chat",
  ])), S.card);
  p.box(720, 110, 640, 190, h("Vela Light · $9.99/month or $79/year per kept-light member · +50% for a second", li([
    "The flame, quiet notices, nearby contacts, away mode, weekly read, memory, archive export, drift",
    "Why paid: people pay for the meaning of silence; Snug's $19.99 tier sells exactly this",
    "Trial: 30 days of Light after the first answer, so a family sees one weekly read or one quiet notice before paying",
    "To test in 90 days: $9.99 vs $14.99 vs annual-only; move the line if conversion &lt; 25%",
  ])), S.cardAmber);
  const comps = [
    h("Famileo", ["£5.99–17.99/mo", "260k families, €14M revenue 2024"]),
    h("Snug Dispatch", ["$19.99/mo", "the alert is what sells"]),
    h("Docomo Chikaku", ["¥1,980/mo", "sold in every Docomo shop; Aflac invested"]),
    h("ViewClix", ["$9.95/mo per family", "one fee for the whole family"]),
    h("Germany Hausnotruf", ["€25.50/mo reimbursed", "public price anchor for this outcome"]),
  ];
  p.box(40, 320, 400, 30, "<b>Comparables</b>", S.sub);
  p.grid(comps, { cols: 5, x: 40, y: 350, w: 248, h: 70, gx: 20, gy: 10, style: S.cardGrey });
  p.box(40, 450, 640, 170, h("Unit economics", li([
    "No hardware, no staff on the ladder; AI ≈ $0.30–0.60 per kept-light member per month",
    "Infrastructure under 2% of revenue at every scale (page 8)",
    "LTV capped at 2–4 years per kept-light member → acquisition must stay under $60 per family",
    "Plan: word of mouth inside families and communities; the under-30 member recruits",
    "Payments: Stripe web checkout first; in-app purchases in phase 2 (store rules)",
  ])), S.card);
  p.box(720, 450, 640, 170, h("Scale table (monthly, order of magnitude)", [
    "100 families: infra $0 · AI ~$40 · total &lt; $50 · revenue ~$400",
    "1,000: infra ~$30 · AI ~$400 · total ~$500 · revenue ~$4,000",
    "10,000: infra ~$170 · AI ~$4,000 · total ~$5,000 · revenue ~$40,000",
    "100,000: infra ~$1,700 · AI ~$40,000 · total ~$47,000 · revenue ~$400,000",
    "(revenue assumes 40% of families on Light at $9.99)",
  ]), S.cardGreen);
  pages.push(p);
}

// ===================== 10. GO TO MARKET =====================
{
  const p = new Page("10 · Go to market");
  p.title("Go to market", "Where we start and why; how a family spreads. Channel caution: WhatsApp blocked in Russia since Feb 2026, Telegram throttled, MAX leads reach.");
  const waves = [
    { label: h("Wave 1 · Russian-speaking families", ["sharpest pain among the ~600k who emigrated since 2022 and whose parents stayed", "the founder is one of them and can reach them; hard-currency payers; no product exists", "channel: Telegram communities, personal network; parents via Telegram and MAX"]), style: S.cardGreen },
    { label: h("Wave 2 · Taiwan", ["super-aged since 2025; the founder lives there", "LINE is one adapter away", "channel: LINE; Taiwanese friends; university networks"]), style: S.card },
    { label: h("Wave 3 · Philippines, India, Ukraine, Latin America", ["2.2M overseas Filipino workers; 18.5M Indians abroad", "same family shape at scale; remittance apps already bill this customer monthly", "channel: WhatsApp; Remitly (9M), Wise (15M), Paysend (10M) partnerships"]), style: S.card },
    { label: h("Wave 4 · Germany, UK, Japan", ["insurers and councils reimburse ~€25/mo for this outcome", "no software-only entrant exists in those tenders", "channel: reimbursement codes, with our published precision"]), style: S.card },
  ];
  p.grid(waves, { cols: 4, x: 40, y: 110, w: 315, h: 150, gx: 20, gy: 16 });
  // growth loop
  const g1 = p.box(60, 340, 240, 80, h("A 20-year-old installs Vela", ["for his grandmother"]), S.card);
  const g2 = p.box(360, 340, 240, 80, h("Invites his mother and aunt", ["contributors, free"]), S.card);
  const g3 = p.box(660, 340, 240, 80, h("The mother switches on the light", ["and pays"]), S.cardAmber);
  const g4 = p.box(960, 340, 240, 80, h("The aunt tells her own family", ["a new organiser"]), S.cardGreen);
  p.edge(g1, g2); p.edge(g2, g3); p.edge(g3, g4); p.edge(g4, g1, S.edgeSoft, [[1080, 460], [180, 460]]);
  p.box(40, 480, 1320, 30, "<b>The growth loop</b> · every family is five to eight people; every member is a potential organiser of another family", S.sub);
  p.box(40, 530, 640, 130, h("Later channels", li([
    "Telcos and remittance apps that already bill this exact customer monthly (precedent: AXA × Western Union insurance inside transfers; Aflac invested in Chikaku)",
    "Employers of relocants (IT firms in Yerevan, Tbilisi, Almaty)",
    "Insurers in Germany, the UK, Japan once precision is published",
  ])), S.card);
  p.box(720, 530, 640, 130, h("What we don't do", li([
    "Paid ads before the referral loop works",
    "A single messenger in any market",
    "Care homes as a channel in CIS (no Famileo-style network exists there)",
  ])), S.cardGrey);
  pages.push(p);
}

// ===================== 11. ROADMAP =====================
{
  const p = new Page("11 · Roadmap");
  p.title("Roadmap: twelve months, four phases, each with an exit test", "Dates assume phase 0 starts 14 September 2026. Each phase ends with a decision, not a date.");
  const x0 = 200, monthW = 90, y0 = 120;
  const months = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
  months.forEach((m, i) => p.box(x0 + i * monthW, y0, monthW, 24, m, `text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=${C.ink3};`));
  const rows = [
    ["Phase 0 · prove the loop", 0, 1, S.bar, ["Survey + 20 interviews (wk 1–2)", "Pilot 10–20 families, no app (wk 3–4)"], "Decision 12 Oct"],
    ["Phase 1 · MVP", 1, 3, S.bar, ["App + Telegram/WhatsApp/LINE", "100 families; pricing test; Stripe"], "Exit: conversion > 25%, D30 > 85%"],
    ["Phase 2 · the bridge", 3, 6, S.bar, ["Parent surface, kitchen-table mode, grandchildren tools, translation, story day, memory, MAX, Viber", "Taiwan on LINE · 1,000 families"], "Exit: contributors ≥ 3, family-content > 60%"],
    ["Phase 3 · the read", 6, 12, S.barAmber, ["Drift with published precision, voice line, second-member plans", "First channel partner · 10,000 families · seed on evidence"], "Exit: read trusted and paid"],
  ];
  rows.forEach(([name, m0, m1, st, notes, exit], i) => {
    const y = y0 + 40 + i * 110;
    p.box(40, y, 150, 40, "<b>" + name + "</b>", S.small);
    p.box(x0 + m0 * monthW, y, (m1 - m0) * monthW, 40, notes[0], st);
    p.box(x0 + m0 * monthW, y + 46, (m1 - m0) * monthW, 30, notes[1], S.small);
    p.box(x0 + m1 * monthW - 12, y + 8, 24, 24, "", S.milestone);
    p.box(x0 + m1 * monthW + 16, y + 6, 220, 30, exit, S.small);
  });
  p.box(40, 600, 1320, 160, h("Exit tests", li([
    "Phase 0: answer rate > 85%; family-content days > 30% by week two; ≥ 4 families paying; parents not refusing",
    "Phase 1: Light conversion > 25%; D30 > 85%; answer rate > 85%; members per family ≥ 5",
    "Phase 2: contributors ≥ 3; family-content days > 60%; 2–4 minutes in app per day; Sean Ellis > 40%",
    "Phase 3: the drift read is trusted and paid for; a channel partner signed or rejected with reasons; a seed round on evidence",
  ])), S.card);
  pages.push(p);
}

// ===================== 12. PHASE 0 =====================
{
  const p = new Page("12 · Phase 0 · four weeks");
  p.title("Phase 0: prove the loop before building the app", "Founder: interviews, recruiting, ops. Co-founder: materials, prototype, metrics. Ticks live on the master plan page; this is the map.");
  const weeks = ["Week 1 · survey out, first interviews", "Week 2 · interviews, close pilot families", "Week 3 · pilot live", "Week 4 · measure and decide"];
  weeks.forEach((w, i) => p.box(200 + i * 290, 110, 270, 30, "<b>" + w + "</b>", S.sub));
  p.box(40, 150, 1320, 300, "FOUNDER", S.lane);
  p.box(40, 470, 1320, 300, "CO-FOUNDER (AI)", S.laneAmber);
  const founder = [
    ["Create the Telegram bot, Cloudflare account, Anthropic key (20 min)", "Decide repo visibility", "Post the survey in three places today", "Book 8 interviews", "Show your parent a mock of the arrival; write down her words"],
    ["Interviews 9–16, each ending with the pilot offer ($15, refundable)", "10 families confirmed: eldest + organiser + one under-30", "Collect messengers, wake times, two nearby contacts each"],
    ["Onboard 10–15 families; parent call yourself for the first five", "Daily 15-minute check; log false notices and complaints", "Write the weekly read by hand on Sunday", "Interview anyone who declined or dropped"],
    ["Day-14 check-in: “If Vela stopped tomorrow…”", "Ask each parent: do you like getting this in the morning?", "Two introductions from each paying family", "Decision: build the MVP or change one variable"],
  ];
  const cof = [
    ["Survey intro and posts for all-families framing", "Prototype: family content in the arrival, quiet notice to the child, away mode", "Landing page with waitlist and two price points", "Weekly review template, decisions log"],
    ["Deploy the prototype; 3-day test with the founder's parent", "Onboarding script (5 min child, 5 min parent)", "Interview synthesis: objections, yes-reasons, prices, wish/worry"],
    ["Run the loop daily; tune quiet times", "Daily metrics: answer rate, latency, family-content days, notices and whether true, opt-outs"],
    ["Phase-0 report and MVP scope cut to what was proven", "Pitch deck v1 from evidence"],
  ];
  founder.forEach((items, i) => p.box(200 + i * 290, 180, 270, 260, li(items), S.card));
  cof.forEach((items, i) => p.box(200 + i * 290, 500, 270, 260, li(items), S.cardAmber));
  p.box(40, 790, 1320, 60, "<b>Kill signals:</b> fewer than 4 families paying after 20 interviews · more than 30% of parents refusing or going silent in week one for reasons other than being away · family-content days under 30% by week two despite prompts", S.cardRed);
  pages.push(p);
}

// ===================== 13. METRICS =====================
{
  const p = new Page("13 · Metrics");
  p.title("What we measure, and the 90-day targets", "The precision number is the one nobody else publishes.");
  const m = [
    ["Kept-light answer rate", "Is she opening it with joy?", "> 85%"],
    ["Median answer latency", "Habit; feeds quiet tuning", "< 60 min"],
    ["Family-content days", "Is the family present, or is Vela carrying it?", "> 60%"],
    ["Members / active contributors per family", "Growth engine", "≥ 5 / ≥ 3"],
    ["Under-30 member in family", "Is “closer” landing with the young?", "60% of families"],
    ["Quiet notices per member per month; share true", "Precision, published", "< 2; > 50%"],
    ["Light conversion after trial; D90 retention", "The business", "> 25%; > 80%"],
    ["“Stop” rate among kept-light members", "Dignity", "< 5%"],
    ["Minutes in app per member per day", "The anti-addiction promise", "2–4"],
    ["“If Vela stopped tomorrow…” very disappointed", "Product-market fit", "> 40%"],
  ].map(([a, b, c]) => h(a, [b, "<b>target: " + c + "</b>"]));
  p.grid(m, { cols: 5, x: 40, y: 110, w: 248, h: 100, gx: 20, gy: 16, style: S.card });
  p.box(40, 360, 1320, 90, h("How they're computed", ["A nightly KPI job reads the append-only events table, never the live tables, and writes metrics_daily. Quiet-notice precision comes from quiet_events.outcome recorded by the organiser, not from any model. Reported weekly on the master plan page."]), S.cardGrey);
  pages.push(p);
}

// ===================== 14. RISKS =====================
{
  const p = new Page("14 · Risks");
  p.title("Risks, named now", "Each with its mitigation. Reviewed at every phase exit.");
  const r = [
    ["The family goes quiet after week three, like every group chat", "Turns, prompts from their own words, the under-30 contributor, the Vela fallback; family-content days reviewed weekly as a bug when they drop"],
    ["The eldest feels watched", "Symmetry, “stop”, story day, everything arrives from people; ask her directly at week two"],
    ["The young see it as their parents' app", "The closeness promise is theirs; own flame on their terms; tested with under-30s in phase 0"],
    ["We become a free messenger with 1% conversion", "Free layer is one moment a day, not chat; paid layer is silence semantics; move the line if conversion < 25% at 90 days"],
    ["False quiet notices erode trust", "Per-person tuning, away mode, never before +4 h, published precision, notice as information not alarm"],
    ["Messenger platform risk", "Adapters; never single-channel in a market; the app and the voice line as floors"],
    ["A kept-light member is found late despite Vela", "Honest promise from day one; the language written before the first customer"],
    ["Data law (Russia localisation, GDPR, PDPA)", "Minimum data, per-region storage, legal review per market"],
    ["Solo non-technical founder; consumer AgeTech funding down 48% in 2026", "AI co-founder builds; prototype exists; revenue from day one; a human technical co-founder from the batch or network"],
  ].map(([a, b]) => h(a, ["<b>Mitigation:</b> " + b]));
  p.grid(r, { cols: 3, x: 40, y: 110, w: 425, h: 120, gx: 22, gy: 16, style: S.cardRed });
  pages.push(p);
}

// ===================== 15. DECISIONS =====================
{
  const p = new Page("15 · Decisions");
  p.title("Decisions log", "Append, never rewrite. Architecture decisions with rejected alternatives are in architecture/decisions.md.");
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
    ["2026-09-12", "The master plan page's checklist is the one task tracker. Asana CSV as optional export; Trello dropped."],
    ["2026-09-12", "Architecture: Cloudflare Workers + Postgres per region + adapters; flame lights before AI; gateway enforces the budget; Stripe first, IAP in phase 2; Russia = legal review before launch."],
  ].map(([date, text]) => `<span style="color:${C.ink3};font-family:monospace">${date}</span> · ${text}`);
  p.grid(d, { cols: 2, x: 40, y: 110, w: 650, h: 70, gx: 20, gy: 12, style: S.cardGrey });
  p.box(40, 620, 1320, 100, h("Open for decision (founder)", li([
    "Company jurisdiction: Delaware if ikigai says yes, otherwise Estonia for cost; affects Stripe, store accounts, data residency",
    "Payments: confirm Stripe web checkout first, in-app purchases in phase 2",
    "Data residency: EU default, APAC for Taiwan; Russian localisation law reviewed by a lawyer before any Russian launch",
    "Brand: check vela.app and close domains, trademark conflicts in the first markets",
  ])), S.cardAmber);
  pages.push(p);
}

// ---------- write ----------
const file = `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="Vela generator" version="24.0.0">${pages.map((p) => p.xml()).join("")}</mxfile>`;
writeFileSync(OUT, file, "utf8");
console.log(`wrote ${OUT} · ${pages.length} pages · ${file.length} bytes`);
