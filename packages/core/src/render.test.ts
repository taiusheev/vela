import { type Button, type Lang, OutboundMessage } from "@vela/contracts";
import { t } from "@vela/copy";
import { describe, expect, it } from "vitest";
import { BUTTON_DATA_MAX_BYTES, decodeButton } from "./buttons.ts";
import {
  type ArrivalAsk,
  MAX_VOTE_OPTIONS,
  type RenderArrivalInput,
  type RenderedArrival,
  renderArrival,
} from "./render.ts";

const EXCHANGE = "01920f3e-7a4b-7c5d-8e9f-0a1b2c3d4e5f";

function question(overrides: Partial<Exclude<ArrivalAsk, { type: "hello" }>> = {}): ArrivalAsk {
  return {
    type: "question",
    askerName: "Mia",
    onBehalfOf: null,
    text: "What did you cook today?",
    chips: [],
    voteOptions: [],
    imageCount: 0,
    ...overrides,
  };
}

function render(overrides: Partial<RenderArrivalInput> = {}): RenderedArrival {
  return renderArrival({
    lang: "en",
    address: "Mrs Chen",
    exchangeId: EXCHANGE,
    ask: question(),
    readBack: [],
    late: false,
    repeat: false,
    ...overrides,
  });
}

function paragraphs(arrival: RenderedArrival): string[] {
  return arrival.text.split("\n\n");
}

function labels(arrival: RenderedArrival): string[][] {
  return arrival.buttons.map((row) => row.map((entry) => entry.label));
}

function actions(arrival: RenderedArrival) {
  return arrival.buttons.map((row) => row.map((entry: Button) => decodeButton(entry.id)));
}

const FINAL_ACTIONS = [
  { type: "answer", exchangeId: EXCHANGE, answer: "heart" },
  { type: "answer", exchangeId: EXCHANGE, answer: "fine" },
];

/** The arrival satisfies the adapter contract, so a platform will accept it as sent. */
function expectSendable(arrival: RenderedArrival, lang: Lang): void {
  const parsed = OutboundMessage.safeParse({
    kind: "arrival",
    idempotencyKey: "arrival:test",
    lang,
    to: { channel: "telegram", conversationId: "12345" },
    text: arrival.text,
    buttons: arrival.buttons,
  });
  expect(parsed.success).toBe(true);
  const utf8 = new TextEncoder();
  for (const row of arrival.buttons) {
    for (const entry of row) {
      expect(utf8.encode(entry.id).length).toBeLessThanOrEqual(BUTTON_DATA_MAX_BYTES);
    }
  }
}

