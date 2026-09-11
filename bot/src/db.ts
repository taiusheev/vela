import type { DayRow, Env, Family, MessageRow } from "./types";

const nowIso = () => new Date().toISOString();

export async function familyByChild(env: Env, chatId: number): Promise<Family | null> {
  return env.DB.prepare("SELECT * FROM families WHERE child_chat_id = ? AND status != 'deleted'").bind(chatId).first<Family>();
}
export async function familyByParent(env: Env, chatId: number): Promise<Family | null> {
  return env.DB.prepare("SELECT * FROM families WHERE parent_chat_id = ? AND status != 'deleted'").bind(chatId).first<Family>();
}
export async function familyByToken(env: Env, token: string): Promise<Family | null> {
  return env.DB.prepare("SELECT * FROM families WHERE invite_token = ?").bind(token).first<Family>();
}
export async function familyById(env: Env, id: number): Promise<Family | null> {
  return env.DB.prepare("SELECT * FROM families WHERE id = ?").bind(id).first<Family>();
}
export async function activeFamilies(env: Env): Promise<Family[]> {
  const r = await env.DB.prepare("SELECT * FROM families WHERE status = 'active' AND parent_chat_id IS NOT NULL").all<Family>();
  return r.results;
}
export async function allFamilies(env: Env): Promise<Family[]> {
  const r = await env.DB.prepare("SELECT * FROM families WHERE status != 'deleted' ORDER BY id").all<Family>();
  return r.results;
}

export async function createFamily(env: Env, f: Omit<Family, "id" | "created_at" | "parent_chat_id" | "status">): Promise<Family> {
  const r = await env.DB.prepare(
    `INSERT INTO families (child_chat_id, child_name, child_lang, child_tz, parent_name, parent_address, parent_lang, parent_tz, wake_time, invite_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(f.child_chat_id, f.child_name, f.child_lang, f.child_tz, f.parent_name, f.parent_address, f.parent_lang, f.parent_tz, f.wake_time, f.invite_token)
    .first<Family>();
  return r!;
}

export async function setParentChat(env: Env, familyId: number, chatId: number): Promise<void> {
  await env.DB.prepare("UPDATE families SET parent_chat_id = ?, status = 'active' WHERE id = ?").bind(chatId, familyId).run();
}
export async function setStatus(env: Env, familyId: number, status: Family["status"]): Promise<void> {
  await env.DB.prepare("UPDATE families SET status = ? WHERE id = ?").bind(status, familyId).run();
}
export async function deleteFamily(env: Env, familyId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE family_id = ?").bind(familyId),
    env.DB.prepare("DELETE FROM days WHERE family_id = ?").bind(familyId),
    env.DB.prepare("DELETE FROM families WHERE id = ?").bind(familyId),
  ]);
}

export async function getDay(env: Env, familyId: number, day: string): Promise<DayRow> {
  const existing = await env.DB.prepare("SELECT * FROM days WHERE family_id = ? AND day = ?").bind(familyId, day).first<DayRow>();
  if (existing) return existing;
  await env.DB.prepare("INSERT OR IGNORE INTO days (family_id, day) VALUES (?, ?)").bind(familyId, day).run();
  return (await env.DB.prepare("SELECT * FROM days WHERE family_id = ? AND day = ?").bind(familyId, day).first<DayRow>())!;
}
export async function peekDay(env: Env, familyId: number, day: string): Promise<DayRow | null> {
  return env.DB.prepare("SELECT * FROM days WHERE family_id = ? AND day = ?").bind(familyId, day).first<DayRow>();
}

type DayPatch = Partial<Omit<DayRow, "family_id" | "day">>;
export async function patchDay(env: Env, familyId: number, day: string, patch: DayPatch): Promise<void> {
  const keys = Object.keys(patch) as (keyof DayPatch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => patch[k] ?? null);
  await env.DB.prepare(`UPDATE days SET ${sets} WHERE family_id = ? AND day = ?`).bind(...vals, familyId, day).run();
}
export async function bumpAssistantTurns(env: Env, familyId: number, day: string): Promise<void> {
  await env.DB.prepare("UPDATE days SET assistant_turns = assistant_turns + 1 WHERE family_id = ? AND day = ?").bind(familyId, day).run();
}

export async function addMessage(env: Env, familyId: number, day: string, role: MessageRow["role"], text: string, delivered = 1): Promise<void> {
  await env.DB.prepare("INSERT INTO messages (family_id, day, role, text, delivered) VALUES (?, ?, ?, ?, ?)").bind(familyId, day, role, text, delivered).run();
}
export async function messagesForDay(env: Env, familyId: number, day: string): Promise<MessageRow[]> {
  const r = await env.DB.prepare("SELECT * FROM messages WHERE family_id = ? AND day = ? AND role != 'relay' ORDER BY id").bind(familyId, day).all<MessageRow>();
  return r.results;
}
export async function pendingRelays(env: Env, familyId: number): Promise<MessageRow[]> {
  const r = await env.DB.prepare("SELECT * FROM messages WHERE family_id = ? AND role = 'relay' AND delivered = 0 ORDER BY id").bind(familyId).all<MessageRow>();
  return r.results;
}
export async function markRelaysDelivered(env: Env, familyId: number): Promise<void> {
  await env.DB.prepare("UPDATE messages SET delivered = 1 WHERE family_id = ? AND role = 'relay' AND delivered = 0").bind(familyId).run();
}
export async function pruneOldMessages(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM messages WHERE created_at < datetime('now', '-7 days')").run();
}

export async function recentSummaries(env: Env, familyId: number, beforeDay: string, n = 3): Promise<{ day: string; reply_summary: string }[]> {
  const r = await env.DB.prepare(
    "SELECT day, reply_summary FROM days WHERE family_id = ? AND day < ? AND reply_summary IS NOT NULL ORDER BY day DESC LIMIT ?",
  ).bind(familyId, beforeDay, n).all<{ day: string; reply_summary: string }>();
  return r.results.reverse();
}

// Onboarding state
export interface OnboardingState { step: string; data: Record<string, string> }
export async function getOnboarding(env: Env, chatId: number): Promise<OnboardingState | null> {
  const r = await env.DB.prepare("SELECT step, data FROM onboarding WHERE chat_id = ?").bind(chatId).first<{ step: string; data: string }>();
  return r ? { step: r.step, data: JSON.parse(r.data) } : null;
}
export async function setOnboarding(env: Env, chatId: number, s: OnboardingState): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO onboarding (chat_id, step, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = excluded.updated_at",
  ).bind(chatId, s.step, JSON.stringify(s.data), nowIso()).run();
}
export async function clearOnboarding(env: Env, chatId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM onboarding WHERE chat_id = ?").bind(chatId).run();
}

// Digest numbers for the founder.
export async function digestFor(env: Env, day: string): Promise<{ families: number; replied: number; escalations: number; cards: number }> {
  const families = (await env.DB.prepare("SELECT COUNT(*) AS n FROM families WHERE status = 'active'").first<{ n: number }>())!.n;
  const d = (await env.DB.prepare(
    "SELECT SUM(reply_at IS NOT NULL) AS replied, SUM(escalation IS NOT NULL) AS esc, SUM(admin_card_at IS NOT NULL) AS cards FROM days WHERE day = ?",
  ).bind(day).first<{ replied: number | null; esc: number | null; cards: number | null }>())!;
  return { families, replied: d.replied ?? 0, escalations: d.esc ?? 0, cards: d.cards ?? 0 };
}
