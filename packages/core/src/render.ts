/**
 * One arrival as plain text and buttons (spec §4.3–4.5, §14.3 M2 and M4), in her language.
 *
 * Text, in paragraphs: yesterday's replies under their heading; the late note or the repeat preface;
 * the greeting; the ask (who asks, what, and how to answer it) or the fallback hello with its
 * signature; the hint. Buttons: the question's chips one per row, the photo choice's 1 and 2, the
 * vote's options one per row, and always a last row with a heart and "I'm fine", so every arrival
 * can be answered with one tap.
 */
import type { Button, ExchangeType, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { type ButtonAction, encodeButton } from "./buttons.ts";

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

/**
 * A family-written label that fits a button. An over-long label would make the platform refuse the
 * whole arrival, so it is shortened instead; the answer is resolved by index, never by the label.
 * Cuts fall between code points so no half of a surrogate pair is left behind.
 */
function fitLabel(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= LABEL_MAX_LENGTH) {
    return trimmed;
  }
  let label = "";
  for (const character of trimmed) {
    if (label.length + character.length > LABEL_MAX_LENGTH - 1) {
      break;
    }
    label += character;
  }
  return `${label.trimEnd()}…`;
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

export function renderArrival(input: RenderArrivalInput): RenderedArrival {
  const { lang, exchangeId, ask } = input;
  const paragraphs: string[][] = [];

  const readBack = input.readBack.filter((line) => line.trim().length > 0);
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

  const rows: Button[][] = [];
  if (ask.type === "hello") {
    paragraphs.push([t(lang, "arrival.hello"), t(lang, "arrival.hello_signature")]);
  } else {
    const lines = [
      ask.onBehalfOf === null
        ? t(lang, "arrival.asks", { asker: ask.askerName })
        : t(lang, "arrival.asks_on_behalf", { asker: ask.askerName, child: ask.onBehalfOf }),
    ];
    const text = ask.text?.trim() ?? "";
    if (text.length > 0) {
      lines.push(text);
    }
    switch (ask.type) {
      // Spec §5.3: chips belong to questions; story, recipe, and memory asks are answered by voice.
      case "question":
        rows.push(
          ...optionRows(ask.chips, MAX_CHIPS, (index) => ({ type: "chip", exchangeId, index })),
        );
        break;
      case "photo_choice":
        lines.push(t(lang, "arrival.photo_choice"));
        rows.push(
          [0, 1].map((index) =>
            button(t(lang, "button.choice", { n: index + 1 }), { type: "pick", exchangeId, index }),
          ),
        );
        break;
      case "vote":
        lines.push(t(lang, "arrival.vote"));
        rows.push(
          ...optionRows(ask.voteOptions, MAX_VOTE_OPTIONS, (index) => ({
            type: "vote",
            exchangeId,
            index,
          })),
        );
        break;
      default:
        break;
    }
    paragraphs.push(lines);
  }

  paragraphs.push([t(lang, "arrival.hint")]);
  rows.push([
    button(t(lang, "button.heart"), { type: "answer", exchangeId, answer: "heart" }),
    button(t(lang, "button.fine"), { type: "answer", exchangeId, answer: "fine" }),
  ]);

  return {
    text: paragraphs.map((lines) => lines.join("\n")).join("\n\n"),
    buttons: rows,
  };
}
