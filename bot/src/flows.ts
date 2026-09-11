import * as db from "./db";
import { childNote, replyToParent } from "./ai";
import { langFromCode, parentText, START_WORDS, STOP_WORDS, t } from "./i18n";
import { answerCallback, buttons, clearButtons, sendMessage } from "./telegram";
import { fmtMinutes, fmtTimeIn, isValidTz, localNow, parseHHMM, TZ_CHOICES } from "./time";
import type { Env, Family, Lang, TgCallbackQuery, TgMessage, TgUpdate } from "./types";

const MAX_ASSISTANT_TURNS = 4;

export async function handleUpdate(env: Env, u: TgUpdate): Promise<void> {
  if (u.callback_query) return handleCallback(env, u.callback_query);
  if (u.message) return handleMessage(env, u.message);
}

// ---------- routing ----------

async function handleMessage(env: Env, m: TgMessage): Promise<void> {
  const chatId = m.chat.id;
  const text = (m.text ?? "").trim();
  const isAdmin = String(chatId) === env.ADMIN_CHAT_ID;

  if (text === "/whoami") {
    await sendMessage(env, chatId, `chat id: ${chatId}`);
    return;
  }
  if (isAdmin && text.startsWith("/")) {
    if (await handleAdminCommand(env, chatId, text)) return;
  }

  // Parent joining via invite link: /start p_<token>
  const start = /^\/start(?:\s+p_(\S+))?$/.exec(text);
  if (start && start[1]) return parentJoin(env, chatId, start[1]);

  const asParent = await db.familyByParent(env, chatId);
  if (asParent) return parentMessage(env, asParent, m);

  const asChild = await db.familyByChild(env, chatId);
  if (asChild) {
    if (text.startsWith("/")) return childCommand(env, asChild, text);
    if (text) {
      await db.addMessage(env, asChild.id, localNow(asChild.parent_tz).day, "relay", text, 0);
      await sendMessage(env, chatId, t(asChild.child_lang).relayed);
    }
    return;
  }

  // Otherwise: child onboarding.
  return childOnboarding(env, chatId, m);
}

async function handleCallback(env: Env, q: TgCallbackQuery): Promise<void> {
  const data = q.data ?? "";
  const chatId = q.message?.chat.id ?? q.from.id;

  if (data === "ok") {
    await answerCallback(env, q.id);
    const f = await db.familyByParent(env, chatId);
    if (!f) return;
    if (q.message) await clearButtons(env, chatId, q.message.message_id);
    await recordSignOfLife(env, f, "button", "Нажала «всё хорошо»");
    await sendMessage(env, chatId, parentText(f.parent_lang).okReply);
    return;
  }
  if (data === "understood") {
    await answerCallback(env, q.id);
    if (q.message) await clearButtons(env, chatId, q.message.message_id);
    return;
  }
  if (data.startsWith("tz:")) {
    await answerCallback(env, q.id);
    return onboardingTzChosen(env, chatId, data.slice(3));
  }
  if (data.startsWith("plang:")) {
    await answerCallback(env, q.id);
    return onboardingParentLang(env, chatId, data.slice(6) as Lang);
  }
  if (data.startsWith("adm:")) {
    await answerCallback(env, q.id);
    return adminDecision(env, data, q.message?.message_id);
  }
  await answerCallback(env, q.id);
}

// ---------- child onboarding ----------

