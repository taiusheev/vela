/**
 * One arrival as plain text and buttons (spec §4.3–4.5, §14.3 M2 and M4), in her language.
 *
 * Text, in paragraphs: yesterday's replies under their heading; the late note or the repeat preface;
 * the greeting; the ask (who asks, what, and how to answer it, or, for a voice note or photo without
 * words, who sent it) or the fallback hello with its signature; the hint. Buttons: the question's
 * chips one per row, the photo choice's 1 and 2, the vote's options one per row, and always a last
 * row with a heart and "I'm fine", so every arrival can be answered with one tap.
 */
import type { Button, ExchangeType, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { type ButtonAction, encodeButton } from "./buttons.ts";
import { lineCap, shorten, TEXT_MAX_LENGTH } from "./text.ts";

export type ArrivalAsk =
  | { type: "hello" }
  | {
      type: Exclude<ExchangeType, "hello">;
      askerName: string;
      onBehalfOf: string | null;
      text: string | null;
      chips: string[];
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
}

export interface RenderedArrival {
  text: string;
  buttons: Button[][];
}

/** Spec §5.3: up to three chips. */
export const MAX_CHIPS = 3;
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
 * Who asks, what (`text`, already trimmed), and how to answer. An ask without words would otherwise
 * leave "Mia asks:" hanging over nothing, so a voice note, or a question or memory photo that carries
 * images, says what was sent instead.
 */
function askLines(lang: Lang, ask: Exclude<ArrivalAsk, { type: "hello" }>, text: string): string[] {
  const asker = ask.askerName;
  if (text.length === 0) {
    if (ask.type === "voice_note") {
      return [t(lang, "arrival.sent_voice", { asker })];
    }
    if ((ask.type === "question" || ask.type === "memory_photo") && ask.imageCount > 0) {
      return [t(lang, "arrival.sent_photo", { asker })];
    }
  }
  const lines = [
    ask.onBehalfOf === null
      ? t(lang, "arrival.asks", { asker })
      : t(lang, "arrival.asks_on_behalf", { asker, child: ask.onBehalfOf }),
  ];
  if (text.length > 0) {
    lines.push(text);
  }
  if (ask.type === "photo_choice") {
    lines.push(t(lang, "arrival.photo_choice"));
  } else if (ask.type === "vote") {
    lines.push(t(lang, "arrival.vote"));
  }
  return lines;
}

/** The ask's own buttons, above the heart and "I'm fine". */
function askRows(lang: Lang, exchangeId: string, ask: ArrivalAsk): Button[][] {
  switch (ask.type) {
    // Spec §5.3: chips belong to questions; story, recipe, and memory asks are answered by voice.
    case "question":
      return optionRows(ask.chips, MAX_CHIPS, (index) => ({ type: "chip", exchangeId, index }));
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
  opening.push(t(lang, "arrival.greeting", { address: input.address }));
  paragraphs.push(opening);

  paragraphs.push(
    ask.type === "hello"
      ? [t(lang, "arrival.hello"), t(lang, "arrival.hello_signature")]
      : askLines(lang, ask, askText),
  );
  paragraphs.push([t(lang, "arrival.hint")]);
  return paragraphs.map((lines) => lines.join("\n")).join("\n\n");
}

/**
 * The text within `OutboundMessage`'s limit. An over-long text would make the platform refuse the
 * whole arrival and leave her without a morning, so the family's words are shortened instead, never
 * the greeting, who asks, or the hint. The read-back yields first, down to a floor for each line; then
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
  return {
    text: fitText(input, readBack, askText),
    buttons: [
      ...askRows(lang, exchangeId, ask),
      [
        button(t(lang, "button.heart"), { type: "answer", exchangeId, answer: "heart" }),
        button(t(lang, "button.fine"), { type: "answer", exchangeId, answer: "fine" }),
      ],
    ],
  };
}
