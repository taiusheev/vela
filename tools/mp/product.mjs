import { Page, S, h, li } from "./lib.mjs";

export function product() {
  const pages = [];

  // 3.1 The family and the two promises
  {
    const p = new Page("3.1 · The family and the two promises");
    let y = p.title("One family, three generations, two promises", "The unit is the family, not a pair. Anyone the family worries about can carry a light; it is opt-in and visible to them.");
    const thread = p.box(470, y + 200, 460, 110, h("The family's daily thread", ["one moment a day · no feed · no strangers · no ads · free", "turns · prompts · grandchildren · translation · story day · memory"]), S.cardGreen);
    const gm = p.box(60, y, 300, 130, h("Grandmother · 78 · lives alone", ["joins through her messenger; installs nothing", "<b>light on</b>: her answer is the sign of life", "story day makes her the author, not the patient"]), S.cardAmber);
    const student = p.box(1040, y, 300, 130, h("Student · 20 · abroad", ["best contributor: a 10-second voice note gets the strongest reply", "best recruiter: invites the family", "<b>own light, opt-in</b>, while abroad, on his terms"]), S.cardAmber);
    const parent = p.box(550, y + 420, 300, 130, h("Parent · 45 · organiser · pays", ["both a child (of the 78-year-old) and a parent (of the 20-year-old)", "sets up the family, names the nearby contacts", "gets the light, the weekly read, the quiet notice"]), S.card);
    const neighbour = p.box(60, y + 420, 300, 110, h("Nearby contact · neighbour, cousin", ["consents once", "called only when the light stays dark", "never receives anything else"]), S.cardGrey);
    p.edge(gm, thread); p.edge(student, thread); p.edge(parent, thread); p.edge(neighbour, thread, S.edgeSoft);
    y += 600;
    y = p.table(40, y, [{ w: 150, title: "Role" }, { w: 330, title: "Typically" }, { w: 200, title: "Installs" }, { w: 120, title: "Pays" }, { w: 520, title: "What they get" }], [
      ["Member", "Anyone in the family, any age", "The app; or nothing (messenger bot)", "No", "The daily moment, the thread, turns and prompts, translation, story day, memory"],
      ["Organiser", "The one who sets the family up; usually the 40–55-year-old in the middle", "The app", "Yes, if the family keeps a light on for someone", "Everything, plus lights, quiet notices, weekly reads"],
      [{ label: "Kept-light member", style: S.tdAmber }, "The grandmother who lives alone; the student abroad; anyone the family chooses and who agrees", "The app if they can; their messenger if not; a landline later", "No", "A daily arrival from people who love them; nothing to learn; the right to say “stop”"],
      ["Nearby contact", "A neighbour, a relative in the same town", "Nothing", "No", "One message, only when the light hasn't lit and the organiser asks; consents once"],
    ]);
    y += 20;
    p.box(40, y, 640, 150, h("Closer · free · for everyone", li([
      "One moment a day, then the app closes",
      "Turns: each member gets a day; a prompt arrives the evening before",
      "Prompts that know the family, drawn from what people actually said",
      "Grandchildren first-class: voice, drawing, photo without writing",
      "Translation both ways, keeping her form of address",
      "Story day: one question a week; her answers become a book",
      "Memory: the Thursday appointment, the exam, the neighbour's name",
    ])), S.card);
    p.box(720, y, 640, 150, h("Calmer · Vela Light · paid", li([
      "The light: her daily answer lights it on the family's home screen",
      "Quiet notice to the organiser after her usual window (never before +4 h); nearby contacts one tap away",
      "Away mode: “going to my sister's until Sunday” pauses everything",
      "Weekly read: how she really is, in neutral words, from her own replies",
      "Memory and reminders, story archive export, later drift with published precision",
      "Nothing to install, wear, or charge. The family acts; Vela never knocks",
    ])), S.cardAmber);
    pages.push(p);
  }

  // 3.2 Daily loop
  {
    const p = new Page("3.2 · The daily loop");
    let y = p.title("The daily loop and the quiet ladder", "product/03-product-spec.md §3–5. Silence only matters for members with a light.");
    const lanes = [["THE FAMILY (any member, any time)", y, S.lane], ["VELA (scheduler + AI)", y + 150, S.lane], ["THE KEPT-LIGHT MEMBER", y + 360, S.lane], ["THE ORGANISER (when the light stays dark)", y + 510, S.laneAmber]];
    lanes.forEach(([t, yy, st]) => p.box(40, yy, 1320, 130, t, st));
    const q = p.box(60, y + 30, 260, 80, h("Queue something", ["voice · photo · drawing · question", "for today or “whenever”"]), S.card);
    const turn = p.box(340, y + 30, 300, 80, h("Evening before: turn prompt", ["“Tomorrow is Sam's day. She mentioned the tomatoes; ask for a photo.”"]), S.card);
    const thread = p.box(1060, y + 30, 280, 80, h("Thread updates", ["her answer, transcribed and translated;", "whoever's content she answered is told"]), S.cardGreen);
    const compose = p.box(60, y + 180, 360, 90, h("Compose the arrival (her hour)", ["1 queued for today · 2 queued “whenever” (max 2)", "3 story question (story day) · 4 Vela fallback, signed as Vela", "one photo visible · voice as voice · her language and address form"]), S.card);
    const read = p.box(680, y + 180, 340, 90, h("Read the answer (after the light lit)", ["transcribe · one neutral line · mood words · mentions", "flag: none | escalate → organiser with her words", "away detected? confirm back"]), S.card);
    const light = p.box(1060, y + 180, 280, 60, h("Light lights", ["on the raw answer, before any AI", "repeat and quiet cancelled"]), S.cardAmber);
    const repeat = p.box(440, y + 240, 220, 40, "<b>+2.5 h, no answer:</b> repeat once", S.cardGrey);
    const arrive = p.box(60, y + 390, 360, 90, h("One message", ["“Good morning, Mrs Ivanova…” + Mia's photo", "[ ☀️ I'm fine ]  🎤   (or: reply with anything, even a heart)"]), S.card);
    const answer = p.box(680, y + 390, 340, 90, h("One easy answer", ["tap · heart · voice · text · photo; anything counts", "“stop” turns the light off; the organiser is told"]), S.cardGreen);
    const notice = p.box(680, y + 540, 340, 90, h("Quiet notice · arrival + T_quiet", ["T_quiet = median latency (14 d) + 2 h, floor 4 h, cap 8 h", "last contact · usual time · yesterday's words", "[Call] [Ask to check] [She's away] [Wait 2 h]"]), S.cardAmber);
    const acts = p.box(1060, y + 540, 280, 90, h("The family acts", ["a call, a neighbour's knock", "Vela never knocks", "auto-ask a contact only if opted in"]), S.card);
    p.box(60, y + 540, 360, 90, h("Precision accounting", ["every notice records an outcome:", "answered late · away · true concern · unknown", "precision = true concern ÷ notices, published monthly"]), S.cardGrey);
    p.edge(q, compose); p.edge(turn, q); p.edge(compose, arrive); p.edge(arrive, answer); p.edge(answer, light); p.edge(light, read); p.edge(read, thread);
    p.edge(arrive, repeat, S.edgeSoft); p.edge(repeat, notice, S.edgeAmber); p.edge(notice, acts);
    y += 670;
    p.table(40, y, [{ w: 200, title: "Step" }, { w: 260, title: "When" }, { w: 860, title: "What happens" }], [
      ["Arrival", "member's arrival hour (default wake + 30 min; 08:00 for ordinary members)", "One message with the family's content and one reply affordance. Never more than one a day. Ordinary members get nothing on an empty day; kept-light members get the Vela fallback."],
      ["Repeat", "arrival + 2.5 h, no answer, kept-light only", "The same arrival re-sent once with “in case you missed it”"],
      ["Quiet notice", "arrival + T_quiet (5 h to start; then median latency + 2 h, floor 4 h, cap 8 h; Sunday median if it differs by >1 h)", "Organiser gets: last contact, usual answer time, yesterday's summary, nearby contacts with Call and Ask to check, She's away, Wait 2 hours"],
      ["Auto-ask (opt-in)", "notice + T_auto, no organiser action", "“Anna asked us to check on Mrs Ivanova; she hasn't answered today. Could you knock or call?” to the first consented contact"],
      ["Resolution", "any answer, or the organiser marks fine or away", "Notice closes; everyone who was told is told it's fine; outcome recorded"],
      ["Away mode", "set by anyone; said in an answer (“until Sunday”, confirmed back); learned after three recurrences", "Arrivals continue (people like them); repeats and notices do not; ends on the date or on any answer if “until I'm back”"],
    ]);
    pages.push(p);
  }

  // 3.3 Member states and consent
  {
    const p = new Page("3.3 · States and consent");
    let y = p.title("Member states, light states, and consent", "State machines the app and the ladder follow. Consent is a product decision, not a checkbox.");
    y = p.h2(y, "Light state (kept-light member, per day)");
    const sx = 60, sy = y + 10;
    const unlit = p.box(sx, sy, 170, 60, "Unlit<br><span style=\"font-weight:normal;font-size:10px\">light on, no answer yet, within her window</span>", S.state);
    const lit = p.box(sx + 300, sy, 170, 60, "Lit<br><span style=\"font-weight:normal;font-size:10px\">answered today (any kind)</span>", S.stateAmber);
    const quiet = p.box(sx + 300, sy + 130, 170, 60, "Quiet<br><span style=\"font-weight:normal;font-size:10px\">past T_quiet, no answer, not away</span>", S.state);
    const away = p.box(sx, sy + 130, 170, 60, "Away<br><span style=\"font-weight:normal;font-size:10px\">away mode active</span>", S.stateGrey);
    const paused = p.box(sx + 600, sy + 65, 170, 60, "Paused / Off<br><span style=\"font-weight:normal;font-size:10px\">“stop”, or member paused</span>", S.stateGrey);
    p.edge(unlit, lit, S.edge, [], "any answer");
    p.edge(unlit, quiet, S.edgeAmber, [], "T_quiet elapsed");
    p.edge(quiet, lit, S.edge, [[sx + 385, sy + 100]], "late answer → notice closes");
    p.edge(unlit, away, S.edgeSoft, [], "away set / said / learned");
    p.edge(away, unlit, S.edgeSoft, [[sx + 85, sy + 100]], "date reached or “I'm back”");
    p.edge(lit, paused, S.edgeSoft, [], "“stop”");
    p.edge(paused, unlit, S.edgeSoft, [[sx + 685, sy - 30], [sx + 85, sy - 30]], "“start” / resume");
    y = sy + 230;
    y = p.h2(y, "Membership status");
    y = p.table(40, y, [{ w: 140, title: "Status" }, { w: 500, title: "Meaning" }, { w: 680, title: "Transitions" }], [
      ["invited", "Link or invite sent; not yet accepted", "→ active on accept; expires after 30 days"],
      ["active", "Normal", "→ paused (“stop for now” from either side); → left (removed or leaves)"],
      ["paused", "No arrivals, no ladder; thread visible", "→ active on “start” or resume; the organiser is told when a kept-light member pauses"],
      ["left", "Removed; data retained 30 days then deleted", "→ deleted after 30 days; re-invite creates a new membership"],
    ]);
    y += 20;
    y = p.h2(y, "Consent, by surface");
    p.table(40, y, [{ w: 240, title: "Moment" }, { w: 540, title: "What is said, and by whom" }, { w: 540, title: "What is recorded" }], [
      ["Light on, messenger", "First message from Vela: “Anna would like to keep a light on for you: every morning something from the family, and if you don't answer, she'll know to call. Tap Yes or write no.”", "members.light_consented_at, the consent text as an event, the channel"],
      ["Light on, parent surface", "A screen with the same words and two buttons", "same"],
      ["Light on, self", "A member switches their own light on (the student abroad)", "implicit consent; visible in their settings"],
      ["Nearby contact", "Message from Vela on the organiser's behalf: who, why, what they may be asked, one tap to agree", "nearby_contacts.consented_at; until then only the organiser may call them directly"],
      ["“What the family sees”", "Any kept-light member asks in chat or taps the button: last 7 summary lines and the last weekly read", "event; symmetry is a promise, not a setting"],
      ["“Stop”", "Any refusal word in her language turns the light off and pauses arrivals; the organiser is told without judgement", "status paused; light off; event"],
    ]);
    pages.push(p);
  }

  // 3.4 Features: closer
  {
    const p = new Page("3.4 · Closer: the free layer");
    let y = p.title("What makes the family closer (free, for everyone)", "These are the features that make the group chat look like what it is: chaos that goes quiet. Spec §7–10.");
    y = p.table(40, y, [{ w: 180, title: "Feature" }, { w: 520, title: "How it works" }, { w: 620, title: "Why, with evidence" }], [
      ["One moment a day, then closed", "Each member gets exactly one arrival at their hour and one turn prompt at most; the app has no feed, no badges, no other notifications", "BeReal's core opens within 3 min of one daily push; Locket reached 80M downloads feed-free; the anti-addiction promise and the engagement design are the same thing"],
      ["Turns", "Round-robin among members who opted in (default all except kept-light), one per day, skipping days that already have queued content; prompt the evening before at 19:00 local; skipping has no consequence except the fallback", "Five busy people produce a rhythm no single busy child can sustain; no guilt-tripping copy"],
      ["Prompts that know the family", "From the kept-light member's recent mentions, family dates, and the contributor's last item; one sentence, one concrete ask: “She mentioned the tomatoes; ask for a photo”", "Kinsome does generic prompts; ours come from her own words; prompts are suggestions and never auto-sent as a person"],
      ["Grandchildren first-class", "Kids draw or record with a parent's phone; teens send a photo without writing; contributions are attributed to the child", "Famileo: grandchildren post the most; their content gets the strongest replies and is what the eldest keeps"],
      ["Translation both ways", "Every item shown in the reader's language with the original one tap away; register preserved (address form, diminutives, the grandchild's tone); the model is told who speaks to whom", "Reconnects families that lost a shared language (Russian grandmother, English-and-Chinese grandchild in Taipei); nobody offers it"],
      ["Story day", "Weekly (Sunday) question from a curated bank for kept-light members; answers transcribed, translated, kept in the archive unless she says “don't keep that one”; export to a PDF book in phase 2", "Storyworth built a company on this alone; here it is one day in seven and gives her a reason to reply that is about her"],
      ["Memory", "AI extracts dated facts from answers (“doctor on Thursday”) and proposes a reminder to the relevant member; created only on a tap; surfaces in prompts and the weekly read; never shown to her as “we noticed”", "The family remembers more; she feels heard"],
      ["Her side of the bridge", "She can send anything to the family any time through the same chat; it lands in the thread, transcribed and translated", "The channel is two-way; the morning is just the guaranteed moment"],
      ["The safe place", "No ads, no strangers, no discovery, no infinite scroll; stated on the landing page", "Positioning against social media; measured as 2–4 minutes in app per member per day"],
    ]);
    y += 20;
    p.box(40, y, 1320, 90, h("Languages", ["MVP: English, Russian, Traditional Chinese. Phase 2: Ukrainian, Tagalog, Hindi, Spanish, Japanese, Korean, German. English is authored first; every string has a key; translations reviewed by a native speaker before a market launch."]), S.cardGrey);
    pages.push(p);
  }

  // 3.5 Features: calmer
  {
    const p = new Page("3.5 · Calmer: Vela Light");
    let y = p.title("What makes the family calmer (paid, per kept-light member)", "Spec §4–5, §11. The paid reason is the meaning of silence and the read, never messaging.");
    y = p.table(40, y, [{ w: 180, title: "Feature" }, { w: 520, title: "How it works" }, { w: 620, title: "Rules" }], [
      [{ label: "The light", style: S.tdAmber }, "Her first answer of the day lights it on the family's home screen; that is the whole dashboard", "Lights on the raw answer before any AI; no scores, no charts"],
      [{ label: "Quiet notice", style: S.tdAmber }, "After her tuned window: last contact, usual time, yesterday's summary, nearby contacts with Call and Ask to check, She's away, Wait 2 hours", "Never before +4 h; never during away; closes itself on any answer; everyone told is told it's fine; outcome recorded for precision"],
      [{ label: "Nearby contacts", style: S.tdAmber }, "Two people named at setup; consent once; one tap to call; one tap to ask them to check; optional auto-ask after T_auto if the organiser doesn't respond", "Never contacted for anything else; the family decides, Vela never knocks"],
      [{ label: "Away mode", style: S.tdAmber }, "Set by anyone, said in an answer (confirmed back), or learned after three recurrences (Sunday church)", "Arrivals continue; repeats and notices pause; the single biggest false-alarm killer"],
      [{ label: "Weekly read", style: S.tdAmber }, "Sunday: answered N of 7; usual time and drift vs last week (only if >30 min); topics; anything mentioned twice; voice-note length drift (only if >40%); one suggestion", "“Later than usual”, never “concerning”; no scores; she can read it too"],
      [{ label: "Memory and reminders", style: S.tdAmber }, "Dated facts from her answers become reminders to the right member on a tap", "Never silent; appears as the family asking"],
      [{ label: "Story archive export", style: S.tdAmber }, "The kept stories as a PDF book (phase 2); print partner optional (phase 3)", "She is the author; she can drop any story"],
      [{ label: "Drift (phase 3)", style: S.tdAmber }, "Per-person baselines of latency, length, sentiment, vocabulary, topics; sustained change over 2–3 weeks", "Conservative thresholds; framed as “worth a call”; precision published"],
    ]);
    y += 20;
    p.box(40, y, 640, 140, h("Escalation flags (both layers)", li([
      "Health words: pain, fall, dizziness, chest, breathing, not eating",
      "Hopelessness or not wanting to live",
      "A stranger at the door; “the bank called”; a request for money",
      "On a flag: the organiser gets her words verbatim (the one place we quote, because the organiser must judge); the reply to her is calm and warm; nothing goes to nearby contacts automatically",
    ])), S.cardRed);
    p.box(720, y, 640, 140, h("Vela's own replies to a kept-light member", li([
      "At most one warm acknowledgement per day, two sentences, at most one question, her language and address form",
      "Never medical advice; never continues into a conversation; a second message the same day gets a fixed sign-off or nothing",
      "Always honest if asked: “a helper Anna asked to say good morning”",
      "The phase-0 prototype allows four turns; the MVP allows one",
    ])), S.card);
    pages.push(p);
  }

  // 3.6 Surfaces and channels
  {
    const p = new Page("3.6 · Surfaces and channels");
    let y = p.title("Surfaces and channels", "The eldest never learns anything new. No family is told “your grandmother's messenger isn't supported”; no adapter, no launch in that market.");
    y = p.table(40, y, [{ w: 200, title: "Surface" }, { w: 220, title: "For whom" }, { w: 480, title: "Must" }, { w: 420, title: "Must not" }], [
      [{ label: "The app (iOS, Android, web)", style: S.tdGreen }, "Every member who can install", "Lights and today's moment first; thread; queue; turns; own light settings; language; invite", "A feed; badge counts; anything that rewards frequent opening"],
      [{ label: "Parent surface (same app, simplified)", style: S.tdAmber }, "The eldest, when a child installs it on a visit", "One screen: the arrival; one big answer button; voice reply; call the organiser; “what the family sees”; “stop”; 18 pt text, 64 pt buttons, 7:1 contrast; everything read aloud", "Menus, settings, small text"],
      [{ label: "Kitchen-table mode", style: S.tdAmber }, "An old phone or tablet on her table", "Cycle family photos when idle; wake to the arrival; tap anywhere to answer; large clock", "Notifications or sounds beyond a gentle chime at her hour"],
      ["Messenger (Telegram, MAX, WhatsApp, LINE, Viber)", "The eldest who won't install; casual members", "Arrival as one message; button where supported; any reply counts; commands in her language: stop, start, what does the family see", "Chat beyond the one acknowledgement; links to install anything"],
      ["Voice line and SMS (later)", "A parent with a landline", "A call at her hour from a saved number; play the family's voice notes; “press 1 if you're fine, or just say something”", "Menus deeper than one level"],
      ["Nearby contact", "Neighbour, relative in town", "One message only when asked; consent once", "Anything else, ever"],
    ]);
    y += 20;
    y = p.h2(y, "Channel adapters");
    p.table(40, y, [{ w: 160, title: "Channel" }, { w: 300, title: "Where it matters" }, { w: 430, title: "Technical notes" }, { w: 430, title: "Risk and status" }], [
      [{ label: "Telegram", style: S.tdGreen }, "Russia (daily-reach leader: 72M daily, Mar 2026), CIS diaspora, Ukraine", "Free Bot API (~30 msg/s); inline buttons; voice both ways; the prototype bot is the first adapter", "Throttled in Russia since Feb 2026; calls blocked since Aug 2025; full block floated; never the only channel in Russia"],
      ["MAX", "Russia (monthly-reach leader since May/June 2026: 86.2M)", "Official bot and mini-app API (dev.max.ru); CRM integrations; agencies migrating bots from Telegram", "State-run; age ID via Gosuslugi; assume every message is readable; required for Russian parents"],
      ["WhatsApp Business API", "Philippines, India, LatAm, Europe, US", "Cloud API; template messages outside the 24-h window; utility $0.0014–0.0077 per message; business verification; no bots in groups", "Blocked in Russia since 11 Feb 2026; daily arrival may be classified as marketing: test with Meta before the Philippines launch"],
      ["LINE", "Taiwan, Japan, Thailand", "Messaging API; rich messages; the Taiwan launch channel", "Fine; Japanese LINE見守り precedents exist (Enrich, SunLove)"],
      ["Viber", "Ukraine, parts of CIS", "Bot API", "Phase 2"],
      ["Voice / SMS", "Parents with no smartphone (Japan 80+: 19% use a smartphone for internet)", "Twilio-class provider; TTS for text; plays voice notes; DTMF or speech for the answer", "Last in the roadmap, first in importance for 80+; carrier coverage in Russia and Taiwan to verify"],
      ["In-app", "Members and parents who installed the app", "Push via Expo (APNs, FCM); exactly one per member per day", "—"],
    ]);
    pages.push(p);
  }

  // 3.7 AI layer
  {
    const p = new Page("3.7 · The AI layer");
    let y = p.title("The AI layer, and the line it never crosses", "Every call uses a versioned prompt and a JSON schema; every output is logged with its input. Technical design §6.");
    y = p.table(40, y, [{ w: 130, title: "Call" }, { w: 330, title: "Input" }, { w: 330, title: "Output (structured)" }, { w: 120, title: "Model / effort" }, { w: 410, title: "Guardrail" }], [
      ["transcribe", "audio, language hint", "text, detected language", "STT provider; Claude for cleanup", "Cached by media id; member's language with auto-detect fallback"],
      [{ label: "understand", style: S.tdGreen }, "answer text or transcript; last 3 summaries; profile (address form, language)", "summary (one neutral line) · mood_words[] (fixed vocabulary) · mentions{people, places, plans, health, dates} · flag + reason · away{until} · language", "Claude, effort low", "Never quote her to the family; never infer diagnoses; one call per answer"],
      [{ label: "flag", style: S.tdAmber }, "part of understand", "none | escalate, with a plain one-sentence reason", "—", "To the organiser with her words; calm warm reply to her; never medical advice; a human decides what reaches the family"],
      ["acknowledge", "understand output; profile", "one warm reply, ≤2 sentences, ≤1 question", "Claude, effort low", "Kept-light members only, once a day; never continues; honest if asked"],
      ["translate", "text; from; to; speaker→listener relationship", "translation", "Claude, effort low", "Register-preserving; original shown alongside"],
      ["prompt", "recent mentions; family dates; contributor's last item", "one sentence", "Claude, effort low", "Suggestion only; nothing auto-sent as a person"],
      ["fallback", "yesterday's summary; weather; address form", "two lines", "Claude, effort low", "Always signed “Vela, from your family”; never pretends to be family"],
      ["weekly_read", "7 days of summaries; timing stats; mentions", "3–5 lines + one suggestion", "Claude, effort medium", "“Later than usual”, never “concerning”; one suggestion at most"],
      ["drift (phase 3)", "21 days of stats", "signals[] with confidence", "model + rules", "Conservative; “worth a call”; precision published"],
    ]);
    y += 20;
    p.box(40, y, 430, 170, h("Prompt registry and evaluation", li([
      "Each call has a versioned system prompt (ai/prompts/<name>.v<N>.md); the version is stored on every log row",
      "Structured outputs via JSON schema (Zod); parse failures fall back to a safe default (no flag, summary “answered”)",
      "Held-out set of real, consented, anonymised answers, hand-labelled for summary quality, flag correctness, away detection; runs on every prompt change; flag recall must not drop",
      "Quiet-notice precision comes from quiet_events.outcome, not from the model",
    ])), S.card);
    p.box(490, y, 430, 170, h("Cost", li([
      "Per kept-light member per day: ~1 understand (≈1.5k tokens in, 200 out), ~1 acknowledge, occasional translate",
      "At $5/$25 per million tokens: $0.01–0.02 per day, $0.30–0.60 per month",
      "Weekly read adds ~$0.05 per week",
      "Under 10% of a $9.99 subscription even with the strongest model; first thing to optimise at 10,000+ families",
    ])), S.card);
    p.box(940, y, 420, 170, h("Hard rules in every prompt", li([
      "No medical, legal, or financial advice",
      "Never pretend to be a family member",
      "Never mention monitoring, data, sensors, or that the family receives notes",
      "Reply in the member's language and address form; two sentences",
      "Escalate on the defined signals",
    ])), S.cardAmber);
    pages.push(p);
  }

  // 3.8 Edge cases, copy, accessibility
  {
    const p = new Page("3.8 · Edge cases, copy, accessibility");
    let y = p.title("Edge cases we've decided, copy principles, accessibility", "Spec §14–16. Decided now so nobody re-decides them at 2 a.m.");
    y = p.table(40, y, [{ w: 520, title: "Case" }, { w: 800, title: "Decision" }], [
      ["DST change on arrival day", "Arrival at the local wall-clock hour; if the hour doesn't exist, the next valid minute"],
      ["Two organisers disagree (one marks away, one calls)", "Both actions logged; away wins for the ladder; both see each other's action"],
      ["Member changes phone number", "Messenger link breaks; app shows “we lost Mom's Telegram”; re-invite flow"],
      ["Family in two countries with different holidays", "Holidays follow the kept-light member's country"],
      ["Kept-light member answers before the arrival is sent", "Counts as today's answer; the arrival still goes out"],
      ["One parent, two children set up separately", "Second setup detects the same channel identity and offers “join Anna's family”; MVP allows both; phase 2 merges"],
      ["Organiser stops paying", "Light features stop after a 14-day grace; arrivals and the thread continue free; nobody is cut off from family"],
      ["A kept-light member dies", "Any member marks it; all schedules stop within the hour; the archive is offered for export; no automated message of any kind afterwards; the family record is kept read-only for a year, then deleted unless exported"],
      ["Our own outage at the arrival minute", "The next tick catches up; arrivals more than 3 h late say “sorry this is late”; the ladder never fires from our own outage"],
    ]);
    y += 20;
    p.box(40, y, 640, 170, h("Copy principles", li([
      "Address people by name. Never “the parent”, “the user”",
      "Neutral over alarming: “hasn't answered yet”, not “no response detected”",
      "Say what happens next: every notice ends with the one thing the reader can do",
      "The kept-light member is never described as monitored, checked on, or tracked, in any surface, including ours to the family",
      "English authored first; every string keyed; native review before a market launch",
    ])), S.card);
    p.box(720, y, 640, 170, h("Accessibility (parent surface and messenger)", li([
      "Minimum 18 pt text; buttons at least 64 pt tall; contrast 7:1",
      "Voice everywhere: every text can be read aloud; every reply can be spoken",
      "No time-limited interactions; nothing disappears",
      "Android 8+ and iOS 15+ for the app; the messenger path works on anything that runs the messenger",
      "Kitchen-table mode: large clock, gentle chime, tap anywhere",
    ])), S.card);
    pages.push(p);
  }

  return pages;
}