describe("renderArrival in English", () => {
  it("opens with yesterday's replies, then greets her, asks, and hints", () => {
    const arrival = render({
      readBack: ["Sam: The borscht turned out well.", "Anna and Sam sent ❤️"],
      ask: question({ chips: ["Soup", "Pancakes", "Nothing yet"] }),
    });
    expect(paragraphs(arrival)).toEqual([
      "From yesterday:\nSam: The borscht turned out well.\nAnna and Sam sent ❤️",
      "Good morning, Mrs Chen.",
      "Mia asks:\nWhat did you cook today?",
      "Reply with a voice message, or tap a button.",
    ]);
    expect(labels(arrival)).toEqual([["Soup"], ["Pancakes"], ["Nothing yet"], ["❤️", "I'm fine"]]);
    expect(actions(arrival)).toEqual([
      [{ type: "chip", exchangeId: EXCHANGE, index: 0 }],
      [{ type: "chip", exchangeId: EXCHANGE, index: 1 }],
      [{ type: "chip", exchangeId: EXCHANGE, index: 2 }],
      FINAL_ACTIONS,
    ]);
    expectSendable(arrival, "en");
  });

  it("leaves out the read-back heading when there is nothing to read back", () => {
    expect(paragraphs(render({ readBack: [] }))[0]).toBe("Good morning, Mrs Chen.");
    expect(paragraphs(render({ readBack: ["", "  "] }))[0]).toBe("Good morning, Mrs Chen.");
  });

  it("apologises for a late arrival before the greeting", () => {
    const arrival = render({ late: true, readBack: ["Sam: Hello"] });
    expect(paragraphs(arrival).slice(0, 2)).toEqual([
      "From yesterday:\nSam: Hello",
      "Sorry this is late.\nGood morning, Mrs Chen.",
    ]);
  });

  it("prefaces a repeat, and a repeat carries no apology for lateness", () => {
    expect(paragraphs(render({ repeat: true }))[0]).toBe(
      "In case you missed it:\nGood morning, Mrs Chen.",
    );
    expect(paragraphs(render({ repeat: true, late: true }))[0]).toBe(
      "In case you missed it:\nGood morning, Mrs Chen.",
    );
  });

  it("names the parent who asks for a child", () => {
    const arrival = render({ ask: question({ askerName: "Anna", onBehalfOf: "Leo" }) });
    expect(paragraphs(arrival)[1]).toBe("Anna asks, for Leo:\nWhat did you cook today?");
  });

  it("shows at most three chips, keeping each chip's index when an empty one is left out", () => {
    const arrival = render({ ask: question({ chips: ["Soup", " ", "Rice", "Noodles"] }) });
    expect(labels(arrival)).toEqual([["Soup"], ["Rice"], ["❤️", "I'm fine"]]);
    expect(actions(arrival).slice(0, 2)).toEqual([
      [{ type: "chip", exchangeId: EXCHANGE, index: 0 }],
      [{ type: "chip", exchangeId: EXCHANGE, index: 2 }],
    ]);
  });

  it("shortens a chip too long for a button without splitting a character", () => {
    const long = `${"a".repeat(62)}😀😀`;
    const arrival = render({ ask: question({ chips: [long] }) });
    const label = labels(arrival)[0]?.[0] ?? "";
    expect(label.length).toBeLessThanOrEqual(64);
    expect(label).toBe(`${"a".repeat(62)}…`);
    expectSendable(arrival, "en");
  });

  it("asks a photo choice with 1 and 2", () => {
    const arrival = render({
      ask: question({ type: "photo_choice", text: "Which one should I frame?", imageCount: 2 }),
    });
    expect(paragraphs(arrival)[1]).toBe(
      "Mia asks:\nWhich one should I frame?\nWhich one? Tap 1 or 2.",
    );
    expect(labels(arrival)).toEqual([
      ["1", "2"],
      ["❤️", "I'm fine"],
    ]);
    expect(actions(arrival)).toEqual([
      [
        { type: "pick", exchangeId: EXCHANGE, index: 0 },
        { type: "pick", exchangeId: EXCHANGE, index: 1 },
      ],
      FINAL_ACTIONS,
    ]);
    expectSendable(arrival, "en");
  });

  it("asks a vote with one row per option, within the message's row limit", () => {
    const arrival = render({
      ask: question({ type: "vote", text: "Sunday call at 6 or 7?", voteOptions: ["6", "7"] }),
    });
    expect(paragraphs(arrival)[1]).toBe("Mia asks:\nSunday call at 6 or 7?\nTap one.");
    expect(labels(arrival)).toEqual([["6"], ["7"], ["❤️", "I'm fine"]]);
    expect(actions(arrival).slice(0, 2)).toEqual([
      [{ type: "vote", exchangeId: EXCHANGE, index: 0 }],
      [{ type: "vote", exchangeId: EXCHANGE, index: 1 }],
    ]);

    const many = render({
      ask: question({
        type: "vote",
        voteOptions: Array.from({ length: 12 }, (_, i) => `Option ${i + 1}`),
      }),
    });
    expect(many.buttons).toHaveLength(MAX_VOTE_OPTIONS + 1);
    expectSendable(many, "en");
  });

  it.each(["story", "recipe", "memory_photo"] as const)("shows no chips on a %s ask", (type) => {
    const arrival = render({
      ask: question({ type, chips: ["Soup"], text: "How did you meet Dad?" }),
    });
    expect(labels(arrival)).toEqual([["❤️", "I'm fine"]]);
    expect(paragraphs(arrival)[1]).toBe("Mia asks:\nHow did you meet Dad?");
  });

  it("says a voice message was sent when a voice note has no text", () => {
    const arrival = render({ ask: question({ type: "voice_note", text: null }) });
    expect(paragraphs(arrival)).toEqual([
      "Good morning, Mrs Chen.",
      "Mia sent you a voice message.",
      "Reply with a voice message, or tap a button.",
    ]);
    expect(labels(arrival)).toEqual([["❤️", "I'm fine"]]);
    expect(paragraphs(render({ ask: question({ type: "voice_note", text: "  " }) }))[1]).toBe(
      "Mia sent you a voice message.",
    );
  });

  it("says a photo was sent when a question with an image has no text, keeping its chips", () => {
    const arrival = render({
      ask: question({ text: null, imageCount: 1, chips: ["Lovely", "Where?"] }),
    });
    expect(paragraphs(arrival)[1]).toBe("Mia sent you a photo.");
    expect(labels(arrival)).toEqual([["Lovely"], ["Where?"], ["❤️", "I'm fine"]]);
    expectSendable(arrival, "en");
  });

  it("says a photo was sent when a memory photo has no text", () => {
    const arrival = render({ ask: question({ type: "memory_photo", text: null, imageCount: 1 }) });
    expect(paragraphs(arrival)[1]).toBe("Mia sent you a photo.");
  });

  it("keeps the asker line and the caption when a photo comes with words", () => {
    const arrival = render({ ask: question({ text: "Remember this garden?", imageCount: 1 }) });
    expect(paragraphs(arrival)[1]).toBe("Mia asks:\nRemember this garden?");
  });

  it("names the asker alone when an ask without images has no text", () => {
    expect(paragraphs(render({ ask: question({ text: null }) }))[1]).toBe("Mia asks:");
    const memory = render({ ask: question({ type: "memory_photo", text: null, imageCount: 0 }) });
    expect(paragraphs(memory)[1]).toBe("Mia asks:");
  });

  it("sends the fallback hello signed by Vela with only the heart and I'm fine", () => {
    const arrival = render({ ask: { type: "hello" }, readBack: ["Sam: See you Sunday"] });
    expect(paragraphs(arrival)).toEqual([
      "From yesterday:\nSam: See you Sunday",
      "Good morning, Mrs Chen.",
      "Nothing new from the family today. How are you this morning?\nVela, from your family",
      "Reply with a voice message, or tap a button.",
    ]);
    expect(actions(arrival)).toEqual([FINAL_ACTIONS]);
    expectSendable(arrival, "en");
  });
});