async function childOnboarding(env: Env, chatId: number, m: TgMessage): Promise<void> {
  const text = (m.text ?? "").trim();
  const state = await db.getOnboarding(env, chatId);

  if (!state || text === "/start") {
    const lang = langFromCode(m.from?.language_code);
    await db.setOnboarding(env, chatId, { step: "child_name", data: { lang } });
    await sendMessage(env, chatId, t(lang).welcome);
    return;
  }
  const lang = (state.data.lang as Lang) ?? "ru";
  const s = t(lang);
  const next = async (step: string, patch: Record<string, string>, prompt?: string, markup?: ReturnType<typeof buttons>) => {
    await db.setOnboarding(env, chatId, { step, data: { ...state.data, ...patch } });
    if (prompt) await sendMessage(env, chatId, prompt, markup);
  };

  switch (state.step) {
    case "child_name":
      if (!text) return;
      return next("parent_name", { child_name: text }, s.askParentName);
    case "parent_name":
      if (!text) return;
      return next("parent_address", { parent_name: text }, s.askAddress);
    case "parent_address":
      if (!text) return;
      return next("parent_lang", { parent_address: text }, s.askParentLang, buttons([[{ text: "Русский", callback_data: "plang:ru" }, { text: "English", callback_data: "plang:en" }]]));
    case "parent_lang":
      return; // waits for button
    case "parent_tz":
      if (text && isValidTz(text)) return onboardingTzChosen(env, chatId, text);
      if (text) await sendMessage(env, chatId, s.badTz);
      return;
    case "wake_time": {
      const mins = parseHHMM(text);
      if (mins === null) return void (await sendMessage(env, chatId, s.badTime));
      return next("child_tz", { wake_time: fmtMinutes(mins) }, s.askChildTz, tzKeyboard());
    }
    case "child_tz":
      if (text && isValidTz(text)) return onboardingTzChosen(env, chatId, text);
      if (text) await sendMessage(env, chatId, s.badTz);
      return;
  }
}

function tzKeyboard() {
  const rows = [];
  for (let i = 0; i < TZ_CHOICES.length; i += 2) {
    rows.push(TZ_CHOICES.slice(i, i + 2).map(([label, tz]) => ({ text: label, callback_data: `tz:${tz}` })));
  }
  return buttons(rows);
}

async function onboardingParentLang(env: Env, chatId: number, plang: Lang): Promise<void> {
  const state = await db.getOnboarding(env, chatId);
  if (!state || state.step !== "parent_lang") return;
  const lang = state.data.lang as Lang;
  await db.setOnboarding(env, chatId, { step: "parent_tz", data: { ...state.data, parent_lang: plang } });
  await sendMessage(env, chatId, t(lang).askParentTz, tzKeyboard());
}

async function onboardingTzChosen(env: Env, chatId: number, tz: string): Promise<void> {
  const state = await db.getOnboarding(env, chatId);
  if (!state) return;
  const lang = state.data.lang as Lang;
  const s = t(lang);
  if (state.step === "parent_tz") {
    await db.setOnboarding(env, chatId, { step: "wake_time", data: { ...state.data, parent_tz: tz } });
    await sendMessage(env, chatId, s.askWake);
    return;
  }
  if (state.step === "child_tz") {
    const d: Record<string, string> = { ...state.data, child_tz: tz };
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const f = await db.createFamily(env, {
      child_chat_id: chatId,
      child_name: d.child_name,
      child_lang: lang,
      child_tz: d.child_tz,
      parent_name: d.parent_name,
      parent_address: d.parent_address,
      parent_lang: (d.parent_lang as Lang) ?? "ru",
      parent_tz: d.parent_tz,
      wake_time: d.wake_time,
      invite_token: token,
    });
    await db.clearOnboarding(env, chatId);
    const link = `https://t.me/${env.BOT_USERNAME}?start=p_${f.invite_token}`;
    await sendMessage(env, chatId, s.done(link, f.parent_address));
  }
}

// ---------- parent side ----------

async function parentJoin(env: Env, chatId: number, token: string): Promise<void> {
  const f = await db.familyByToken(env, token);
  if (!f || f.status === "deleted") return void (await sendMessage(env, chatId, "Ссылка не действует. / This link is no longer valid."));
  if (f.parent_chat_id && f.parent_chat_id !== chatId) return void (await sendMessage(env, chatId, "Эта ссылка уже использована. / This link was already used."));
  await db.setParentChat(env, f.id, chatId);
  const p = parentText(f.parent_lang);
  const wake = parseHHMM(f.wake_time) ?? 450;
  await sendMessage(env, chatId, p.welcome(f.parent_address, f.child_name, fmtMinutes(wake + 30)), buttons([[{ text: p.understood, callback_data: "understood" }]]));
  await sendMessage(env, f.child_chat_id, t(f.child_lang).parentJoined(f.parent_address));
}

