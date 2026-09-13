/**
 * The deterministic read-back (spec §6.2, §6.3): yesterday's replies as the lines that open her next
 * arrival. It is also the fallback when the AI read-back fails, so it must always produce something
 * true and kind.
 *
 * She hears substance, never counts: each written reply or photo caption in the sender's words, each
 * voice reply and each photo without a caption announced, and reactions grouped by kind with the
 * names of those who sent them. Nothing ever mentions who did not reply.
 */
import { type Lang, MVP_LANGS, type ReactionKind, type ReplyKind } from "@vela/contracts";
import { t } from "@vela/copy";

export interface ReadbackReply {
  name: string;
  kind: ReplyKind;
  text: string | null;
}

export interface SummariseRepliesInput {
  lang: Lang;
  replies: ReadbackReply[];
}

/** The emoji each reaction kind is shown as; the same ones the group's reactions map from. */
export const REACTION_EMOJI: Readonly<Record<ReactionKind, string>> = {
  heart: "❤️",
  laugh: "😂",
  hug: "🤗",
};

function isReaction(kind: ReplyKind): kind is ReactionKind {
  return Object.hasOwn(REACTION_EMOJI, kind);
}

/**
 * Names are joined the way the sentence around them is written: a language without its own catalog
 * gets English copy from `t()`, so its list of names is English too.
 */
function listNames(lang: Lang, names: readonly string[]): string {
  const listLang = (MVP_LANGS as readonly Lang[]).includes(lang) ? lang : "en";
  return new Intl.ListFormat(listLang, { style: "long", type: "conjunction" }).format(names);
}

export function summariseReplies(input: SummariseRepliesInput): string[] {
  const { lang } = input;
  const lines: string[] = [];
  const reactions = new Map<ReactionKind, string[]>();

  for (const reply of input.replies) {
    const name = reply.name.trim();
    if (name.length === 0) {
      continue;
    }
    if (isReaction(reply.kind)) {
      const names = reactions.get(reply.kind) ?? [];
      if (!names.includes(name)) {
        names.push(name);
      }
      reactions.set(reply.kind, names);
      continue;
    }
    if (reply.kind === "voice") {
      lines.push(t(lang, "readback.voice", { name }));
      continue;
    }
    // A written reply, or a photo's caption. A photo without words is announced, since an empty
    // quote would read as a mistake; a written reply without words has nothing to say.
    const text = reply.text?.trim() ?? "";
    if (text.length > 0) {
      lines.push(t(lang, "readback.replied", { name, text }));
    } else if (reply.kind === "photo") {
      lines.push(t(lang, "readback.photo", { name }));
    }
  }

  for (const [kind, names] of reactions) {
    lines.push(
      t(lang, "readback.reactions", { names: listNames(lang, names), emoji: REACTION_EMOJI[kind] }),
    );
  }
  return lines;
}
