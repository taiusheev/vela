/**
 * One arrival as plain text and buttons (spec §4.3–4.5, §14.3 M2 and M4), in her language.
 *
 * Text, in paragraphs: yesterday's replies under their heading; the late note or the repeat preface;
 * the greeting, worded three ways in turn by her local date; the ask, written as a note from the one
 * who asks (their words and how to choose for a photo choice or vote, then their name, as a signed
 * message reads; for a voice note or photo without words, who sent it, or that the photo is gone), or
 * the fallback hello signed by Vela; and, on her first mornings only, the hint on how to answer
 * (first test, 15 Oct 2026: a morning should read as her child writing, not as a bot).
 * Buttons: the photo choice's 1 and 2, the vote's options one per row, and always a last row with a
 * heart and "I'm fine", so every arrival can be answered with one tap. A question has no answers to
 * tap (founder, 27 Oct 2026: a tapped answer tells the family nothing, she should talk with them),
 * so the heart or "I'm fine" lights the light and her thanks asks for her own words.
 *
 * With the check-in on (ADR-54) the morning has no heart and "I'm fine" either: she answers in her
 * own words, and a morning she has not answered by the repeat gets the check-in instead
 * (`renderCheckIn`), whose two buttons say whether she is okay.
 */
import type { Button, ExchangeType, Lang, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { type ButtonAction, encodeButton } from "./buttons.ts";
import { lineCap, shorten, TEXT_MAX_LENGTH } from "./text.ts";

export type ArrivalAsk =
  | {
      type: "hello";
      /**
       * Vela's question from the question bank on a morning nobody in the family asked, in her
       * language, so the fallback asks something new instead of the same "how are you" each time;
       * null or absent keeps the plain hello.
       */
      question?: string | null;
    }
  | {
      type: Exclude<ExchangeType, "hello">;
      askerName: string;
      onBehalfOf: string | null;
      text: string | null;
      voteOptions: string[];
      /**
       * Images the caller attaches before the text. The buttons do not depend on it: a photo choice
       * is always two photos (spec §4.4), and the copy says "Tap 1 or 2".
       */
      imageCount: number;
    };

export interface RenderArrivalInput {
  lang: Lang;
  address: string;
  exchangeId: string;
  ask: ArrivalAsk;
  /** Already-rendered read-back lines, possibly empty. */
  readBack: string[];
  late: boolean;
  repeat: boolean;
  /** Her local date of the morning, which picks the greeting's wording. */
  date: LocalDate;
  /**
   * Whether to end with how to answer. She needs it while the ritual is new; every day after, the
   * line would only make a note from her family read like a form.
   */
  hint: boolean;
  /**
   * Whether the check-in is on (ADR-54, `CHECK_IN`): the morning then carries no heart or "I'm
   * fine", and its hint asks for her words. Absent means off.
   */
  checkIn?: boolean;
}

export interface RenderedArrival {
  text: string;
  buttons: Button[][];
}

/** `OutboundMessage` allows eight rows of buttons, and the last one is always heart and "I'm fine". */
export const MAX_VOTE_OPTIONS = 7;
/** `Button.label` allows at most 64 characters. */
const LABEL_MAX_LENGTH = 64;
/** What a shortened read-back line keeps before the ask gives up any words: the name and a start. */
const READBACK_LINE_FLOOR = 100;
/** What a shortened ask keeps before the read-back lines go below their floor. */
const ASK_TEXT_FLOOR = 1000;

/**
 * A family-written label that fits a button. An over-long label would make the platform refuse the
 * whole arrival, so it is shortened instead; the answer is resolved by index, never by the label.
 */
function fitLabel(text: string): string {
  return shorten(text.trim(), LABEL_MAX_LENGTH);
}

function button(label: string, action: ButtonAction): Button {
  return { id: encodeButton(action), label };
}

/**
 * Options become one button per row, keeping each option's position as its index even when an empty
 * one is left out, so a tap always resolves to the option that was shown.
 */
function optionRows(
  options: readonly string[],
  limit: number,
  action: (index: number) => ButtonAction,
): Button[][] {
  const rows: Button[][] = [];
  options.slice(0, limit).forEach((option, index) => {
    const label = fitLabel(option);
    if (label.length > 0) {
      rows.push([button(label, action(index))]);
    }
  });
  return rows;
}

/**
 * The greeting, worded three ways in turn by her local date, so the mornings do not open with the
 * same line day after day, as a person writing would not.
 */
const GREETINGS = ["arrival.greeting", "arrival.greeting_2", "arrival.greeting_3"] as const;

export function greetingKeyFor(date: LocalDate): (typeof GREETINGS)[number] {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return (
    GREETINGS[((day % GREETINGS.length) + GREETINGS.length) % GREETINGS.length] ?? GREETINGS[0]
  );
}

/**
 * The ask as a note from the one who asks (`text`, already trimmed): their words, how to choose for a
 * photo choice or a vote, then their name below, as a signed message reads. An ask without words
 * would otherwise leave a name signed under nothing, so a voice note, or a question or memory photo
 * that carries images, says who sent what instead. Only a photo comes as a question or a memory photo
 * without words (a text message is words, and the app asks with words), so one with no image left
 * lost its photos, to retention or to her channel: it says so, and asks how she is, so her morning
 * still asks her something. A photo choice short of two arrives here as a question.
 */
function askLines(lang: Lang, ask: Exclude<ArrivalAsk, { type: "hello" }>, text: string): string[] {
  const asker = ask.askerName;
  if (text.length === 0) {
    if (ask.type === "voice_note") {
      return [t(lang, "arrival.sent_voice", { asker })];
    }
    if (ask.type === "question" || ask.type === "memory_photo") {
      return [t(lang, ask.imageCount > 0 ? "arrival.sent_photo" : "arrival.photo_gone", { asker })];
    }
  }
  const lines = text.length > 0 ? [text] : [];
  if (ask.type === "photo_choice") {
    lines.push(t(lang, "arrival.photo_choice"));
  } else if (ask.type === "vote") {
    lines.push(t(lang, "arrival.vote"));
  }
  lines.push(
    ask.onBehalfOf === null
      ? t(lang, "arrival.signed", { asker })
      : t(lang, "arrival.signed_on_behalf", { asker, child: ask.onBehalfOf }),
  );
  return lines;
}

/**
 * The fallback: Vela's question when there is one, with an invitation to answer it by voice, else the
 * plain hello; always signed by Vela, as a short text reads, never under a header.
 */
function helloLines(lang: Lang, ask: Extract<ArrivalAsk, { type: "hello" }>): string[] {
  const question = ask.question?.trim() ?? "";
  return question.length === 0
    ? [t(lang, "arrival.hello"), t(lang, "arrival.hello_signature")]
    : [`${question} ${t(lang, "arrival.hello_question")}`, t(lang, "arrival.hello_signature")];
}

/**
 * The ask's own buttons, above the heart and "I'm fine": only a choice the family made for her. A
 * question, story, recipe or memory is answered in her own words.
 */
function askRows(lang: Lang, exchangeId: string, ask: ArrivalAsk): Button[][] {
  switch (ask.type) {
    case "photo_choice":
      return [
        [0, 1].map((index) =>
          button(t(lang, "button.choice", { n: index + 1 }), { type: "pick", exchangeId, index }),
        ),
      ];
    case "vote":
      return optionRows(ask.voteOptions, MAX_VOTE_OPTIONS, (index) => ({
        type: "vote",
        exchangeId,
        index,
      }));
    default:
      return [];
  }
}

/** The text with the family's words exactly as given: the read-back lines and the ask's text. */
function composeText(
  input: RenderArrivalInput,
  readBack: readonly string[],
  askText: string,
): string {
  const { lang, ask } = input;
  const paragraphs: string[][] = [];
  if (readBack.length > 0) {
    paragraphs.push([t(lang, "arrival.readback_heading"), ...readBack]);
  }

  // A repeat re-sends a morning that already went out, so an apology for lateness belongs only to the
  // first sending.
  const opening: string[] = [];
  if (input.repeat) {
    opening.push(t(lang, "arrival.repeat"));
  } else if (input.late) {
    opening.push(t(lang, "arrival.late"));
  }
  if (!input.repeat) opening.push(t(lang, greetingKeyFor(input.date), { address: input.address }));
  paragraphs.push(opening);

  paragraphs.push(ask.type === "hello" ? helloLines(lang, ask) : askLines(lang, ask, askText));
  if (input.hint && !input.repeat) {
    paragraphs.push([t(lang, input.checkIn === true ? "arrival.hint_words" : "arrival.hint")]);
  }
  return paragraphs.map((lines) => lines.join("\n")).join("\n\n");
}

/**
 * The text within `OutboundMessage`'s limit. An over-long text would make the platform refuse the
 * whole arrival and leave her without a morning, so the family's words are shortened instead, never
 * the greeting, who signs, or the hint. The read-back yields first, down to a floor for each line; then
 * the ask, down to its own floor; then the read-back again. A line is shortened, never dropped: every
 * reply behind the read-back is marked as read back once the arrival is sent.
 */
function fitText(input: RenderArrivalInput, readBack: readonly string[], askText: string): string {
  const full = composeText(input, readBack, askText);
  if (full.length <= TEXT_MAX_LENGTH) {
    return full;
  }
  const readBackLength = readBack.reduce((sum, line) => sum + line.length, 0);
  const room = TEXT_MAX_LENGTH - (full.length - readBackLength - askText.length);
  const readBackAtFloor = readBack.reduce(
    (sum, line) => sum + Math.min(line.length, READBACK_LINE_FLOOR),
    0,
  );
  const fittedAsk = shorten(askText, Math.max(room - readBackAtFloor, ASK_TEXT_FLOOR));
  const cap = lineCap(readBack, room - fittedAsk.length);
  return composeText(
    input,
    readBack.map((line) => shorten(line, cap)),
    fittedAsk,
  );
}

export function renderArrival(input: RenderArrivalInput): RenderedArrival {
  const { lang, exchangeId, ask } = input;
  const readBack = input.readBack.filter((line) => line.trim().length > 0);
  const askText = ask.type === "hello" ? "" : (ask.text?.trim() ?? "");
  const askButtons = askRows(lang, exchangeId, ask);
  return {
    text: fitText(input, readBack, askText),
    buttons:
      input.checkIn === true
        ? askButtons
        : [
            ...askButtons,
            [
              button(t(lang, "button.heart"), { type: "answer", exchangeId, answer: "heart" }),
              button(t(lang, "button.fine"), { type: "answer", exchangeId, answer: "fine" }),
            ],
          ],
  };
}

/**
 * The check-in (ADR-54): sent in place of the repeat when her morning is still unanswered, a short
 * note asking how she is, with "I'm okay" and "Not okay, tell my family" one per row, so the tap
 * that matters most is the easiest to read. Either tap answers her morning and lights the light.
 */
export function renderCheckIn(input: {
  lang: Lang;
  address: string;
  exchangeId: string;
}): RenderedArrival {
  const { lang, exchangeId } = input;
  return {
    text: t(lang, "checkin.text", { address: input.address }),
    buttons: [
      [button(t(lang, "button.okay"), { type: "answer", exchangeId, answer: "fine" })],
      [button(t(lang, "button.not_okay"), { type: "answer", exchangeId, answer: "not_okay" })],
    ],
  };
}