async function parentMessage(env: Env, f: Family, m: TgMessage): Promise<void> {
  const p = parentText(f.parent_lang);
  const text = (m.text ?? "").trim();
  const lower = text.toLowerCase();

  if (m.voice) {
    await recordSignOfLife(env, f, "voice", "Прислала голосовое сообщение");
    await sendMessage(env, m.chat.id, p.voice);
    return;
  }
  if (!text) return;

  if (f.status === "paused") {
    if (START_WORDS.some((w) => lower.includes(w))) {
      await db.setStatus(env, f.id, "active");
      await sendMessage(env, m.chat.id, p.okReply);
    }
    return;
  }
  if (STOP_WORDS.some((w) => lower === w || lower.includes(w))) {
    await db.setStatus(env, f.id, "paused");
    await sendMessage(env, m.chat.id, p.stopped);
    await sendMessage(env, env.ADMIN_CHAT_ID, `⏸ ${f.parent_address} (family ${f.id}) asked to stop: "${text}"`);
    await sendMessage(env, f.child_chat_id, f.child_lang === "ru" ? `${f.parent_address} попросила пока не писать. Я поставил на паузу; поговорите с ней, и напишите /resume, когда будет можно.` : `${f.parent_address} asked me to stop for now. Paused; talk to them and send /resume when it's okay.`);
    return;
  }

  const { day } = localNow(f.parent_tz);
  const dayRow = await db.getDay(env, f.id, day);
  await db.addMessage(env, f.id, day, "parent", text);

  if (dayRow.assistant_turns >= MAX_ASSISTANT_TURNS) {
    if (!dayRow.reply_at) await recordSignOfLife(env, f, "text", "Написала сообщение");
    await sendMessage(env, m.chat.id, p.signoff);
    return;
  }

  const turns = await db.messagesForDay(env, f.id, day);
  const prev = await db.recentSummaries(env, f.id, day);
  const relays = (await db.pendingRelays(env, f.id)).map((r) => r.text);

  let out;
  try {
    out = await replyToParent(env, f, turns, prev, relays);
  } catch (e) {
    console.error("ai reply failed", e);
    await recordSignOfLife(env, f, "text", "Написала сообщение (ответ ИИ не удался)");
    await sendMessage(env, m.chat.id, p.okReply);
    await sendMessage(env, env.ADMIN_CHAT_ID, `⚠️ AI reply failed for family ${f.id}. Parent wrote: "${text}"`);
    return;
  }

  if (out.reply) {
    await sendMessage(env, m.chat.id, out.reply);
    await db.addMessage(env, f.id, day, "assistant", out.reply);
    await db.bumpAssistantTurns(env, f.id, day);
  }
  const summary = out.summary || "Написала сообщение";
  if (out.flag === "escalate") {
    await db.patchDay(env, f.id, day, { escalation: out.flag_reason });
    await sendAdminCard(env, f, day, `🚩 ${out.flag_reason}\n\nParent wrote: "${text}"`);
  }
  await recordSignOfLife(env, f, "text", summary, out.flag === "escalate" ? out.flag_reason : null);
}

