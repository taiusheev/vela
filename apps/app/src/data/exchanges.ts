import { t } from "@lingui/core/macro";
import type { ReplyKind } from "@vela/contracts";
import { clockTime } from "./format.ts";
import type { ExchangePhoto } from "./today.ts";

/**
 * What the Exchanges list and one exchange need (spec §14.1 A8), in the screens’ idiom. With an API
 * the list comes from `GET /v1/families/:id/exchanges` (`useExchanges`); these example days stand
 * in when there is none.
 */

export interface ExchangeReply {
  id: string;
  from: string;
  /**
   * Words, or what came without any: a heart, a laugh, a hug, a voice message or a photo, read out
   * as one whole line by `replyLine`. The parent hears the substance, never a count.
   */
  kind: ReplyKind;
  text?: string;
}

export interface ExchangeAnswer {
  text: string;
  at: string;
  /** Her own words before translation, shown by the language switch. */
  original?: string;
  transcript?: boolean;
}

export interface Exchange {
  id: string;
  asker: string;
  recipient: string;
  ask: string;
  askOriginal?: string;
  day: string;
  answer?: ExchangeAnswer;
  replies: ExchangeReply[];
  receipt?: string;
  /**
   * Whether a reply written now reaches her. Her next morning reads back only her latest exchange,
   * so on any older one a reply is kept for the family and never heard (API contract §4).
   */
  repliesReachHer?: boolean;
  /** The ask's photos, in the order she saw them (ADR-33): a photo choice's first is her "1". */
  photos?: ExchangePhoto[];
  /** The photo she picked on a photo choice, which the detail screen rings. */
  picked?: string;
}

/** The receipt in the words `useToday` gives a real one, so the two share one translation. */
function seen(recipient: string, time: string): string {
  return t`${recipient} saw it · ${time}`;
}

/**
 * The example days in the language active when called, so they read as one language with the
 * screen around them. Given names stay as they are, a role such as Mom is translated, and her
 * original stays in the Russian she wrote.
 */
export function exchangesFixture(): Exchange[] {
  const mom = t`Mom`;
  return [
    {
      id: "x1",
      asker: "Mia",
      recipient: mom,
      ask: t`What did the garden look like this morning?`,
      day: t`Today`,
      answer: {
        text: t`The tomatoes finally turned. I picked three before breakfast and left them on the sill.`,
        at: clockTime(8, 12),
        original: "Помидоры наконец покраснели. Сняла три до завтрака, оставила на подоконнике.",
      },
      replies: [
        { id: "r1", from: "Mia", kind: "heart" },
        {
          id: "r2",
          from: "Anna",
          kind: "text",
          text: t`Those are the ones from the seeds you saved`,
        },
      ],
      receipt: seen(mom, clockTime(8, 12)),
      repliesReachHer: true,
    },
    {
      id: "x2",
      asker: "Anna",
      recipient: mom,
      ask: t`Which one of us did you teach to make the pies?`,
      day: t`Yesterday`,
      answer: {
        text: t`Both of you, but only Mia listened about the butter.`,
        at: clockTime(9, 5),
        transcript: true,
      },
      replies: [
        { id: "r3", from: "Mia", kind: "laugh" },
        { id: "r4", from: "Anna", kind: "text", text: t`She is never letting that go` },
      ],
      receipt: seen(mom, clockTime(9, 5)),
    },
    {
      id: "x3",
      asker: "Mia",
      recipient: mom,
      ask: t`A photo of the street where you grew up — do you remember the shop on the corner?`,
      day: t`Sunday`,
      answer: {
        text: t`It was a bakery, then a bookshop. We queued there for bread in the winter.`,
        at: clockTime(8, 40),
      },
      replies: [{ id: "r5", from: "Anna", kind: "hug" }],
      receipt: seen(mom, clockTime(8, 41)),
      // Sent through the family group, so the example shows where such a photo is kept.
      photos: [{ id: "p3", width: null, height: null, stored: false }],
    },
  ];
}
