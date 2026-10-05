import * as db from "./db";
import { parentText } from "./i18n";
import { maybeSendChildNote, sendAdminCard } from "./flows";
import { buttons, sendMessage } from "./telegram";
import { localNow, parseHHMM } from "./time";
import type { Env, Family } from "./types";

const MORNING_OFFSET = 30; // minutes after wake
const NUDGE_OFFSET = 150; // wake + 2h30
const CARD_OFFSET = 330; // wake + 5h30
const RESEND_CARD_AFTER_MS = 2 * 3600e3;

// Runs every 15 minutes. Idempotent: each step checks the day row before acting.
export async function tick(env: Env, now = new Date()): Promise<void> {
  const families = await db.activeFamilies(env);
  for (const f of families) {
    try {
      await tickFamily(env, f, now);
    } catch (e) {
      console.error("tick family", f.id, e);
    }
  }
  if (now.getUTCMinutes() < 15 && now.getUTCHours() === 3) await db.pruneOldMessages(env);
}

async function tickFamily(env: Env, f: Family, now: Date): Promise<void> {
  const { day, minutes } = localNow(f.parent_tz, now);
  const wake = parseHHMM(f.wake_time) ?? 450;
  const morningAt = wake + MORNING_OFFSET;
  if (minutes < morningAt) return; // before the morning window: nothing to do today yet

  const row = await db.getDay(env, f.id, day);
  const p = parentText(f.parent_lang);

  if (!row.morning_sent_at) {
    const relays = await db.pendingRelays(env, f.id);
    const template = p.morning[hashDay(day, f.id) % p.morning.length];
    let text = template(f.parent_address);
    if (relays.length) {
      text += `\n\n${p.relayIntro(f.child_name)} ${relays.map((r) => `«${r.text}»`).join(" ")}`;
    }
    await sendMessage(env, f.parent_chat_id!, text, buttons([[{ text: p.okButton, callback_data: "ok" }]]));
    await db.addMessage(env, f.id, day, "assistant", text);
    await db.markRelaysDelivered(env, f.id);
    await db.patchDay(env, f.id, day, { morning_sent_at: now.toISOString() });
    return;
  }

  if (row.reply_at) {
    // Replied: make sure the child's note went out (it may have been night time for the child).
    if (!row.child_note_at) await maybeSendChildNote(env, f, day, row.escalation);
    return;
  }

  if (!row.nudge_sent_at && minutes >= wake + NUDGE_OFFSET) {
    await sendMessage(env, f.parent_chat_id!, p.nudge(f.parent_address), buttons([[{ text: p.okButton, callback_data: "ok" }]]));
    await db.patchDay(env, f.id, day, { nudge_sent_at: now.toISOString() });
    return;
  }

  if (minutes >= wake + CARD_OFFSET) {
    const cardAge = row.admin_card_at ? now.getTime() - new Date(row.admin_card_at).getTime() : Infinity;
    const needCard = !row.admin_card_at || (row.admin_decision === "wait" && cardAge >= RESEND_CARD_AFTER_MS);
    if (needCard) {
      await sendAdminCard(env, f, day, `⏰ No reply ${Math.round((minutes - wake) / 60)} h after wake time. Nudge sent at ${row.nudge_sent_at ? "yes" : "no"}.`);
      await db.patchDay(env, f.id, day, { admin_decision: null });
    }
  }
}

function hashDay(day: string, familyId: number): number {
  let h = familyId;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