// First sign of life today: store it, and send the child's note if it is time.
async function recordSignOfLife(env: Env, f: Family, kind: "button" | "text" | "voice", summary: string, escalation: string | null = null): Promise<void> {
  const { day } = localNow(f.parent_tz);
  const row = await db.getDay(env, f.id, day);
  const nowIso = new Date().toISOString();
  const patch: Parameters<typeof db.patchDay>[3] = {};
  if (!row.reply_at) {
    patch.reply_at = nowIso;
    patch.reply_kind = kind;
  }
  // Text replies refine the summary; a button press never overwrites a text summary.
  if (kind !== "button" || !row.reply_summary) patch.reply_summary = summary;
  await db.patchDay(env, f.id, day, patch);

  if (!row.child_note_at) await maybeSendChildNote(env, f, day, escalation ?? row.escalation);
}

export async function maybeSendChildNote(env: Env, f: Family, day: string, escalation: string | null): Promise<void> {
  const row = await db.getDay(env, f.id, day);
  if (row.child_note_at || !row.reply_at) return;
  // Never message the child between 23:00 and 07:00 their time; the scheduler retries.
  const childMin = localNow(f.child_tz).minutes;
  if (childMin < 7 * 60 || childMin >= 23 * 60) return;

  const when = fmtTimeIn(f.parent_tz, row.reply_at);
  const ru = f.child_lang === "ru";
  let note: string;
  if (row.reply_kind === "button" && !escalation) {
    note = ru ? `${f.parent_address} нажала «всё хорошо» в ${when}. Ничего делать не нужно.` : `${f.parent_address} tapped "I'm fine" at ${when}. Nothing to do.`;
  } else if (row.reply_kind === "voice" && !escalation) {
    note = ru ? `${f.parent_address} прислала голосовое в ${when}, на связи. Ничего делать не нужно.` : `${f.parent_address} sent a voice note at ${when}, in touch. Nothing to do.`;
  } else {
    try {
      note = await childNote(env, f, when, row.reply_summary ?? "", escalation);
    } catch (e) {
      console.error("note failed", e);
      note = ru ? `${f.parent_address} ответила в ${when}. Ничего делать не нужно.` : `${f.parent_address} replied at ${when}. Nothing to do.`;
    }
  }
  await sendMessage(env, f.child_chat_id, `🟢 ${note}`);
  await db.patchDay(env, f.id, day, { child_note_at: new Date().toISOString(), child_note_text: note });
}

// ---------- child commands ----------

async function childCommand(env: Env, f: Family, cmd: string): Promise<void> {
  const s = t(f.child_lang);
  const c = cmd.split(/\s+/)[0].toLowerCase();
  if (c === "/pause") { await db.setStatus(env, f.id, "paused"); return void (await sendMessage(env, f.child_chat_id, s.paused)); }
  if (c === "/resume") { await db.setStatus(env, f.id, "active"); return void (await sendMessage(env, f.child_chat_id, s.resumed)); }
  if (c === "/delete") { await db.deleteFamily(env, f.id); return void (await sendMessage(env, f.child_chat_id, s.deleted)); }
  if (c === "/status" || c === "/start") {
    const { day } = localNow(f.parent_tz);
    const row = await db.peekDay(env, f.id, day);
    const link = `https://t.me/${env.BOT_USERNAME}?start=p_${f.invite_token}`;
    const lines = f.child_lang === "ru"
      ? [
          `${f.parent_address}: ${f.status === "active" ? "подключена" : f.status === "invited" ? "ещё не нажала «Старт»" : "на паузе"}.`,
          `Утреннее сообщение в ${fmtMinutes((parseHHMM(f.wake_time) ?? 450) + 30)} (${f.parent_tz}).`,
          row?.reply_at ? `Сегодня ответила в ${fmtTimeIn(f.parent_tz, row.reply_at)}.` : "Сегодня пока не отвечала.",
          f.status === "invited" ? `Ссылка для родителя: ${link}` : "",
        ]
      : [
          `${f.parent_address}: ${f.status === "active" ? "connected" : f.status === "invited" ? "hasn't tapped Start yet" : "paused"}.`,
          `Morning message at ${fmtMinutes((parseHHMM(f.wake_time) ?? 450) + 30)} (${f.parent_tz}).`,
          row?.reply_at ? `Replied today at ${fmtTimeIn(f.parent_tz, row.reply_at)}.` : "No reply yet today.",
          f.status === "invited" ? `Parent link: ${link}` : "",
        ];
    return void (await sendMessage(env, f.child_chat_id, lines.filter(Boolean).join("\n")));
  }
  await sendMessage(env, f.child_chat_id, s.noFamily);
}

