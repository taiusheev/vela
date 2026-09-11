import type { Env } from "./types";

type InlineButton = { text: string; callback_data: string };
export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { remove_keyboard: true };

async function call<T>(env: Env, method: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("telegram", method, res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { ok: boolean; result: T };
  return json.ok ? json.result : null;
}

export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  markup?: ReplyMarkup,
): Promise<{ message_id: number } | null> {
  return call(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: markup,
    disable_web_page_preview: true,
  });
}

export async function answerCallback(env: Env, id: string, text?: string): Promise<void> {
  await call(env, "answerCallbackQuery", { callback_query_id: id, text });
}

export async function clearButtons(env: Env, chatId: number | string, messageId: number): Promise<void> {
  await call(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

export function buttons(rows: InlineButton[][]): ReplyMarkup {
  return { inline_keyboard: rows };
}
