import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Env, Family, MessageRow } from "./types";

// Every parent conversation goes through this one call. The system prompt is
// frozen and cached; the volatile parts (today's turns) come after it.

const ReplySchema = z.object({
  reply: z.string().describe("What to say to the parent. Two short sentences at most, warm, in their language. At most one question."),
  flag: z.enum(["none", "escalate"]).describe("escalate if anything in the parent's message needs a human: pain, fall, dizziness, chest or breathing, not eating, hopelessness or not wanting to live, a stranger at the door, money or 'bank' calls, or anything else a caring adult child would want to know now."),
  flag_reason: z.string().describe("If escalate: one plain sentence for the founder saying what was said. Otherwise empty."),
  summary: z.string().describe("One neutral line about how the parent is today, for the child's note and tomorrow's context. Example: 'Slept badly, going to the pharmacy, in good spirits.'"),
  end_conversation: z.boolean().describe("true if the exchange has reached a natural close and no further reply is needed today."),
});
export type ParentReply = z.infer<typeof ReplySchema>;

const NoteSchema = z.object({
  note: z.string().describe("Two short sentences for the child, in the child's language. First: when the parent replied and how they are, in neutral words, never quoting the parent verbatim. Second: exactly 'Ничего делать не нужно.' (ru) or 'Nothing to do.' (en) unless something was flagged."),
});

function systemPrompt(f: Family): string {
  const lang = f.parent_lang === "ru" ? "Russian" : "English";
  return `You are a gentle morning companion sent by ${f.child_name}, who lives far away, to their parent ${f.parent_address}. You write in ${lang}, using the polite form of address (in Russian: "вы" and "${f.parent_address}"). You are warm, unhurried, specific, and brief.

What you do: greet, ask how they slept, react to their plans, remember what they told you on previous days, pass on messages from ${f.child_name}, and say goodbye naturally. Two short sentences at most. At most one question per reply. Never lecture, never give instructions.

What you never do: medical, legal, or financial advice; discussing medication beyond a gentle acknowledgement; pretending to be human (if asked, say you are a helper ${f.child_name} asked to say good morning); mentioning monitoring, data, sensors, or the fact that ${f.child_name} receives notes. Never repeat their words back verbatim in the summary field.

If they say anything about pain, a fall, dizziness, chest or breathing trouble, not eating, feeling hopeless or not wanting to live, a stranger at the door, a call from "the bank", or a request for money: reply with warmth and calm (do not diagnose, do not alarm), and set flag to "escalate" with a plain one-sentence reason. A human will follow up.

Keep the exchange short: once they have said how they are and the pleasantries are done, close warmly and set end_conversation to true.`;
}

function client(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export async function replyToParent(
  env: Env,
  f: Family,
  turnsToday: MessageRow[],
  previousDays: { day: string; reply_summary: string }[],
  relays: string[],
): Promise<ParentReply> {
  const context: string[] = [];
  if (previousDays.length) context.push("Previous days:\n" + previousDays.map((d) => `${d.day}: ${d.reply_summary}`).join("\n"));
  if (relays.length) context.push(`Messages from ${f.child_name} already delivered this morning: ${relays.join(" | ")}`);

  const messages: Anthropic.MessageParam[] = [];
  if (context.length) messages.push({ role: "user", content: `[context]\n${context.join("\n\n")}` }, { role: "assistant", content: "Understood." });
  for (const m of turnsToday) {
    messages.push({ role: m.role === "parent" ? "user" : "assistant", content: m.text });
  }
  // The API requires the last message to be from the user.
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: "[the parent has not written yet; greet them briefly]" });
  }

  const res = await client(env).beta.messages.create({
    model: env.MODEL,
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(ReplySchema) },
    cache_control: { type: "ephemeral" },
    system: systemPrompt(f),
    messages,
  });
  if (res.stop_reason === "refusal") {
    return { reply: "", flag: "escalate", flag_reason: "The model declined to answer this message; please read it yourself.", summary: "", end_conversation: true };
  }
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no text block in reply");
  return ReplySchema.parse(JSON.parse(text.text));
}

export async function childNote(
  env: Env,
  f: Family,
  replyTimeLocal: string,
  summary: string,
  escalation: string | null,
): Promise<string> {
  const lang = f.child_lang === "ru" ? "Russian" : "English";
  const prompt = `Write the daily note for ${f.child_name} (in ${lang}) about their parent ${f.parent_name}. Parent replied at ${replyTimeLocal} (parent's local time). Summary of how they are: "${summary}". ${escalation ? `A human has been alerted about: "${escalation}". Say so calmly in one sentence and that the team will be in touch; do not add 'nothing to do'.` : "Nothing was flagged."}`;

  const res = await client(env).beta.messages.create({
    model: env.MODEL,
    max_tokens: 512,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(NoteSchema) },
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no text block in note");
  return NoteSchema.parse(JSON.parse(text.text)).note;
}