describe("renderArrival in Traditional Chinese", () => {
  const lang = "zh-TW";

  it("builds the same structure from the Traditional Chinese copy", () => {
    const arrival = render({
      lang,
      address: "陳奶奶",
      late: true,
      readBack: ["小明：奶奶的湯很好喝"],
      ask: question({ askerName: "小美", text: "今天煮了什麼？", chips: ["湯", "麵"] }),
    });
    expect(paragraphs(arrival)).toEqual([
      "昨天家人的回覆：\n小明：奶奶的湯很好喝",
      "不好意思，這則訊息晚到了。\n陳奶奶，早安。",
      "小美想問您：\n今天煮了什麼？",
      "您可以傳語音訊息回覆，或按下面的按鈕。",
    ]);
    expect(labels(arrival)).toEqual([["湯"], ["麵"], ["❤️", "我很好"]]);
    expectSendable(arrival, lang);
  });

  it("renders every line from the zh-TW catalog for a photo choice asked on behalf of a child", () => {
    const arrival = render({
      lang,
      address: "陳奶奶",
      repeat: true,
      ask: question({
        type: "photo_choice",
        askerName: "小美",
        onBehalfOf: "小寶",
        text: null,
        imageCount: 2,
      }),
    });
    expect(paragraphs(arrival)).toEqual([
      `${t(lang, "arrival.repeat")}\n${t(lang, "arrival.greeting", { address: "陳奶奶" })}`,
      `${t(lang, "arrival.asks_on_behalf", { asker: "小美", child: "小寶" })}\n${t(lang, "arrival.photo_choice")}`,
      t(lang, "arrival.hint"),
    ]);
    expect(paragraphs(arrival)[1]).toBe("小美替小寶問您：\n選哪一張呢？請按 1 或 2。");
    expect(labels(arrival)).toEqual([
      ["1", "2"],
      ["❤️", "我很好"],
    ]);
    expectSendable(arrival, lang);
  });

  it("says a voice message or a photo was sent when the ask has no text", () => {
    const voice = render({
      lang,
      address: "陳奶奶",
      ask: question({ type: "voice_note", askerName: "小美", text: null }),
    });
    expect(paragraphs(voice)).toEqual([
      "陳奶奶，早安。",
      "小美傳了一則語音訊息給您。",
      "您可以傳語音訊息回覆，或按下面的按鈕。",
    ]);
    expectSendable(voice, lang);
    const photo = render({
      lang,
      address: "陳奶奶",
      ask: question({ askerName: "小美", text: null, imageCount: 1 }),
    });
    expect(paragraphs(photo)[1]).toBe("小美傳了一張照片給您。");
    const memory = render({
      lang,
      address: "陳奶奶",
      ask: question({ type: "memory_photo", askerName: "小美", text: null, imageCount: 1 }),
    });
    expect(paragraphs(memory)[1]).toBe("小美傳了一張照片給您。");
  });

  it("sends the fallback hello in Traditional Chinese", () => {
    const arrival = render({ lang, address: "陳奶奶", ask: { type: "hello" } });
    expect(paragraphs(arrival)).toEqual([
      "陳奶奶，早安。",
      "今天家人沒有新的消息。您早上過得好嗎？\nVela，代表您的家人",
      "您可以傳語音訊息回覆，或按下面的按鈕。",
    ]);
    expect(labels(arrival)).toEqual([["❤️", "我很好"]]);
  });

  it("asks a vote with the Traditional Chinese instruction", () => {
    const arrival = render({
      lang,
      address: "陳奶奶",
      ask: question({
        type: "vote",
        askerName: "小美",
        text: "星期天幾點視訊？",
        voteOptions: ["六點", "七點"],
      }),
    });
    expect(paragraphs(arrival)[1]).toBe("小美想問您：\n星期天幾點視訊？\n請按一個選項。");
    expect(labels(arrival)).toEqual([["六點"], ["七點"], ["❤️", "我很好"]]);
  });
});