// ---------- founder / admin ----------

export async function sendAdminCard(env: Env, f: Family, day: string, body: string): Promise<void> {
  const row = await db.getDay(env, f.id, day);
  const head = `Family ${f.id}: ${f.parent_address} (${f.parent_tz}), child ${f.child_name}\n${row.reply_at ? `Replied today at ${fmtTimeIn(f.parent_tz, row.reply_at)}` : "No reply today"}\n\n`;
  const msg = await sendMessage(env, env.ADMIN_CHAT_ID, head + body, buttons([[
    { text: "Написать дочери", callback_data: `adm:notify:${f.id}:${day}` },
    { text: "Подождать 2 ч", callback_data: `adm:wait:${f.id}:${day}` },
    { text: "Всё в порядке", callback_data: `adm:ok:${f.id}:${day}` },
  ]]));
  await db.patchDay(env, f.id, day, { admin_card_at: new Date().toISOString(), admin_card_msg_id: msg?.message_id ?? null });
}

async function adminDecision(env: Env, data: string, msgId?: number): Promise<void> {
  const [, action, idStr, day] = data.split(":");
  const f = await db.familyById(env, Number(idStr));
  if (!f) return;
  if (msgId) await clearButtons(env, env.ADMIN_CHAT_ID, msgId);
  await db.patchDay(env, f.id, day, { admin_decision: action as "notify" | "wait" | "ok" });
  if (action === "notify") {
    await sendMessage(env, f.child_chat_id, `🟡 ${t(f.child_lang).noteButton}`);
    await db.patchDay(env, f.id, day, { child_note_at: new Date().toISOString(), child_note_text: "[yellow] " + t(f.child_lang).noteButton });
    await sendMessage(env, env.ADMIN_CHAT_ID, `Sent to ${f.child_name}.`);
  } else if (action === "wait") {
    // Re-arm: the scheduler will re-send the card 2 h after this decision.
    await db.patchDay(env, f.id, day, { admin_card_at: new Date().toISOString() });
    await sendMessage(env, env.ADMIN_CHAT_ID, `Will ask again in 2 hours if still quiet.`);
  } else {
    await sendMessage(env, env.ADMIN_CHAT_ID, `Marked fine. No note to ${f.child_name}.`);
  }
}

async function handleAdminCommand(env: Env, chatId: number, text: string): Promise<boolean> {
  const c = text.split(/\s+/)[0].toLowerCase();
  if (c === "/families") {
    const fams = await db.allFamilies(env);
    if (!fams.length) { await sendMessage(env, chatId, "No families yet."); return true; }
    const lines = [];
    for (const f of fams) {
      const { day } = localNow(f.parent_tz);
      const row = await db.peekDay(env, f.id, day);
      const st = row?.reply_at ? `🟢 ${fmtTimeIn(f.parent_tz, row.reply_at)}` : row?.admin_card_at ? "🔴 card open" : row?.morning_sent_at ? "⏳ waiting" : "· not yet";
      lines.push(`${f.id}. ${f.parent_address} ← ${f.child_name} [${f.status}] ${st}${row?.escalation ? " 🚩" : ""}`);
    }
    await sendMessage(env, chatId, lines.join("\n"));
    return true;
  }
  if (c === "/digest") {
    const day = new Date().toISOString().slice(0, 10);
    const d = await db.digestFor(env, day);
    await sendMessage(env, chatId, `Today (UTC ${day}): ${d.families} active families, ${d.replied} replied, ${d.cards} cards, ${d.escalations} escalations.`);
    return true;
  }
  return false;
}
