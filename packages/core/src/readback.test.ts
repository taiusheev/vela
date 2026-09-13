import { describe, expect, it } from "vitest";
import { REACTION_EMOJI, type ReadbackReply, summariseReplies } from "./readback.ts";

describe("summariseReplies", () => {
  it("has nothing to say when nobody replied", () => {
    expect(summariseReplies({ lang: "en", replies: [] })).toEqual([]);
  });

  it("gives each written reply its own line in the sender's words, in reply order", () => {
    const replies: ReadbackReply[] = [
      { name: "Sam", kind: "text", text: "The borscht turned out well." },
      { name: "Mia", kind: "text", text: "  Can you teach me next week?  " },
    ];
    expect(summariseReplies({ lang: "en", replies })).toEqual([
      "Sam: The borscht turned out well.",
      "Mia: Can you teach me next week?",
    ]);
  });

  it("announces each voice reply without quoting it", () => {
    const replies: ReadbackReply[] = [
      { name: "Mia", kind: "voice", text: "a transcript she will hear in Mia's own voice" },
      { name: "Sam", kind: "voice", text: null },
    ];
    expect(summariseReplies({ lang: "en", replies })).toEqual([
      "Mia sent a voice message.",
      "Sam sent a voice message.",
    ]);
  });

  it("groups reactions by emoji with everyone who sent them, after the words", () => {
    const replies: ReadbackReply[] = [
      { name: "Anna", kind: "heart", text: null },
      { name: "Sam", kind: "laugh", text: null },
      { name: "Sam", kind: "text", text: "Love it" },
      { name: "Mia", kind: "heart", text: null },
      { name: "Leo", kind: "heart", text: null },
      { name: "Mia", kind: "hug", text: null },
    ];
    expect(summariseReplies({ lang: "en", replies })).toEqual([
      "Sam: Love it",
      "Anna, Mia, and Leo sent ❤️",
      "Sam sent 😂",
      "Mia sent 🤗",
    ]);
  });

  it("names someone once per reaction kind", () => {
    const replies: ReadbackReply[] = [
      { name: "Anna", kind: "heart", text: null },
      { name: "Anna", kind: "heart", text: null },
      { name: "Sam", kind: "heart", text: null },
    ];
    expect(summariseReplies({ lang: "en", replies })).toEqual(["Anna and Sam sent ❤️"]);
  });

  it("uses a caption of a photo reply as its words and says nothing of a bare photo", () => {
    const replies: ReadbackReply[] = [
      { name: "Sam", kind: "photo", text: "The tomatoes this year" },
      { name: "Mia", kind: "photo", text: null },
      { name: "Leo", kind: "text", text: "   " },
    ];
    expect(summariseReplies({ lang: "en", replies })).toEqual(["Sam: The tomatoes this year"]);
  });

  it("skips replies without a name rather than rendering an empty sender", () => {
    const replies: ReadbackReply[] = [
      { name: " ", kind: "text", text: "Hello" },
      { name: "", kind: "heart", text: null },
    ];
    expect(summariseReplies({ lang: "en", replies })).toEqual([]);
  });

  it("never counts, and never mentions who did not reply", () => {
    const replies: ReadbackReply[] = [
      { name: "Anna", kind: "heart", text: null },
      { name: "Sam", kind: "heart", text: null },
      { name: "Mia", kind: "heart", text: null },
    ];
    const lines = summariseReplies({ lang: "en", replies });
    expect(lines.join("\n")).not.toMatch(/\d/);
  });

  it("writes in Traditional Chinese with Chinese list punctuation", () => {
    const replies: ReadbackReply[] = [
      { name: "小明", kind: "text", text: "奶奶的湯很好喝" },
      { name: "小華", kind: "voice", text: null },
      { name: "阿姨", kind: "hug", text: null },
      { name: "小明", kind: "hug", text: null },
      { name: "小華", kind: "hug", text: null },
    ];
    expect(summariseReplies({ lang: "zh-TW", replies })).toEqual([
      "小明：奶奶的湯很好喝",
      "小華傳了一則語音訊息。",
      "阿姨、小明和小華送上🤗",
    ]);
  });

  it("joins names in English for a language whose copy falls back to English", () => {
    const replies: ReadbackReply[] = [
      { name: "Ольга", kind: "heart", text: null },
      { name: "Иван", kind: "heart", text: null },
    ];
    expect(summariseReplies({ lang: "ru", replies })).toEqual(["Ольга and Иван sent ❤️"]);
  });

  it("maps every reaction kind to an emoji", () => {
    expect(REACTION_EMOJI).toEqual({ heart: "❤️", laugh: "😂", hug: "🤗" });
  });
});
