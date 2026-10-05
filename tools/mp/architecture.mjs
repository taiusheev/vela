import { Page, S, h, li } from "./lib.mjs";

export function architecture() {
  const pages = [];

  // 4.1 Components
  {
    const p = new Page("4.1 · Components");
    let y = p.title("Architecture: components", "One deployable, one database per region, one queue. architecture/02-technical-architecture-v2.md §2; drawing in architecture.drawio.");
    p.box(40, y, 340, 300, "FAMILY SIDE", S.lane);
    p.box(420, y, 580, 480, "VELA PLATFORM · one Cloudflare Worker", S.lane);
    p.box(1040, y, 320, 480, "PARENT CHANNELS · adapters", S.lane);
    const app = p.box(60, y + 30, 300, 100, h("Vela app", ["React Native (Expo) · iOS, Android, web", "parent surface and kitchen-table mode are display modes", "push: one per member per day"]), S.cardGreen);
    const web = p.box(60, y + 150, 300, 60, h("Web", ["setup · story archive · account · Stripe checkout"]), S.card);
    const api = p.box(440, y + 30, 260, 90, h("API + webhooks", ["Hono router · Supabase Auth JWT", "answers light the light synchronously"]), S.cardGreen);
    const sch = p.box(720, y + 30, 260, 90, h("Scheduler", ["cron every 5 min → due query → queue", "arrivals unique per member per day"]), S.card);
    const gw = p.box(440, y + 140, 260, 90, h("Outbound gateway", ["the only thing that sends to a person", "budget by kind · idempotency · retries"]), S.cardAmber);
    const ai = p.box(720, y + 140, 260, 90, h("AI service", ["Claude · structured outputs", "prompt registry · every call logged"]), S.card);
    const db = p.box(440, y + 250, 260, 90, h("Postgres (Neon) per region", ["eu · apac · us · Hyperdrive", "answers 30 days rolling · events append-only"]), S.card);
    const r2 = p.box(720, y + 250, 260, 90, h("Media (R2) + event log", ["voice, photos, drawings; signed URLs (15 min)", "events partitioned monthly; KPI job reads them"]), S.card);
    const admin = p.box(440, y + 360, 260, 90, h("Admin view + billing", ["who's quiet, what got flagged, what the model said", "Stripe now; RevenueCat/IAP in phase 2"]), S.cardGrey);
    const ifc = p.box(720, y + 360, 260, 90, h("Channel interface", ["send(link, msg) · parseWebhook(req) · verifyWebhook", "capabilities per channel"]), S.card);
    const ch = ["Telegram (prototype = first adapter)", "MAX", "WhatsApp Business API", "LINE", "Viber", "Voice / SMS (later)", "In-app push"].map((t, i) => p.box(1060, y + 30 + i * 60, 280, 46, "<b>" + t + "</b>", i === 0 ? S.cardGreen : S.card));
    p.edge(app, api); p.edge(web, api); p.edge(sch, gw); p.edge(api, ai); p.edge(api, db); p.edge(api, r2); p.edge(gw, ifc); p.edge(api, admin, S.edgeSoft);
    ch.forEach((c) => p.edge(ifc, c, S.edgeSoft));
    y += 510;
    p.table(40, y, [{ w: 200, title: "Component" }, { w: 620, title: "Responsibility" }, { w: 500, title: "Technology and why" }], [
      ["Family app", "Member surfaces: home, thread, queue, turns, settings, parent surface, kitchen-table mode", "React Native + Expo; one codebase; EAS builds; OTA updates for JS changes"],
      ["API", "All reads and writes; webhooks; auth", "TypeScript on Cloudflare Workers (Hono); zero servers; free tier to phase 1"],
      ["Scheduler", "Every 5 minutes decides what is due: arrivals, repeats, quiet notices, turn prompts, weekly reads", "Cron Trigger → Queue → consumers; idempotency keys; re-check state before acting"],
      ["Outbound gateway", "The only sender; enforces the notification budget; retries; delivery log", "Worker + Queue"],
      ["Channel adapters", "One contract per messenger and for voice/SMS and in-app push", "Modules with their own webhook routes; a new messenger is a new file"],
      ["AI service", "Transcription, understanding, flags, prompts, fallback, translation, weekly read, drift", "Claude via the API; STT provider; prompt registry; every call logged with its input"],
      ["Database", "System of record", "Postgres (Neon), one project per region, Hyperdrive from Workers; D1 stays in the prototype only"],
      ["Media store · Event log", "Voice notes, photos, drawings · append-only record of sends, answers, AI calls, decisions", "R2 per region with signed URLs · Postgres table partitioned monthly"],
      ["Admin · Billing · Auth · Observability", "Internal view; Free vs Light; member sign-in; errors and KPIs", "Same Worker · Stripe then RevenueCat · Supabase Auth (magic link, phone OTP) · Sentry, Workers analytics, nightly KPI job"],
    ]);
    pages.push(p);
  }

  // 4.2 Data flow, scheduler, gateway
  {
    const p = new Page("4.2 · Data flow, scheduler, gateway");
    let y = p.title("From a queued photo to a lit light", "Every arrow writes an event. The KPI job reads events, never the live tables. Technical design §2–5.");
    const a = p.box(40, y, 300, 70, h("1 · Member queues an item", ["app → API: items.insert → event"]), S.card);
    const b = p.box(380, y, 300, 70, h("2 · Cron, every 5 minutes", ["SELECT members WHERE next_arrival_at <= now() AND no arrival for (member, local_day)"]), S.card);
    const c = p.box(720, y, 300, 70, h("3 · Composer", ["today's items → “whenever” items → story? → fallback? → render per channel"]), S.card);
    const d = p.box(1060, y, 300, 70, h("4 · Outbound gateway", ["budget check → idempotency → adapter.send() → arrivals.sent_at → event"]), S.cardAmber);
    const e = p.box(1060, y + 110, 300, 70, h("5 · Channel webhook: an answer", ["verify → parse → answers.insert → light lights → cancel repeat/quiet → ack within 1 s"]), S.cardGreen);
    const f = p.box(720, y + 110, 300, 70, h("6 · Queue: understand(answer_id)", ["transcribe → understand → translate → thread.post → notify contributor"]), S.card);
    const g = p.box(380, y + 110, 300, 70, h("7 · Flag?", ["notice to the organiser with her words; calm reply to her"]), S.cardRed);
    const k = p.box(40, y + 110, 300, 70, h("8 · Nightly KPI job", ["reads events → metrics_daily; prunes answers >30 days; precision from quiet_events.outcome"]), S.cardGrey);
    p.edge(a, b); p.edge(b, c); p.edge(c, d); p.edge(d, e, S.edge, [[1210, y + 90]]); p.edge(e, f); p.edge(f, g, S.edgeSoft); p.edge(g, k, S.edgeSoft);
    y += 210;
    y = p.h2(y, "Scheduler rules");
    y = p.table(40, y, [{ w: 220, title: "Due when" }, { w: 640, title: "Query" }, { w: 460, title: "Idempotency" }], [
      ["Arrival", "members.next_arrival_at <= now() and no arrivals row for (member_id, local_day); next_arrival_at recomputed after each send from arrival_hour and IANA tz (DST-safe)", "UNIQUE(member_id, day) makes double sends impossible even if two crons overlap"],
      ["Repeat", "arrivals.sent_at <= now() − 2.5 h, repeated_at is null, no answer, light on, not away", "repeated_at set once"],
      ["Quiet notice", "arrivals.sent_at <= now() − T_quiet(member), no answer, light on, not away, no open quiet_events row", "one open quiet_events row per member per day"],
      ["Turn prompt", "members whose turn is tomorrow and local time is 19:00 ± 5 min", "turns.prompt_sent_at"],
      ["Weekly read", "kept-light members, local Sunday 18:00 ± 5 min, no read for this week", "weekly_reads(member_id, week_start) unique"],
      ["Scale", "100,000 members ≈ 14 due arrivals per tick on average, a few thousand at popular hours", "One Postgres query and a queue absorb that"],
    ]);
    y += 20;
    y = p.h2(y, "The outbound gateway (the notification budget in code)");
    p.table(40, y, [{ w: 220, title: "Step" }, { w: 1100, title: "Rule" }], [
      ["1 · Budget", "Check (member_id, local_day, kind) against limits: arrival 1, repeat 1 (kept-light only), turn_prompt 1, quiet_notice as they occur (organisers), weekly_read 1, ack 1, system as needed. Over budget → dropped and logged, never sent."],
      ["2 · Idempotency", "idempotencyKey unique in outbound; a duplicate is a no-op"],
      ["3 · Send", "adapter.send(); record sent_at and external id; on failure retry 3× with backoff over 30 min, then mark failed and open an admin alert; tell the organiser once (“we couldn't reach Mom on Telegram today”); the ladder does not fire from our own outage"],
    ]);
    pages.push(p);
  }

  // 4.3 Data model
  {
    const p = new Page("4.3 · Data model");
    let y = p.title("Data model (MVP)", "Drawn in database.drawio. Green = the daily loop; amber = the paid Light layer; grey = supporting.");
    y = p.table(40, y, [{ w: 170, title: "Table" }, { w: 620, title: "Key fields" }, { w: 530, title: "Notes" }], [
      [{ label: "families", style: S.tdGreen }, "id · name · region (eu, apac, us) · plan (free, light) · created_at", "Region chosen at creation from the kept-light member's country; cannot move without export/import"],
      [{ label: "members", style: S.tdGreen }, "id · family_id · display_name · address_form · role (organiser, member) · lang · tz · arrival_hour · next_arrival_at · light_on · light_consented_at · quiet_after_min (learned, ≥240) · usual_answer_window · birth_year? · status", "Carries the scheduling fields so the due query touches one table"],
      ["channel_links", "id · member_id · channel · external_id · capabilities · status · linked_at", "The parent's identity on a messenger; there is no account for her"],
      [{ label: "nearby_contacts", style: S.tdAmber }, "id · member_id · name · relation · phone · consented_at · consent_channel · auto_ask_after_min?", "Cannot be auto-asked until consented"],
      ["items", "id · family_id · author_id · for_member_id? · kind (voice, photo, drawing, text, question) · media_id · text · translation · scheduled_day? · delivered_in_arrival_id · created_at", "What the family queues"],
      [{ label: "arrivals", style: S.tdGreen }, "id · member_id · day (member-local) · composed_at · sent_at · repeated_at · channel · source (family, story, fallback) · item_ids · fallback_text · read_at?", "UNIQUE(member_id, day): the idempotency backbone"],
      [{ label: "answers", style: S.tdGreen }, "id · arrival_id · member_id · kind (tap, reaction, text, voice, photo) · text · media_id · transcript · summary · mood_words · mentions · flag · flag_reason · translations · external_id · created_at", "Rolling 30 days; external_id unique per channel (duplicate webhooks)"],
      [{ label: "light_days", style: S.tdAmber }, "member_id · day · lit_at · answer_kind · latency_min", "Derived, cached"],
      [{ label: "quiet_events", style: S.tdAmber }, "id · member_id · day · repeat_sent_at · notice_sent_at · organiser_action · contact_asked_id · resolved_at · outcome (answered_late, away, true_concern, unknown)", "The precision dataset; outcome never null after resolution"],
      [{ label: "away_periods", style: S.tdAmber }, "id · member_id · from_day · to_day · source (said_in_answer, set_by_member, learned) · note", "Pauses repeats and notices, not arrivals"],
      ["weekly_reads", "id · member_id · week_start · text · suggestion · drift_signals · draft · final · sent_at", "Draft vs final diffs are product lessons"],
      ["stories", "id · member_id · question · answer_text · media_id · transcript · translations · keep · created_at", "Kept only if the family chose; exportable"],
      ["reminders", "id · family_id · about_member_id · remind_member_id · text · due_day · source_answer_id · sent_at", "Created on a tap, never silently"],
      ["turns", "family_id · day · member_id · prompt_text · prompt_sent_at · fulfilled_item_id", "Round-robin"],
      ["subscriptions", "id · family_id · payer_member_id · plan · kept_light_member_ids · status · trial_ends · provider_ref", "Stripe now; RevenueCat later"],
      ["events", "id · at · family_id · member_id · type · payload", "Append-only, partitioned monthly; every AI output with its input; every send; every tap"],
      ["ai_calls", "id · member_id · call · prompt_version · input_hash · input_ref · output · tokens_in · tokens_out · latency_ms · at", "Inputs by reference, so retention applies once"],
      ["media", "id · family_id · uploader_id · kind · storage_key · duration_s · created_at", "R2 per region"],
    ]);
    y += 20;
    p.box(40, y, 1320, 70, h("Retention", ["answers 30 days rolling (except those kept as stories) · media with its answer · a left member 30 days · a deleted family within 24 h · a deceased member's family read-only for a year · a deletion is an event with a hash of what was deleted, so we can prove it without keeping it"]), S.cardGrey);
    pages.push(p);
  }

  // 4.4 Security, privacy, failure modes
  {
    const p = new Page("4.4 · Security, privacy, failure modes");
    let y = p.title("Security and privacy architecture; failure modes", "Technical design §8–9. The light lights on the raw answer, before any AI: nothing on the safety path depends on a model.");
    y = p.table(40, y, [{ w: 220, title: "Area" }, { w: 1100, title: "Decision" }], [
      ["Data residency", "One Postgres project and one R2 bucket per region: eu (default), apac (Taiwan; later Japan, Korea), us. Family region set at creation. Russia's localisation law is a legal review before any Russian launch; the pilot stores minimal data in eu (ADR-7)"],
      ["Encryption", "TLS everywhere; Postgres and R2 encrypted at rest; media URLs signed, 15-minute expiry"],
      ["Secrets", "Worker secrets only; nothing in the repo; every webhook verified by signature or secret token"],
      ["Minimum data", "No health records, no location, no contact scraping. The AI sees the answer, the last three summaries, and the profile; never the whole thread"],
      ["Consent records", "members.light_consented_at, nearby_contacts.consented_at, and the event that carried the consent text"],
      ["Deletion", "Family cascade within 24 h; member left after 30 days; answers after 30 days; archive only if kept; deletion event with a hash"],
      ["Access", "Admin view gated by a short allow-list; every admin read of a family is logged as an event visible to the organiser on request"],
      ["What we never build", "Location tracking, camera or microphone monitoring, contact-list upload, advertising identifiers, selling data"],
    ]);
    y += 20;
    y = p.h2(y, "Failure modes, decided");
    p.table(40, y, [{ w: 300, title: "Failure" }, { w: 300, title: "Effect" }, { w: 720, title: "Handling" }], [
      ["Messenger API down (Telegram throttled, WhatsApp outage)", "Arrival not delivered", "Gateway retries 3× over 30 min; then undelivered, organiser told once; the ladder does not fire from our own outage"],
      ["Our Worker down at the arrival minute", "Arrival late", "Next cron tick catches up; UNIQUE(member_id, day) prevents doubles; >3 h late carries “sorry this is late”"],
      ["Postgres unreachable", "Everything pauses", "Webhooks get 503 (channels retry); cron ticks skip; admin alert"],
      ["AI provider down", "Answers not understood", "The light still lights immediately; understanding runs when the queue drains; the family sees “Mom answered” with the media"],
      ["Duplicate webhook delivery", "Duplicate answer", "answers.external_id unique per channel"],
      ["Member's phone changes number", "Channel link dead", "Detected on blocked/unreachable events; organiser told; re-invite flow"],
      ["Wrong time zone", "False quiet notice", "Tz set from the city, confirmed by the first three answer times; mismatch >3 h triggers a check with the organiser"],
      ["A flag missed by the model", "A concern not escalated", "The organiser still sees her words in the thread; the eval set tracks flag recall on every prompt change; the weekly read repeats anything mentioned twice"],
    ]);
    pages.push(p);
  }

  // 4.5 Environments, delivery, cost
  {
    const p = new Page("4.5 · Delivery and cost at scale");
    let y = p.title("Environments, delivery, cost at scale", "Technical design §10–11.");
    y = p.table(40, y, [{ w: 220, title: "Topic" }, { w: 1100, title: "Practice" }], [
      ["Environments", "dev (local wrangler dev + a Neon branch) · staging (a Worker + Neon branch, a real Telegram test bot) · prod"],
      ["Migrations", "SQL files applied in order (db/migrations/), reviewed in the PR"],
      ["CI on every PR", "Type check; unit tests for the composer, the ladder, the budget; contract tests for each adapter against recorded webhooks; the AI eval set on prompt changes"],
      ["Mobile delivery", "Expo EAS builds; TestFlight and Play internal track for pilot families; OTA updates for JS-only changes"],
      ["Feature flags", "A flags table read by the Worker, so phase-2 features ship dark"],
      ["Observability", "Sentry (free tier); Workers analytics; nightly KPI job writing metrics_daily; admin alerts on gateway failures"],
    ]);
    y += 20;
    y = p.h2(y, "Cost at scale (per month, order of magnitude)");
    y = p.table(40, y, [{ w: 140, title: "Families" }, { w: 140, title: "Members" }, { w: 140, title: "Workers" }, { w: 140, title: "Postgres" }, { w: 120, title: "R2" }, { w: 160, title: "AI" }, { w: 160, title: "Messaging" }, { w: 160, title: "Total" }, { w: 160, title: "Revenue (40% Light)" }], [
      ["100", "600", "$0", "$0", "$0", "~$40", "$0–5", { label: "< $50", style: S.tdGreen }, "~$400"],
      ["1,000", "6,000", "$5", "$19", "$5", "~$400", "~$50", { label: "~$500", style: S.tdGreen }, "~$4,000"],
      ["10,000", "60,000", "$50", "$70", "$50", "~$4,000", "~$500", { label: "~$5,000", style: S.tdGreen }, "~$40,000"],
      ["100,000", "600,000", "$500", "$700", "$500", "~$40,000", "~$5,000", { label: "~$47,000", style: S.tdGreen }, "~$400,000"],
    ]);
    y += 20;
    p.box(40, y, 640, 120, h("Where the money goes", li([
      "AI is the dominant cost and the first thing to optimise: cheaper models for translation and prompts, cached system prompts, batched weekly reads",
      "Infrastructure stays under 2% of revenue at every scale",
      "Messaging is free on Telegram and cents on WhatsApp",
    ])), S.card);
    p.box(720, y, 640, 120, h("Open technical questions", li([
      "Speech-to-text provider: accuracy for elderly Russian and Mandarin speech; decide in phase 1",
      "WhatsApp template classification for a daily arrival; test with Meta before the Philippines launch",
      "MAX bot API maturity and data retention terms",
      "Voice-line carrier coverage in Russia and Taiwan; Expo web on old tablets for kitchen-table mode",
    ])), S.cardGrey);
    pages.push(p);
  }

  // 4.6 ADRs
  {
    const p = new Page("4.6 · Architecture decisions");
    let y = p.title("Architecture decision records", "architecture/decisions.md. Each with what we rejected and what would make us revisit.");
    p.table(40, y, [{ w: 60, title: "#" }, { w: 330, title: "Decision" }, { w: 400, title: "Why" }, { w: 300, title: "Rejected" }, { w: 230, title: "Revisit if" }], [
      ["1", "Backend on Cloudflare Workers (Cron, Queues, R2, Hyperdrive), not a container service", "Zero servers; free tier through phase 1; edge latency for webhooks; the prototype is already there; one deployable for a solo builder", "Node on Fly/Railway; Supabase functions; Lambda", "Long-running audio work or CPU limits bite; then move the AI worker only"],
      ["2", "Postgres (Neon) as system of record, one project per region", "Relational fit; branches for free staging; residency by config; D1 too small", "D1 (prototype only); Firestore; Mongo", "A market requires in-country hosting Neon lacks"],
      ["3", "One Expo codebase; the parent surface is a mode, not an app", "One codebase; EAS; a separate parent app doubles listings and support while she rarely installs anyway", "Flutter; two apps; native", "Kitchen-table mode performs badly on old tablets"],
      ["4", "Parent side is adapters behind one interface; never one messenger", "WhatsApp blocked in Russia, Telegram throttled, MAX state-run, LINE owns Taiwan; a platform dependency is a company risk", "Telegram-only; WhatsApp-only; a Vela-only parent app", "Never; add adapters"],
      ["5", "The light lights on the raw answer, before any AI", "The safety promise must not depend on a model or a third-party API", "Understand-then-light", "—"],
      ["6", "Notification budget enforced in one outbound gateway", "The anti-addiction promise survives only if it is impossible to bypass in code", "Per-feature discipline", "—"],
      ["7", "Residency by region; Russia as a legal review, not a technical bet", "Minimum data reduces exposure; the founder cannot fund in-country infra now", "Russian hosting from day one; ignoring it", "Phase-1 exit, with a lawyer's opinion"],
      ["8", "Claude via the API, structured outputs, versioned prompts, eval set; STT provider for voice", "Auditable, comparable across versions; safe prompt changes with real families", "Fine-tuning; self-hosted open model; free-text outputs", "Cost at 10,000+ families; route by call type"],
      ["9", "Stripe web checkout first; in-app purchases in phase 2", "Avoids the 15–30% cut and review friction while testing prices; store rules require IAP once purchase is offered in-app", "IAP from day one; never doing IAP", "Phase 2 store launch"],
      ["10", "No human welfare-check operations inside Vela", "Founder's decision; keeps Vela a software company; the family's own people are the scarce asset", "Partner dispatch; Vela staff on the ladder", "—"],
    ]);
    pages.push(p);
  }

  return pages;
}
