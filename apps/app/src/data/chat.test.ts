import { i18n } from "@lingui/core";
import type { ApiExchangeSummary, ApiTodayAnswer } from "@vela/contracts";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type ChatMessage,
  dayLabel,
  newestMine,
  type PendingChatMessage,
  pendingHasArrived,
  showsStatus,
  showsTime,
  startsGroup,
  toChat,
} from "./chat.ts";
import { weekWindows } from "./week-windows.ts";

// The macros compile away when the app is bundled; here `t` reads the English as written.
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (line, part, index) => `${line}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));

beforeAll(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

const MOM = "00000000-0000-7000-8000-000000000001";
const MIA = "00000000-0000-7000-8000-000000000002";
const ANNA = "00000000-0000-7000-8000-000000000003";

function answer(at: string, text: string | null, kind = "text"): ApiTodayAnswer {
  return {
    kind: kind as ApiTodayAnswer["kind"],
    text,
    at,
    picked_media_id: null,
    picked_number: null,
    translation: null,
    audio: null,
    photo: null,
  };
}

function exchange(over: Partial<ApiExchangeSummary> & { id: string }): ApiExchangeSummary {
  return {
    recipient_id: MOM,
    recipient_name: "Mom",
    recipient_tz: "Asia/Taipei",
    asker_name: "Mia",
    asker_id: MIA,
    on_behalf_of: null,
    type: "question",
    ask: "What did the garden look like?",
    voice_hello: null,
    answer: null,
    replies: [],
    seen_at: null,
    replies_reach_her: true,
    photos: [],
    scheduled_for: null,
    delivered_at: "2026-10-17T00:00:00.000Z",
    delivery_status: "delivered",
    ...over,
  };
}

describe("the chat with a parent", () => {
  it("puts the reader on the right, her and the family on the left, in the order things happened", () => {
    const morning = exchange({
      id: "x1",
      scheduled_for: "2026-10-17",
      answers: [
        answer("2026-10-17T00:12:00.000Z", "The tomatoes turned."),
        answer("2026-10-17T00:14:00.000Z", "Three of them."),
      ],
      answer: answer("2026-10-17T00:14:00.000Z", "Three of them."),
      replies: [
        {
          from: "Anna",
          from_id: ANNA,
          at: "2026-10-17T00:20:00.000Z",
          kind: "text",
          text: "From your seeds!",
          photo: null,
          audio: null,
        },
        {
          from: "Mia",
          from_id: MIA,
          at: "2026-10-17T00:21:00.000Z",
          kind: "heart",
          text: null,
          photo: null,
          audio: null,
        },
      ],
      seen_at: "2026-10-17T00:05:00.000Z",
    });
    const now = exchange({
      id: "x2",
      ask: "Save me two?",
      delivered_at: "2026-10-17T01:00:00.000Z",
      answers: [answer("2026-10-17T01:05:00.000Z", null, "heart")],
      answer: answer("2026-10-17T01:05:00.000Z", null, "heart"),
    });
    // The list reads newest first; the chat oldest first.
    const chat = toChat([now, morning], MOM, { id: MIA });
    expect(chat.map((message) => [message.side, message.text])).toEqual([
      ["me", "What did the garden look like?"],
      ["her", "The tomatoes turned."],
      ["her", "Three of them."],
      ["family", "From your seeds!"],
      ["me", "Save me two?"],
      ["her", "❤️"],
    ]);
    expect(chat[0]?.morning).toBe(true);
    expect(chat[0]?.status).toBe("seen");
    expect(chat[4]?.morning).toBeUndefined();
    expect(chat[4]?.status).toBe("delivered");
    expect(chat[5]?.tap).toBe(true);
    // A heart goes under her last message of that exchange, marked as the reader's own.
    expect(chat[2]?.reactions).toEqual([{ kind: "heart", from: "Mia", mine: true }]);
    expect(chat[2]?.time).toBe("8:14");
    expect(chat[2]?.day).toBe("2026-10-17");
  });

  it("reads an older response, with only her latest answer and no ids, by the reader's name", () => {
    const older = exchange({
      id: "x1",
      asker_id: undefined,
      answer: answer("2026-10-17T00:12:00.000Z", "Lovely."),
      replies: [
        { from: "Mia", kind: "text", text: "Glad!", photo: null, audio: null },
      ] as ApiExchangeSummary["replies"],
    });
    const chat = toChat([older], MOM, { name: "Mia" });
    expect(chat.map((message) => [message.side, message.text])).toEqual([
      ["me", "What did the garden look like?"],
      ["her", "Lovely."],
      ["me", "Glad!"],
    ]);
  });

  it("shows Vela's own hello centred, a message still on its way as sending, and leaves out other parents", () => {
    const hello = exchange({
      id: "x1",
      asker_name: null,
      asker_id: null,
      type: "hello",
      ask: null,
    });
    const sending = exchange({
      id: "x2",
      delivered_at: null,
      created_at: "2026-10-17T02:00:00.000Z",
      delivery_status: "pending",
    });
    const dad = exchange({ id: "x3", recipient_id: ANNA });
    const chat = toChat([sending, hello, dad], MOM, { id: MIA });
    expect(chat.map((message) => [message.side, message.status])).toEqual([
      ["vela", undefined],
      ["me", "sent"],
    ]);
  });

  it("groups one person's messages within five minutes, and names the days", () => {
    const chat = toChat(
      [
        exchange({
          id: "x1",
          answers: [
            answer("2026-10-17T00:12:00.000Z", "One."),
            answer("2026-10-17T00:13:00.000Z", "Two."),
            answer("2026-10-17T00:30:00.000Z", "Later."),
          ],
        }),
      ],
      MOM,
      { id: MIA },
    );
    const at = (index: number): ChatMessage => {
      const message = chat[index];
      if (message === undefined) throw new Error(`no message ${index}`);
      return message;
    };
    // The ask, then her three messages: two a minute apart, and one seventeen minutes later.
    expect(startsGroup(at(0), at(1))).toBe(true);
    expect(startsGroup(at(1), at(2))).toBe(false);
    expect(startsGroup(at(2), at(3))).toBe(true);
    expect(dayLabel("2026-10-17", "2026-10-17")).toBe("Today");
    expect(dayLabel("2026-10-16", "2026-10-17")).toBe("Yesterday");
    expect(dayLabel("2026-10-12", "2026-10-17")).toBe("Monday 12 Oct");
  });
});

describe("how much the chat says around each message", () => {
  const MINUTE = 60_000;
  const base = Date.parse("2026-10-17T00:00:00.000Z");
  function message(key: string, over: Partial<ChatMessage> = {}): ChatMessage {
    return {
      key,
      exchangeId: "x1",
      side: "her",
      from: "Mom",
      at: base,
      day: "2026-10-17",
      time: "08:00",
      text: key,
      reactions: [],
      ...over,
    };
  }

  it("shows a time after the last message, at a new day and after a pause of half an hour", () => {
    const first = message("a");
    expect(showsTime(first, undefined)).toBe(true);
    expect(showsTime(first, message("b", { day: "2026-10-18", at: base + 5 * MINUTE }))).toBe(true);
    expect(showsTime(first, message("b", { at: base + 30 * MINUTE }))).toBe(true);
    expect(showsTime(first, message("b", { at: base + 17 * MINUTE }))).toBe(false);
  });

  it("says Seen or Delivered once, under the reader's newest message", () => {
    const chat = [
      message("ask", { side: "me", from: "Mia", status: "seen" }),
      message("hers", { at: base + MINUTE }),
      message("later", { side: "me", from: "Mia", status: "seen", at: base + 2 * MINUTE }),
    ];
    const newest = newestMine(chat);
    expect(newest).toBe("later");
    expect(showsStatus(chat[0] as ChatMessage, newest)).toBe(false);
    expect(showsStatus(chat[2] as ChatMessage, newest)).toBe(true);
    expect(newestMine([message("hers")])).toBeUndefined();
  });

  it("always says when a message is still sending or was not delivered", () => {
    expect(showsStatus(message("a", { side: "me", status: "sending" }), "b")).toBe(true);
    expect(showsStatus(message("a", { side: "me", status: "failed" }), "b")).toBe(true);
    expect(showsStatus(message("a", { side: "me" }), "a")).toBe(false);
  });
});

describe("this week's windows", () => {
  const rolling = (today: string, lit: string[]) =>
    Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.parse(`${today}T12:00:00Z`) - (6 - index) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return { date, hasMessage: lit.includes(date) };
    });

  it("runs Monday to Sunday, lit from the left, with the days still ahead marked", () => {
    // Saturday 17 October 2026.
    const week = weekWindows(rolling("2026-10-17", ["2026-10-12", "2026-10-14", "2026-10-10"]));
    expect(week.map((day) => day.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    expect(week.map((day) => day.hasMessage)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(week.map((day) => day.ahead)).toEqual([false, false, false, false, false, false, true]);
    expect(week.find((day) => day.today)?.date).toBe("2026-10-17");
  });

  it("starts a new row on Monday, leaving last week's lights out", () => {
    const week = weekWindows(rolling("2026-10-19", ["2026-10-18", "2026-10-19"]));
    expect(week[0]).toEqual({ date: "2026-10-19", hasMessage: true, ahead: false, today: true });
    expect(week.filter((day) => day.hasMessage)).toHaveLength(1);
    expect(week.slice(1).every((day) => day.ahead)).toBe(true);
  });
});

describe("outgoing message reconciliation", () => {
  const pending: PendingChatMessage = {
    localId: "local",
    text: "Hello",
    since: 100_000,
    status: "sending",
    existingIds: ["old"],
  };
  const message = (exchangeId: string, text = "Hello", side: "me" | "her" = "me") => ({
    key: `${exchangeId}:ask`,
    exchangeId,
    side,
    text,
    at: 100_000,
    from: "Mia",
    day: "2026-10-23",
    time: "08:00",
    reactions: [],
  });
  it("hides the local copy when polling beats the send acknowledgement", () => {
    expect(pendingHasArrived(pending, [message("new")])).toBe(true);
  });
  it("never matches an earlier identical message or the parent's words", () => {
    expect(pendingHasArrived(pending, [message("old"), message("new", "Hello", "her")])).toBe(
      false,
    );
  });
  it("uses the accepted exchange ID after acknowledgement, even for repeated words", () => {
    const accepted = { ...pending, status: "sent" as const, exchangeId: "accepted" };
    expect(pendingHasArrived(accepted, [message("other")])).toBe(false);
    expect(pendingHasArrived(accepted, [message("accepted", "server words")])).toBe(true);
  });
  it("does not discard a delayed send just because time passed", () => {
    expect(pendingHasArrived({ ...pending, since: 1 }, [])).toBe(false);
  });
});
